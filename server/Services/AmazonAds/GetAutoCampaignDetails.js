const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const { generateAdsAccessToken } = require('./GenerateToken');
const gunzip = promisify(zlib.gunzip);
const userModel = require('../../models/user-auth/userModel.js');
// You'll need to create this new model
const AutoCampaignSearchTermsModel = require('../../models/amazon-ads/AutoCampaignSearchTermsModel.js');

// Base URIs for different regions
const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

async function getSearchTermReportId(accessToken, profileId, region, tokenRefreshCallback = null) {
    let currentAccessToken = accessToken;
    let hasRetried = false;

    while (true) {
        try {
            // Validate region and get base URI
            const baseUri = BASE_URIS[region];
            if (!baseUri) {
                throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
            }

            // Construct the endpoint URL
            const url = `${baseUri}/reporting/reports`;

            // Set up headers
            const headers = {
                'Authorization': `Bearer ${currentAccessToken}`,
                'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
                'Amazon-Advertising-API-Scope': profileId,
                'Content-Type': 'application/vnd.createasyncreportrequest.v3+json'
            };

            // Calculate dynamic dates
            const now = new Date();
            const endDate = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24 hours before now (1 day delay for data accuracy)
            const startDate = new Date(now.getTime() - (31 * 24 * 60 * 60 * 1000)); // 31 days before now
            
            // Format dates as YYYY-MM-DD strings
            const formatDate = (date) => {
                return date.toISOString().split('T')[0];
            };

            // Generate unique report name to prevent duplicate requests
            const timestamp = Date.now();
            const uniqueReportName = `Auto Campaign Search Terms Report - ${timestamp}`;

            // Set up request body for Search Term Report with AUTO campaigns filter
            const body = {
                "name": uniqueReportName,
                "startDate": formatDate(startDate),
                "endDate": formatDate(endDate),
                "configuration": {
                    "adProduct": "SPONSORED_PRODUCTS",
                    "reportTypeId": "spSearchTerm",  // Changed from spAdvertisedProduct
                    "timeUnit": "DAILY",
                    "format": "GZIP_JSON",
                    "groupBy": ["searchTerm", "campaignId"],  // Group by search term and campaign
                    "columns": [
                        "date",
                        "searchTerm",           // The actual search query
                        "campaignId",
                        "campaignName",
                        "adGroupId",
                        "adGroupName",
                        "advertisedAsin",       // Which ASIN was shown
                        "advertisedSku",
                        "impressions",
                        "clicks",
                        "cost",
                        "purchases1d",
                        "purchases7d",
                        "purchases14d",
                        "purchases30d",
                        "sales1d",
                        "sales7d",
                        "sales14d",
                        "sales30d",
                        "acos",                 // Advertising Cost of Sales
                        "roas"                  // Return on Ad Spend
                    ],
                    "filters": [
                        {
                            "field": "targetingType",
                            "values": ["AUTO"]  // CRITICAL: Only get auto campaigns
                        }
                    ]
                }
            }

            // Make the API request
            const response = await axios.post(url, body, { headers });

            // Return the response data with the current token
            return { ...response.data, currentAccessToken };

        } catch (error) {
            // Handle 401 Unauthorized - refresh token and retry once
            if (error.response && error.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetAutoCampaignDetails] Token expired during getSearchTermReportId, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        console.log(`✅ [GetAutoCampaignDetails] Token refreshed successfully, retrying getSearchTermReportId...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    console.error('❌ [GetAutoCampaignDetails] Failed to refresh token:', refreshError.message);
                    throw new Error(`Token refresh failed: ${refreshError.message}`);
                }
            }

            // Handle different types of errors
            if (error.response) {
                console.error('API Error Response:', {
                    status: error.response.status,
                    data: error.response.data,
                    headers: error.response.headers
                });
                // Preserve the original error structure for TokenManager to detect 401s
                const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
                enhancedError.response = error.response;
                enhancedError.status = error.response.status;
                enhancedError.statusCode = error.response.status;
                throw enhancedError;
            } else if (error.request) {
                console.error('No response received:', error.request);
                throw new Error('No response received from Amazon Ads API');
            } else {
                console.error('Request setup error:', error.message);
                throw error;
            }
        }
    }
}

async function checkReportStatus(reportId, accessToken, profileId, region, userId, tokenRefreshCallback = null) {
    try {
        // Validate region and get base URI
        const baseUri = BASE_URIS[region];
        if (!baseUri) {
            throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
        }

        // Construct the endpoint URL with reportId as parameter
        const url = `${baseUri}/reporting/reports/${reportId}`;
        let currentAccessToken = accessToken; // Use a mutable token variable

        // Poll for report status
        let attempts = 0;

        while (true) {
            try {
                // Set up headers with current token
                const headers = {
                    'Authorization': `Bearer ${currentAccessToken}`,
                    'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
                    'Amazon-Advertising-API-Scope': profileId,
                    'Content-Type': 'application/vnd.createasyncreportrequest.v3+json'
                };

                // Make GET request to check status
                const response = await axios.get(url, { headers });
                const { status } = response.data;
                const location = response.data.url;

                console.log(`📊 [GetAutoCampaignDetails] Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

                // Check if report is complete
                if (status === 'COMPLETED') {
                    console.log(`✅ [GetAutoCampaignDetails] Report completed after ${attempts + 1} attempts`);
                    return {
                        status: 'COMPLETED',
                        location: location,
                        reportId: reportId,
                        finalAccessToken: currentAccessToken
                    };
                } else if (status === 'FAILURE') {
                    console.error(`❌ [GetAutoCampaignDetails] Report generation failed after ${attempts + 1} attempts`);
                    return {
                        status: 'FAILURE',
                        reportId: reportId,
                        error: 'Report generation failed'
                    };
                }

                // If still processing, wait 60 seconds before next check
                if (status === 'PROCESSING' || status === 'PENDING') {
                    console.log(`⏳ [GetAutoCampaignDetails] Report still ${status}, waiting 60 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds
                    attempts++;
                } else {
                    // Unknown status
                    console.error(`❓ [GetAutoCampaignDetails] Unknown report status: ${status}`);
                    throw new Error(`Unknown report status: ${status}`);
                }

            } catch (error) {
                // Handle 401 Unauthorized - refresh token and continue polling
                if (error.response && error.response.status === 401) {
                    console.log(`⚠️ [GetAutoCampaignDetails] Token expired during polling (attempt ${attempts + 1}), refreshing token...`);
                    
                    if (tokenRefreshCallback) {
                        try {
                            // Get a fresh token using the callback
                            const newToken = await tokenRefreshCallback();
                            if (newToken) {
                                currentAccessToken = newToken;
                                console.log(`✅ [GetAutoCampaignDetails] Token refreshed successfully, continuing to poll report ${reportId}`);
                                // Continue the loop with the new token
                                continue;
                            } else {
                                throw new Error('Token refresh callback returned null/undefined');
                            }
                        } catch (refreshError) {
                            console.error('❌ [GetAutoCampaignDetails] Failed to refresh token during polling:', refreshError.message);
                            throw new Error(`Token refresh failed during polling: ${refreshError.message}`);
                        }
                    } else {
                        // No token refresh callback provided, throw the error
                        throw new Error('Token expired during polling and no refresh callback provided');
                    }
                }
                // If it's a network error, we might want to retry
                if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                    console.error(`Network error checking report status, retrying... (attempt ${attempts + 1})`);
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    attempts++;
                    continue;
                }
                throw error;
            }
        }

    } catch (error) {
        // Handle different types of errors
        if (error.response) {
            console.error('API Error Response:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
            // Preserve the original error structure for TokenManager to detect 401s
            const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            enhancedError.response = error.response;
            enhancedError.status = error.response.status;
            enhancedError.statusCode = error.response.status;
            throw enhancedError;
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response received from Amazon Ads API');
        } else {
            console.error('Report status check error:', error.message);
            throw error;
        }
    }
}

async function downloadSearchTermReportData(location, accessToken, profileId, tokenRefreshCallback = null) {
    let currentAccessToken = accessToken;
    let hasRetried = false;

    while (true) {
        try {
            // 1) Always ask for binary so we can gunzip ourselves
            const response = await axios.get(location, {
                responseType: 'arraybuffer',  // get raw bytes
                decompress: false             // turn off axios's auto-inflate
            });

            // 2) Inflate the GZIP buffer
            const inflatedBuffer = await gunzip(response.data);
            const payloadText = inflatedBuffer.toString('utf8');

            // 3) Parse JSON
            const reportJson = JSON.parse(payloadText);
            
            if(!reportJson){
                return {
                    success: false,
                    message: "Error in downloading report",
                };
            }
            
            const searchTermsData = [];

            reportJson.forEach(item => {
                searchTermsData.push({
                    date: item.date,
                    searchTerm: item.searchTerm,  // The actual search query
                    campaignId: item.campaignId,
                    campaignName: item.campaignName,
                    adGroupId: item.adGroupId,
                    adGroupName: item.adGroupName,
                    advertisedAsin: item.advertisedAsin,
                    advertisedSku: item.advertisedSku,
                    impressions: item.impressions,
                    clicks: item.clicks,
                    cost: item.cost,
                    purchasesIn1Day: item.purchases1d,
                    purchasesIn7Days: item.purchases7d,
                    purchasesIn14Days: item.purchases14d,
                    purchasesIn30Days: item.purchases30d,
                    salesIn1Day: item.sales1d,
                    salesIn7Days: item.sales7d,
                    salesIn14Days: item.sales14d,
                    salesIn30Days: item.sales30d,
                    acos: item.acos,  // Advertising Cost of Sales percentage
                    roas: item.roas,  // Return on Ad Spend
                    // Calculate additional metrics if needed
                    conversionRate: item.clicks > 0 ? (item.purchases7d / item.clicks * 100).toFixed(2) : 0,
                    cpc: item.clicks > 0 ? (item.cost / item.clicks).toFixed(2) : 0
                });
            });
            
            return searchTermsData;

        } catch (err) {
            // Handle 401 Unauthorized - refresh token and retry once
            if (err.response && err.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetAutoCampaignDetails] Token expired during download, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        console.log(`✅ [GetAutoCampaignDetails] Token refreshed successfully, retrying download...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    console.error('❌ [GetAutoCampaignDetails] Failed to refresh token during download:', refreshError.message);
                    throw new Error(`Token refresh failed during download: ${refreshError.message}`);
                }
            }

            // Better error logging
            if (err.response) {
                console.error('Status:', err.response.status);
                console.error('Body:', err.response.data.toString?.() ?? err.response.data);
                throw new Error(`Download failed: ${err.response.status} ${err.response.statusText}`);
            }
            console.error('Error downloading report:', err);
            throw err;
        }
    }
}

async function getAutoSearchTermsWithSales(accessToken, profileId, userId, country, region, refreshToken = null) {
            // console.log(`Getting search terms for auto campaigns in region: ${region}`);

    try {
        // Add a small delay to prevent rapid successive requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create token refresh callback
        const tokenRefreshCallback = refreshToken ? async () => {
            try {
                console.log('🔄 [GetAutoCampaignDetails] Refreshing Amazon Ads token...');
                const newToken = await generateAdsAccessToken(refreshToken);
                if (newToken) {
                    console.log('✅ [GetAutoCampaignDetails] Token refreshed successfully');
                    return newToken;
                } else {
                    throw new Error('Failed to generate new access token');
                }
            } catch (error) {
                console.error('❌ [GetAutoCampaignDetails] Token refresh failed:', error.message);
                throw error;
            }
        } : null;

        // Get the report ID first (with token refresh support)
        const reportData = await getSearchTermReportId(accessToken, profileId, region, tokenRefreshCallback);

        if (!reportData || !reportData.reportId) {
            throw new Error('Failed to get report ID');
        }

        // Use the token from getSearchTermReportId if it was refreshed
        let currentToken = reportData.currentAccessToken || accessToken;

        // console.log(`Report ID generated: ${reportData.reportId}`);

        // Check report status until completion (with token refresh support)
        const reportStatus = await checkReportStatus(reportData.reportId, currentToken, profileId, region, userId, tokenRefreshCallback);

        if (reportStatus.status === 'COMPLETED') {
            // Use the latest token if refreshed during polling
            const downloadToken = reportStatus.finalAccessToken || currentToken;
            
            // Download and parse the report data (with token refresh support)
            const searchTermsContent = await downloadSearchTermReportData(reportStatus.location, downloadToken, profileId, tokenRefreshCallback);

            // Optional: Filter for high-performing search terms
            const highPerformingTerms = searchTermsContent.filter(term => 
                term.salesIn7Days > 0 || term.clicks >= 10
            );

            // Save to database
            const createSearchTermsData = await AutoCampaignSearchTermsModel.create({
                userId: userId,
                country: country,
                region: region,
                reportDate: new Date(),
                totalSearchTerms: searchTermsContent.length,
                highPerformingTerms: highPerformingTerms.length,
                searchTerms: searchTermsContent
            });

            if(!createSearchTermsData){
                return {
                    success: false,
                    message: "Error in creating search terms data",
                };
            }

            // Optional: Return summary statistics
            const summary = {
                totalSearchTerms: searchTermsContent.length,
                totalSpend: searchTermsContent.reduce((sum, term) => sum + term.cost, 0).toFixed(2),
                totalSales7d: searchTermsContent.reduce((sum, term) => sum + term.salesIn7Days, 0).toFixed(2),
                totalClicks: searchTermsContent.reduce((sum, term) => sum + term.clicks, 0),
                averageAcos: (searchTermsContent.reduce((sum, term) => sum + (term.acos || 0), 0) / searchTermsContent.length).toFixed(2)
            };

            return {
                success: true,
                message: "Auto campaign search terms data fetched successfully",
                data: createSearchTermsData,
                summary: summary
            };
        } else {
            console.error('Report generation failed:', reportStatus.error);
            return {
                success: false,
                reportId: reportStatus.reportId,
                error: reportStatus.error
            };
        }

    } catch (error) {
        console.error('Error in getAutoSearchTermsWithSales:', error.message);
        
        // Handle specific 425 errors with more helpful messaging
        if (error.message.includes('425')) {
            throw new Error('Duplicate request detected by Amazon Ads API. Please wait a moment before retrying.');
        }
        
        throw error;
    }
}

module.exports = {
    getAutoSearchTermsWithSales,
};
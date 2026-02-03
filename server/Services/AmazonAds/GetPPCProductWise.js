const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const { generateAdsAccessToken } = require('./GenerateToken');
const gunzip = promisify(zlib.gunzip);
const userModel = require('../../models/user-auth/userModel.js');
// Use service layer for saving data (handles 16MB limit with separate collection)
const { saveProductWiseSponsoredAdsData } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');

// Base URIs for different regions
const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

async function getReportId(accessToken, profileId, region, tokenRefreshCallback = null) {
    let currentAccessToken = accessToken;
    let hasRetried = false;

    while (true) {
        try {
            console.log(`📄 [GetPPCProductWise] Generating report ID for profile: ${profileId}, region: ${region}`);
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
            const uniqueReportName = `ASIN/SKU Performance Report - ${timestamp}`;

            // Set up request body for ASIN/SKU level data
            const body = {
                "name": uniqueReportName,
                "startDate": formatDate(startDate),
                "endDate": formatDate(endDate),
                "configuration": {
                    "adProduct": "SPONSORED_PRODUCTS",
                    "reportTypeId": "spAdvertisedProduct",
                    "timeUnit": "DAILY",
                    "format": "GZIP_JSON",
                    "groupBy": ["advertiser"],
                    "columns": [
                        "date",
                        "advertisedAsin",
                        "advertisedSku",
                        "campaignId",
                        "campaignName",
                        "adGroupId",
                        "adGroupName",
                        "impressions",
                        "clicks",
                        "cost",
                        "purchases7d",
                        "purchases14d",
                        "purchases30d",
                        "sales7d",
                        "sales14d",
                        "sales30d"
                    ]
                }
            }

            // Make the API request
            const response = await axios.post(url, body, { headers });
            console.log(`✅ [GetPPCProductWise] Report request successful, report ID: ${response.data.reportId}`);

            // Return the response data with the current token
            return { ...response.data, currentAccessToken };

        } catch (error) {
            // Handle 401 Unauthorized - refresh token and retry once
            if (error.response && error.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetPPCProductWise] Token expired during getReportId, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        console.log(`✅ [GetPPCProductWise] Token refreshed successfully, retrying getReportId...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    console.error('❌ [GetPPCProductWise] Failed to refresh token:', refreshError.message);
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

async function checkReportStatus(reportId, accessToken, profileId, region, userId, tokenRefreshCallback) {
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

                console.log(`📊 [GetPPCProductWise] Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

                // Check if report is complete
                if (status === 'COMPLETED') {
                    console.log(`✅ [GetPPCProductWise] Report completed after ${attempts + 1} attempts`);
                    return {
                        status: 'COMPLETED',
                        location: location,
                        reportId: reportId,
                        finalAccessToken: currentAccessToken
                    };
                } else if (status === 'FAILURE') {
                    console.error(`❌ [GetPPCProductWise] Report generation failed after ${attempts + 1} attempts`);
                    return {
                        status: 'FAILURE',
                        reportId: reportId,
                        error: 'Report generation failed'
                    };
                }

                // If still processing, wait 60 seconds before next check
                if (status === 'PROCESSING' || status === 'PENDING') {
                    console.log(`⏳ [GetPPCProductWise] Report still ${status}, waiting 60 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds
                    attempts++;
                } else {
                    // Unknown status
                    console.error(`❓ [GetPPCProductWise] Unknown report status: ${status}`);
                    throw new Error(`Unknown report status: ${status}`);
                }

            } catch (error) {
                // Handle 401 Unauthorized - refresh token and continue polling
                if (error.response && error.response.status === 401) {
                    console.log(`⚠️ Token expired during polling (attempt ${attempts + 1}), refreshing token...`);
                    
                    if (tokenRefreshCallback) {
                        try {
                            // Get a fresh token using the callback
                            const newToken = await tokenRefreshCallback();
                            if (newToken) {
                                currentAccessToken = newToken;
                                console.log(`✅ Token refreshed successfully, continuing to poll report ${reportId}`);
                                // Continue the loop with the new token
                                continue;
                            } else {
                                throw new Error('Token refresh callback returned null/undefined');
                            }
                        } catch (refreshError) {
                            console.error('❌ Failed to refresh token during polling:', refreshError.message);
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
            throw new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response received from Amazon Ads API');
        } else {
            console.error('Report status check error:', error.message);
            throw error;
        }
    }
}

async function downloadReportData(location, accessToken, profileId, tokenRefreshCallback = null) {
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
            
            const sponsoredAdsData=[];

            reportJson.forEach(item=>{
                sponsoredAdsData.push({
                    date: item.date,
                    asin: item.advertisedAsin,
                    spend: item.cost,
                    salesIn7Days: item.sales7d,
                    salesIn14Days: item.sales14d,
                    salesIn30Days: item.sales30d,
                    campaignId: item.campaignId,
                    campaignName: item.campaignName,
                    adGroupId: item.adGroupId,
                    adGroupName: item.adGroupName,
                    impressions: item.impressions,
                    adGroupId: item.adGroupId,
                    clicks: item.clicks,
                    purchasedIn7Days: item.purchases7d,
                    purchasedIn14Days: item.purchases14d,
                    purchasedIn30Days: item.purchases30d,
                })
            })
            
            return sponsoredAdsData;

        } catch (err) {
            // Handle 401 Unauthorized - refresh token and retry once
            if (err.response && err.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetPPCProductWise] Token expired during download, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        console.log(`✅ [GetPPCProductWise] Token refreshed successfully, retrying download...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    console.error('❌ [GetPPCProductWise] Failed to refresh token during download:', refreshError.message);
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

async function getPPCSpendsBySKU(accessToken, profileId, userId,country,region, refreshToken = null) {
            // console.log(`Getting PPC spends by ASIN/SKU for region: ${region}`);

    try {
        // Add a small delay to prevent rapid successive requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create token refresh callback
        const tokenRefreshCallback = refreshToken ? async () => {
            try {
                console.log('🔄 [GetPPCProductWise] Refreshing Amazon Ads token...');
                const newToken = await generateAdsAccessToken(refreshToken);
                if (newToken) {
                    console.log('✅ [GetPPCProductWise] Token refreshed successfully');
                    return newToken;
                } else {
                    throw new Error('Failed to generate new access token');
                }
            } catch (error) {
                console.error('❌ [GetPPCProductWise] Token refresh failed:', error.message);
                throw error;
            }
        } : null;

        // Get the report ID first (with token refresh support)
        const reportData = await getReportId(accessToken, profileId, region, tokenRefreshCallback);

        if (!reportData || !reportData.reportId) {
            throw new Error('Failed to get report ID');
        }

        // Use the token from getReportId if it was refreshed
        let currentToken = reportData.currentAccessToken || accessToken;

        // console.log(`Report ID generated: ${reportData.reportId}`);

        // Check report status until completion (with token refresh support)
        const reportStatus = await checkReportStatus(reportData.reportId, currentToken, profileId, region, userId, tokenRefreshCallback);

        if (reportStatus.status === 'COMPLETED') {
            // Use the latest token if refreshed during polling
            const downloadToken = reportStatus.finalAccessToken || currentToken;
            
            // Download and parse the report data (with token refresh support)
            const reportContent = await downloadReportData(reportStatus.location, downloadToken, profileId, tokenRefreshCallback);

            // Save to database using service layer (handles 16MB limit with separate collection)
            const saveResult = await saveProductWiseSponsoredAdsData(userId, country, region, reportContent);
            if(!saveResult || !saveResult.success){
                return {
                    success: false,
                    message: "Error in creating product wise sponsored ads data",
                };
            }
            return {
                success: true,
                message: "Product wise sponsored ads data fetched successfully",
                data: {
                    userId: userId,
                    country: country,
                    region: region,
                    itemCount: saveResult.itemCount,
                    batchId: saveResult.batchId
                }
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
        console.error('Error in getPPCSpendsBySKU:', error.message);
        
        // Handle specific 425 errors with more helpful messaging
        if (error.message.includes('425')) {
            throw new Error('Duplicate request detected by Amazon Ads API. Please wait a moment before retrying.');
        }
        
        throw error;
    }
}

module.exports = {
    getPPCSpendsBySKU,
};
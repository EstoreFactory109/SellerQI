const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const { generateAdsAccessToken } = require('./GenerateToken');
const gunzip = promisify(zlib.gunzip);
const userModel = require('../../models/userModel.js');
const ProductWiseSponsoredAdsData = require('../../models/ProductWiseSponseredAdsModel.js');

// Base URIs for different regions
const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

async function getReportId(accessToken, profileId, region) {
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
            'Authorization': `Bearer ${accessToken}`,
            'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
            'Amazon-Advertising-API-Scope': profileId,
            'Content-Type': 'application/vnd.createasyncreportrequest.v3+json'
        };

        // Calculate dynamic dates
        const now = new Date();
        const endDate = new Date(now.getTime() - (72 * 60 * 60 * 1000)); // 72 hours before now
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

        // Return the response data
        return response.data;

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
            console.error('Request setup error:', error.message);
            throw error;
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
        const maxAttempts = 30; // Maximum 30 minutes (30 * 60 seconds)

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

        // If we've exceeded max attempts
        throw new Error(`Report status check timed out after ${maxAttempts} attempts`);

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

async function downloadReportData(location, accessToken, profileId) {
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
        // 4) Better error logging
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Body:', err.response.data.toString?.() ?? err.response.data);
            throw new Error(`Download failed: ${err.response.status} ${err.response.statusText}`);
        }
        console.error('Error downloading report:', err);
        throw err;
    }
}

async function getPPCSpendsBySKU(accessToken, profileId, userId,country,region, refreshToken = null) {
            // console.log(`Getting PPC spends by ASIN/SKU for region: ${region}`);

    try {
        // Add a small delay to prevent rapid successive requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get the report ID first
        const reportData = await getReportId(accessToken, profileId, region);

        if (!reportData || !reportData.reportId) {
            throw new Error('Failed to get report ID');
        }

        // console.log(`Report ID generated: ${reportData.reportId}`);

        // Create token refresh callback for polling
        const tokenRefreshCallback = refreshToken ? async () => {
            try {
                console.log('🔄 Refreshing Amazon Ads token during polling...');
                const newToken = await generateAdsAccessToken(refreshToken);
                if (newToken) {
                    console.log('✅ Token refreshed successfully for polling');
                    return newToken;
                } else {
                    throw new Error('Failed to generate new access token');
                }
            } catch (error) {
                console.error('❌ Token refresh failed during polling:', error.message);
                throw error;
            }
        } : null;

        // Check report status until completion
        const reportStatus = await checkReportStatus(reportData.reportId, accessToken, profileId, region, userId, tokenRefreshCallback);

        if (reportStatus.status === 'COMPLETED') {
            // Download and parse the report data
            // Use the latest token if refreshed
            const downloadToken = reportStatus.finalAccessToken || accessToken;
            const reportContent = await downloadReportData(reportStatus.location, downloadToken, profileId);

            

            const createProductWiseSponsoredAdsData = await ProductWiseSponsoredAdsData.create({
                userId: userId,
                country: country,
                region: region,
                sponsoredAds: reportContent
            })
            if(!createProductWiseSponsoredAdsData){
                return {
                    success: false,
                    message: "Error in creating product wise sponsored ads data",
                };
            }
            return {
                success: true,
                message: "Product wise sponsored ads data fetched successfully",
                data: createProductWiseSponsoredAdsData
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
const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const { generateAdsAccessToken } = require('./GenerateToken');
const gunzip = promisify(zlib.gunzip);
const GetDateWisePPCspendModel = require('../../models/amazon-ads/GetDateWisePPCspendModel.js');
const { resolveReportDateRange } = require('../../utils/reportDateRange.js');
const logger = require('../../utils/Logger');

// Base URIs for different regions
// Hard ceiling on report-status polling so a report wedged in PENDING/PROCESSING
// can't poll forever and hang the phase. At the cap we return FAILURE.
// Amazon publishes no hard SLA for v3 report generation; large reports can take
// a few hours. Default ~4h (one poll per 60s); tune via ADS_REPORT_MAX_POLL_ATTEMPTS.
const MAX_POLL_ATTEMPTS = parseInt(process.env.ADS_REPORT_MAX_POLL_ATTEMPTS || '240', 10);

const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

async function getReportId(accessToken, profileId, region, tokenRefreshCallback = null, startDate, endDate) {
    let currentAccessToken = accessToken;
    let hasRetried = false;

    if (!startDate || !endDate) {
        throw new Error('getReportId requires startDate and endDate (YYYY-MM-DD).');
    }

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

            // Generate unique report name to prevent duplicate requests
            const timestamp = Date.now();
            const uniqueReportName = `ASIN/SKU Performance Report - ${timestamp}`;

            // Set up request body for ASIN/SKU level data
            const body = {
                "name": uniqueReportName,
                "startDate": startDate,
                "endDate": endDate,
                "configuration": {
                    "adProduct": "SPONSORED_PRODUCTS",
                    "reportTypeId": "spCampaigns",
                    "format": "GZIP_JSON",
                    "groupBy": ["campaign"],
                    "columns": [
                        "date",
                        "campaignId",
                        "campaignName",
                        "campaignStatus",
                        "cost",
                        "impressions",
                        "clicks",
                        "purchases7d",
                        "purchasesSameSku7d",
                        "sales7d",
                        "sales14d"
                    ],
                    "filters": [],
                    "timeUnit": "DAILY"
                }
            }

            // Make the API request
            const response = await axios.post(url, body, { headers });

            // Return the response data with the current token
            return { ...response.data, currentAccessToken };

        } catch (error) {
            // Handle 401 Unauthorized - refresh token and retry once
            if (error.response && error.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                logger.debug(`⚠️ [GetDateWiseSpendKeywords] Token expired during getReportId, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        logger.debug(`✅ [GetDateWiseSpendKeywords] Token refreshed successfully, retrying getReportId...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    logger.error('❌ [GetDateWiseSpendKeywords] Failed to refresh token:', refreshError.message);
                    throw new Error(`Token refresh failed: ${refreshError.message}`);
                }
            }

            // Handle different types of errors
            if (error.response) {
                logger.error(`[GetDateWiseSpendKeywords] API error during getReportId: status ${error.response.status}`);
                const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
                enhancedError.response = error.response;
                enhancedError.status = error.response.status;
                enhancedError.statusCode = error.response.status;
                throw enhancedError;
            } else if (error.request) {
                logger.error('[GetDateWiseSpendKeywords] No response received from Amazon Ads API');
                throw new Error('No response received from Amazon Ads API');
            } else {
                logger.error('[GetDateWiseSpendKeywords] Request setup error:', error.message);
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

                logger.info(`📊 [GetDateWiseSpendKeywords] Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

                // Check if report is complete
                if (status === 'COMPLETED') {
                    logger.info(`✅ [GetDateWiseSpendKeywords] Report completed after ${attempts + 1} attempts`);
                    return {
                        status: 'COMPLETED',
                        location: location,
                        reportId: reportId,
                        finalAccessToken: currentAccessToken
                    };
                } else if (status === 'FAILURE') {
                    logger.error(`❌ [GetDateWiseSpendKeywords] Report generation failed after ${attempts + 1} attempts`);
                    return {
                        status: 'FAILURE',
                        reportId: reportId,
                        error: 'Report generation failed'
                    };
                }

                // If still processing, wait 60 seconds before next check
                if (status === 'PROCESSING' || status === 'PENDING') {
                    if (attempts >= MAX_POLL_ATTEMPTS) {
                        logger.error(`❌ [GetDateWiseSpendKeywords] Report ${reportId} stuck in ${status} after ${attempts} polls (~${attempts} min); giving up`);
                        return { status: 'FAILURE', reportId: reportId, error: `Report timed out after ${attempts} polls while ${status}` };
                    }
                    logger.debug(`⏳ [GetDateWiseSpendKeywords] Report still ${status}, waiting 60 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds
                    attempts++;
                } else {
                    // Unknown status
                    logger.error(`❓ [GetDateWiseSpendKeywords] Unknown report status: ${status}`);
                    throw new Error(`Unknown report status: ${status}`);
                }

            } catch (error) {
                // Handle 401 Unauthorized - refresh token and continue polling
                if (error.response && error.response.status === 401) {
                    logger.debug(`⚠️ [GetDateWiseSpendKeywords] Token expired during polling (attempt ${attempts + 1}), refreshing token...`);

                    if (tokenRefreshCallback) {
                        try {
                            // Get a fresh token using the callback
                            const newToken = await tokenRefreshCallback();
                            if (newToken) {
                                currentAccessToken = newToken;
                                logger.debug(`✅ [GetDateWiseSpendKeywords] Token refreshed successfully, continuing to poll report ${reportId}`);
                                // Continue the loop with the new token
                                continue;
                            } else {
                                throw new Error('Token refresh callback returned null/undefined');
                            }
                        } catch (refreshError) {
                            logger.error('❌ [GetDateWiseSpendKeywords] Failed to refresh token during polling:', refreshError.message);
                            throw new Error(`Token refresh failed during polling: ${refreshError.message}`);
                        }
                    } else {
                        // No token refresh callback provided, throw the error
                        throw new Error('Token expired during polling and no refresh callback provided');
                    }
                }
                // If it's a network error, we might want to retry
                if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                    logger.error(`Network error checking report status, retrying... (attempt ${attempts + 1})`);
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
            logger.error(`[GetDateWiseSpendKeywords] API error checking report status: status ${error.response.status}`);
            const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            enhancedError.response = error.response;
            enhancedError.status = error.response.status;
            enhancedError.statusCode = error.response.status;
            throw enhancedError;
        } else if (error.request) {
            logger.error('[GetDateWiseSpendKeywords] No response received from Amazon Ads API');
            throw new Error('No response received from Amazon Ads API');
        } else {
            logger.error('[GetDateWiseSpendKeywords] Report status check error:', error.message);
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

            // Process in chunks to yield to the event loop and allow lock renewal
            const CHUNK_SIZE = 500;
            for (let i = 0; i < reportJson.length; i += CHUNK_SIZE) {
                const chunk = reportJson.slice(i, i + CHUNK_SIZE);
                
                for (const item of chunk) {
                    sponsoredAdsData.push({
                        date: item.date,
                        cost: item.cost,
                        campaignId: item.campaignId,
                        campaignName: item.campaignName,
                        clicks: item.clicks,
                        impressions: item.impressions,
                        sales7d: item.sales7d || 0,
                        sales14d: item.sales14d || 0,
                    });
                }
                
                // Yield to event loop after each chunk to allow lock renewal
                if (i + CHUNK_SIZE < reportJson.length) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
            
            return sponsoredAdsData;

        } catch (err) {
            // Handle 401 Unauthorized - refresh token and retry once
            if (err.response && err.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                logger.debug(`⚠️ [GetDateWiseSpendKeywords] Token expired during download, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        logger.debug(`✅ [GetDateWiseSpendKeywords] Token refreshed successfully, retrying download...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    logger.error('❌ [GetDateWiseSpendKeywords] Failed to refresh token during download:', refreshError.message);
                    throw new Error(`Token refresh failed during download: ${refreshError.message}`);
                }
            }

            // Better error logging
            if (err.response) {
                logger.error(`[GetDateWiseSpendKeywords] Download failed: status ${err.response.status}`);
                throw new Error(`Download failed: ${err.response.status} ${err.response.statusText}`);
            }
            logger.error('[GetDateWiseSpendKeywords] Error downloading report:', err.message);
            throw err;
        }
    }
}

async function getPPCSpendsDateWise(accessToken, profileId, userId, country, region, refreshToken = null, options = {}) {
            // console.log(`Getting PPC spends by ASIN/SKU for region: ${region}`);

    try {
        const { startDate, endDate, isCustom } = resolveReportDateRange(options);
        logger.info(`📡 [GetDateWiseSpendKeywords] PPC spends date-wise for region: ${region}, country: ${country}, userId: ${userId}, window: ${startDate} → ${endDate}, customDateRange: ${isCustom}`);

        // Add a small delay to prevent rapid successive requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create token refresh callback
        const tokenRefreshCallback = refreshToken ? async () => {
            try {
                logger.debug('🔄 [GetDateWiseSpendKeywords] Refreshing Amazon Ads token...');
                const newToken = await generateAdsAccessToken(refreshToken);
                if (newToken) {
                    logger.debug('✅ [GetDateWiseSpendKeywords] Token refreshed successfully');
                    return newToken;
                } else {
                    throw new Error('Failed to generate new access token');
                }
            } catch (error) {
                logger.error('❌ [GetDateWiseSpendKeywords] Token refresh failed:', error.message);
                throw error;
            }
        } : null;

        // Get the report ID first (with token refresh support)
        const reportData = await getReportId(accessToken, profileId, region, tokenRefreshCallback, startDate, endDate);

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

            const createProductWiseSponsoredAdsData = await GetDateWisePPCspendModel.create({
                userId: userId,
                country: country,
                region: region,
                dateWisePPCSpends: reportContent
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
            logger.error('[GetDateWiseSpendKeywords] Report generation failed:', reportStatus.error);
            return {
                success: false,
                reportId: reportStatus.reportId,
                error: reportStatus.error
            };
        }

    } catch (error) {
        logger.error('Error in getPPCSpendsBySKU:', error.message);
        
        // Handle specific 425 errors with more helpful messaging
        if (error.message.includes('425')) {
            throw new Error('Duplicate request detected by Amazon Ads API. Please wait a moment before retrying.');
        }
        
        throw error;
    }
}

module.exports = {
    getPPCSpendsDateWise
};
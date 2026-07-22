const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const SearchTerms = require('../../models/amazon-ads/SearchTermsModel.js');
const { generateAdsAccessToken } = require('./GenerateToken.js');
const { toYyyyMmDd, getYesterdayMetricDateUtc } = require('../../utils/metricDateKey.js');
const { resolveReportDateRange } = require('../../utils/reportDateRange.js');
const logger = require('../../utils/Logger');

/** Search-term report → `SearchTerms` per-day upsert; merged reads power zero-sales + auto-campaign insights tabs. */

// Base URIs for different regions
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
            const uniqueReportName = `Search Terms With Zero Sales - ${timestamp}`;

            // Set up request body for ASIN/SKU level data
            const body = {
                "name": uniqueReportName,
                "startDate": startDate,
                "endDate": endDate,
                "configuration": {
                    "adProduct": "SPONSORED_PRODUCTS",
                    "reportTypeId": "spSearchTerm",
                    "timeUnit": "DAILY",
                    "format": "GZIP_JSON",
                    "groupBy": ["searchTerm"],
                    "columns": [
                        "date",
                        "campaignId",
                        "campaignName",
                        "adGroupId",
                        "adGroupName",
                        "searchTerm",
                        "keyword",
                        "impressions",
                        "clicks",
                        "cost",
                        "sales7d",
                        "purchases7d",
                        "unitsSoldClicks7d"
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
                logger.debug(`⚠️ [GetSearchKeywords] Token expired during getReportId, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        logger.debug(`✅ [GetSearchKeywords] Token refreshed successfully, retrying getReportId...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    logger.error('❌ [GetSearchKeywords] Failed to refresh token:', refreshError.message);
                    throw new Error(`Token refresh failed: ${refreshError.message}`);
                }
            }

            // Handle different types of errors
            if (error.response) {
                logger.error(`[GetSearchKeywords] API error during getReportId: status ${error.response.status}`);
                // Preserve the original error structure for TokenManager to detect 401s
                const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
                enhancedError.response = error.response;
                enhancedError.status = error.response.status;
                enhancedError.statusCode = error.response.status;
                // Flag for TokenManager to detect Amazon API errors
                if (error.response.status === 401 || error.response.status === 403) {
                    enhancedError.amazonApiError = true;
                }
                throw enhancedError;
            } else if (error.request) {
                logger.error('[GetSearchKeywords] No response received from Amazon Ads API');
                throw new Error('No response received from Amazon Ads API');
            } else {
                logger.error('[GetSearchKeywords] Request setup error:', error.message);
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

        // Poll for report status
        let attempts = 0;
        let currentAccessToken = accessToken; // Use a mutable token variable

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

                logger.info(`[GetSearchKeywords] Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

                // Check if report is complete
                if (status === 'COMPLETED') {
                    return {
                        status: 'COMPLETED',
                        location: location,
                        reportId: reportId,
                        finalAccessToken: currentAccessToken // Return the latest token for download
                    };
                } else if (status === 'FAILURE') {
                    return {
                        status: 'FAILURE',
                        reportId: reportId,
                        error: 'Report generation failed'
                    };
                }

                // If still processing, wait 60 seconds before next check
                if (status === 'PROCESSING' || status === 'PENDING') {
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds
                    attempts++;
                } else {
                    // Unknown status
                    throw new Error(`Unknown report status: ${status}`);
                }

            } catch (error) {
                // Handle 401 Unauthorized - refresh token and continue polling
                if (error.response && error.response.status === 401) {
                    logger.debug(`⚠️ Token expired during polling (attempt ${attempts + 1}), refreshing token...`);

                    if (tokenRefreshCallback) {
                        try {
                            // Get a fresh token using the callback
                            const newToken = await tokenRefreshCallback();
                            if (newToken) {
                                currentAccessToken = newToken;
                                logger.debug(`✅ Token refreshed successfully, continuing to poll report ${reportId}`);
                                // Continue the loop with the new token
                                continue;
                            } else {
                                throw new Error('Token refresh callback returned null/undefined');
                            }
                        } catch (refreshError) {
                            logger.error('❌ Failed to refresh token during polling:', refreshError.message);
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
            logger.error(`[GetSearchKeywords] API error checking report status: status ${error.response.status}`);
            // Preserve the original error structure for TokenManager to detect 401s
            const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            enhancedError.response = error.response;
            enhancedError.status = error.response.status;
            enhancedError.statusCode = error.response.status;
            // Flag for TokenManager to detect Amazon API errors
            if (error.response.status === 401 || error.response.status === 403) {
                enhancedError.amazonApiError = true;
            }
            throw enhancedError;
        } else if (error.request) {
            logger.error('[GetSearchKeywords] No response received from Amazon Ads API');
            throw new Error('No response received from Amazon Ads API');
        } else {
            logger.error('[GetSearchKeywords] Report status check error:', error.message);
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

            if (!reportJson) {
                return {
                    success: false,
                    message: "Error in downloading report",
                };
            }

            logger.debug(`[GetSearchKeywords] Downloaded report with ${Array.isArray(reportJson) ? reportJson.length : 'unknown number of'} items`);

            // 4) Format the data to match the model schema
            const sponsoredAdsData = [];

            // Process in chunks to yield to the event loop and allow lock renewal
            const CHUNK_SIZE = 500;
            for (let i = 0; i < reportJson.length; i += CHUNK_SIZE) {
                const chunk = reportJson.slice(i, i + CHUNK_SIZE);
                
                for (const item of chunk) {
                    sponsoredAdsData.push({
                        date: item.date || null,
                        campaignId: item.campaignId || '',
                        campaignName: item.campaignName || '',
                        adGroupId: item.adGroupId || '',
                        adGroupName: item.adGroupName || item.adGroup || '',
                        searchTerm: item.searchTerm || '',
                        keyword: item.keyword || '',
                        clicks: item.clicks || 0,
                        sales: item.sales7d || 0,
                        spend: item.cost || 0,
                        impressions: item.impressions || 0
                    });
                }
                
                // Yield to event loop after each chunk to allow lock renewal
                if (i + CHUNK_SIZE < reportJson.length) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }

            logger.debug(`[GetSearchKeywords] Formatted ${sponsoredAdsData.length} search terms for database storage`);
            return sponsoredAdsData;

        } catch (err) {
            // Handle 401 Unauthorized - refresh token and retry once
            if (err.response && err.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                logger.debug(`⚠️ [GetSearchKeywords] Token expired during download, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        logger.debug(`✅ [GetSearchKeywords] Token refreshed successfully, retrying download...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    logger.error('❌ [GetSearchKeywords] Failed to refresh token during download:', refreshError.message);
                    throw new Error(`Token refresh failed during download: ${refreshError.message}`);
                }
            }

            // Better error logging
            if (err.response) {
                logger.error(`[GetSearchKeywords] Download failed: status ${err.response.status}`);
                throw new Error(`Download failed: ${err.response.status} ${err.response.statusText}`);
            }
            logger.error('[GetSearchKeywords] Error downloading report:', err.message);
            throw err;
        }
    }
}

// `options.startDate` / `options.endDate` (YYYY-MM-DD) override the default
// "yesterday-30 … yesterday" Pacific window. Per-day storage still keys on each
// `row.date` returned by Amazon, so requesting a narrower window only narrows
// the rows we ingest.
async function getSearchKeywords(accessToken, profileId, userId, country, region, refreshToken = null, options = {}) {
    try {
        const { startDate, endDate, isCustom } = resolveReportDateRange(options);
        // ===== INPUT VALIDATION =====
        if (!accessToken) {
            throw new Error('Access token is required');
        }

        if (!profileId) {
            throw new Error('Profile ID is required');
        }

        if (!userId) {
            throw new Error('User ID is required');
        }

        if (!country) {
            throw new Error('Country is required');
        }

        if (!region) {
            throw new Error('Region is required');
        }

        // Validate region
        if (!BASE_URIS[region]) {
            throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
        }

        logger.info(`📡 Getting search keywords for region: ${region}, country: ${country}, userId: ${userId}, startDate: ${startDate}, endDate: ${endDate}, customDateRange: ${isCustom}`);

        // Add a small delay to prevent rapid successive requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create token refresh callback
        const tokenRefreshCallback = refreshToken ? async () => {
            try {
                logger.debug('🔄 [GetSearchKeywords] Refreshing Amazon Ads token...');
                const newToken = await generateAdsAccessToken(refreshToken);
                if (newToken) {
                    logger.debug('✅ [GetSearchKeywords] Token refreshed successfully');
                    return newToken;
                } else {
                    throw new Error('Failed to generate new access token');
                }
            } catch (error) {
                logger.error('❌ [GetSearchKeywords] Token refresh failed:', error.message);
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

        logger.info(`✅ Search keywords report ID generated: ${reportData.reportId}`);

        // Check report status until completion with token refresh support
        const reportStatus = await checkReportStatus(reportData.reportId, currentToken, profileId, region, userId, tokenRefreshCallback);

        if (reportStatus.status === 'COMPLETED') {
            // Use the latest token if refreshed during polling
            const downloadToken = reportStatus.finalAccessToken || currentToken;

            // Download and parse the report data (with token refresh support)
            const reportContent = await downloadReportData(reportStatus.location, downloadToken, profileId, tokenRefreshCallback);

            // Add validation and logging
            logger.debug(`✅ Processing ${reportContent.length} search terms for user ${userId}`);

            if (!reportContent || reportContent.length === 0) {
                logger.warn('No search terms data available for the specified period', { userId, region, country });

                const snapshotDay = getYesterdayMetricDateUtc();
                await SearchTerms.upsertSearchTermsForDate(userId, country, region, snapshotDay, []);

                const merged = await SearchTerms.findMergedSearchTermData(userId, country, region, {});
                return {
                    success: true,
                    message: "No search terms data available for the specified period",
                    data: {
                        userId,
                        country,
                        region,
                        searchTermData: merged
                    }
                };
            }

            try {
                const byDay = new Map();
                for (const row of reportContent) {
                    const day = toYyyyMmDd(row.date) || (row.date ? String(row.date).substring(0, 10) : null);
                    if (!day) continue;
                    if (!byDay.has(day)) byDay.set(day, []);
                    byDay.get(day).push(row);
                }

                for (const [metricDate, rows] of byDay) {
                    await SearchTerms.upsertSearchTermsForDate(userId, country, region, metricDate, rows);
                }

                const merged = await SearchTerms.findMergedSearchTermData(userId, country, region, {});
                logger.info(`✅ Search terms saved per day (${byDay.size} day(s)); merged rows: ${merged.length}`);
                return {
                    success: true,
                    message: "Search terms data fetched and saved successfully",
                    data: {
                        userId,
                        country,
                        region,
                        searchTermData: merged
                    }
                };

            } catch (dbError) {
                logger.error('Database error while saving search terms data', {
                    error: dbError.message,
                    userId,
                    region,
                    country,
                    dataLength: reportContent.length
                });

                return {
                    success: true,
                    message: "Search terms data retrieved but database save failed",
                    data: {
                        userId,
                        country,
                        region,
                        searchTermData: reportContent,
                        _isTemporary: true,
                        _dbError: dbError.message
                    }
                };
            }
        } else {
            logger.error('❌ Search keywords report generation failed:', reportStatus.error);
            return {
                success: false,
                reportId: reportStatus.reportId,
                error: reportStatus.error
            };
        }

    } catch (error) {
        logger.error('❌ Error in getSearchKeywords:', {
            message: error.message,
            userId,
            region,
            country
        });
        throw error;
    }
}

module.exports = {
    getSearchKeywords
};
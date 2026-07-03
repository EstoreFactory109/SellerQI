const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const { generateAdsAccessToken } = require('./GenerateToken');
const gunzip = promisify(zlib.gunzip);
const userModel = require('../../models/user-auth/userModel.js');
// Use service layer for saving data (handles 16MB limit with separate collection)
const { saveProductWiseSponsoredAdsData } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');
const { resolveReportDateRange } = require('../../utils/reportDateRange.js');

/**
 * GetPPCProductWise.js
 *
 * Fetches product-level (ASIN-level) ad performance data from:
 *   - Sponsored Products  (SP)  — 7-day attribution default
 *   - Sponsored Display   (SD)  — 14-day attribution default
 *
 * Sponsored Brands (SB) is intentionally EXCLUDED from product-wise data.
 * SB ads feature multiple ASINs per ad, so Amazon does not provide an
 * ASIN-level advertised product report for SB. The only SB report with
 * ASIN granularity is sbPurchasedProduct, but its spend/clicks/impressions
 * are campaign-level (not ASIN-level), which would double/triple count
 * spend when aggregated by ASIN. SB spend is tracked at campaign level
 * in GetPPCMetrics.js instead.
 *
 * Each ad type uses the v3 async reporting API at /reporting/reports
 * with its own adProduct, reportTypeId, and column set.
 *
 * TIMEZONE NOTE:
 *   The `date` column returned by Amazon's v3 reporting API is already
 *   in the marketplace's local timezone (Pacific for NA/US). We store
 *   it as-is — no conversion needed. The `startDate`/`endDate` in the
 *   request body are also marketplace-local, and `resolveReportDateRange`
 *   already computes them in Pacific time.
 *
 * ATTRIBUTION NOTE:
 *   - SP reports have sales7d as the Seller Central default (matches the SC UI).
 *   - SD reports have sales14d as the default attribution window.
 *   - We fetch all available windows (1d/7d/14d/30d) for SP and SD
 *     so downstream code can use whichever it needs.
 */

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

// ============================================================
// Report type configurations for each ad type
// ============================================================

const REPORT_CONFIGS = {
    SP: {
        adProduct: 'SPONSORED_PRODUCTS',
        reportTypeId: 'spAdvertisedProduct',
        groupBy: ['advertiser'],
        columns: [
            'date',
            'advertisedAsin',
            'advertisedSku',
            'campaignId',
            'campaignName',
            'adGroupId',
            'adGroupName',
            'impressions',
            'clicks',
            'cost',
            'sales7d',          // SC default attribution for SP (includes halo)
            'purchases7d',      // Order count (7d attribution)
            'unitsSoldClicks7d'  // Units sold (7d attribution)
        ],
        mapRow: (item) => ({
            adType: 'SP',
            date: item.date,
            asin: item.advertisedAsin,
            sku: item.advertisedSku || '',
            campaignId: item.campaignId,
            campaignName: item.campaignName,
            adGroupId: item.adGroupId,
            adGroupName: item.adGroupName || '',
            impressions: item.impressions || 0,
            clicks: item.clicks || 0,
            spend: item.cost || 0,
            sales: item.sales7d || 0,              // SP 7d → unified 'sales'
            purchases: item.purchases7d || 0,       // SP 7d → unified 'purchases'
            unitsSoldClicks: item.unitsSoldClicks7d || 0, // SP 7d → unified 'unitsSoldClicks'
        }),
    },

    SD: {
        adProduct: 'SPONSORED_DISPLAY',
        reportTypeId: 'sdAdvertisedProduct',
        groupBy: ['advertiser'],
        columns: [
            'date',
            'promotedAsin',     // SD uses 'promotedAsin', not 'advertisedAsin'
            'promotedSku',      // SD uses 'promotedSku', not 'advertisedSku'
            'campaignId',
            'campaignName',
            'adGroupId',
            'adGroupName',
            'impressions',
            'clicks',
            'cost',
            // SD columns have no day suffix — they represent 14d attribution (the only window SD provides)
            'sales',
            'purchases',
            'unitsSoldClicks',
        ],
        mapRow: (item) => ({
            adType: 'SD',
            date: item.date,
            asin: item.promotedAsin,             // SD field name
            sku: item.promotedSku || '',         // SD field name
            campaignId: item.campaignId,
            campaignName: item.campaignName,
            adGroupId: item.adGroupId || '',
            adGroupName: item.adGroupName || '',
            impressions: item.impressions || 0,
            clicks: item.clicks || 0,
            spend: item.cost || 0,
            sales: item.sales || 0,              // SD 14d → unified 'sales'
            purchases: item.purchases || 0,       // SD 14d → unified 'purchases'
            unitsSoldClicks: item.unitsSoldClicks || 0, // SD 14d → unified 'unitsSoldClicks'
        }),
    },
};


// ============================================================
// Report API helpers (shared across all ad types)
// ============================================================

async function createReport(accessToken, profileId, region, config, startDate, endDate, tokenRefreshCallback) {
    let currentAccessToken = accessToken;
    let hasRetried = false;

    while (true) {
        try {
            const baseUri = BASE_URIS[region];
            if (!baseUri) {
                throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
            }

            const url = `${baseUri}/reporting/reports`;

            const headers = {
                'Authorization': `Bearer ${currentAccessToken}`,
                'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
                'Amazon-Advertising-API-Scope': profileId,
                'Content-Type': 'application/vnd.createasyncreportrequest.v3+json'
            };

            const timestamp = Date.now();
            const body = {
                name: `${config.adProduct} Product Report - ${timestamp}`,
                startDate,
                endDate,
                configuration: {
                    adProduct: config.adProduct,
                    reportTypeId: config.reportTypeId,
                    timeUnit: 'DAILY',
                    format: 'GZIP_JSON',
                    groupBy: config.groupBy,
                    columns: config.columns
                }
            };

            console.log(`📄 [GetPPCProductWise] Creating ${config.adProduct} report for ${startDate} → ${endDate}`);
            const response = await axios.post(url, body, { headers });
            console.log(`✅ [GetPPCProductWise] ${config.adProduct} report ID: ${response.data.reportId}`);

            return { ...response.data, currentAccessToken };

        } catch (error) {
            // Handle 401 — refresh token and retry once
            if (error.response && error.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetPPCProductWise] Token expired during ${config.adProduct} createReport, refreshing...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        continue;
                    }
                } catch (refreshError) {
                    console.error(`❌ [GetPPCProductWise] Token refresh failed:`, refreshError.message);
                }
            }

            if (error.response) {
                console.error(`❌ [GetPPCProductWise] ${config.adProduct} createReport error:`, {
                    status: error.response.status,
                    data: error.response.data
                });
                const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
                enhancedError.response = error.response;
                enhancedError.status = error.response.status;
                enhancedError.statusCode = error.response.status;
                throw enhancedError;
            } else if (error.request) {
                throw new Error('No response received from Amazon Ads API');
            } else {
                throw error;
            }
        }
    }
}


async function pollReportStatus(reportId, accessToken, profileId, region, tokenRefreshCallback) {
    const baseUri = BASE_URIS[region];
    const url = `${baseUri}/reporting/reports/${reportId}`;
    let currentAccessToken = accessToken;
    let attempts = 0;

    while (true) {
        try {
            const headers = {
                'Authorization': `Bearer ${currentAccessToken}`,
                'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
                'Amazon-Advertising-API-Scope': profileId,
                'Content-Type': 'application/vnd.createasyncreportrequest.v3+json'
            };

            const response = await axios.get(url, { headers });
            const { status } = response.data;
            const location = response.data.url;

            console.log(`📊 [GetPPCProductWise] Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

            if (status === 'COMPLETED') {
                console.log(`✅ [GetPPCProductWise] Report completed after ${attempts + 1} attempts`);
                return {
                    status: 'COMPLETED',
                    location,
                    reportId,
                    finalAccessToken: currentAccessToken
                };
            } else if (status === 'FAILURE') {
                console.error(`❌ [GetPPCProductWise] Report failed after ${attempts + 1} attempts`);
                return {
                    status: 'FAILURE',
                    reportId,
                    error: 'Report generation failed'
                };
            }

            if (status === 'PROCESSING' || status === 'PENDING') {
                if (attempts >= MAX_POLL_ATTEMPTS) {
                    console.error(`❌ [GetPPCProductWise] Report ${reportId} stuck in ${status} after ${attempts} polls (~${attempts} min); giving up`);
                    return { status: 'FAILURE', reportId, error: `Report timed out after ${attempts} polls while ${status}` };
                }
                console.log(`⏳ [GetPPCProductWise] Report still ${status}, waiting 60 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 60000));
                attempts++;
            } else {
                throw new Error(`Unknown report status: ${status}`);
            }

        } catch (error) {
            if (error.response && error.response.status === 401 && tokenRefreshCallback) {
                console.log(`⚠️ Token expired during polling (attempt ${attempts + 1}), refreshing...`);
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        continue;
                    }
                } catch (refreshError) {
                    console.error('❌ Token refresh failed during polling:', refreshError.message);
                    throw new Error(`Token refresh failed during polling: ${refreshError.message}`);
                }
            }
            if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                console.error(`Network error checking report status, retrying... (attempt ${attempts + 1})`);
                await new Promise(resolve => setTimeout(resolve, 60000));
                attempts++;
                continue;
            }
            throw error;
        }
    }
}


async function downloadReport(location, accessToken, tokenRefreshCallback) {
    let currentAccessToken = accessToken;
    let hasRetried = false;

    while (true) {
        try {
            const response = await axios.get(location, {
                responseType: 'arraybuffer',
                decompress: false
            });

            const inflatedBuffer = await gunzip(response.data);
            const payloadText = inflatedBuffer.toString('utf8');
            const reportJson = JSON.parse(payloadText);

            if (!reportJson || !Array.isArray(reportJson)) {
                return [];
            }

            return reportJson;

        } catch (err) {
            if (err.response && err.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetPPCProductWise] Token expired during download, refreshing...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        continue;
                    }
                } catch (refreshError) {
                    throw new Error(`Token refresh failed during download: ${refreshError.message}`);
                }
            }

            if (err.response) {
                throw new Error(`Download failed: ${err.response.status} ${err.response.statusText}`);
            }
            throw err;
        }
    }
}


// ============================================================
// Fetch one ad type's report end-to-end
// ============================================================

async function fetchReportForAdType(adType, accessToken, profileId, region, startDate, endDate, tokenRefreshCallback) {
    const config = REPORT_CONFIGS[adType];

    try {
        console.log(`📡 [GetPPCProductWise] Fetching ${adType} report...`);

        // 1. Create report request
        const reportData = await createReport(accessToken, profileId, region, config, startDate, endDate, tokenRefreshCallback);

        if (!reportData || !reportData.reportId) {
            console.warn(`⚠️ [GetPPCProductWise] No report ID returned for ${adType}`);
            return [];
        }

        // Use the (potentially refreshed) token
        let currentToken = reportData.currentAccessToken || accessToken;

        // 2. Poll until complete
        const reportStatus = await pollReportStatus(reportData.reportId, currentToken, profileId, region, tokenRefreshCallback);

        if (reportStatus.status !== 'COMPLETED') {
            console.warn(`⚠️ [GetPPCProductWise] ${adType} report did not complete: ${reportStatus.error || reportStatus.status}`);
            return [];
        }

        // 3. Download and parse
        const downloadToken = reportStatus.finalAccessToken || currentToken;
        const rawRows = await downloadReport(reportStatus.location, downloadToken, tokenRefreshCallback);

        console.log(`✅ [GetPPCProductWise] ${adType} report: ${rawRows.length} rows`);

        // 4. Map raw rows through the ad-type-specific mapper, yielding to event loop periodically
        const mappedRows = [];
        const CHUNK_SIZE = 500;
        for (let i = 0; i < rawRows.length; i += CHUNK_SIZE) {
            const chunk = rawRows.slice(i, i + CHUNK_SIZE);
            for (const item of chunk) {
                mappedRows.push(config.mapRow(item));
            }
            if (i + CHUNK_SIZE < rawRows.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }

        return mappedRows;

    } catch (error) {
        // Don't let one ad type's failure kill the others
        console.error(`❌ [GetPPCProductWise] ${adType} report failed:`, error.message);
        return [];
    }
}


// ============================================================
// Main entry point — fetches SP + SB + SD and merges
// ============================================================

/**
 * `options.startDate` / `options.endDate` (YYYY-MM-DD) override the default
 * "yesterday-30 … yesterday" Pacific window. Saved rows are still keyed off
 * each row's `date`, so a custom window simply restricts which days are
 * fetched and stored.
 */
async function getPPCSpendsBySKU(accessToken, profileId, userId, country, region, refreshToken = null, options = {}) {
    try {
        const { startDate, endDate, isCustom } = resolveReportDateRange(options);
        console.log(`📡 [GetPPCProductWise] PPC spends by SKU for region: ${region}, country: ${country}, userId: ${userId}, window: ${startDate} → ${endDate}, customDateRange: ${isCustom}`);

        // Small delay to prevent rapid successive requests
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

        // Fetch SP + SD in parallel (SB excluded — no ASIN-level report available)
        const [spRows, sdRows] = await Promise.allSettled([
            fetchReportForAdType('SP', accessToken, profileId, region, startDate, endDate, tokenRefreshCallback),
            fetchReportForAdType('SD', accessToken, profileId, region, startDate, endDate, tokenRefreshCallback),
        ]);

        // Extract results (default to [] on failure)
        const spData = spRows.status === 'fulfilled' ? spRows.value : [];
        const sdData = sdRows.status === 'fulfilled' ? sdRows.value : [];

        const allData = [...spData, ...sdData];

        console.log(`📊 [GetPPCProductWise] Total rows: ${allData.length} (SP: ${spData.length}, SD: ${sdData.length})`);

        if (allData.length === 0) {
            console.warn(`⚠️ [GetPPCProductWise] No data from any ad type for userId: ${userId}`);
            return {
                success: true,
                message: 'No product-wise sponsored ads data available',
                data: { userId, country, region, itemCount: 0, batchId: null }
            };
        }

        // Save all rows (SP + SD merged)
        const saveResult = await saveProductWiseSponsoredAdsData(userId, country, region, allData);
        if (!saveResult || !saveResult.success) {
            return {
                success: false,
                message: 'Error in creating product wise sponsored ads data',
            };
        }

        return {
            success: true,
            message: 'Product wise sponsored ads data fetched successfully',
            data: {
                userId,
                country,
                region,
                itemCount: saveResult.itemCount,
                batchId: saveResult.batchId,
                breakdown: {
                    SP: spData.length,
                    SD: sdData.length,
                }
            }
        };

    } catch (error) {
        console.error('Error in getPPCSpendsBySKU:', error.message);

        if (error.message.includes('425')) {
            throw new Error('Duplicate request detected by Amazon Ads API. Please wait a moment before retrying.');
        }

        throw error;
    }
}

module.exports = {
    getPPCSpendsBySKU,
};
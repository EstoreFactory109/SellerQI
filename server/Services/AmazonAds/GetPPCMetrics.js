const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const { generateAdsAccessToken } = require('./GenerateToken');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel');

const gunzip = promisify(zlib.gunzip);

// Base URIs for different regions
const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

// Report types for different campaign types
// SP: columns use sales1d / purchases1d / unitsSoldClicks1d (single-window daily rows)
// SB/SD: sales / purchases / units (Amazon naming per report type)
const CAMPAIGN_TYPES = {
    SPONSORED_PRODUCTS: {
        adProduct: 'SPONSORED_PRODUCTS',
        reportTypeId: 'spCampaigns',
        // SP Seller Central default = 7-day attribution
        // sales7d ALREADY includes halo (all products purchased after ad click)
        // attributedSalesSameSku7d = only the advertised product
        defaultSalesMetric: 'sales7d',
        columns: [
            "date",
            "campaignId",
            "campaignName",
            "campaignStatus",
            "cost",
            "impressions",
            "clicks",
            // Sales (includes halo — all products purchased after click)
            "sales1d",
            "sales7d",
            "sales14d",
            "sales30d",
            // Sales SAME SKU only (advertised product)
            "attributedSalesSameSku1d",
            "attributedSalesSameSku7d",
            "attributedSalesSameSku14d",
            "attributedSalesSameSku30d",
            // Purchases (orders)
            "purchases1d",
            "purchases7d",
            "purchases14d",
            "purchases30d",
            // Units sold (advertised product)
            "unitsSoldClicks1d",
            "unitsSoldClicks7d",
            "unitsSoldClicks14d",
            "unitsSoldClicks30d",
            // Units sold SAME SKU
            "unitsSoldSameSku1d",
            "unitsSoldSameSku7d",
            "unitsSoldSameSku14d",
            "unitsSoldSameSku30d"
        ]
    },
    SPONSORED_BRANDS: {
        adProduct: 'SPONSORED_BRANDS',
        reportTypeId: 'sbCampaigns',
        // SB Seller Central default = 14-day attribution
        // SB uses 'sales' (not sales14d), 'purchases' (not purchases14d), 'unitsSoldClicks' (not unitsSoldClicks14d)
        defaultSalesMetric: 'sales',
        columns: [
            "date",
            "campaignId",
            "campaignName",
            "campaignStatus",
            "cost",
            "impressions",
            "clicks",
            "sales",
            "salesClicks",
            "purchases",
            "purchasesClicks",
            "unitsSoldClicks",
            "newToBrandSales",
            "newToBrandPurchases",
            "newToBrandUnitsSold",
            "detailPageViews",
            "brandedSearches"
        ]
    },
    SPONSORED_DISPLAY: {
        adProduct: 'SPONSORED_DISPLAY',
        reportTypeId: 'sdCampaigns',
        // SD Seller Central default = 14-day attribution
        // SD uses 'sales' (not sales14d), 'purchases' (not purchases14d), 'unitsSoldClicks' (not unitsSoldClicks14d)
        defaultSalesMetric: 'sales',
        columns: [
            "date",
            "campaignId",
            "campaignName",
            "campaignStatus",
            "cost",
            "impressions",
            "clicks",
            "sales",
            "salesClicks",
            "purchases",
            "purchasesClicks",
            "unitsSoldClicks",
            "newToBrandSales",
            "newToBrandPurchases",
            "newToBrandUnitsSold",
            "detailPageViews"
        ]
    }
};

/**
 * Create a report request for a specific campaign type
 */
// Amazon Ads API responds with 429 (and sometimes 400 "Throttled - Deprecated
// resource") when a tenant exceeds per-second request quota. The whole report
// call is idempotent at this stage (we haven't created a report yet), so it's
// safe to back off and retry. Capped to MAX_THROTTLE_RETRIES so a permanently-
// throttled endpoint doesn't hang the pipeline.
const MAX_THROTTLE_RETRIES = 4;
const THROTTLE_BASE_DELAY_MS = 5000;

// Hard ceiling on report-status polling. Without a cap a report wedged in
// PENDING/PROCESSING would poll forever and the phase would never resolve. At
// the cap we treat the report as FAILURE so the caller records an honest failure
// and the cron can retry later.
// Amazon publishes no hard SLA for v3 report generation; large reports can take
// a few hours. Default ~4h (one poll per 60s); tune via ADS_REPORT_MAX_POLL_ATTEMPTS.
const MAX_POLL_ATTEMPTS = parseInt(process.env.ADS_REPORT_MAX_POLL_ATTEMPTS || '240', 10);

function isAdsThrottleError(error) {
    if (!error?.response) return false;
    if (error.response.status === 429) return true;
    // The deprecated v2 endpoints sometimes return 400 with a "Throttled" body.
    const body = error.response.data;
    if (!body) return false;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return /throttl/i.test(text);
}

// Distinguish a true Amazon-side advertiser-permission revocation (the
// user must re-authorize Amazon Ads on the dashboard) from a transient
// 401 (which the TokenManager auto-refresh path already handles) or a
// legitimate "not enabled" 400/404 ("this seller never had SB" etc.).
//
// Amazon's profile-revocation error reaches us as an `Error` object
// whose `.message` includes BOTH the 401 status AND either
// "does not have access to profile" or "Missing rights". Transient
// token expiry uses different wording ("access token you provided has
// expired"). So this matcher won't false-positive on token blips.
function isAuthRevokedError(error) {
    if (!error) return false;
    const msg = (error.message || String(error)).toString();
    if (!/401/.test(msg)) return false;
    return /does not have access to profile/i.test(msg)
        || /Missing rights/i.test(msg);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createReport(accessToken, profileId, region, campaignType, startDate, endDate, tokenRefreshCallback = null) {
    let currentAccessToken = accessToken;
    let hasRetried = false;
    let throttleRetries = 0;

    while (true) {
        try {
            const baseUri = BASE_URIS[region];
            if (!baseUri) {
                throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
            }

            const url = `${baseUri}/reporting/reports`;
            const campaignConfig = CAMPAIGN_TYPES[campaignType];

            const headers = {
                'Authorization': `Bearer ${currentAccessToken}`,
                'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
                'Amazon-Advertising-API-Scope': profileId,
                'Content-Type': 'application/vnd.createasyncreportrequest.v3+json'
            };

            const timestamp = Date.now();
            const uniqueReportName = `PPC Metrics Report - ${campaignType} - ${timestamp}`;

            const body = {
                "name": uniqueReportName,
                "startDate": startDate,
                "endDate": endDate,
                "configuration": {
                    "adProduct": campaignConfig.adProduct,
                    "reportTypeId": campaignConfig.reportTypeId,
                    "format": "GZIP_JSON",
                    "groupBy": ["campaign"],
                    "columns": campaignConfig.columns,
                    "filters": [],
                    "timeUnit": "DAILY"
                }
            };

            const response = await axios.post(url, body, { headers });
            return { ...response.data, currentAccessToken };

        } catch (error) {
            // Handle 401 Unauthorized - refresh token and retry once
            if (error.response && error.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetPPCMetrics] Token expired during createReport for ${campaignType}, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        console.log(`✅ [GetPPCMetrics] Token refreshed successfully, retrying createReport...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    console.error('❌ [GetPPCMetrics] Failed to refresh token:', refreshError.message);
                    throw new Error(`Token refresh failed: ${refreshError.message}`);
                }
            }

            // ★ 429 / throttled — back off and retry instead of dropping the
            //   call. Important for the deprecated v2 endpoints that throttle
            //   aggressively. The throttle check comes BEFORE the 400/404 skip
            //   below so a 400-with-throttle-body doesn't get silently dropped.
            if (isAdsThrottleError(error) && throttleRetries < MAX_THROTTLE_RETRIES) {
                throttleRetries++;
                const delay = THROTTLE_BASE_DELAY_MS * Math.pow(3, throttleRetries - 1);
                console.warn(`⏳ [GetPPCMetrics] Throttled creating report for ${campaignType} (retry ${throttleRetries}/${MAX_THROTTLE_RETRIES}). Waiting ${delay}ms…`);
                await sleep(delay);
                continue;
            }

            if (error.response) {
                console.error(`API Error Response for ${campaignType}:`, {
                    status: error.response.status,
                    data: error.response.data
                });

                // Some campaign types might not be available for this seller
                if (error.response.status === 400 || error.response.status === 404) {
                    console.log(`⚠️ [GetPPCMetrics] ${campaignType} not available for this seller, skipping...`);
                    return { reportId: null, skipped: true, campaignType };
                }

                const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
                enhancedError.response = error.response;
                enhancedError.status = error.response.status;
                throw enhancedError;
            } else if (error.request) {
                throw new Error('No response received from Amazon Ads API');
            } else {
                throw error;
            }
        }
    }
}

/**
 * Check report status and wait for completion
 */
async function checkReportStatus(reportId, accessToken, profileId, region, tokenRefreshCallback = null) {
    try {
        const baseUri = BASE_URIS[region];
        if (!baseUri) {
            throw new Error(`Invalid region: ${region}`);
        }

        const url = `${baseUri}/reporting/reports/${reportId}`;
        let currentAccessToken = accessToken;
        let attempts = 0;
        let throttleRetries = 0;

        // Infinite loop - only exits on COMPLETED or FAILURE status
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

                console.log(`📊 [GetPPCMetrics] Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

                if (status === 'COMPLETED') {
                    console.log(`✅ [GetPPCMetrics] Report completed after ${attempts + 1} attempts`);
                    return {
                        status: 'COMPLETED',
                        location: location,
                        reportId: reportId,
                        finalAccessToken: currentAccessToken
                    };
                } else if (status === 'FAILURE') {
                    console.error(`❌ [GetPPCMetrics] Report generation failed after ${attempts + 1} attempts`);
                    return {
                        status: 'FAILURE',
                        reportId: reportId,
                        error: 'Report generation failed'
                    };
                }

                if (status === 'PROCESSING' || status === 'PENDING') {
                    if (attempts >= MAX_POLL_ATTEMPTS) {
                        console.error(`❌ [GetPPCMetrics] Report ${reportId} stuck in ${status} after ${attempts} polls (~${attempts} min); giving up`);
                        return { status: 'FAILURE', reportId, error: `Report timed out after ${attempts} polls while ${status}` };
                    }
                    // Log every 10 attempts (10 minutes) to track progress
                    if (attempts > 0 && attempts % 10 === 0) {
                        console.log(`⏳ [GetPPCMetrics] Report ${reportId} still ${status} after ${attempts} minutes, continuing to wait...`);
                    } else {
                    console.log(`⏳ [GetPPCMetrics] Report still ${status}, waiting 60 seconds...`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    attempts++;
                } else {
                    throw new Error(`Unknown report status: ${status}`);
                }

            } catch (error) {
                if (error.response && error.response.status === 401 && tokenRefreshCallback) {
                    console.log(`⚠️ [GetPPCMetrics] Token expired during polling, refreshing token...`);
                    try {
                        const newToken = await tokenRefreshCallback();
                        if (newToken) {
                            currentAccessToken = newToken;
                            console.log(`✅ [GetPPCMetrics] Token refreshed successfully, continuing poll...`);
                            continue;
                        }
                    } catch (refreshError) {
                        throw new Error(`Token refresh failed during polling: ${refreshError.message}`);
                    }
                }

                if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                    console.error(`Network error checking report status, retrying... (attempt ${attempts + 1})`);
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    attempts++;
                    continue;
                }
                // ★ 429 throttle during status polling — back off and retry the
                //   same poll. Bounded by MAX_THROTTLE_RETRIES so we eventually
                //   give up (the report itself is still in flight on Amazon's
                //   side and a later poll will pick up where we left off).
                if (isAdsThrottleError(error) && throttleRetries < MAX_THROTTLE_RETRIES) {
                    throttleRetries++;
                    const delay = THROTTLE_BASE_DELAY_MS * Math.pow(3, throttleRetries - 1);
                    console.warn(`⏳ [GetPPCMetrics] Throttled polling report ${reportId} (retry ${throttleRetries}/${MAX_THROTTLE_RETRIES}). Waiting ${delay}ms…`);
                    await sleep(delay);
                    continue;
                }
                throw error;
            }
        }

    } catch (error) {
        if (error.response) {
            const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            enhancedError.response = error.response;
            throw enhancedError;
        }
        throw error;
    }
}

/**
 * Download and parse report data
 */
async function downloadReportData(location, accessToken, profileId, tokenRefreshCallback = null) {
    let currentAccessToken = accessToken;
    let hasRetried = false;
    let throttleRetries = 0;

    while (true) {
        try {
            const response = await axios.get(location, {
                responseType: 'arraybuffer',
                decompress: false
            });

            const inflatedBuffer = await gunzip(response.data);
            const payloadText = inflatedBuffer.toString('utf8');
            const reportJson = JSON.parse(payloadText);

            return reportJson;

        } catch (err) {
            if (err.response && err.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetPPCMetrics] Token expired during download, refreshing token...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        console.log(`✅ [GetPPCMetrics] Token refreshed successfully, retrying download...`);
                        continue;
                    }
                } catch (refreshError) {
                    throw new Error(`Token refresh failed during download: ${refreshError.message}`);
                }
            }

            // ★ 429 throttle during report-document download — back off and
            //   retry. The pre-signed download URL stays valid throughout.
            if (isAdsThrottleError(err) && throttleRetries < MAX_THROTTLE_RETRIES) {
                throttleRetries++;
                const delay = THROTTLE_BASE_DELAY_MS * Math.pow(3, throttleRetries - 1);
                console.warn(`⏳ [GetPPCMetrics] Throttled downloading report (retry ${throttleRetries}/${MAX_THROTTLE_RETRIES}). Waiting ${delay}ms…`);
                await sleep(delay);
                continue;
            }

            if (err.response) {
                throw new Error(`Download failed: ${err.response.status} ${err.response.statusText}`);
            }
            throw err;
        }
    }
}

/**
 * Process report data and aggregate metrics
 * Uses chunked processing with yields to prevent blocking the event loop
 */
async function processReportData(reportData, campaignType) {
    const config = CAMPAIGN_TYPES[campaignType];
    const defaultSalesMetric = config.defaultSalesMetric;
    
    const metrics = {
        totalSales: 0,      // uses defaultSalesMetric
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalUnitsSoldClicks1d: 0,
        // All attribution window totals
        totalSales1d: 0,
        totalSales7d: 0,
        totalSales14d: 0,
        totalSales30d: 0,
        totalPurchases1d: 0,
        totalPurchases7d: 0,
        totalPurchases14d: 0,
        totalPurchases30d: 0,
        totalUnits1d: 0,
        totalUnits7d: 0,
        totalUnits14d: 0,
        totalUnits30d: 0,
        dateWiseData: {},
        campaigns: []
    };

    if (!reportData || !Array.isArray(reportData)) {
        return metrics;
    }

    // Process in chunks to yield to the event loop and allow lock renewal
    const CHUNK_SIZE = 500;
    for (let i = 0; i < reportData.length; i += CHUNK_SIZE) {
        const chunk = reportData.slice(i, i + CHUNK_SIZE);
        
        for (const row of chunk) {
            const spend = parseFloat(row.cost || 0);
            const impressions = parseInt(row.impressions || 0);
            const clicks = parseInt(row.clicks || 0);
            const date = row.date;

            // Extract all attribution windows
            // SP has explicit windows: sales1d, sales7d, sales14d, sales30d
            // SB/SD use: sales (=14d default), purchases, unitsSoldClicks
            const sales1d = parseFloat(row.sales1d || 0);
            const sales7d = parseFloat(row.sales7d || 0);
            const sales14d = parseFloat(row.sales14d || row.sales || 0);
            const sales30d = parseFloat(row.sales30d || 0);
            const purchases1d = parseFloat(row.purchases1d || 0);
            const purchases7d = parseFloat(row.purchases7d || 0);
            const purchases14d = parseFloat(row.purchases14d || row.purchases || 0);
            const purchases30d = parseFloat(row.purchases30d || 0);
            const units1d = parseInt(row.unitsSoldClicks1d || 0);
            const units7d = parseInt(row.unitsSoldClicks7d || 0);
            const units14d = parseInt(row.unitsSoldClicks14d || row.unitsSoldClicks || 0);
            const units30d = parseInt(row.unitsSoldClicks30d || 0);

            // Default metrics use the Seller Central default attribution window:
            //   SP: 7d — sales7d ALREADY includes halo (all products purchased after click)
            //   SB/SD: 14d — 'sales' column IS the 14d default
            const defaultSales = parseFloat(row[defaultSalesMetric] || row.sales || 0);
            const defaultPurchases = campaignType === 'SPONSORED_PRODUCTS'
                ? purchases7d : purchases14d;
            const defaultUnits = campaignType === 'SPONSORED_PRODUCTS'
                ? units7d : units14d;

            metrics.totalSales += defaultSales;
            metrics.totalSpend += spend;
            metrics.totalImpressions += impressions;
            metrics.totalClicks += clicks;
            metrics.totalUnitsSoldClicks1d += defaultUnits;

            // Attribution window totals
            metrics.totalSales1d += sales1d;
            metrics.totalSales7d += sales7d;
            metrics.totalSales14d += sales14d;
            metrics.totalSales30d += sales30d;
            metrics.totalPurchases1d += purchases1d;
            metrics.totalPurchases7d += purchases7d;
            metrics.totalPurchases14d += purchases14d;
            metrics.totalPurchases30d += purchases30d;
            metrics.totalUnits1d += units1d;
            metrics.totalUnits7d += units7d;
            metrics.totalUnits14d += units14d;
            metrics.totalUnits30d += units30d;

            // Date-wise aggregation
            if (date) {
                if (!metrics.dateWiseData[date]) {
                    metrics.dateWiseData[date] = {
                        sales: 0, spend: 0, impressions: 0, clicks: 0,
                        // All windows
                        sales1d: 0, sales7d: 0, sales14d: 0, sales30d: 0,
                        purchases1d: 0, purchases7d: 0, purchases14d: 0, purchases30d: 0,
                        units1d: 0, units7d: 0, units14d: 0, units30d: 0,
                        unitsSoldClicks1d: 0
                    };
                }
                const d = metrics.dateWiseData[date];
                d.sales += defaultSales;
                d.spend += spend;
                d.impressions += impressions;
                d.clicks += clicks;
                d.unitsSoldClicks1d += defaultUnits;
                d.sales1d += sales1d;
                d.sales7d += sales7d;
                d.sales14d += sales14d;
                d.sales30d += sales30d;
                d.purchases1d += purchases1d;
                d.purchases7d += purchases7d;
                d.purchases14d += purchases14d;
                d.purchases30d += purchases30d;
                d.units1d += units1d;
                d.units7d += units7d;
                d.units14d += units14d;
                d.units30d += units30d;
            }

            // Campaign-level data
            if (row.campaignId) {
                metrics.campaigns.push({
                    date: date || null,
                    campaignId: row.campaignId,
                    campaignName: row.campaignName,
                    campaignStatus: row.campaignStatus,
                    sales: defaultSales,
                    spend: spend,
                    impressions: impressions,
                    clicks: clicks,
                    unitsSoldClicks1d: defaultUnits,
                    purchases: defaultPurchases,
                    sales1d, sales7d, sales14d, sales30d,
                    purchases1d, purchases7d, purchases14d, purchases30d,
                    units1d, units7d, units14d, units30d
                });
            }
        }
        
        // Yield to event loop after each chunk to allow lock renewal
        if (i + CHUNK_SIZE < reportData.length) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    return metrics;
}

/**
 * Merge per-row campaign snapshots into one row per campaignId (sums across dates).
 */
function aggregateCampaignRows(rows) {
    if (!rows || !rows.length) return [];
    const map = new Map();
    for (const row of rows) {
        const id = row.campaignId != null ? String(row.campaignId) : '';
        if (!id) continue;
        if (!map.has(id)) {
            map.set(id, {
                campaignId: row.campaignId,
                campaignName: row.campaignName || '',
                campaignStatus: row.campaignStatus || '',
                sales: 0,
                spend: 0,
                impressions: 0,
                clicks: 0,
                unitsSoldClicks1d: 0
            });
        }
        const agg = map.get(id);
        agg.sales += Number(row.sales) || 0;
        agg.spend += Number(row.spend) || 0;
        agg.impressions += Number(row.impressions) || 0;
        agg.clicks += Number(row.clicks) || 0;
        agg.unitsSoldClicks1d += Number(row.unitsSoldClicks1d) || 0;
    }
    return Array.from(map.values());
}

/**
 * Combine metrics from all campaign types
 */
function combineMetrics(reportResults, startDate, endDate) {
    const combined = {
        dateRange: {
            startDate: startDate,
            endDate: endDate
        },
        totalSales: 0,
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalUnitsSoldClicks1d: 0,
        overallAcos: 0,
        overallRoas: 0,
        ctr: 0,
        cpc: 0,
        dateWiseMetrics: {},
        campaignTypeBreakdown: {
            sponsoredProducts: { sales: 0, spend: 0, impressions: 0, clicks: 0, acos: 0, unitsSoldClicks1d: 0 },
            sponsoredBrands: { sales: 0, spend: 0, impressions: 0, clicks: 0, acos: 0, unitsSoldClicks1d: 0 },
            sponsoredDisplay: { sales: 0, spend: 0, impressions: 0, clicks: 0, acos: 0, unitsSoldClicks1d: 0 }
        },
        processedCampaignTypes: [],
        campaignSummaries: {
            sponsoredProducts: [],
            sponsoredBrands: [],
            sponsoredDisplay: []
        }
    };

    const campaignTypeMap = {
        'SPONSORED_PRODUCTS': 'sponsoredProducts',
        'SPONSORED_BRANDS': 'sponsoredBrands',
        'SPONSORED_DISPLAY': 'sponsoredDisplay'
    };

    reportResults.forEach(({ campaignType, metrics, skipped, authRevoked }) => {
        if (skipped) {
            // Differentiate the two skip causes so the log doesn't conflate
            // a true "not enabled for this seller" with a 401 profile-permission
            // revocation. The aggregate check at the end of getPPCMetrics
            // promotes the all-auth-revoked case into a hard failure.
            const reason = authRevoked
                ? 'auth revoked (Amazon Ads profile permission)'
                : 'not available for this seller';
            console.log(`⏭️ Skipping ${campaignType} - ${reason}`);
            return;
        }

        const mappedType = campaignTypeMap[campaignType];
        combined.processedCampaignTypes.push(campaignType);

        combined.totalSales += metrics.totalSales;
        combined.totalSpend += metrics.totalSpend;
        combined.totalImpressions += metrics.totalImpressions;
        combined.totalClicks += metrics.totalClicks;
        combined.totalUnitsSoldClicks1d += metrics.totalUnitsSoldClicks1d || 0;

        if (mappedType) {
            combined.campaignTypeBreakdown[mappedType] = {
                sales: metrics.totalSales,
                spend: metrics.totalSpend,
                impressions: metrics.totalImpressions,
                clicks: metrics.totalClicks,
                unitsSoldClicks1d: metrics.totalUnitsSoldClicks1d || 0,
                acos: metrics.totalSales > 0 
                    ? parseFloat(((metrics.totalSpend / metrics.totalSales) * 100).toFixed(2)) 
                    : 0
            };
            combined.campaignSummaries[mappedType] = aggregateCampaignRows(metrics.campaigns || []);
        }

        // Merge date-wise data
        Object.keys(metrics.dateWiseData).forEach(date => {
            if (!combined.dateWiseMetrics[date]) {
                combined.dateWiseMetrics[date] = {
                    date: date,
                    sales: 0,
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    unitsSoldClicks1d: 0,
                    acos: 0,
                    roas: 0,
                    ctr: 0,
                    cpc: 0
                };
            }
            
            combined.dateWiseMetrics[date].sales += metrics.dateWiseData[date].sales;
            combined.dateWiseMetrics[date].spend += metrics.dateWiseData[date].spend;
            combined.dateWiseMetrics[date].impressions += metrics.dateWiseData[date].impressions;
            combined.dateWiseMetrics[date].clicks += metrics.dateWiseData[date].clicks;
            combined.dateWiseMetrics[date].unitsSoldClicks1d += metrics.dateWiseData[date].unitsSoldClicks1d || 0;
        });
    });

    // Calculate overall metrics
    if (combined.totalSales > 0) {
        combined.overallAcos = parseFloat(((combined.totalSpend / combined.totalSales) * 100).toFixed(2));
        combined.overallRoas = parseFloat((combined.totalSales / combined.totalSpend).toFixed(2));
    }

    if (combined.totalImpressions > 0) {
        combined.ctr = parseFloat(((combined.totalClicks / combined.totalImpressions) * 100).toFixed(2));
    }

    if (combined.totalClicks > 0) {
        combined.cpc = parseFloat((combined.totalSpend / combined.totalClicks).toFixed(2));
    }

    // Calculate date-wise ACOS, ROAS, CTR, CPC
    Object.keys(combined.dateWiseMetrics).forEach(date => {
        const dayMetrics = combined.dateWiseMetrics[date];
        
        if (dayMetrics.sales > 0) {
            dayMetrics.acos = parseFloat(((dayMetrics.spend / dayMetrics.sales) * 100).toFixed(2));
            dayMetrics.roas = parseFloat((dayMetrics.sales / dayMetrics.spend).toFixed(2));
        }
        
        if (dayMetrics.impressions > 0) {
            dayMetrics.ctr = parseFloat(((dayMetrics.clicks / dayMetrics.impressions) * 100).toFixed(2));
        }
        
        if (dayMetrics.clicks > 0) {
            dayMetrics.cpc = parseFloat((dayMetrics.spend / dayMetrics.clicks).toFixed(2));
        }
    });

    // Convert dateWiseMetrics object to sorted array
    combined.dateWiseMetrics = Object.values(combined.dateWiseMetrics)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    return combined;
}

const CAMPAIGN_TYPE_MAP = {
    SPONSORED_PRODUCTS: 'sponsoredProducts',
    SPONSORED_BRANDS: 'sponsoredBrands',
    SPONSORED_DISPLAY: 'sponsoredDisplay'
};

/**
 * Build one metrics payload per calendar day for DB storage (one document per metricDate).
 */
function buildDailyMetricsDocuments(reportResults, profileId) {
    const emptyBreakdown = () => ({
        sponsoredProducts: { sales: 0, spend: 0, impressions: 0, clicks: 0, acos: 0, unitsSoldClicks1d: 0 },
        sponsoredBrands: { sales: 0, spend: 0, impressions: 0, clicks: 0, acos: 0, unitsSoldClicks1d: 0 },
        sponsoredDisplay: { sales: 0, spend: 0, impressions: 0, clicks: 0, acos: 0, unitsSoldClicks1d: 0 }
    });

    const allDates = new Set();
    reportResults.forEach(({ metrics }) => {
        if (metrics?.dateWiseData && typeof metrics.dateWiseData === 'object') {
            Object.keys(metrics.dateWiseData).forEach((d) => allDates.add(d));
        }
    });

    const sortedDates = Array.from(allDates).sort((a, b) => a.localeCompare(b));
    const dailyDocs = [];

    for (const d of sortedDates) {
        const breakdown = emptyBreakdown();
        let totalSales = 0;
        let totalSpend = 0;
        let totalImpressions = 0;
        let totalClicks = 0;
        let totalUnits = 0;
        const processedSet = new Set();
        const summaries = {
            sponsoredProducts: [],
            sponsoredBrands: [],
            sponsoredDisplay: []
        };

        reportResults.forEach(({ campaignType, metrics, skipped }) => {
            if (skipped || !metrics) return;
            const mapped = CAMPAIGN_TYPE_MAP[campaignType];
            if (!mapped) return;

            const day = metrics.dateWiseData && metrics.dateWiseData[d];
            if (!day) return;

            processedSet.add(campaignType);
            breakdown[mapped] = {
                sales: day.sales || 0,
                spend: day.spend || 0,
                impressions: day.impressions || 0,
                clicks: day.clicks || 0,
                unitsSoldClicks1d: day.unitsSoldClicks1d || 0,
                acos:
                    day.sales > 0
                        ? parseFloat(((day.spend / day.sales) * 100).toFixed(2))
                        : 0
            };

            totalSales += day.sales || 0;
            totalSpend += day.spend || 0;
            totalImpressions += day.impressions || 0;
            totalClicks += day.clicks || 0;
            totalUnits += day.unitsSoldClicks1d || 0;

            const rowsForDay = (metrics.campaigns || []).filter((c) => c.date === d);
            summaries[mapped] = aggregateCampaignRows(rowsForDay);
        });

        const overallAcos =
            totalSales > 0 ? parseFloat(((totalSpend / totalSales) * 100).toFixed(2)) : 0;
        const overallRoas =
            totalSpend > 0 ? parseFloat((totalSales / totalSpend).toFixed(2)) : 0;
        const ctr =
            totalImpressions > 0
                ? parseFloat(((totalClicks / totalImpressions) * 100).toFixed(2))
                : 0;
        const cpc =
            totalClicks > 0 ? parseFloat((totalSpend / totalClicks).toFixed(2)) : 0;

        dailyDocs.push({
            metricDate: d,
            profileId,
            dateRange: { startDate: d, endDate: d },
            summary: {
                totalSales,
                totalSpend,
                totalImpressions,
                totalClicks,
                totalUnitsSoldClicks1d: totalUnits,
                overallAcos,
                overallRoas,
                ctr,
                cpc
            },
            campaignTypeBreakdown: breakdown,
            processedCampaignTypes: Array.from(processedSet),
            campaignSummaries: summaries,
            dateWiseMetrics: []
        });
    }

    return dailyDocs;
}

/**
 * Main function to get PPC metrics
 * @param {string} accessToken - Amazon Ads access token
 * @param {string} profileId - Amazon Ads profile ID
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} refreshToken - Refresh token for token refresh
 * @param {string} startDate - Start date (YYYY-MM-DD) - optional, defaults to 30 days ago
 * @param {string} endDate - End date (YYYY-MM-DD) - optional, defaults to yesterday
 * @param {boolean} saveToDatabase - Whether to save the data to database - defaults to true
 */
async function getPPCMetrics(accessToken, profileId, userId, country, region, refreshToken = null, startDate = null, endDate = null, saveToDatabase = true) {
    console.log(`🚀 [GetPPCMetrics] Starting PPC metrics fetch for user: ${userId}, country: ${country}, region: ${region}`);

    try {
        // Add a small delay to prevent rapid successive requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create token refresh callback
        const tokenRefreshCallback = refreshToken ? async () => {
            try {
                console.log('🔄 [GetPPCMetrics] Refreshing Amazon Ads token...');
                const newToken = await generateAdsAccessToken(refreshToken);
                if (newToken) {
                    console.log('✅ [GetPPCMetrics] Token refreshed successfully');
                    return newToken;
                } else {
                    throw new Error('Failed to generate new access token');
                }
            } catch (error) {
                console.error('❌ [GetPPCMetrics] Token refresh failed:', error.message);
                throw error;
            }
        } : null;

        // Calculate dates if not provided
        // Amazon Ads reports use the marketplace's timezone for date grouping.
        // For NA (US), this is Pacific Time. We compute "yesterday" in Pacific
        // to match the Finance API's Pacific-time convention.
        const PACIFIC_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC-7 (PDT)
        const nowUtc = Date.now();
        const nowPacific = new Date(nowUtc - PACIFIC_OFFSET_MS);
        const fmtDate = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
        
        // Yesterday in Pacific time
        const yesterdayPacific = new Date(nowPacific);
        yesterdayPacific.setUTCDate(yesterdayPacific.getUTCDate() - 1);
        
        const calculatedEndDate = endDate || fmtDate(yesterdayPacific);
        
        // 30 days total: yesterday back to yesterday-29
        const startPacific = new Date(yesterdayPacific);
        startPacific.setUTCDate(startPacific.getUTCDate() - 29);
        const calculatedStartDate = startDate || fmtDate(startPacific);

        console.log(`📅 [GetPPCMetrics] Date range: ${calculatedStartDate} to ${calculatedEndDate}`);

        // Create reports for all campaign types in parallel
        const campaignTypes = Object.keys(CAMPAIGN_TYPES);
        const createReportPromises = campaignTypes.map(campaignType =>
            createReport(accessToken, profileId, region, campaignType, calculatedStartDate, calculatedEndDate, tokenRefreshCallback)
                .then(result => ({ campaignType, ...result }))
                .catch(error => {
                    console.error(`❌ Error creating report for ${campaignType}:`, error.message);
                    // Tag auth-revoked errors so the aggregate logic at the end
                    // of this function can surface them as a real failure rather
                    // than silently logging $0 success. Other errors (legit
                    // 400/404 "not enabled", transient network blips) keep the
                    // existing "skipped, treat as zeroes" behaviour so partial
                    // data is still preserved across campaign types.
                    return {
                        campaignType,
                        reportId: null,
                        skipped: true,
                        error: error.message,
                        authRevoked: isAuthRevokedError(error)
                    };
                })
        );

        const reportCreationResults = await Promise.all(createReportPromises);
        console.log(`📝 [GetPPCMetrics] Created ${reportCreationResults.filter(r => r.reportId).length} reports`);

        // Wait for reports and download data
        const reportResults = [];
        let currentToken = accessToken;

        for (const reportResult of reportCreationResults) {
            if (reportResult.skipped || !reportResult.reportId) {
                reportResults.push({
                    campaignType: reportResult.campaignType,
                    skipped: true,
                    // Carry the auth-revoked flag forward from createReport's
                    // .catch so the aggregate check at the end of the function
                    // can detect "every campaign type had its profile rejected".
                    authRevoked: reportResult.authRevoked === true,
                    error: reportResult.error,
                    metrics: { totalSales: 0, totalSpend: 0, totalImpressions: 0, totalClicks: 0, totalUnitsSoldClicks1d: 0, dateWiseData: {}, campaigns: [] }
                });
                continue;
            }

            // Update current token if it was refreshed during report creation
            if (reportResult.currentAccessToken) {
                currentToken = reportResult.currentAccessToken;
            }

            try {
                // Check report status
                const reportStatus = await checkReportStatus(
                    reportResult.reportId, 
                    currentToken, 
                    profileId, 
                    region, 
                    tokenRefreshCallback
                );

                if (reportStatus.status === 'COMPLETED') {
                    // Update token if refreshed during status check
                    if (reportStatus.finalAccessToken) {
                        currentToken = reportStatus.finalAccessToken;
                    }

                    // Download report data
                    const reportData = await downloadReportData(
                        reportStatus.location, 
                        currentToken, 
                        profileId, 
                        tokenRefreshCallback
                    );

                    // Process the report data
                    const metrics = await processReportData(reportData, reportResult.campaignType);
                    
                    reportResults.push({
                        campaignType: reportResult.campaignType,
                        skipped: false,
                        metrics: metrics
                    });

                    console.log(`✅ [GetPPCMetrics] ${reportResult.campaignType}: Sales=$${metrics.totalSales.toFixed(2)}, Spend=$${metrics.totalSpend.toFixed(2)}`);
                } else {
                    console.error(`❌ [GetPPCMetrics] Report failed for ${reportResult.campaignType}`);
                    reportResults.push({ 
                        campaignType: reportResult.campaignType, 
                        skipped: true,
                        error: reportStatus.error,
                        metrics: { totalSales: 0, totalSpend: 0, totalImpressions: 0, totalClicks: 0, totalUnitsSoldClicks1d: 0, dateWiseData: {}, campaigns: [] }
                    });
                }
            } catch (error) {
                console.error(`❌ [GetPPCMetrics] Error processing ${reportResult.campaignType}:`, error.message);
                reportResults.push({
                    campaignType: reportResult.campaignType,
                    skipped: true,
                    error: error.message,
                    authRevoked: isAuthRevokedError(error),
                    metrics: { totalSales: 0, totalSpend: 0, totalImpressions: 0, totalClicks: 0, totalUnitsSoldClicks1d: 0, dateWiseData: {}, campaigns: [] }
                });
            }
        }

        // ─────────────────────────────────────────────────────────────
        // Auth-revoked aggregate check
        //
        // If EVERY campaign-type report failed with a 401 "does not have
        // access to profile" error, the seller's Amazon Ads advertiser
        // permission has been revoked upstream. Without this throw the
        // function would silently log "$0 sales / $0 spend / Saved 0
        // documents" and return success — the phase wrapper would then
        // mark the run as succeeded, lastDailyUpdate would stamp, and
        // the same broken account would silently waste a slot every
        // day forever.
        //
        // We only escalate when EVERY result is auth-revoked. Partial
        // failures (e.g. one campaign type 401-revoked, others fetched
        // fine) still use the existing "skipped, count zero" behaviour
        // so legitimate partial data is preserved.
        //
        // Throwing here propagates up through the outer try/catch
        // (re-thrown at the catch block below) → the wrapper in
        // fetchScheduledApiData marks `success: false` for this service
        // → AdsPhase's `anyAdsSucceeded` becomes false if no other ads
        // service succeeded → A.3 finalize gate skips
        // markDailyUpdateComplete → the cron retries (up to the
        // per-account daily cap), then caps out. Honest signal end-to-end.
        const everyResultAuthRevoked =
            reportResults.length > 0 &&
            reportResults.every(r => r && r.authRevoked === true);
        if (everyResultAuthRevoked) {
            const sampleError = reportResults.find(r => r && r.error)?.error || '(no error message captured)';
            const err = new Error(
                `Amazon Ads profile permission revoked for user ${userId} (${country}-${region}). ` +
                `All ${reportResults.length} campaign-type reports returned 401. ` +
                `The seller needs to re-authorize Amazon Ads. Sample upstream error: ${sampleError}`
            );
            err.authRevoked = true;
            throw err;
        }

        // Combine all metrics
        const combinedMetrics = combineMetrics(reportResults, calculatedStartDate, calculatedEndDate);

        console.log(`🎉 [GetPPCMetrics] Completed! Total Sales: $${combinedMetrics.totalSales.toFixed(2)}, Total Spend: $${combinedMetrics.totalSpend.toFixed(2)}, ACOS: ${combinedMetrics.overallAcos}%`);

        // Save one document per calendar day
        let savedRecord = null;
        let documentsSaved = 0;
        if (saveToDatabase) {
            try {
                const dailyDocs = buildDailyMetricsDocuments(reportResults, profileId);
                const userIdStr = userId?.toString() || userId;
                console.log(`💾 [GetPPCMetrics] Saving ${dailyDocs.length} per-day metric documents...`);

                for (const doc of dailyDocs) {
                    const { metricDate, ...payload } = doc;
                    savedRecord = await PPCMetrics.upsertMetricsForDate(
                        userIdStr,
                        country,
                        region,
                        metricDate,
                        payload
                    );
                    documentsSaved += 1;
                }

                console.log(
                    `✅ [GetPPCMetrics] Saved ${documentsSaved} daily PPC metric document(s). Last ID: ${savedRecord?._id}`
                );
            } catch (saveError) {
                console.error(`⚠️ [GetPPCMetrics] Failed to save metrics to database:`, saveError.message);
            }
        }

        return {
            success: true,
            message: 'PPC metrics fetched successfully',
            data: combinedMetrics,
            metadata: {
                userId: userId,
                country: country,
                region: region,
                profileId: profileId,
                processedAt: new Date().toISOString(),
                savedToDatabase: documentsSaved > 0,
                documentsSaved,
                recordId: savedRecord?._id?.toString() || null
            }
        };

    } catch (error) {
        console.error('❌ [GetPPCMetrics] Error:', error.message);
        
        if (error.message.includes('425')) {
            throw new Error('Duplicate request detected by Amazon Ads API. Please wait a moment before retrying.');
        }
        
        throw error;
    }
}

module.exports = {
    getPPCMetrics,
    CAMPAIGN_TYPES,
    BASE_URIS
};
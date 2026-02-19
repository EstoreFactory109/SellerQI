/**
 * GetPPCUnitsSold Service
 * 
 * Fetches units sold data from Amazon Ads API with date-wise breakdown.
 * This is a separate service to avoid modifying existing PPC metrics functionality.
 * 
 * Available metrics:
 * - Sponsored Products: unitsSoldClicks1d, unitsSoldClicks7d, unitsSoldClicks14d, unitsSoldClicks30d
 * - Sponsored Brands: unitsSold14d, newToBrandUnitsSold14d
 * - Sponsored Display: unitsSold14d
 */

const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const { generateAdsAccessToken } = require('./GenerateToken');
const PPCUnitsSold = require('../../models/amazon-ads/PPCUnitsSoldModel');

const gunzip = promisify(zlib.gunzip);

// Base URIs for different regions
const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

// Report configurations with units sold columns
// Attribution windows per Amazon documentation:
// - Sponsored Products: 7-day for sellers
// - Sponsored Brands/Display: 14-day
const UNITS_SOLD_REPORT_CONFIGS = {
    SPONSORED_PRODUCTS: {
        adProduct: 'SPONSORED_PRODUCTS',
        reportTypeId: 'spCampaigns',
        columns: [
            "date",
            "campaignId",
            "campaignName",
            "impressions",
            "clicks",
            "cost",
            "sales7d",
            "purchases7d",
            // Units sold metrics with different attribution windows
            "unitsSoldClicks1d",
            "unitsSoldClicks7d",
            "unitsSoldClicks14d",
            "unitsSoldClicks30d"
        ]
    },
    SPONSORED_BRANDS: {
        adProduct: 'SPONSORED_BRANDS',
        reportTypeId: 'sbCampaigns',
        columns: [
            "date",
            "campaignId",
            "campaignName",
            "impressions",
            "clicks",
            "cost",
            "sales14d",
            "purchases14d",
            // Units sold metrics for SB
            "unitsSold14d",
            "newToBrandUnitsSold14d",
            "newToBrandUnitsSoldPercentage14d"
        ]
    },
    SPONSORED_DISPLAY: {
        adProduct: 'SPONSORED_DISPLAY',
        reportTypeId: 'sdCampaigns',
        columns: [
            "date",
            "campaignId",
            "campaignName",
            "impressions",
            "clicks",
            "cost",
            "sales14d",
            "purchases14d",
            // Units sold metrics for SD
            "unitsSold14d"
        ]
    }
};

/**
 * Create a report request for units sold data
 */
async function createUnitsReport(accessToken, profileId, region, reportConfig, startDate, endDate, tokenRefreshCallback = null) {
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
            const uniqueReportName = `PPC Units Sold Report - ${reportConfig.adProduct} - ${timestamp}`;

            const body = {
                "name": uniqueReportName,
                "startDate": startDate,
                "endDate": endDate,
                "configuration": {
                    "adProduct": reportConfig.adProduct,
                    "reportTypeId": reportConfig.reportTypeId,
                    "format": "GZIP_JSON",
                    "groupBy": ["campaign"],
                    "columns": reportConfig.columns,
                    "filters": [],
                    "timeUnit": "DAILY"
                }
            };

            const response = await axios.post(url, body, { headers });
            return { ...response.data, currentAccessToken };

        } catch (error) {
            // Handle 401 Unauthorized - refresh token and retry once
            if (error.response && error.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetPPCUnitsSold] Token expired during createUnitsReport for ${reportConfig.adProduct}, refreshing...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        console.log(`✅ [GetPPCUnitsSold] Token refreshed, retrying createUnitsReport...`);
                        continue;
                    } else {
                        throw new Error('Token refresh callback returned null/undefined');
                    }
                } catch (refreshError) {
                    console.error('❌ [GetPPCUnitsSold] Failed to refresh token:', refreshError.message);
                    throw new Error(`Token refresh failed: ${refreshError.message}`);
                }
            }

            if (error.response) {
                // Some campaign types might not be available for this seller
                if (error.response.status === 400 || error.response.status === 404) {
                    console.log(`⚠️ [GetPPCUnitsSold] ${reportConfig.adProduct} not available for this seller, skipping...`);
                    return { reportId: null, skipped: true, campaignType: reportConfig.adProduct };
                }
                
                const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
                enhancedError.response = error.response;
                throw enhancedError;
            }
            throw error;
        }
    }
}

/**
 * Check report status and wait for completion
 */
async function checkUnitsReportStatus(reportId, accessToken, profileId, region, tokenRefreshCallback = null) {
    const baseUri = BASE_URIS[region];
    if (!baseUri) {
        throw new Error(`Invalid region: ${region}`);
    }

    const url = `${baseUri}/reporting/reports/${reportId}`;
    let currentAccessToken = accessToken;
    let attempts = 0;

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

            console.log(`📊 [GetPPCUnitsSold] Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

            if (status === 'COMPLETED') {
                console.log(`✅ [GetPPCUnitsSold] Report completed after ${attempts + 1} attempts`);
                return {
                    status: 'COMPLETED',
                    location: location,
                    reportId: reportId,
                    finalAccessToken: currentAccessToken
                };
            } else if (status === 'FAILURE') {
                console.error(`❌ [GetPPCUnitsSold] Report generation failed after ${attempts + 1} attempts`);
                return {
                    status: 'FAILURE',
                    reportId: reportId,
                    error: 'Report generation failed'
                };
            }

            if (status === 'PROCESSING' || status === 'PENDING') {
                // Log every 10 attempts (10 minutes) to track progress
                if (attempts > 0 && attempts % 10 === 0) {
                    console.log(`⏳ [GetPPCUnitsSold] Report ${reportId} still ${status} after ${attempts} minutes, continuing to wait...`);
                } else {
                    console.log(`⏳ [GetPPCUnitsSold] Report still ${status}, waiting 60 seconds...`);
                }
                await new Promise(resolve => setTimeout(resolve, 60000));
                attempts++;
            } else {
                throw new Error(`Unknown report status: ${status}`);
            }

        } catch (error) {
            if (error.response && error.response.status === 401 && tokenRefreshCallback) {
                console.log(`⚠️ [GetPPCUnitsSold] Token expired during polling, refreshing...`);
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
                        currentAccessToken = newToken;
                        console.log(`✅ [GetPPCUnitsSold] Token refreshed successfully, continuing poll...`);
                        continue;
                    }
                } catch (refreshError) {
                    throw new Error(`Token refresh failed during polling: ${refreshError.message}`);
                }
            }

            if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                console.error(`[GetPPCUnitsSold] Network error checking report status, retrying... (attempt ${attempts + 1})`);
                await new Promise(resolve => setTimeout(resolve, 60000));
                attempts++;
                continue;
            }
            throw error;
        }
    }
}

/**
 * Download and parse report data
 */
async function downloadUnitsReportData(location, accessToken, tokenRefreshCallback = null) {
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

            return reportJson;

        } catch (err) {
            if (err.response && err.response.status === 401 && !hasRetried && tokenRefreshCallback) {
                console.log(`⚠️ [GetPPCUnitsSold] Token expired during download, refreshing...`);
                hasRetried = true;
                try {
                    const newToken = await tokenRefreshCallback();
                    if (newToken) {
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

/**
 * Process units sold data from report (simplified to only 1-day attribution)
 */
async function processUnitsData(reportData, campaignType) {
    const metrics = {
        campaignType: campaignType,
        totalUnits: 0,
        dateWiseUnits: {},
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
            const date = row.date;
            
            // Initialize date if not exists
            if (date && !metrics.dateWiseUnits[date]) {
                metrics.dateWiseUnits[date] = {
                    date: date,
                    units: 0,
                    sales: 0,
                    spend: 0,
                    impressions: 0,
                    clicks: 0
                };
            }

            // Process based on campaign type
            // SP uses 7-day attribution for sellers, SB/SD use 14-day
            let units = 0;
            let sales = 0;
            
            if (campaignType === 'SPONSORED_PRODUCTS') {
                // Use 7-day units to match Seller Central's attribution for sellers
                units = parseInt(row.unitsSoldClicks7d || row.unitsSoldClicks1d || 0);
                sales = parseFloat(row.sales7d || 0);
            } else if (campaignType === 'SPONSORED_BRANDS') {
                units = parseInt(row.unitsSold14d || 0);
                sales = parseFloat(row.sales14d || 0);
            } else if (campaignType === 'SPONSORED_DISPLAY') {
                units = parseInt(row.unitsSold14d || 0);
                sales = parseFloat(row.sales14d || 0);
            }
            
            metrics.totalUnits += units;
            
            if (date) {
                metrics.dateWiseUnits[date].units += units;
                metrics.dateWiseUnits[date].sales += sales;
                metrics.dateWiseUnits[date].spend += parseFloat(row.cost || 0);
                metrics.dateWiseUnits[date].impressions += parseInt(row.impressions || 0);
                metrics.dateWiseUnits[date].clicks += parseInt(row.clicks || 0);
            }

            // Collect campaign-level data
            if (row.campaignId) {
                metrics.campaigns.push({
                    campaignId: row.campaignId,
                    campaignName: row.campaignName,
                    date: date,
                    units: units
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
 * Combine metrics from all campaign types (simplified to only 1-day attribution)
 */
function combineUnitsMetrics(reportResults, startDate, endDate) {
    const combined = {
        dateRange: {
            startDate: startDate,
            endDate: endDate
        },
        totalUnits: 0,
        dateWiseUnits: {},
        processedCampaignTypes: [],
        summary: {}
    };

    reportResults.forEach(({ campaignType, metrics, skipped }) => {
        if (skipped) {
            console.log(`⏭️ [GetPPCUnitsSold] Skipping ${campaignType} - not available for this seller`);
            return;
        }

        combined.processedCampaignTypes.push(campaignType);

        // Aggregate totals
        combined.totalUnits += metrics.totalUnits;

        // Merge date-wise data
        Object.entries(metrics.dateWiseUnits).forEach(([date, units]) => {
            if (!combined.dateWiseUnits[date]) {
                combined.dateWiseUnits[date] = {
                    date: date,
                    units: 0,
                    sales: 0,
                    spend: 0,
                    impressions: 0,
                    clicks: 0
                };
            }
            
            combined.dateWiseUnits[date].units += units.units;
            combined.dateWiseUnits[date].sales += units.sales;
            combined.dateWiseUnits[date].spend += units.spend;
            combined.dateWiseUnits[date].impressions += units.impressions;
            combined.dateWiseUnits[date].clicks += units.clicks;
        });
    });

    // Convert dateWiseUnits to sorted array
    combined.dateWiseUnits = Object.values(combined.dateWiseUnits)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate summary statistics
    const totalDays = combined.dateWiseUnits.length;
    const totalSales = combined.dateWiseUnits.reduce((sum, day) => sum + day.sales, 0);
    const totalSpend = combined.dateWiseUnits.reduce((sum, day) => sum + day.spend, 0);
    
    combined.summary = {
        totalUnits: combined.totalUnits,
        averageDailyUnits: totalDays > 0
            ? parseFloat((combined.totalUnits / totalDays).toFixed(2))
            : 0,
        totalSales: parseFloat(totalSales.toFixed(2)),
        totalSpend: parseFloat(totalSpend.toFixed(2))
    };

    return combined;
}

/**
 * Main function to get PPC units sold data
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
async function getPPCUnitsSold(accessToken, profileId, userId, country, region, refreshToken = null, startDate = null, endDate = null, saveToDatabase = true) {
    console.log(`📦 [GetPPCUnitsSold] Starting units sold fetch for user: ${userId}, country: ${country}, region: ${region}`);

    try {
        // Add a small delay to prevent rapid successive requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Create token refresh callback
        const tokenRefreshCallback = refreshToken ? async () => {
            try {
                console.log('🔄 [GetPPCUnitsSold] Refreshing Amazon Ads token...');
                const newToken = await generateAdsAccessToken(refreshToken);
                if (newToken) {
                    console.log('✅ [GetPPCUnitsSold] Token refreshed successfully');
                    return newToken;
                } else {
                    throw new Error('Failed to generate new access token');
                }
            } catch (error) {
                console.error('❌ [GetPPCUnitsSold] Token refresh failed:', error.message);
                throw error;
            }
        } : null;

        // Calculate dates if not provided
        const now = new Date();
        const calculatedEndDate = endDate || new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        const calculatedStartDate = startDate || new Date(now.getTime() - (31 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

        console.log(`📅 [GetPPCUnitsSold] Date range: ${calculatedStartDate} to ${calculatedEndDate}`);

        // Create reports for all campaign types in parallel
        const campaignTypes = Object.keys(UNITS_SOLD_REPORT_CONFIGS);
        const createReportPromises = campaignTypes.map(campaignType => 
            createUnitsReport(
                accessToken, 
                profileId, 
                region, 
                UNITS_SOLD_REPORT_CONFIGS[campaignType], 
                calculatedStartDate, 
                calculatedEndDate, 
                tokenRefreshCallback
            )
                .then(result => ({ campaignType, ...result }))
                .catch(error => {
                    console.error(`❌ [GetPPCUnitsSold] Error creating report for ${campaignType}:`, error.message);
                    return { campaignType, reportId: null, skipped: true, error: error.message };
                })
        );

        const reportCreationResults = await Promise.all(createReportPromises);
        console.log(`📝 [GetPPCUnitsSold] Created ${reportCreationResults.filter(r => r.reportId).length} reports`);

        // Wait for reports and download data
        const reportResults = [];
        let currentToken = accessToken;

        for (const reportResult of reportCreationResults) {
            if (reportResult.skipped || !reportResult.reportId) {
                reportResults.push({ 
                    campaignType: reportResult.campaignType, 
                    skipped: true,
                    metrics: { 
                        campaignType: reportResult.campaignType,
                        totalUnits: { units1d: 0, units7d: 0, units14d: 0, units30d: 0, newToBrandUnits: 0 },
                        dateWiseUnits: {},
                        campaigns: []
                    }
                });
                continue;
            }

            // Update current token if it was refreshed during report creation
            if (reportResult.currentAccessToken) {
                currentToken = reportResult.currentAccessToken;
            }

            try {
                // Check report status
                const reportStatus = await checkUnitsReportStatus(
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
                    const reportData = await downloadUnitsReportData(
                        reportStatus.location, 
                        currentToken, 
                        tokenRefreshCallback
                    );

                    // Process the report data
                    const metrics = await processUnitsData(reportData, reportResult.campaignType);
                    
                    reportResults.push({
                        campaignType: reportResult.campaignType,
                        skipped: false,
                        metrics: metrics
                    });

                    console.log(`✅ [GetPPCUnitsSold] ${reportResult.campaignType}: Units7d=${metrics.totalUnits.units7d}, Units14d=${metrics.totalUnits.units14d}`);
                } else {
                    console.error(`❌ [GetPPCUnitsSold] Report failed for ${reportResult.campaignType}`);
                    reportResults.push({ 
                        campaignType: reportResult.campaignType, 
                        skipped: true,
                        error: reportStatus.error,
                        metrics: { 
                            campaignType: reportResult.campaignType,
                            totalUnits: { units1d: 0, units7d: 0, units14d: 0, units30d: 0, newToBrandUnits: 0 },
                            dateWiseUnits: {},
                            campaigns: []
                        }
                    });
                }
            } catch (error) {
                console.error(`❌ [GetPPCUnitsSold] Error processing ${reportResult.campaignType}:`, error.message);
                reportResults.push({ 
                    campaignType: reportResult.campaignType, 
                    skipped: true,
                    error: error.message,
                    metrics: { 
                        campaignType: reportResult.campaignType,
                        totalUnits: { units1d: 0, units7d: 0, units14d: 0, units30d: 0, newToBrandUnits: 0 },
                        dateWiseUnits: {},
                        campaigns: []
                    }
                });
            }
        }

        // Combine all metrics
        const combinedMetrics = combineUnitsMetrics(reportResults, calculatedStartDate, calculatedEndDate);

        console.log(`🎉 [GetPPCUnitsSold] Completed! Total Units (7d): ${combinedMetrics.totalUnits.units7d}, New-to-Brand: ${combinedMetrics.totalUnits.newToBrandUnits}`);

        // Save to database if requested
        let savedRecord = null;
        if (saveToDatabase) {
            try {
                console.log(`💾 [GetPPCUnitsSold] Saving units sold data to database...`);
                console.log(`💾 [GetPPCUnitsSold] Total units: ${combinedMetrics.totalUnits}, DateWise entries: ${combinedMetrics.dateWiseUnits.length}`);
                savedRecord = await PPCUnitsSold.upsertUnitsSold(
                    userId,
                    country,
                    region,
                    calculatedStartDate,
                    calculatedEndDate,
                    {
                        profileId: profileId,
                        dateRange: combinedMetrics.dateRange,
                        totalUnits: combinedMetrics.totalUnits,
                        summary: combinedMetrics.summary,
                        dateWiseUnits: combinedMetrics.dateWiseUnits,
                        processedCampaignTypes: combinedMetrics.processedCampaignTypes
                    }
                );
                console.log(`✅ [GetPPCUnitsSold] Units sold data saved to database with ID: ${savedRecord._id}`);
            } catch (saveError) {
                console.error(`⚠️ [GetPPCUnitsSold] Failed to save units sold data to database:`, saveError.message);
                console.error(`⚠️ [GetPPCUnitsSold] Error stack:`, saveError.stack);
                // Don't throw - continue to return the data even if save fails
            }
        }

        return {
            success: true,
            message: 'PPC units sold data fetched successfully',
            data: combinedMetrics,
            metadata: {
                userId: userId,
                country: country,
                region: region,
                profileId: profileId,
                processedAt: new Date().toISOString(),
                savedToDatabase: !!savedRecord,
                recordId: savedRecord?._id?.toString() || null
            }
        };

    } catch (error) {
        console.error('❌ [GetPPCUnitsSold] Error:', error.message);
        
        if (error.message.includes('425')) {
            throw new Error('Duplicate request detected by Amazon Ads API. Please wait a moment before retrying.');
        }
        
        throw error;
    }
}

module.exports = {
    getPPCUnitsSold,
    UNITS_SOLD_REPORT_CONFIGS,
    BASE_URIS
};


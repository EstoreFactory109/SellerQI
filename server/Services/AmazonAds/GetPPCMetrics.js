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
// Using 30-day attribution window (sales30d) for all campaign types for consistency
// Note: SP supports sales30d, SB/SD use 'sales' which is their default 14-day attribution
const CAMPAIGN_TYPES = {
    SPONSORED_PRODUCTS: {
        adProduct: 'SPONSORED_PRODUCTS',
        reportTypeId: 'spCampaigns',
        salesMetric: 'sales30d',
        columns: [
            "date",
            "campaignId",
            "campaignName",
            "campaignStatus",
            "cost",
            "impressions",
            "clicks",
            "sales30d",
            "purchases30d"
        ]
    },
    SPONSORED_BRANDS: {
        adProduct: 'SPONSORED_BRANDS',
        reportTypeId: 'sbCampaigns',
        salesMetric: 'sales',
        columns: [
            "date",
            "campaignId",
            "campaignName",
            "campaignStatus",
            "cost",
            "impressions",
            "clicks",
            "sales",
            "purchases",
            "unitsSold"
        ]
    },
    SPONSORED_DISPLAY: {
        adProduct: 'SPONSORED_DISPLAY',
        reportTypeId: 'sdCampaigns',
        salesMetric: 'sales',
        columns: [
            "date",
            "campaignId",
            "campaignName",
            "campaignStatus",
            "cost",
            "impressions",
            "clicks",
            "sales",
            "purchases",
            "unitsSold"
        ]
    }
};

/**
 * Create a report request for a specific campaign type
 */
async function createReport(accessToken, profileId, region, campaignType, startDate, endDate, tokenRefreshCallback = null) {
    let currentAccessToken = accessToken;
    let hasRetried = false;

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
    const salesMetric = config.salesMetric;
    
    const metrics = {
        totalSales: 0,
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
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
            // Get sales from the appropriate column based on campaign type
            // SP uses sales30d, SB/SD use 'sales' (which is 14-day by default)
            const sales = parseFloat(row[salesMetric] || row.sales30d || row.sales || 0);
            const spend = parseFloat(row.cost || 0);
            const impressions = parseInt(row.impressions || 0);
            const clicks = parseInt(row.clicks || 0);
            const date = row.date;

            metrics.totalSales += sales;
            metrics.totalSpend += spend;
            metrics.totalImpressions += impressions;
            metrics.totalClicks += clicks;

            // Date-wise aggregation
            if (date) {
                if (!metrics.dateWiseData[date]) {
                    metrics.dateWiseData[date] = {
                        sales: 0,
                        spend: 0,
                        impressions: 0,
                        clicks: 0
                    };
                }
                
                metrics.dateWiseData[date].sales += sales;
                metrics.dateWiseData[date].spend += spend;
                metrics.dateWiseData[date].impressions += impressions;
                metrics.dateWiseData[date].clicks += clicks;
            }

            // Campaign-level data
            if (row.campaignId) {
                metrics.campaigns.push({
                    campaignId: row.campaignId,
                    campaignName: row.campaignName,
                    campaignStatus: row.campaignStatus,
                    sales: sales,
                    spend: spend,
                    impressions: impressions,
                    clicks: clicks
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
        overallAcos: 0,
        overallRoas: 0,
        ctr: 0,
        cpc: 0,
        dateWiseMetrics: {},
        campaignTypeBreakdown: {
            sponsoredProducts: { sales: 0, spend: 0, impressions: 0, clicks: 0, acos: 0 },
            sponsoredBrands: { sales: 0, spend: 0, impressions: 0, clicks: 0, acos: 0 },
            sponsoredDisplay: { sales: 0, spend: 0, impressions: 0, clicks: 0, acos: 0 }
        },
        processedCampaignTypes: []
    };

    const campaignTypeMap = {
        'SPONSORED_PRODUCTS': 'sponsoredProducts',
        'SPONSORED_BRANDS': 'sponsoredBrands',
        'SPONSORED_DISPLAY': 'sponsoredDisplay'
    };

    reportResults.forEach(({ campaignType, metrics, skipped }) => {
        if (skipped) {
            console.log(`⏭️ Skipping ${campaignType} - not available for this seller`);
            return;
        }

        const mappedType = campaignTypeMap[campaignType];
        combined.processedCampaignTypes.push(campaignType);

        combined.totalSales += metrics.totalSales;
        combined.totalSpend += metrics.totalSpend;
        combined.totalImpressions += metrics.totalImpressions;
        combined.totalClicks += metrics.totalClicks;

        if (mappedType) {
            combined.campaignTypeBreakdown[mappedType] = {
                sales: metrics.totalSales,
                spend: metrics.totalSpend,
                impressions: metrics.totalImpressions,
                clicks: metrics.totalClicks,
                acos: metrics.totalSales > 0 
                    ? parseFloat(((metrics.totalSpend / metrics.totalSales) * 100).toFixed(2)) 
                    : 0
            };
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
        const now = new Date();
        const calculatedEndDate = endDate || new Date(now.getTime() - (24 * 60 * 60 * 1000)).toISOString().split('T')[0]; // Yesterday
        const calculatedStartDate = startDate || new Date(now.getTime() - (31 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0]; // 30 days ago

        console.log(`📅 [GetPPCMetrics] Date range: ${calculatedStartDate} to ${calculatedEndDate}`);

        // Create reports for all campaign types in parallel
        const campaignTypes = Object.keys(CAMPAIGN_TYPES);
        const createReportPromises = campaignTypes.map(campaignType => 
            createReport(accessToken, profileId, region, campaignType, calculatedStartDate, calculatedEndDate, tokenRefreshCallback)
                .then(result => ({ campaignType, ...result }))
                .catch(error => {
                    console.error(`❌ Error creating report for ${campaignType}:`, error.message);
                    return { campaignType, reportId: null, skipped: true, error: error.message };
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
                    metrics: { totalSales: 0, totalSpend: 0, totalImpressions: 0, totalClicks: 0, dateWiseData: {}, campaigns: [] }
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
                        metrics: { totalSales: 0, totalSpend: 0, totalImpressions: 0, totalClicks: 0, dateWiseData: {}, campaigns: [] }
                    });
                }
            } catch (error) {
                console.error(`❌ [GetPPCMetrics] Error processing ${reportResult.campaignType}:`, error.message);
                reportResults.push({ 
                    campaignType: reportResult.campaignType, 
                    skipped: true,
                    error: error.message,
                    metrics: { totalSales: 0, totalSpend: 0, totalImpressions: 0, totalClicks: 0, dateWiseData: {}, campaigns: [] }
                });
            }
        }

        // Combine all metrics
        const combinedMetrics = combineMetrics(reportResults, calculatedStartDate, calculatedEndDate);

        console.log(`🎉 [GetPPCMetrics] Completed! Total Sales: $${combinedMetrics.totalSales.toFixed(2)}, Total Spend: $${combinedMetrics.totalSpend.toFixed(2)}, ACOS: ${combinedMetrics.overallAcos}%`);

        // Save to database if requested
        let savedRecord = null;
        if (saveToDatabase) {
            try {
                console.log(`💾 [GetPPCMetrics] Saving metrics to database...`);
                savedRecord = await PPCMetrics.upsertMetrics(
                    userId,
                    country,
                    region,
                    calculatedStartDate,
                    calculatedEndDate,
                    {
                        profileId: profileId,
                        dateRange: combinedMetrics.dateRange,
                        summary: {
                            totalSales: combinedMetrics.totalSales,
                            totalSpend: combinedMetrics.totalSpend,
                            totalImpressions: combinedMetrics.totalImpressions,
                            totalClicks: combinedMetrics.totalClicks,
                            overallAcos: combinedMetrics.overallAcos,
                            overallRoas: combinedMetrics.overallRoas,
                            ctr: combinedMetrics.ctr,
                            cpc: combinedMetrics.cpc
                        },
                        campaignTypeBreakdown: combinedMetrics.campaignTypeBreakdown,
                        dateWiseMetrics: combinedMetrics.dateWiseMetrics,
                        processedCampaignTypes: combinedMetrics.processedCampaignTypes
                    }
                );
                console.log(`✅ [GetPPCMetrics] Metrics saved to database with ID: ${savedRecord._id}`);
            } catch (saveError) {
                console.error(`⚠️ [GetPPCMetrics] Failed to save metrics to database:`, saveError.message);
                // Don't throw - continue to return the data even if save fails
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
                savedToDatabase: !!savedRecord,
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


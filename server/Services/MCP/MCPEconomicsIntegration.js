/**
 * MCPEconomicsIntegration.js
 * 
 * Service for fetching economics data from Amazon Data Kiosk API
 * and storing calculated metrics in the database.
 * 
 * This replaces the separate sales/finance API calls with a unified MCP approach.
 * 
 * IMPORTANT: Uses TWO separate queries for accurate data:
 * 1. RANGE + PARENT_ASIN query: Gets ASIN-level totals and overall summaries
 * 2. DAY + PARENT_ASIN query: Gets date-wise breakdowns for charts and trends
 * 
 * This is necessary because Amazon's Data Kiosk API aggregates differently
 * based on the dateGranularity parameter.
 */

const { buildEconomicsQuery } = require('./QueryBuilderService.js');
const { 
    createQueryWithRefreshToken, 
    waitForQueryCompletionWithRefreshToken,
    downloadDocument 
} = require('./DataKioskService.js');
const { calculateEconomicsMetrics, calculateDatewiseMetrics, calculateAsinWiseDailyMetrics } = require('../Calculations/EconomicsMetricsCalculation.js');
const { saveEconomicsMetrics, getLatestEconomicsMetrics } = require('./EconomicsMetricsService.js');
const { fetchSalesAndTrafficByDate } = require('./MCPSalesAndTrafficIntegration.js');
const logger = require('../../utils/Logger.js');
const LoggingHelper = require('../../utils/LoggingHelper.js');

/**
 * Fetch economics data from MCP Data Kiosk API and store in database
 * Uses TWO queries for accurate data:
 * 1. RANGE + PARENT_ASIN: For totals and ASIN-wise breakdown
 * 2. DAY + PARENT_ASIN: For accurate date-wise breakdowns
 * 
 * @param {string} userId - User ID
 * @param {string} refreshToken - SP-API refresh token
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Country/Marketplace code (US, CA, UK, etc.)
 * @returns {Promise<Object>} Result with success status and data
 */
async function fetchAndStoreEconomicsData(userId, refreshToken, region, country) {
    logger.info('Starting MCP Economics data fetch (dual query mode)', { 
        userId, 
        region, 
        country,
        hasRefreshToken: !!refreshToken,
        refreshTokenLength: refreshToken ? refreshToken.length : 0
    });

    try {
        if (!refreshToken) {
            const errorMsg = 'Refresh token not available';
            logger.error('[MCP Economics] No refresh token provided', { userId, region, country });
            
            // Log to MongoDB for tracking
            await LoggingHelper.logStandaloneError({
                userId,
                region,
                country,
                functionName: 'fetchAndStoreEconomicsData',
                error: errorMsg,
                source: 'MCP_ECONOMICS',
                additionalData: { reason: 'missing_refresh_token' }
            });
            
            return {
                success: false,
                error: errorMsg,
                data: null
            };
        }

        // Validate region and country combination
        const { REGION_VALID_MARKETPLACES } = require('./constants.js');
        const validMarketplaces = REGION_VALID_MARKETPLACES[region] || [];
        if (!validMarketplaces.includes(country)) {
            logger.warn('Invalid country for region in MCP Economics fetch', { region, country, validMarketplaces });
            return {
                success: false,
                error: `Invalid country ${country} for region ${region}. Valid countries: ${validMarketplaces.join(', ')}`,
                data: null
            };
        }

        // Calculate date range (last 30 days ending yesterday)
        // Amazon data has a 24-hour delay, so we fetch up to yesterday
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - 1); // Yesterday
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 30); // 30 days before yesterday

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];

        logger.info('Building economics queries (RANGE for totals, DAY for datewise)', { 
            startDate: startDateStr, 
            endDate: endDateStr, 
            country 
        });

        // ============================================================
        // QUERY 1: RANGE + PARENT_ASIN - For totals and ASIN breakdown
        // ============================================================
        const rangeQuery = buildEconomicsQuery({
            startDate: startDateStr,
            endDate: endDateStr,
            dateGranularity: 'RANGE',
            productIdGranularity: 'PARENT_ASIN',
            marketplace: country,
            includeFeeComponents: false
        });

        logger.info('Creating RANGE query for totals and ASIN breakdown', { region });

        const rangeQueryResult = await createQueryWithRefreshToken(refreshToken, region, rangeQuery);
        
        if (!rangeQueryResult || !rangeQueryResult.queryId) {
            const errorMsg = 'Failed to create Data Kiosk RANGE query';
            logger.error('Failed to create RANGE query', { rangeQueryResult });
            
            // Log to MongoDB for tracking
            await LoggingHelper.logStandaloneError({
                userId,
                region,
                country,
                functionName: 'fetchAndStoreEconomicsData',
                error: errorMsg,
                source: 'MCP_ECONOMICS',
                additionalData: { 
                    step: 'create_range_query',
                    queryResult: rangeQueryResult 
                }
            });
            
            return {
                success: false,
                error: errorMsg,
                data: null
            };
        }

        const rangeQueryId = rangeQueryResult.queryId;
        logger.info('RANGE query created successfully', { queryId: rangeQueryId });

        // Wait for RANGE query to complete
        const rangeDocumentDetails = await waitForQueryCompletionWithRefreshToken(
            refreshToken, 
            region, 
            rangeQueryId, 
            10000
        );

        // Check if RANGE query completed but has no document
        if (rangeDocumentDetails.hasDocument === false) {
            logger.warn('RANGE query completed but no data available', { queryId: rangeQueryId });
            
            const emptyMetrics = createEmptyMetrics(startDateStr, endDateStr, country);
            const savedMetrics = await saveEconomicsMetrics(
                userId, region, country, emptyMetrics, rangeQueryId, null
            );

            return {
                success: true,
                data: savedMetrics,
                message: 'Query completed but no data was available for the date range'
            };
        }

        // Download RANGE document content
        const rangeDocumentUrl = rangeDocumentDetails.documentUrl || rangeDocumentDetails.url;
        if (!rangeDocumentUrl) {
            const errorMsg = 'Failed to get document URL from completed RANGE query';
            logger.error('No document URL in RANGE query result', { rangeDocumentDetails });
            
            // Log to MongoDB for tracking
            await LoggingHelper.logStandaloneError({
                userId,
                region,
                country,
                functionName: 'fetchAndStoreEconomicsData',
                error: errorMsg,
                source: 'MCP_ECONOMICS',
                additionalData: { 
                    step: 'get_document_url',
                    rangeQueryId 
                }
            });
            
            return {
                success: false,
                error: errorMsg,
                data: null
            };
        }

        logger.info('Downloading RANGE document', { hasUrl: !!rangeDocumentUrl });
        const rangeDocumentContent = await downloadDocument(rangeDocumentUrl);
        
        if (!rangeDocumentContent || rangeDocumentContent.trim() === '') {
            logger.warn('Downloaded RANGE document is empty', { queryId: rangeQueryId });
            
            const emptyMetrics = createEmptyMetrics(startDateStr, endDateStr, country);
            const savedMetrics = await saveEconomicsMetrics(
                userId, region, country, emptyMetrics, rangeQueryId, rangeDocumentDetails.documentId
            );

            return {
                success: true,
                data: savedMetrics,
                message: 'Document downloaded but was empty'
            };
        }

        // Calculate metrics from RANGE document (totals and ASIN breakdown)
        logger.info('Calculating metrics from RANGE document', { 
            contentLength: rangeDocumentContent.length 
        });

        const calculatedMetrics = await calculateEconomicsMetrics(
            rangeDocumentContent,
            startDateStr,
            endDateStr,
            country
        );

        logger.info('RANGE metrics calculated', { 
            totalSales: calculatedMetrics.totalSales?.amount,
            grossProfit: calculatedMetrics.grossProfit?.amount,
            fbaFees: calculatedMetrics.fbaFees?.amount,
            storageFees: calculatedMetrics.storageFees?.amount,
            refunds: calculatedMetrics.refunds?.amount,
            asinCount: calculatedMetrics.asinWiseSales?.length
        });

        // ============================================================
        // QUERY 2: DAY + PARENT_ASIN - For accurate date-wise breakdown
        // ============================================================
        logger.info('Creating DAY query for date-wise breakdown', { region });

        const dayQuery = buildEconomicsQuery({
            startDate: startDateStr,
            endDate: endDateStr,
            dateGranularity: 'DAY',
            productIdGranularity: 'PARENT_ASIN',
            marketplace: country,
            includeFeeComponents: false
        });

        let datewiseMetrics = null;
        
        try {
            const dayQueryResult = await createQueryWithRefreshToken(refreshToken, region, dayQuery);
            
            if (dayQueryResult && dayQueryResult.queryId) {
                const dayQueryId = dayQueryResult.queryId;
                logger.info('DAY query created successfully', { queryId: dayQueryId });

                // Wait for DAY query to complete
                const dayDocumentDetails = await waitForQueryCompletionWithRefreshToken(
                    refreshToken, 
                    region, 
                    dayQueryId, 
                    10000
                );

                if (dayDocumentDetails.hasDocument !== false) {
                    const dayDocumentUrl = dayDocumentDetails.documentUrl || dayDocumentDetails.url;
                    
                    if (dayDocumentUrl) {
                        logger.info('Downloading DAY document', { hasUrl: !!dayDocumentUrl });
                        const dayDocumentContent = await downloadDocument(dayDocumentUrl);
                        
                        if (dayDocumentContent && dayDocumentContent.trim() !== '') {
                            // Calculate date-wise metrics from DAY document
                            datewiseMetrics = await calculateDatewiseMetrics(
                                dayDocumentContent,
                                startDateStr,
                                endDateStr,
                                country
                            );
                            
                            logger.info('DAY metrics calculated', { 
                                datewiseSalesCount: datewiseMetrics.datewiseSales?.length,
                                datewiseGrossProfitCount: datewiseMetrics.datewiseGrossProfit?.length,
                                datewiseFeesAndRefundsCount: datewiseMetrics.datewiseFeesAndRefunds?.length,
                                datewiseAmazonFeesCount: datewiseMetrics.datewiseAmazonFees?.length
                            });
                        }
                    }
                }
            }
        } catch (dayQueryError) {
            // DAY query failed, but we still have RANGE data - log and continue
            logger.warn('DAY query failed, using RANGE datewise data as fallback', {
                error: dayQueryError.message
            });
        }

        // ============================================================
        // QUERY 3: DAY + CHILD_ASIN - For accurate ASIN-wise daily data
        // ============================================================
        // This query gets daily breakdown per ASIN with all metrics:
        // sales, grossProfit, unitsSold, refunds, ppcSpent, fbaFees, storageFees, totalFees, amazonFees
        logger.info('Creating DAY + CHILD_ASIN query for ASIN-wise daily breakdown', { region });

        let asinWiseDailyMetrics = null;
        
        try {
            const asinDailyQuery = buildEconomicsQuery({
                startDate: startDateStr,
                endDate: endDateStr,
                dateGranularity: 'DAY',
                productIdGranularity: 'CHILD_ASIN',
                marketplace: country,
                includeFeeComponents: false
            });

            const asinDailyQueryResult = await createQueryWithRefreshToken(refreshToken, region, asinDailyQuery);
            
            if (asinDailyQueryResult && asinDailyQueryResult.queryId) {
                const asinDailyQueryId = asinDailyQueryResult.queryId;
                logger.info('ASIN Daily query created successfully', { queryId: asinDailyQueryId });

                // Wait for ASIN Daily query to complete
                const asinDailyDocumentDetails = await waitForQueryCompletionWithRefreshToken(
                    refreshToken, 
                    region, 
                    asinDailyQueryId, 
                    10000
                );

                if (asinDailyDocumentDetails.hasDocument !== false) {
                    const asinDailyDocumentUrl = asinDailyDocumentDetails.documentUrl || asinDailyDocumentDetails.url;
                    
                    if (asinDailyDocumentUrl) {
                        logger.info('Downloading ASIN Daily document', { hasUrl: !!asinDailyDocumentUrl });
                        const asinDailyDocumentContent = await downloadDocument(asinDailyDocumentUrl);
                        
                        if (asinDailyDocumentContent && asinDailyDocumentContent.trim() !== '') {
                            // Calculate ASIN-wise daily metrics using the new function
                            asinWiseDailyMetrics = await calculateAsinWiseDailyMetrics(
                                asinDailyDocumentContent,
                                startDateStr,
                                endDateStr,
                                country
                            );
                            
                            logger.info('ASIN-wise daily metrics calculated', { 
                                asinWiseSalesCount: asinWiseDailyMetrics.asinWiseSales?.length,
                                uniqueAsins: new Set(asinWiseDailyMetrics.asinWiseSales?.map(r => r.asin) || []).size,
                                uniqueDates: new Set(asinWiseDailyMetrics.asinWiseSales?.map(r => r.date) || []).size
                            });
                        }
                    }
                }
            }
        } catch (asinDailyQueryError) {
            // ASIN Daily query failed, fall back to RANGE data for ASIN breakdown
            logger.warn('ASIN Daily query failed, using RANGE ASIN data as fallback', {
                error: asinDailyQueryError.message
            });
        }

        // ============================================================
        // QUERY 4: Sales and Traffic API - For accurate TOTAL SALES
        // ============================================================
        // The Economics API only includes ASIN-linked orders
        // Sales API includes ALL orders, giving accurate total sales
        let salesApiData = null;
        
        try {
            logger.info('Fetching Sales and Traffic data for accurate total sales', { region, country });
            
            const salesResult = await fetchSalesAndTrafficByDate(
                refreshToken,
                region,
                country,
                startDateStr,
                endDateStr
            );
            
            if (salesResult.success && salesResult.data) {
                salesApiData = salesResult.data;
                logger.info('Sales and Traffic data fetched successfully', {
                    totalSales: salesApiData.totalSales?.amount,
                    datewiseSalesCount: salesApiData.datewiseSales?.length
                });
            }
        } catch (salesError) {
            logger.warn('Sales and Traffic API fetch failed, using Economics data for sales', {
                error: salesError.message
            });
        }

        // ============================================================
        // Merge results - SINGLE SOURCE for sales data to ensure consistency
        // ============================================================
        // IMPORTANT: Use SAME source for both totalSales and datewiseSales
        // This prevents discrepancies between total and sum of datewise values
        // 
        // Priority: Sales API (more complete) -> Economics API (fallback)
        // NO MIXING: If Sales API is used for totalSales, it's also used for datewiseSales
        
        let salesSource = 'Economics API';
        let finalTotalSales;
        let finalDatewiseSales;
        
        if (salesApiData?.totalSales && salesApiData?.datewiseSales?.length > 0) {
            // Use Sales API for both totalSales and datewiseSales (with grossProfit from Economics)
            salesSource = 'Sales API';
            finalTotalSales = salesApiData.totalSales;
            finalDatewiseSales = salesApiData.datewiseSales.map(item => ({
                date: item.date,
                sales: item.sales,
                grossProfit: datewiseMetrics?.datewiseSales?.find(d => d.date === item.date)?.grossProfit || 
                            calculatedMetrics.datewiseSales?.find(d => d.date === item.date)?.grossProfit ||
                            { amount: 0, currencyCode: item.sales.currencyCode }
            }));
        } else {
            // Use Economics API for both totalSales and datewiseSales
            // Priority: DAY granularity -> RANGE granularity
            salesSource = datewiseMetrics ? 'Economics API (DAY)' : 'Economics API (RANGE)';
            finalDatewiseSales = datewiseMetrics?.datewiseSales || calculatedMetrics.datewiseSales;
            
            // CRITICAL: Calculate totalSales by summing datewiseSales to ensure consistency
            const summedTotal = finalDatewiseSales.reduce((sum, item) => sum + (item.sales?.amount || 0), 0);
            finalTotalSales = {
                amount: parseFloat(summedTotal.toFixed(2)),
                currencyCode: finalDatewiseSales[0]?.sales?.currencyCode || calculatedMetrics.totalSales?.currencyCode || 'USD'
            };
        }
        
        const finalMetrics = {
            ...calculatedMetrics,
            totalSales: finalTotalSales,
            datewiseSales: finalDatewiseSales,
            datewiseGrossProfit: datewiseMetrics?.datewiseGrossProfit || calculatedMetrics.datewiseGrossProfit,
            datewiseFeesAndRefunds: datewiseMetrics?.datewiseFeesAndRefunds || calculatedMetrics.datewiseFeesAndRefunds,
            // Datewise Amazon fees with breakdown - use DAY query data if available (more accurate)
            datewiseAmazonFees: datewiseMetrics?.datewiseAmazonFees || calculatedMetrics.datewiseAmazonFees,
            // Use ASIN Daily query data if available (with dates), else fallback to RANGE data (without dates)
            asinWiseSales: asinWiseDailyMetrics?.asinWiseSales || calculatedMetrics.asinWiseSales
        };

        logger.info('Final merged metrics (single source for sales consistency)', { 
            totalSales: finalMetrics.totalSales?.amount,
            salesSource: salesSource,
            grossProfit: finalMetrics.grossProfit?.amount,
            fbaFees: finalMetrics.fbaFees?.amount,
            storageFees: finalMetrics.storageFees?.amount,
            amazonFees: finalMetrics.amazonFees?.amount,
            refunds: finalMetrics.refunds?.amount,
            datewiseSalesCount: finalMetrics.datewiseSales?.length,
            datewiseAmazonFeesCount: finalMetrics.datewiseAmazonFees?.length,
            asinCount: finalMetrics.asinWiseSales?.length,
            asinWiseSalesSource: asinWiseDailyMetrics ? 'DAY + CHILD_ASIN (with dates)' : 'RANGE + PARENT_ASIN (without dates)',
            asinWiseHasDates: asinWiseDailyMetrics ? true : false
        });

        // Save metrics to database
        const savedMetrics = await saveEconomicsMetrics(
            userId,
            region,
            country,
            finalMetrics,
            rangeQueryId,
            rangeDocumentDetails.documentId
        );

        logger.info('Economics metrics saved successfully', { 
            metricsId: savedMetrics._id,
            userId,
            region,
            country
        });

        return {
            success: true,
            data: savedMetrics,
            message: 'Economics data fetched and stored successfully'
        };

    } catch (error) {
        logger.error('Error in MCP economics data fetch', {
            userId,
            region,
            country,
            error: error.message,
            stack: error.stack
        });
        
        // Log to MongoDB for tracking
        await LoggingHelper.logStandaloneError({
            userId,
            region,
            country,
            functionName: 'fetchAndStoreEconomicsData',
            error,
            source: 'MCP_ECONOMICS',
            additionalData: { 
                step: 'unexpected_error',
                tokenRefreshNeeded: error.message?.includes('refresh_token') || error.message?.includes('invalid grant')
            }
        });

        // Try to get cached data as fallback
        try {
            logger.info('Attempting to fetch cached EconomicsMetrics data as fallback', { userId, region, country });
            const cachedData = await getLatestEconomicsMetrics(userId, region, country);
            if (cachedData) {
                logger.info('Using cached EconomicsMetrics data', { userId, region, country });
                return {
                    success: true,
                    data: cachedData,
                    message: 'Using cached data due to fetch error',
                    error: null
                };
            }
        } catch (cacheError) {
            logger.warn('Failed to fetch cached EconomicsMetrics data', {
                error: cacheError.message,
                userId,
                region,
                country
            });
        }

        return {
            success: false,
            error: error.message || 'Unknown error in MCP economics fetch',
            data: null
        };
    }
}

/**
 * Create empty metrics structure when no data is available
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @param {string} marketplace - Marketplace code
 * @returns {Object} Empty metrics object
 */
function createEmptyMetrics(startDate, endDate, marketplace) {
    return {
        dateRange: {
            startDate,
            endDate
        },
        marketplace,
        totalSales: { amount: 0, currencyCode: 'USD' },
        grossProfit: { amount: 0, currencyCode: 'USD' },
        ppcSpent: { amount: 0, currencyCode: 'USD' },
        fbaFees: { amount: 0, currencyCode: 'USD' },
        storageFees: { amount: 0, currencyCode: 'USD' },
        refunds: { amount: 0, currencyCode: 'USD' },
        datewiseSales: [],
        datewiseGrossProfit: [],
        asinWiseSales: []
    };
}

/**
 * Get latest economics data for a user
 * Falls back to fetching new data if no cached data exists
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} country - Country/Marketplace code
 * @param {string} refreshToken - Optional refresh token for fetching new data
 * @returns {Promise<Object>} Economics metrics data
 */
async function getEconomicsData(userId, region, country, refreshToken = null) {
    try {
        // First try to get cached data from database
        const cachedMetrics = await getLatestEconomicsMetrics(userId, region, country);
        
        if (cachedMetrics) {
            // Check if data is less than 1 hour old
            const dataAge = Date.now() - new Date(cachedMetrics.updatedAt).getTime();
            const oneHour = 60 * 60 * 1000;
            
            if (dataAge < oneHour) {
                logger.info('Using cached economics data', { 
                    userId, 
                    region, 
                    country,
                    dataAge: Math.round(dataAge / 1000) + 's'
                });
                return {
                    success: true,
                    data: cachedMetrics,
                    source: 'cache'
                };
            }
        }

        // If no cached data or data is old, and we have refresh token, fetch new data
        if (refreshToken) {
            logger.info('Fetching fresh economics data', { userId, region, country });
            return await fetchAndStoreEconomicsData(userId, refreshToken, region, country);
        }

        // Return cached data even if old, or null if no data
        if (cachedMetrics) {
            logger.info('Using stale cached economics data (no refresh token available)', { 
                userId, 
                region, 
                country 
            });
            return {
                success: true,
                data: cachedMetrics,
                source: 'stale_cache'
            };
        }

        return {
            success: false,
            error: 'No economics data available and no refresh token to fetch new data',
            data: null
        };

    } catch (error) {
        logger.error('Error getting economics data', {
            userId,
            region,
            country,
            error: error.message
        });
        
        // Log to MongoDB for tracking
        await LoggingHelper.logStandaloneError({
            userId,
            region,
            country,
            functionName: 'getEconomicsData',
            error,
            source: 'MCP_ECONOMICS',
            additionalData: { step: 'get_economics_data' }
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

module.exports = {
    fetchAndStoreEconomicsData,
    getEconomicsData,
    createEmptyMetrics
};


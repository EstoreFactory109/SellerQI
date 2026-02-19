/**
 * IssuesDataService
 * 
 * Service for managing pre-computed issues data for the Issues pages.
 * This service provides fast access to issues data by:
 * 1. Reading from MongoDB (pre-computed during integration/Sunday schedules)
 * 2. Falling back to full calculation only when data is missing
 * 
 * The precomputed data is stored in IssuesData model and used by:
 * - Issues by Category page (Category.jsx)
 * - Issues by Product page (IssuesByProduct.jsx)
 * 
 * Data freshness:
 * - Data is ALWAYS refreshed on Sundays via ScheduleConfig
 * - Whatever data exists in MongoDB is considered fresh
 * - First-time integration also stores issues data immediately
 */

const logger = require('../../utils/Logger.js');
const IssuesData = require('../../models/system/IssuesDataModel.js');
const { AnalyseService } = require('../main/Analyse.js');
const { analyseData } = require('./DashboardCalculation.js');

/**
 * Get issues data for a user - optimized with MongoDB storage
 * 
 * Strategy:
 * 1. Try to get data from MongoDB (if exists)
 * 2. If data exists, return immediately (always considered fresh - updated every Sunday)
 * 3. If data is missing, calculate and store, then return
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {boolean} forceRefresh - Force recalculation even if data exists
 * @returns {Promise<Object>} Issues data object
 */
async function getIssuesData(userId, country, region, forceRefresh = false) {
    const startTime = Date.now();
    
    try {
        // Step 1: Check for data in MongoDB (unless force refresh)
        if (!forceRefresh) {
            const cachedData = await IssuesData.getIssuesData(userId, country, region);
            
            // Return cached data if it exists (always fresh - updated every Sunday)
            if (cachedData) {
                const duration = Date.now() - startTime;
                logger.info('[IssuesDataService] Returning data from MongoDB', {
                    userId,
                    country,
                    region,
                    duration,
                    source: 'mongodb_cache',
                    lastCalculatedAt: cachedData.lastCalculatedAt
                });
                
                return {
                    success: true,
                    data: formatIssuesDataForResponse(cachedData),
                    source: 'mongodb_cache',
                    duration
                };
            }
        }
        
        // Step 2: Data is missing - calculate fresh data
        logger.info('[IssuesDataService] Calculating fresh issues data', {
            userId,
            country,
            region,
            reason: forceRefresh ? 'force_refresh' : 'missing'
        });
        
        const result = await calculateAndStoreIssuesData(userId, country, region, 'request');
        
        if (!result.success) {
            return result;
        }
        
        const duration = Date.now() - startTime;
        
        return {
            success: true,
            data: formatIssuesDataForResponse(result.data),
            source: 'calculated',
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesDataService] Error getting issues data', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Calculate and store issues data in MongoDB
 * Called during integration, schedules, or on-demand
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} source - Source of calculation
 * @returns {Promise<Object>} Result object
 */
async function calculateAndStoreIssuesData(userId, country, region, source = 'integration') {
    const startTime = Date.now();
    
    logger.info('[IssuesDataService] Starting issues data calculation', {
        userId,
        country,
        region,
        source
    });
    
    try {
        // Step 1: Get raw analyse data
        const analyseResult = await AnalyseService.Analyse(userId, country, region);
        
        if (!analyseResult || analyseResult.status !== 200) {
            logger.error('[IssuesDataService] Failed to get analyse data', {
                userId,
                country,
                region,
                status: analyseResult?.status
            });
            return {
                success: false,
                error: `Failed to get analyse data: status ${analyseResult?.status}`
            };
        }
        
        // Step 2: Calculate dashboard data
        const calculationResult = await analyseData(analyseResult.message, userId);
        
        if (!calculationResult?.dashboardData) {
            logger.error('[IssuesDataService] Failed to calculate dashboard data', {
                userId,
                country,
                region
            });
            return {
                success: false,
                error: 'Failed to calculate dashboard data'
            };
        }
        
        const dashboardData = calculationResult.dashboardData;
        
        // Step 3: Store in MongoDB
        const savedData = await IssuesData.upsertIssuesData(
            userId,
            country,
            region,
            dashboardData,
            source
        );
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesDataService] Issues data calculation completed', {
            userId,
            country,
            region,
            source,
            duration,
            productCount: dashboardData.productWiseError?.length || 0,
            totalIssues: (dashboardData.TotalRankingerrors || 0) + 
                        (dashboardData.totalErrorInConversion || 0) + 
                        (dashboardData.totalInventoryErrors || 0)
        });
        
        return {
            success: true,
            data: savedData,
            duration
        };
        
    } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.error('[IssuesDataService] Error calculating issues data', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region,
            source,
            duration
        });
        
        return {
            success: false,
            error: error.message,
            duration
        };
    }
}

/**
 * Store issues data from pre-calculated dashboard data
 * More efficient when dashboard data is already available
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} dashboardData - Pre-calculated dashboard data
 * @param {string} source - Source of calculation
 */
async function storeIssuesDataFromDashboard(userId, country, region, dashboardData, source = 'integration') {
    try {
        if (!dashboardData) {
            logger.warn('[IssuesDataService] No dashboard data provided', {
                userId,
                country,
                region
            });
            return { success: false, error: 'No dashboard data provided' };
        }
        
        const savedData = await IssuesData.upsertIssuesData(
            userId,
            country,
            region,
            dashboardData,
            source
        );
        
        logger.info('[IssuesDataService] Stored issues data from dashboard', {
            userId,
            country,
            region,
            source,
            productCount: dashboardData.productWiseError?.length || 0
        });
        
        return {
            success: true,
            data: savedData
        };
        
    } catch (error) {
        logger.error('[IssuesDataService] Error storing issues data from dashboard', {
            error: error.message,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Format MongoDB document for API response
 * Matches the structure expected by the frontend
 */
function formatIssuesDataForResponse(data) {
    return {
        // Product-wise error data for Category.jsx
        productWiseError: data.productWiseError || [],
        rankingProductWiseErrors: data.rankingProductWiseErrors || [],
        conversionProductWiseErrors: data.conversionProductWiseErrors || [],
        inventoryProductWiseErrors: data.inventoryProductWiseErrors || [],
        
        // Error counts
        totalErrorInAccount: data.totalAccountErrors || 0,
        totalErrorInConversion: data.totalConversionErrors || 0,
        TotalRankingerrors: data.totalRankingErrors || 0,
        totalInventoryErrors: data.totalInventoryErrors || 0,
        totalProfitabilityErrors: data.totalProfitabilityErrors || 0,
        totalSponsoredAdsErrors: data.totalSponsoredAdsErrors || 0,
        
        // Error details
        profitabilityErrorDetails: data.profitabilityErrorDetails || [],
        sponsoredAdsErrorDetails: data.sponsoredAdsErrorDetails || [],
        
        // Account errors for Account.jsx
        AccountErrors: data.AccountErrors || {},
        accountHealthPercentage: data.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
        
        // Buy Box data for Category.jsx
        buyBoxData: data.buyBoxData || { asinBuyBoxData: [] },
        
        // Top error products
        first: data.topErrorProducts?.first || null,
        second: data.topErrorProducts?.second || null,
        third: data.topErrorProducts?.third || null,
        fourth: data.topErrorProducts?.fourth || null,
        
        // Product data for lookups
        TotalProduct: data.TotalProduct || [],
        ActiveProducts: data.ActiveProducts || [],
        Country: data.country
    };
}

module.exports = {
    getIssuesData,
    calculateAndStoreIssuesData,
    storeIssuesDataFromDashboard
};

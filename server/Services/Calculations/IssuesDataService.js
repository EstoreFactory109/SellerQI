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
 * 
 * OPTIMIZED: Large arrays are now stored in IssuesDataChunks collection
 * to avoid the 16MB MongoDB document limit. The main IssuesData document
 * stores only counts and metadata.
 */

const logger = require('../../utils/Logger.js');
const IssuesData = require('../../models/system/IssuesDataModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const { AnalyseService } = require('../main/Analyse.js');
const { analyseData } = require('./DashboardCalculation.js');

// Fields that should be stored as chunks (large arrays)
const CHUNKED_FIELDS = [
    'productWiseError',
    'rankingProductWiseErrors',
    'conversionProductWiseErrors',
    'inventoryProductWiseErrors',
    'profitabilityErrorDetails',
    'sponsoredAdsErrorDetails',
    'TotalProduct',
    'ActiveProducts'
];

/**
 * Get issues data for a user - optimized with MongoDB storage
 * 
 * Strategy:
 * 1. Try to get data from MongoDB (if exists)
 * 2. If data exists, return immediately (always considered fresh - updated every Sunday)
 * 3. If data is missing, calculate and store, then return
 * 
 * OPTIMIZED: Large arrays are now stored in IssuesDataChunks and reconstructed on read.
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
                // Check if this is chunked storage (dataVersion >= 2)
                let responseData;
                if (cachedData.dataVersion >= 2) {
                    // Reconstruct data from chunks
                    responseData = await reconstructIssuesDataFromChunks(cachedData, userId, country, region);
                } else {
                    // Legacy: data is stored inline
                    responseData = formatIssuesDataForResponse(cachedData);
                }
                
                const duration = Date.now() - startTime;
                logger.info('[IssuesDataService] Returning data from MongoDB', {
                    userId,
                    country,
                    region,
                    duration,
                    source: 'mongodb_cache',
                    lastCalculatedAt: cachedData.lastCalculatedAt,
                    isChunked: cachedData.dataVersion >= 2
                });
                
                return {
                    success: true,
                    data: responseData,
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
        
        // Result.data is already formatted from calculateAndStoreIssuesData
        return {
            success: true,
            data: result.data,
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
 * Reconstruct full issues data by loading chunks
 * @param {Object} cachedData - The IssuesData document (metadata only in v2)
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Full issues data with arrays reconstructed
 */
async function reconstructIssuesDataFromChunks(cachedData, userId, country, region) {
    // Get all chunked field data in one query
    const chunkedFieldsData = await IssuesDataChunks.getAllFieldsData(userId, country, region);
    
    // Merge metadata with chunked data
    return {
        // Product-wise error data from chunks
        productWiseError: chunkedFieldsData.productWiseError || [],
        rankingProductWiseErrors: chunkedFieldsData.rankingProductWiseErrors || [],
        conversionProductWiseErrors: chunkedFieldsData.conversionProductWiseErrors || [],
        inventoryProductWiseErrors: chunkedFieldsData.inventoryProductWiseErrors || [],
        
        // Error counts from metadata
        totalErrorInAccount: cachedData.totalAccountErrors || 0,
        totalErrorInConversion: cachedData.totalConversionErrors || 0,
        TotalRankingerrors: cachedData.totalRankingErrors || 0,
        totalInventoryErrors: cachedData.totalInventoryErrors || 0,
        totalProfitabilityErrors: cachedData.totalProfitabilityErrors || 0,
        totalSponsoredAdsErrors: cachedData.totalSponsoredAdsErrors || 0,
        
        // Error details from chunks
        profitabilityErrorDetails: chunkedFieldsData.profitabilityErrorDetails || [],
        sponsoredAdsErrorDetails: chunkedFieldsData.sponsoredAdsErrorDetails || [],
        
        // Account errors from metadata (small object, not chunked)
        AccountErrors: cachedData.AccountErrors || {},
        accountHealthPercentage: cachedData.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
        
        // Buy Box data from metadata (small object)
        buyBoxData: cachedData.buyBoxData || { asinBuyBoxData: [] },
        
        // Top error products from metadata
        first: cachedData.topErrorProducts?.first || null,
        second: cachedData.topErrorProducts?.second || null,
        third: cachedData.topErrorProducts?.third || null,
        fourth: cachedData.topErrorProducts?.fourth || null,
        
        // Product data from chunks
        TotalProduct: chunkedFieldsData.TotalProduct || [],
        ActiveProducts: chunkedFieldsData.ActiveProducts || [],
        Country: cachedData.country
    };
}

/**
 * Calculate and store issues data in MongoDB
 * Called during integration, schedules, or on-demand
 * 
 * OPTIMIZED: Large arrays are stored as chunks in IssuesDataChunks collection.
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
        
        // Step 3: Store using chunked approach
        const storeResult = await storeIssuesDataWithChunks(userId, country, region, dashboardData, source);
        
        if (!storeResult.success) {
            return storeResult;
        }
        
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
                        (dashboardData.totalInventoryErrors || 0),
            chunksCreated: storeResult.chunksCreated
        });
        
        return {
            success: true,
            data: storeResult.formattedData,
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
 * Store issues data with chunked arrays
 * This is the core function that handles the chunked storage strategy.
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @param {Object} dashboardData - Dashboard data to store
 * @param {string} source - Source of calculation
 * @returns {Promise<Object>} Result with savedData and chunk info
 */
async function storeIssuesDataWithChunks(userId, country, region, dashboardData, source) {
    try {
        // Step 1: Prepare metadata-only document (no large arrays)
        const metadataOnly = {
            totalRankingErrors: dashboardData.TotalRankingerrors || dashboardData.totalRankingErrors || 0,
            totalConversionErrors: dashboardData.totalErrorInConversion || dashboardData.totalConversionErrors || 0,
            totalInventoryErrors: dashboardData.totalInventoryErrors || 0,
            totalAccountErrors: dashboardData.totalErrorInAccount || dashboardData.totalAccountErrors || 0,
            totalProfitabilityErrors: dashboardData.totalProfitabilityErrors || 0,
            totalSponsoredAdsErrors: dashboardData.totalSponsoredAdsErrors || 0,
            
            // Small objects kept inline
            AccountErrors: dashboardData.AccountErrors || {},
            accountHealthPercentage: dashboardData.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
            buyBoxData: dashboardData.buyBoxData || { asinBuyBoxData: [] },
            topErrorProducts: {
                first: dashboardData.first || null,
                second: dashboardData.second || null,
                third: dashboardData.third || null,
                fourth: dashboardData.fourth || null
            },
            
            // Large arrays will be empty - stored in chunks
            productWiseError: [],
            rankingProductWiseErrors: [],
            conversionProductWiseErrors: [],
            inventoryProductWiseErrors: [],
            profitabilityErrorDetails: [],
            sponsoredAdsErrorDetails: [],
            TotalProduct: [],
            ActiveProducts: [],
            
            lastCalculatedAt: new Date(),
            calculationSource: source,
            dataVersion: 2  // Mark as chunked storage
        };
        
        // Step 2: Upsert metadata document
        const savedData = await IssuesData.findOneAndUpdate(
            { userId, country, region },
            { $set: metadataOnly },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        
        const issuesDataId = savedData._id;
        
        // Step 3: Store large arrays as chunks
        let totalChunksCreated = 0;
        
        for (const fieldName of CHUNKED_FIELDS) {
            const data = dashboardData[fieldName];
            if (data && Array.isArray(data)) {
                const result = await IssuesDataChunks.saveAsChunks({
                    issuesDataId,
                    userId,
                    country,
                    region,
                    fieldName,
                    data
                });
                totalChunksCreated += Array.isArray(result) ? result.length : 1;
            }
        }
        
        // Step 4: Return formatted data for immediate use
        const formattedData = {
            productWiseError: dashboardData.productWiseError || [],
            rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
            conversionProductWiseErrors: dashboardData.conversionProductWiseErrors || [],
            inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || [],
            
            totalErrorInAccount: metadataOnly.totalAccountErrors,
            totalErrorInConversion: metadataOnly.totalConversionErrors,
            TotalRankingerrors: metadataOnly.totalRankingErrors,
            totalInventoryErrors: metadataOnly.totalInventoryErrors,
            totalProfitabilityErrors: metadataOnly.totalProfitabilityErrors,
            totalSponsoredAdsErrors: metadataOnly.totalSponsoredAdsErrors,
            
            profitabilityErrorDetails: dashboardData.profitabilityErrorDetails || [],
            sponsoredAdsErrorDetails: dashboardData.sponsoredAdsErrorDetails || [],
            
            AccountErrors: metadataOnly.AccountErrors,
            accountHealthPercentage: metadataOnly.accountHealthPercentage,
            buyBoxData: metadataOnly.buyBoxData,
            
            first: metadataOnly.topErrorProducts.first,
            second: metadataOnly.topErrorProducts.second,
            third: metadataOnly.topErrorProducts.third,
            fourth: metadataOnly.topErrorProducts.fourth,
            
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            Country: country
        };
        
        return {
            success: true,
            savedData,
            formattedData,
            chunksCreated: totalChunksCreated
        };
        
    } catch (error) {
        logger.error('[IssuesDataService] Error storing issues data with chunks', {
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
 * Store issues data from pre-calculated dashboard data
 * More efficient when dashboard data is already available
 * 
 * OPTIMIZED: Uses chunked storage to avoid 16MB limit.
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
        
        // Use chunked storage
        const result = await storeIssuesDataWithChunks(userId, country, region, dashboardData, source);
        
        if (!result.success) {
            return result;
        }
        
        logger.info('[IssuesDataService] Stored issues data from dashboard', {
            userId,
            country,
            region,
            source,
            productCount: dashboardData.productWiseError?.length || 0,
            chunksCreated: result.chunksCreated
        });
        
        return {
            success: true,
            data: result.savedData
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

/**
 * Get paginated data for a specific field
 * Useful for large arrays to avoid loading everything at once
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @param {string} fieldName - Field name to get
 * @param {number} skip - Items to skip
 * @param {number} limit - Items to return
 * @returns {Promise<Object>} { data: Array, total: Number }
 */
async function getPaginatedFieldData(userId, country, region, fieldName, skip = 0, limit = 50) {
    try {
        return await IssuesDataChunks.getPaginatedFieldData(userId, country, region, fieldName, skip, limit);
    } catch (error) {
        logger.error('[IssuesDataService] Error getting paginated field data', {
            error: error.message,
            userId,
            country,
            region,
            fieldName
        });
        return { data: [], total: 0 };
    }
}

module.exports = {
    getIssuesData,
    calculateAndStoreIssuesData,
    storeIssuesDataFromDashboard,
    getPaginatedFieldData,
    reconstructIssuesDataFromChunks,
    CHUNKED_FIELDS
};

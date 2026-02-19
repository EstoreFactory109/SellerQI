/**
 * IssuesPaginationService
 * 
 * Service for paginated access to issues data for the Issues pages.
 * This service provides server-side pagination, sorting, and filtering
 * to reduce data transfer and improve initial page load times.
 * 
 * Used by:
 * - Issues by Category page (separate endpoints per category)
 * - Issues by Product page (paginated product list)
 * 
 * Fallback behavior:
 * - If pre-computed data doesn't exist in IssuesDataModel, it falls back
 *   to IssuesDataService which will calculate and store data on-the-fly
 */

const logger = require('../../utils/Logger.js');
const IssuesData = require('../../models/system/IssuesDataModel.js');
const IssueSummary = require('../../models/system/IssueSummaryModel.js');
const IssuesDataService = require('./IssuesDataService.js');

// Default pagination settings
const DEFAULT_PAGE_SIZE = 10;
const PRODUCTS_PAGE_SIZE = 6;

/**
 * Helper function to ensure issues data exists
 * Falls back to IssuesDataService if data is missing
 * 
 * @param {string} userId 
 * @param {string} country 
 * @param {string} region 
 * @param {Object} projection - MongoDB projection for fields to retrieve
 * @returns {Promise<Object|null>} Issues data or null
 */
async function ensureIssuesData(userId, country, region, projection = {}) {
    // First try to get from MongoDB
    let issuesData = await IssuesData.findOne({ userId, country, region }, projection).lean();
    
    if (issuesData) {
        return issuesData;
    }
    
    // Data missing - calculate and store using IssuesDataService
    logger.info('[IssuesPaginationService] No pre-computed data found, calculating on-the-fly', {
        userId, country, region
    });
    
    const calcResult = await IssuesDataService.calculateAndStoreIssuesData(userId, country, region, 'pagination_fallback');
    
    if (!calcResult.success) {
        logger.error('[IssuesPaginationService] Failed to calculate issues data', {
            userId, country, region,
            error: calcResult.error
        });
        return null;
    }
    
    // Re-fetch with projection after storing
    issuesData = await IssuesData.findOne({ userId, country, region }, projection).lean();
    return issuesData;
}

/**
 * Get issues summary (counts only) for the dashboard header
 * Uses pre-computed IssueSummary model for instant response
 * Falls back to IssuesDataService if data is missing
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Summary counts
 */
async function getIssuesSummary(userId, country, region) {
    const startTime = Date.now();
    
    try {
        // Get pre-computed summary counts
        let summary = await IssueSummary.getIssueSummary(userId, country, region);
        
        // Also get account health and total products from IssuesData
        let issuesData = await IssuesData.findOne(
            { userId, country, region },
            {
                accountHealthPercentage: 1,
                TotalProduct: 1,
                ActiveProducts: 1,
                totalRankingErrors: 1,
                totalConversionErrors: 1,
                totalInventoryErrors: 1,
                totalAccountErrors: 1,
                totalProfitabilityErrors: 1,
                totalSponsoredAdsErrors: 1
            }
        ).lean();
        
        // If no data exists, fall back to calculating it
        if (!summary && !issuesData) {
            logger.info('[IssuesPaginationService] No summary data, calculating on-the-fly', {
                userId, country, region
            });
            
            const calcResult = await IssuesDataService.calculateAndStoreIssuesData(userId, country, region, 'summary_fallback');
            
            if (!calcResult.success) {
                const duration = Date.now() - startTime;
                return {
                    success: false,
                    error: 'No issues data found and calculation failed',
                    duration
                };
            }
            
            // Re-fetch after storing
            summary = await IssueSummary.getIssueSummary(userId, country, region);
            issuesData = await IssuesData.findOne(
                { userId, country, region },
                {
                    accountHealthPercentage: 1,
                    TotalProduct: 1,
                    ActiveProducts: 1,
                    totalRankingErrors: 1,
                    totalConversionErrors: 1,
                    totalInventoryErrors: 1,
                    totalAccountErrors: 1,
                    totalProfitabilityErrors: 1,
                    totalSponsoredAdsErrors: 1
                }
            ).lean();
        }
        
        const duration = Date.now() - startTime;
        
        // Use IssueSummary if available, else fall back to IssuesData counts
        const result = {
            totalRankingErrors: summary?.totalRankingErrors || issuesData?.totalRankingErrors || 0,
            totalConversionErrors: summary?.totalConversionErrors || issuesData?.totalConversionErrors || 0,
            totalInventoryErrors: summary?.totalInventoryErrors || issuesData?.totalInventoryErrors || 0,
            totalAccountErrors: summary?.totalAccountErrors || issuesData?.totalAccountErrors || 0,
            totalProfitabilityErrors: summary?.totalProfitabilityErrors || issuesData?.totalProfitabilityErrors || 0,
            totalSponsoredAdsErrors: summary?.totalSponsoredAdsErrors || issuesData?.totalSponsoredAdsErrors || 0,
            totalIssues: summary?.totalIssues || (
                (issuesData?.totalRankingErrors || 0) + 
                (issuesData?.totalConversionErrors || 0) + 
                (issuesData?.totalInventoryErrors || 0)
            ),
            totalActiveProducts: summary?.totalActiveProducts || issuesData?.ActiveProducts?.length || 0,
            numberOfProductsWithIssues: summary?.numberOfProductsWithIssues || 0,
            accountHealthPercentage: issuesData?.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
            TotalProduct: issuesData?.TotalProduct?.length || 0,
            lastCalculatedAt: summary?.lastCalculatedAt || issuesData?.lastCalculatedAt
        };
        
        logger.info('[IssuesPaginationService] Summary retrieved', {
            userId,
            country,
            region,
            duration,
            source: summary ? 'IssueSummary' : 'IssuesData'
        });
        
        return {
            success: true,
            data: result,
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting summary', {
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
 * Get paginated ranking issues
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated ranking issues
 */
async function getRankingIssues(userId, country, region, page = 1, limit = DEFAULT_PAGE_SIZE) {
    const startTime = Date.now();
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            { rankingProductWiseErrors: 1, TotalProduct: 1 }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        const allErrors = issuesData.rankingProductWiseErrors || [];
        const totalProducts = issuesData.TotalProduct || [];
        
        // Create a lookup map for product details
        const productMap = new Map();
        totalProducts.forEach(product => {
            if (product.asin) {
                productMap.set(product.asin, product);
            }
        });
        
        // Enrich ranking errors with product details (name, sku)
        const enrichedErrors = allErrors.map(error => {
            const product = productMap.get(error.asin);
            return {
                ...error,
                Title: product?.Title || product?.name || error.Title || 'Unknown Product',
                sku: product?.sku || error.sku || '',
                MainImage: product?.MainImage || null
            };
        });
        
        // Apply pagination
        const total = enrichedErrors.length;
        const startIndex = (page - 1) * limit;
        const paginatedData = enrichedErrors.slice(startIndex, startIndex + limit);
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Ranking issues retrieved', {
            userId, country, region,
            page, limit, total,
            returned: paginatedData.length,
            duration
        });
        
        return {
            success: true,
            data: paginatedData,
            pagination: {
                page,
                limit,
                total,
                hasMore: startIndex + limit < total,
                totalPages: Math.ceil(total / limit)
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting ranking issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get paginated conversion issues (includes buy box data)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated conversion issues
 */
async function getConversionIssues(userId, country, region, page = 1, limit = DEFAULT_PAGE_SIZE) {
    const startTime = Date.now();
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            { conversionProductWiseErrors: 1, buyBoxData: 1, TotalProduct: 1 }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        const conversionErrors = issuesData.conversionProductWiseErrors || [];
        const buyBoxData = issuesData.buyBoxData?.asinBuyBoxData || [];
        const totalProducts = issuesData.TotalProduct || [];
        
        // Create a lookup map for product details
        const productMap = new Map();
        totalProducts.forEach(product => {
            if (product.asin) {
                productMap.set(product.asin, product);
            }
        });
        
        // Combine conversion errors with product details
        const enrichedErrors = conversionErrors.map(error => {
            const product = productMap.get(error.asin);
            return {
                ...error,
                Title: error.Title || product?.Title || product?.name || 'Unknown Product',
                sku: product?.sku || error.sku || '',
                MainImage: product?.MainImage || null
            };
        });
        
        // Apply pagination
        const total = enrichedErrors.length;
        const startIndex = (page - 1) * limit;
        const paginatedData = enrichedErrors.slice(startIndex, startIndex + limit);
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Conversion issues retrieved', {
            userId, country, region,
            page, limit, total,
            returned: paginatedData.length,
            duration
        });
        
        return {
            success: true,
            data: paginatedData,
            buyBoxData: buyBoxData, // Include buy box data for the conversion tab
            pagination: {
                page,
                limit,
                total,
                hasMore: startIndex + limit < total,
                totalPages: Math.ceil(total / limit)
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting conversion issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get paginated inventory issues
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated inventory issues
 */
async function getInventoryIssues(userId, country, region, page = 1, limit = DEFAULT_PAGE_SIZE) {
    const startTime = Date.now();
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            { inventoryProductWiseErrors: 1, TotalProduct: 1 }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        const allErrors = issuesData.inventoryProductWiseErrors || [];
        const totalProducts = issuesData.TotalProduct || [];
        
        // Create a lookup map for product details
        const productMap = new Map();
        totalProducts.forEach(product => {
            if (product.asin) {
                productMap.set(product.asin, product);
            }
        });
        
        // Enrich inventory errors with product details
        const enrichedErrors = allErrors.map(error => {
            const product = productMap.get(error.asin);
            return {
                ...error,
                Title: error.Title || product?.Title || product?.name || 'Unknown Product',
                sku: product?.sku || error.sku || '',
                MainImage: product?.MainImage || null
            };
        });
        
        // Apply pagination
        const total = enrichedErrors.length;
        const startIndex = (page - 1) * limit;
        const paginatedData = enrichedErrors.slice(startIndex, startIndex + limit);
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Inventory issues retrieved', {
            userId, country, region,
            page, limit, total,
            returned: paginatedData.length,
            duration
        });
        
        return {
            success: true,
            data: paginatedData,
            pagination: {
                page,
                limit,
                total,
                hasMore: startIndex + limit < total,
                totalPages: Math.ceil(total / limit)
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting inventory issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get account issues (typically small, no pagination needed)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Account issues
 */
async function getAccountIssues(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            { AccountErrors: 1, accountHealthPercentage: 1, totalAccountErrors: 1 }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Account issues retrieved', {
            userId, country, region,
            duration
        });
        
        return {
            success: true,
            data: {
                AccountErrors: issuesData.AccountErrors || {},
                accountHealthPercentage: issuesData.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
                totalAccountErrors: issuesData.totalAccountErrors || 0
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting account issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get paginated products with issues for Issues by Product page
 * Supports sorting, filtering by priority, and search
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated products with issues
 */
async function getProductsWithIssues(userId, country, region, options = {}) {
    const startTime = Date.now();
    
    const {
        page = 1,
        limit = PRODUCTS_PAGE_SIZE,
        sort = 'issues',
        sortOrder = 'desc',
        priority = null,
        search = null
    } = options;
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            {
                productWiseError: 1,
                rankingProductWiseErrors: 1,
                conversionProductWiseErrors: 1,
                inventoryProductWiseErrors: 1,
                buyBoxData: 1
            }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        let products = issuesData.productWiseError || [];
        
        // Create lookup maps for detailed errors
        const rankingErrorsMap = new Map();
        (issuesData.rankingProductWiseErrors || []).forEach(error => {
            rankingErrorsMap.set(error.asin, error);
        });
        
        const conversionErrorsMap = new Map();
        (issuesData.conversionProductWiseErrors || []).forEach(error => {
            conversionErrorsMap.set(error.asin, error);
        });
        
        const inventoryErrorsMap = new Map();
        (issuesData.inventoryProductWiseErrors || []).forEach(error => {
            inventoryErrorsMap.set(error.asin, error);
        });
        
        const buyBoxMap = new Map();
        (issuesData.buyBoxData?.asinBuyBoxData || []).forEach(item => {
            buyBoxMap.set(item.asin, item);
        });
        
        // Enrich products with detailed error information
        products = products.map(product => {
            const rankingDetails = rankingErrorsMap.get(product.asin);
            const conversionDetails = conversionErrorsMap.get(product.asin);
            const inventoryDetails = inventoryErrorsMap.get(product.asin);
            const buyBoxDetails = buyBoxMap.get(product.asin);
            
            // Count ranking errors
            let rankingErrorCount = 0;
            if (product.rankingErrors) {
                rankingErrorCount = Object.values(product.rankingErrors).filter(v => v?.status === 'Error').length;
            }
            
            // Count conversion errors
            let conversionErrorCount = 0;
            if (product.conversionErrors) {
                conversionErrorCount = Object.values(product.conversionErrors).filter(v => v?.status === 'Error').length;
            }
            
            // Count inventory errors
            let inventoryErrorCount = 0;
            if (product.inventoryErrors) {
                inventoryErrorCount = Object.values(product.inventoryErrors).filter(v => v?.status === 'Error').length;
            }
            
            return {
                ...product,
                rankingErrorCount,
                conversionErrorCount,
                inventoryErrorCount,
                rankingDetails,
                conversionDetails,
                inventoryDetails,
                buyBoxDetails
            };
        });
        
        // Apply search filter
        if (search) {
            const searchLower = search.toLowerCase();
            products = products.filter(product => {
                const name = (product.name || '').toLowerCase();
                const asin = (product.asin || '').toLowerCase();
                const sku = (product.sku || '').toLowerCase();
                return name.includes(searchLower) || asin.includes(searchLower) || sku.includes(searchLower);
            });
        }
        
        // Apply priority filter
        if (priority) {
            products = products.filter(product => {
                const totalErrors = product.errors || 0;
                switch (priority) {
                    case 'high':
                        return totalErrors >= 5;
                    case 'medium':
                        return totalErrors >= 2 && totalErrors < 5;
                    case 'low':
                        return totalErrors === 1;
                    default:
                        return true;
                }
            });
        }
        
        // Apply sorting
        products = sortProducts(products, sort, sortOrder);
        
        // Apply pagination
        const total = products.length;
        const startIndex = (page - 1) * limit;
        const paginatedData = products.slice(startIndex, startIndex + limit);
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Products with issues retrieved', {
            userId, country, region,
            page, limit, sort, sortOrder, priority, search,
            total,
            returned: paginatedData.length,
            duration
        });
        
        return {
            success: true,
            data: paginatedData,
            pagination: {
                page,
                limit,
                total,
                hasMore: startIndex + limit < total,
                totalPages: Math.ceil(total / limit)
            },
            filters: {
                sort,
                sortOrder,
                priority,
                search
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting products with issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Sort products based on specified field and order
 */
function sortProducts(products, sortField, sortOrder) {
    const order = sortOrder === 'asc' ? 1 : -1;
    
    return [...products].sort((a, b) => {
        let valueA, valueB;
        
        switch (sortField) {
            case 'issues':
                valueA = a.errors || 0;
                valueB = b.errors || 0;
                break;
            case 'sessions':
                valueA = a.sessions || 0;
                valueB = b.sessions || 0;
                break;
            case 'conversion':
                valueA = a.conversionRate || 0;
                valueB = b.conversionRate || 0;
                break;
            case 'sales':
                valueA = a.sales || 0;
                valueB = b.sales || 0;
                break;
            case 'acos':
                valueA = a.acos || 0;
                valueB = b.acos || 0;
                break;
            case 'name':
                valueA = (a.name || '').toLowerCase();
                valueB = (b.name || '').toLowerCase();
                return order * valueA.localeCompare(valueB);
            case 'asin':
                valueA = (a.asin || '').toLowerCase();
                valueB = (b.asin || '').toLowerCase();
                return order * valueA.localeCompare(valueB);
            case 'price':
                valueA = a.price || 0;
                valueB = b.price || 0;
                break;
            default:
                valueA = a.errors || 0;
                valueB = b.errors || 0;
        }
        
        if (valueA < valueB) return -1 * order;
        if (valueA > valueB) return 1 * order;
        return 0;
    });
}

module.exports = {
    getIssuesSummary,
    getRankingIssues,
    getConversionIssues,
    getInventoryIssues,
    getAccountIssues,
    getProductsWithIssues,
    DEFAULT_PAGE_SIZE,
    PRODUCTS_PAGE_SIZE
};

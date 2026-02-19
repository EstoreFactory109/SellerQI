/**
 * ProductIssuesService
 * 
 * Service for calculating and storing per-product issue counts.
 * This updates the `issueCount` field on each product in the Seller model.
 * 
 * The calculation uses the SAME logic as DashboardCalculation.js:
 * - For each product, counts ranking + conversion + inventory errors
 * - Uses the exact same helper functions and error detection logic
 * 
 * This is called:
 * 1. After first-time integration (integration worker)
 * 2. After NumberOfProductReviews service runs (scheduled on Sundays)
 * 3. Can be triggered manually
 */

const logger = require('../../utils/Logger.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { AnalyseService } = require('../main/Analyse.js');
const { analyseData } = require('./DashboardCalculation.js');

/**
 * Calculate and store per-product issue counts
 * Uses the same calculation flow as DashboardCalculation.js
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} source - Source of calculation ('integration', 'schedule', 'manual')
 * @returns {Promise<Object>} Result object with success status and data
 */
async function calculateAndStoreProductIssues(userId, country, region, source = 'integration') {
    const startTime = Date.now();
    
    logger.info('[ProductIssuesService] Starting product issues calculation', {
        userId,
        country,
        region,
        source
    });
    
    try {
        // Step 1: Get raw analyse data
        const getAnalyseData = await AnalyseService.Analyse(userId, country, region);
        
        if (!getAnalyseData || getAnalyseData.status !== 200) {
            logger.error('[ProductIssuesService] Failed to get analyse data', {
                userId,
                country,
                region,
                status: getAnalyseData?.status
            });
            return {
                success: false,
                error: `Failed to get analyse data: status ${getAnalyseData?.status}`
            };
        }
        
        // Step 2: Calculate dashboard data using DashboardCalculation
        // This gives us the productWiseError array with per-product error counts
        const calculationResult = await analyseData(getAnalyseData.message, userId);
        
        if (!calculationResult?.dashboardData) {
            logger.error('[ProductIssuesService] Failed to calculate dashboard data', {
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
        const productWiseError = dashboardData.productWiseError || [];
        
        // Step 3: Build a map of ASIN -> issue count
        // productWiseError contains: { asin, errors, rankingErrors, conversionErrors, inventoryErrors, ... }
        const issueCountMap = new Map();
        
        productWiseError.forEach(product => {
            if (product.asin) {
                // The 'errors' field already contains the total: ranking + conversion + inventory
                issueCountMap.set(product.asin, product.errors || 0);
            }
        });
        
        logger.info('[ProductIssuesService] Built issue count map', {
            userId,
            country,
            region,
            productsWithIssues: issueCountMap.size,
            totalProductsInError: productWiseError.length
        });
        
        // Step 4: Update the Seller model with issue counts
        const seller = await Seller.findOne({ User: userId });
        
        if (!seller) {
            logger.error('[ProductIssuesService] Seller not found', {
                userId,
                country,
                region
            });
            return {
                success: false,
                error: 'Seller not found'
            };
        }
        
        // Find the seller account for the current region
        const sellerAccountIndex = seller.sellerAccount.findIndex(
            acc => acc.country === country && acc.region === region
        );
        
        if (sellerAccountIndex === -1) {
            logger.error('[ProductIssuesService] Seller account not found for region', {
                userId,
                country,
                region
            });
            return {
                success: false,
                error: 'Seller account not found for region'
            };
        }
        
        const sellerAccount = seller.sellerAccount[sellerAccountIndex];
        const products = sellerAccount.products || [];
        let updatedCount = 0;
        const now = new Date();
        
        // Update each product with its issue count
        products.forEach((product, productIndex) => {
            const issueCount = issueCountMap.get(product.asin) || 0;
            
            // Only update if the value has changed or not set
            if (product.issueCount !== issueCount) {
                seller.sellerAccount[sellerAccountIndex].products[productIndex].issueCount = issueCount;
                seller.sellerAccount[sellerAccountIndex].products[productIndex].issueCountUpdatedAt = now;
                updatedCount++;
            }
        });
        
        // Save if there were any updates
        if (updatedCount > 0) {
            await seller.save();
            logger.info('[ProductIssuesService] Updated product issue counts', {
                userId,
                country,
                region,
                updatedCount,
                totalProducts: products.length
            });
        } else {
            logger.info('[ProductIssuesService] No product issue count changes', {
                userId,
                country,
                region,
                totalProducts: products.length
            });
        }
        
        const duration = Date.now() - startTime;
        
        logger.info('[ProductIssuesService] Product issues calculation completed', {
            userId,
            country,
            region,
            source,
            duration,
            updatedCount,
            totalProducts: products.length,
            productsWithIssues: issueCountMap.size
        });
        
        return {
            success: true,
            data: {
                updatedCount,
                totalProducts: products.length,
                productsWithIssues: issueCountMap.size
            },
            duration
        };
        
    } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.error('[ProductIssuesService] Error calculating product issues', {
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
 * Calculate and store product issues using pre-fetched dashboard data
 * This is more efficient when dashboard data is already available
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} dashboardData - Pre-calculated dashboard data with productWiseError
 * @param {string} source - Source of calculation
 * @returns {Promise<Object>} Result object with success status and data
 */
async function storeProductIssuesFromDashboardData(userId, country, region, dashboardData, source = 'integration') {
    const startTime = Date.now();
    
    try {
        if (!dashboardData || !dashboardData.productWiseError) {
            logger.warn('[ProductIssuesService] No productWiseError data provided', {
                userId,
                country,
                region
            });
            return {
                success: false,
                error: 'No productWiseError data provided'
            };
        }
        
        const productWiseError = dashboardData.productWiseError;
        
        // Build a map of ASIN -> issue count
        const issueCountMap = new Map();
        productWiseError.forEach(product => {
            if (product.asin) {
                issueCountMap.set(product.asin, product.errors || 0);
            }
        });
        
        // Update the Seller model
        const seller = await Seller.findOne({ User: userId });
        
        if (!seller) {
            return {
                success: false,
                error: 'Seller not found'
            };
        }
        
        const sellerAccountIndex = seller.sellerAccount.findIndex(
            acc => acc.country === country && acc.region === region
        );
        
        if (sellerAccountIndex === -1) {
            return {
                success: false,
                error: 'Seller account not found for region'
            };
        }
        
        const products = seller.sellerAccount[sellerAccountIndex].products || [];
        let updatedCount = 0;
        const now = new Date();
        
        products.forEach((product, productIndex) => {
            const issueCount = issueCountMap.get(product.asin) || 0;
            
            if (product.issueCount !== issueCount) {
                seller.sellerAccount[sellerAccountIndex].products[productIndex].issueCount = issueCount;
                seller.sellerAccount[sellerAccountIndex].products[productIndex].issueCountUpdatedAt = now;
                updatedCount++;
            }
        });
        
        if (updatedCount > 0) {
            await seller.save();
        }
        
        const duration = Date.now() - startTime;
        
        logger.info('[ProductIssuesService] Stored product issues from dashboard data', {
            userId,
            country,
            region,
            source,
            duration,
            updatedCount,
            totalProducts: products.length
        });
        
        return {
            success: true,
            data: {
                updatedCount,
                totalProducts: products.length,
                productsWithIssues: issueCountMap.size
            },
            duration
        };
        
    } catch (error) {
        logger.error('[ProductIssuesService] Error storing product issues from dashboard data', {
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
 * Get products sorted by issue count (descending)
 * Useful for "Top Products to Fix" feature
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} limit - Maximum number of products to return
 * @returns {Promise<Array>} Array of products sorted by issue count
 */
async function getTopProductsByIssues(userId, country, region, limit = 10) {
    try {
        const seller = await Seller.findOne({ User: userId })
            .select('sellerAccount')
            .lean();
        
        if (!seller) {
            return [];
        }
        
        const sellerAccount = seller.sellerAccount.find(
            acc => acc.country === country && acc.region === region
        );
        
        if (!sellerAccount || !sellerAccount.products) {
            return [];
        }
        
        // Filter active products with issues and sort by issue count
        const productsWithIssues = sellerAccount.products
            .filter(p => p.status === 'Active' && (p.issueCount || 0) > 0)
            .sort((a, b) => (b.issueCount || 0) - (a.issueCount || 0))
            .slice(0, limit)
            .map(p => ({
                asin: p.asin,
                sku: p.sku,
                itemName: p.itemName,
                price: p.price,
                status: p.status,
                issueCount: p.issueCount || 0,
                issueCountUpdatedAt: p.issueCountUpdatedAt
            }));
        
        return productsWithIssues;
        
    } catch (error) {
        logger.error('[ProductIssuesService] Error getting top products by issues', {
            error: error.message,
            userId,
            country,
            region
        });
        return [];
    }
}

module.exports = {
    calculateAndStoreProductIssues,
    storeProductIssuesFromDashboardData,
    getTopProductsByIssues
};

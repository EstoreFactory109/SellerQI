/**
 * OptimizationService.js
 * 
 * Self-contained service for the Optimization tab.
 * Fetches all required data and generates recommendations in the backend.
 * Does NOT depend on frontend state or other heavy services like Analyse/analyseData.
 * 
 * Data sources:
 * - Seller model: Active products (asin, sku, name)
 * - BuyBoxData: Sessions, pageViews, conversionRate
 * - EconomicsMetrics: Sales, grossProfit, fees (embedded or AsinWiseSalesForBigAccounts)
 * - ProductWiseSponsoredAds: PPC spend, ACOS
 */

const logger = require('../../utils/Logger.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const mongoose = require('mongoose');
const { aggregateProductPerformance, enrichProductsWithPerformance } = require('./ProductPerformanceService.js');

/**
 * Generate recommendations for a single product based on profitability and performance data
 * 
 * @param {Object} profitability - Profitability metrics (sales, grossProfit, ads, amzFee, etc.)
 * @param {Object} performance - Performance metrics (sessions, conversionRate, acos, etc.)
 * @param {string} currency - Currency symbol (default: '$')
 * @returns {Array} Array of recommendation objects
 */
const generateProductRecommendations = (profitability, performance, currency = '$') => {
    const recommendations = [];
    
    const sales = profitability?.sales || 0;
    const grossProfit = profitability?.grossProfit || 0;
    const adsSpend = profitability?.ads || 0;
    const amzFee = profitability?.amzFee || 0;
    const profitMargin = sales > 0 ? (grossProfit / sales) * 100 : 0;
    const acos = (adsSpend > 0 && sales > 0) ? (adsSpend / sales) * 100 : 0;
    
    // Profitability-based recommendations
    if (profitability) {
        if (grossProfit < 0) {
            recommendations.push({
                shortLabel: 'Review Profitability',
                message: 'Product is operating at a loss. Consider reviewing pricing, reducing PPC spend, or negotiating better costs.',
                reason: `Gross profit is ${currency}${grossProfit.toFixed(2)} (loss)`
            });
        } else if (profitMargin < 10 && sales > 0) {
            recommendations.push({
                shortLabel: 'Low Profit Margin',
                message: 'Product has low profit margin. Consider increasing price or reducing costs.',
                reason: `Profit margin is ${profitMargin.toFixed(1)}% (below 10% threshold)`
            });
        }
        
        if (adsSpend > 0 && acos > 30) {
            recommendations.push({
                shortLabel: 'Optimize PPC',
                message: 'Advertising cost of sale is high. Review and optimize keyword targeting and bids.',
                reason: `ACOS is ${acos.toFixed(1)}% (above 30% threshold)`
            });
        }
        
        if (adsSpend > grossProfit && grossProfit > 0) {
            recommendations.push({
                shortLabel: 'Reduce PPC Spend',
                message: 'PPC spend is consuming most of the profit margin. Consider reducing ad spend or improving conversion.',
                reason: `PPC spend (${currency}${adsSpend.toFixed(2)}) exceeds gross profit (${currency}${grossProfit.toFixed(2)})`
            });
        }
        
        if (amzFee > 0 && sales > 0) {
            const feePercentage = (amzFee / sales) * 100;
            if (feePercentage > 40) {
                recommendations.push({
                    shortLabel: 'Review Fees',
                    message: 'Amazon fees are consuming a large portion of revenue. Consider FBA alternatives or product bundling.',
                    reason: `Amazon fees are ${feePercentage.toFixed(1)}% of sales`
                });
            }
        }
    }
    
    // Performance-based recommendations
    if (performance?.conversionRate !== undefined && performance.conversionRate < 5 && performance.conversionRate > 0) {
        recommendations.push({
            shortLabel: 'Improve Conversion',
            message: 'Conversion rate is below average. Optimize listing images, description, and reviews.',
            reason: `Conversion rate is ${performance.conversionRate.toFixed(1)}% (below 5% threshold)`
        });
    }
    
    // ACOS from performance (fallback if profitability ACOS wasn't checked)
    if (!profitability && performance?.acos !== undefined && performance.acos > 30) {
        recommendations.push({
            shortLabel: 'Optimize PPC',
            message: 'Advertising cost of sale is high. Review and optimize keyword targeting and bids.',
            reason: `ACOS is ${performance.acos.toFixed(1)}% (above 30% threshold)`
        });
    }
    
    // Low sessions recommendation
    if (performance?.sessions !== undefined && performance.sessions < 50 && performance.sessions > 0) {
        recommendations.push({
            shortLabel: 'Increase Traffic',
            message: 'Product has low traffic. Consider increasing PPC spend or improving keywords.',
            reason: `Only ${performance.sessions} sessions in the period`
        });
    }
    
    return recommendations;
};

/**
 * Build performance map from BuyBox and SponsoredAds data
 * 
 * @param {Object} buyBoxData - BuyBox data document
 * @param {Array} sponsoredAdsArray - Array of sponsored ads data
 * @returns {Map} Map of ASIN -> performance metrics
 */
const buildPerformanceMap = (buyBoxData, sponsoredAdsArray) => {
    const performanceMap = new Map();
    
    // Extract BuyBox metrics (sessions, pageViews, conversionRate)
    const buyBoxItems = buyBoxData?.Items || buyBoxData?.items || [];
    buyBoxItems.forEach(item => {
        const asin = (item.asin || item.childAsin || '').trim();
        if (!asin) return;
        
        const sessions = item.sessions || 0;
        const pageViews = item.pageViews || item.browserPageViews || 0;
        const unitsSold = item.unitsOrdered || item.unitsSold || 0;
        const conversionRate = sessions > 0 ? (unitsSold / sessions) * 100 : 0;
        
        performanceMap.set(asin, {
            sessions,
            pageViews,
            unitsSold,
            conversionRate
        });
    });
    
    // Merge sponsored ads metrics (ppcSpend, ppcSales, acos)
    sponsoredAdsArray.forEach(item => {
        const asin = (item.asin || item.advertisedAsin || '').trim();
        if (!asin) return;
        
        const ppcSpend = item.spend || item.cost || 0;
        const ppcSales = item.sales || item.attributedSales || 0;
        const acos = ppcSales > 0 ? (ppcSpend / ppcSales) * 100 : 0;
        
        const existing = performanceMap.get(asin) || {};
        performanceMap.set(asin, {
            ...existing,
            ppcSpend,
            ppcSales,
            acos
        });
    });
    
    return performanceMap;
};

/**
 * Build profitability map from Economics data
 * Handles both standard accounts (embedded asinWiseSales) and big accounts (separate collection)
 * 
 * @param {Object} economicsData - Economics metrics document
 * @returns {Promise<Map>} Map of ASIN -> profitability metrics
 */
const buildProfitabilityMap = async (economicsData) => {
    const profitabilityMap = new Map();
    
    const isBigAccount = economicsData?.isBig === true;
    
    if (isBigAccount && economicsData?._id) {
        // Big accounts: Use optimized DB aggregation
        const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
        return await AsinWiseSalesForBigAccounts.getProfitabilityMapByMetricsId(economicsData._id);
    }
    
    // Standard accounts: use embedded asinWiseSales
    const asinWiseSales = economicsData?.asinWiseSales || [];
    asinWiseSales.forEach(item => {
        const asin = (item.asin || '').trim();
        if (!asin) return;
        
        // Aggregate values for same ASIN across dates
        const existing = profitabilityMap.get(asin);
        if (existing) {
            existing.sales += item.sales?.amount || 0;
            existing.grossProfit += item.grossProfit?.amount || 0;
            existing.ads += item.ppcSpent?.amount || 0;
            existing.amzFee += item.amazonFees?.amount || 0;
            existing.fbaFees += item.fbaFees?.amount || 0;
            existing.storageFees += item.storageFees?.amount || 0;
            existing.totalFees += item.totalFees?.amount || 0;
            existing.unitsSold += item.unitsSold || 0;
            existing.refunds += item.refunds?.amount || 0;
        } else {
            profitabilityMap.set(asin, {
                asin,
                sales: item.sales?.amount || 0,
                grossProfit: item.grossProfit?.amount || 0,
                ads: item.ppcSpent?.amount || 0,
                amzFee: item.amazonFees?.amount || 0,
                fbaFees: item.fbaFees?.amount || 0,
                storageFees: item.storageFees?.amount || 0,
                totalFees: item.totalFees?.amount || 0,
                unitsSold: item.unitsSold || 0,
                refunds: item.refunds?.amount || 0
            });
        }
    });
    
    return profitabilityMap;
};

/**
 * Get all optimization products with recommendations
 * Self-contained: fetches all required data and computes recommendations
 * 
 * @param {string} userId - User ID
 * @param {string} region - Region code
 * @param {string} country - Country code
 * @param {Object} options - Options { page, limit }
 * @returns {Promise<Object>} { products, pagination, currency }
 */
const getOptimizationProducts = async (userId, region, country, options = {}) => {
    const startTime = Date.now();
    const page = Math.max(1, parseInt(options.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(options.limit) || 20));
    
    logger.info(`[OptimizationService] Starting for user ${userId}, page ${page}, limit ${limit}`);
    
    const userObjectId = mongoose.Types.ObjectId.createFromHexString(userId);
    
    // Import required models and services
    const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
    const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
    const { getProductWiseSponsoredAdsData } = require('../../Services/amazon-ads/ProductWiseSponsoredAdsService.js');
    
    // Step 1: Fetch all data in parallel
    const [allProductsResult, buyBoxData, economicsData, sponsoredAdsData] = await Promise.all([
        // Get ALL active products (no pagination at DB level - we paginate after enrichment)
        Seller.aggregate([
            { $match: { User: userObjectId } },
            { $unwind: '$sellerAccount' },
            { $match: { 'sellerAccount.region': region } },
            { $unwind: { path: '$sellerAccount.products', preserveNullAndEmptyArrays: false } },
            { $match: { 'sellerAccount.products.status': { $regex: /^active$/i } } },
            { $sort: { 'sellerAccount.products.asin': 1 } },
            {
                $project: {
                    _id: 0,
                    asin: '$sellerAccount.products.asin',
                    sku: '$sellerAccount.products.sku',
                    name: '$sellerAccount.products.itemName',
                    status: '$sellerAccount.products.status'
                }
            }
        ]),
        BuyBoxData.findLatest(userId, region, country),
        EconomicsMetrics.findLatest(userId, region, country),
        getProductWiseSponsoredAdsData(userId, country, region)
    ]);
    
    const allProducts = allProductsResult || [];
    const totalItems = allProducts.length;
    
    logger.info(`[OptimizationService] Fetched ${totalItems} active products`);
    
    // Step 2: Extract sponsored ads array (handle different response formats)
    let sponsoredAdsArray = [];
    if (sponsoredAdsData?.sponsoredAds && Array.isArray(sponsoredAdsData.sponsoredAds)) {
        sponsoredAdsArray = sponsoredAdsData.sponsoredAds;
    } else if (sponsoredAdsData?.Items && Array.isArray(sponsoredAdsData.Items)) {
        sponsoredAdsArray = sponsoredAdsData.Items;
    } else if (Array.isArray(sponsoredAdsData)) {
        sponsoredAdsArray = sponsoredAdsData;
    }
    
    // Step 3: Use ProductPerformanceService for consistent performance data format
    // This ensures same data structure as the rest of the app (sessions, pageViews, sales, acos, etc.)
    const performanceMap = aggregateProductPerformance({
        productList: allProducts,
        buyBoxData: buyBoxData,
        productWiseSponsoredAds: sponsoredAdsArray,
        economicsMetrics: economicsData
    });
    
    // Step 4: Build profitability map (for detailed profitability metrics beyond basic sales)
    const profitabilityMap = await buildProfitabilityMap(economicsData);
    
    logger.info(`[OptimizationService] Built maps - performance: ${performanceMap.size} ASINs, profitability: ${profitabilityMap.size} ASINs`);
    
    // Step 5: Determine currency from economics data
    const currency = economicsData?.asinWiseSales?.[0]?.sales?.currencyCode || 
                     economicsData?.currency || 
                     '$';
    
    // Step 6: Enrich products with performance using the existing service
    const productsWithPerformance = enrichProductsWithPerformance(allProducts, performanceMap);
    
    // Step 7: Add profitability and generate recommendations for each product
    const enrichedProducts = productsWithPerformance.map(product => {
        const asin = (product.asin || '').trim();
        const profitability = profitabilityMap.get(asin) || null;
        const performance = product.performance || {};
        const recommendations = generateProductRecommendations(profitability, performance, currency);
        
        return {
            asin: product.asin,
            sku: product.sku,
            name: product.name || '',
            title: product.name || '',
            status: product.status || 'Active',
            performance: performance,
            profitability: profitability,
            recommendations: recommendations,
            primaryRecommendation: recommendations.length > 0 ? recommendations[0] : null
        };
    });
    
    // Step 8: Paginate the enriched products
    const startIndex = (page - 1) * limit;
    const paginatedProducts = enrichedProducts.slice(startIndex, startIndex + limit);
    const totalPages = Math.ceil(totalItems / limit);
    
    const elapsed = Date.now() - startTime;
    logger.info(`[OptimizationService] Completed in ${elapsed}ms - returning ${paginatedProducts.length} of ${totalItems} products (page ${page}/${totalPages})`);
    
    return {
        products: paginatedProducts,
        pagination: {
            page,
            limit,
            totalItems,
            totalPages,
            hasMore: page < totalPages
        },
        currency,
        country,
        region
    };
};

module.exports = {
    getOptimizationProducts,
    generateProductRecommendations,
    buildPerformanceMap,
    buildProfitabilityMap
};

/**
 * OptimizationService.js
 *
 * Self-contained service for the Optimization tab.
 * Fetches all required data, computes WoW comparison for trend scenarios,
 * and generates scenario-based recommendations via ScenarioRecommendationService.
 *
 * Data sources:
 * - Seller model: Active products (asin, sku, name)
 * - BuyBoxData: Sessions, pageViews, conversionRate
 * - EconomicsMetrics: Sales, grossProfit, fees
 * - ProductWiseSponsoredAds: PPC spend, ACOS
 * - ProductPerformanceComparisonService: WoW trend data
 */

const logger = require('../../utils/Logger.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const mongoose = require('mongoose');
const { aggregateProductPerformance, enrichProductsWithPerformance } = require('./ProductPerformanceService.js');
const { evaluateScenarios, buildMetrics } = require('./ScenarioRecommendationService.js');
const { fetchAndEnrichWithComparison } = require('./ProductPerformanceComparisonService.js');

/**
 * Build profitability map from Economics data.
 * Handles both standard accounts (embedded asinWiseSales) and big accounts (separate collection).
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

    // Step 6b: Fetch WoW comparison data for trend-based scenarios
    let productsWithComparison = productsWithPerformance;
    try {
        const compResult = await fetchAndEnrichWithComparison({
            userId,
            region,
            country,
            comparisonType: 'wow',
            currentBuyBoxData: buyBoxData,
            currentEconomicsData: economicsData,
            products: productsWithPerformance,
        });
        productsWithComparison = compResult.products;
        logger.info(`[OptimizationService] Comparison enrichment done — ${compResult.comparisonMeta?.hasComparison ? 'with' : 'without'} trend data`);
    } catch (compErr) {
        logger.warn(`[OptimizationService] Comparison fetch failed, continuing without trend data: ${compErr.message}`);
    }

    // Step 7: Evaluate scenario-based recommendations for each product
    const enrichedProducts = productsWithComparison.map(product => {
        const asin = (product.asin || '').trim();
        const profitability = profitabilityMap.get(asin) || null;
        const performance = product.performance || {};
        const comparison = product.comparison || null;

        const metrics = buildMetrics({ performance, profitability });
        const recommendations = evaluateScenarios(metrics, comparison);

        return {
            asin: product.asin,
            sku: product.sku,
            name: product.name || '',
            title: product.name || '',
            status: product.status || 'Active',
            performance,
            profitability,
            recommendations,
            primaryRecommendation: recommendations.length > 0 ? recommendations[0] : null,
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
    buildProfitabilityMap,
};

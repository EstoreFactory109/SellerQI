/**
 * ProductPerformanceService.js
 * 
 * Aggregates product-level performance metrics from multiple data sources:
 * - BuyBoxData: sessions, pageViews, unitSessionPercentage (conversion)
 * - EconomicsMetrics/asinWiseSales: sales, units, grossProfit
 * - ProductWiseSponsoredAds: PPC spend, attributed sales, impressions, clicks
 * 
 * Used to enrich product lists with performance data for the "issues by product" page.
 */

const mongoose = require('mongoose');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Aggregate performance metrics per ASIN from multiple data sources
 * @param {Object} params - Input parameters
 * @param {Array} params.productList - Array of products (with asin property)
 * @param {Object} params.buyBoxData - BuyBox data with asinBuyBoxData array
 * @param {Array} params.productWiseSponsoredAds - Product-wise sponsored ads data
 * @param {Object} params.economicsMetrics - Economics metrics with asinWiseSales
 * @returns {Map<string, Object>} Map of ASIN -> performance metrics
 */
function aggregateProductPerformance({ productList, buyBoxData, productWiseSponsoredAds, economicsMetrics }) {
    const performanceMap = new Map();
    
    // Build lookup maps for efficient access
    
    // 1. BuyBox data (sessions, conversion, pageViews)
    const buyBoxMap = new Map();
    if (buyBoxData?.asinBuyBoxData && Array.isArray(buyBoxData.asinBuyBoxData)) {
        buyBoxData.asinBuyBoxData.forEach(item => {
            const asin = (item.childAsin || item.parentAsin || '').trim();
            if (asin) {
                buyBoxMap.set(asin, {
                    sessions: item.sessions || 0,
                    pageViews: item.pageViews || 0,
                    unitSessionPercentage: item.unitSessionPercentage || 0,
                    buyBoxPercentage: item.buyBoxPercentage || 0,
                    unitsOrdered: item.unitsOrdered || 0,
                    sales: item.sales?.amount || 0
                });
            }
        });
    }
    
    // 2. PPC data (spend, attributed sales, impressions, clicks)
    const ppcMap = new Map();
    if (Array.isArray(productWiseSponsoredAds)) {
        productWiseSponsoredAds.forEach(item => {
            const asin = (item.asin || '').trim();
            if (asin) {
                // Aggregate if multiple entries for same ASIN
                const existing = ppcMap.get(asin) || {
                    ppcSpend: 0,
                    ppcSales: 0,
                    impressions: 0,
                    clicks: 0
                };
                existing.ppcSpend += item.spend || 0;
                existing.ppcSales += item.salesIn7Days || item.salesIn14Days || item.salesIn30Days || 0;
                existing.impressions += item.impressions || 0;
                existing.clicks += item.clicks || 0;
                ppcMap.set(asin, existing);
            }
        });
    }
    
    // 3. Economics data (sales, units from EconomicsMetrics)
    const economicsMap = new Map();
    if (economicsMetrics?.asinWiseSales && Array.isArray(economicsMetrics.asinWiseSales)) {
        economicsMetrics.asinWiseSales.forEach(item => {
            const asin = (item.asin || '').trim();
            if (asin) {
                economicsMap.set(asin, {
                    totalSales: item.sales?.amount || 0,
                    unitsSold: item.unitsSold || 0,
                    grossProfit: item.grossProfit?.amount || 0
                });
            }
        });
    }
    
    // 4. Build combined performance data for each product
    const productAsins = productList.map(p => (p.asin || '').trim()).filter(Boolean);
    
    productAsins.forEach(asin => {
        const buyBox = buyBoxMap.get(asin) || {};
        const ppc = ppcMap.get(asin) || {};
        const economics = economicsMap.get(asin) || {};
        
        // Calculate derived metrics
        const ppcSpend = ppc.ppcSpend || 0;
        const ppcSales = ppc.ppcSales || 0;
        const clicks = ppc.clicks || 0;
        const impressions = ppc.impressions || 0;
        
        // ACOS = (spend / sales) * 100
        const acos = ppcSales > 0 ? (ppcSpend / ppcSales) * 100 : 0;
        // CTR = (clicks / impressions) * 100
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        
        performanceMap.set(asin, {
            // Traffic metrics (from BuyBox/Sales and Traffic by ASIN)
            sessions: buyBox.sessions || 0,
            pageViews: buyBox.pageViews || 0,
            conversionRate: buyBox.unitSessionPercentage || 0,
            buyBoxPercentage: buyBox.buyBoxPercentage || 0,
            
            // Sales metrics (prefer BuyBox data if available, fall back to economics)
            sales: buyBox.sales || economics.totalSales || 0,
            unitsSold: buyBox.unitsOrdered || economics.unitsSold || 0,
            grossProfit: economics.grossProfit || 0,
            
            // PPC metrics
            ppcSpend: ppcSpend,
            ppcSales: ppcSales,
            impressions: impressions,
            clicks: clicks,
            acos: parseFloat(acos.toFixed(2)),
            ctr: parseFloat(ctr.toFixed(2)),
            
            // Flags for recommendation engine
            hasPPC: ppcSpend > 0,
            hasTraffic: (buyBox.sessions || 0) > 0
        });
    });
    
    return performanceMap;
}

/**
 * Enrich product list with performance metrics
 * @param {Array} products - Array of product objects (each with 'asin' property)
 * @param {Map} performanceMap - Map from aggregateProductPerformance
 * @returns {Array} Products with added 'performance' property
 */
function enrichProductsWithPerformance(products, performanceMap) {
    return products.map(product => {
        const asin = (product.asin || '').trim();
        const performance = performanceMap.get(asin) || {
            sessions: 0,
            pageViews: 0,
            conversionRate: 0,
            buyBoxPercentage: 0,
            sales: 0,
            unitsSold: 0,
            grossProfit: 0,
            ppcSpend: 0,
            ppcSales: 0,
            impressions: 0,
            clicks: 0,
            acos: 0,
            ctr: 0,
            hasPPC: false,
            hasTraffic: false
        };
        
        return {
            ...product,
            performance
        };
    });
}

/**
 * Get performance metrics for a single ASIN with optional comparison
 * OPTIMIZED: Fetches current and comparison data in PARALLEL when comparison is requested
 * 
 * @param {Object} params - Parameters
 * @param {string} params.userId - User ID
 * @param {string} params.region - Region (NA, EU, FE)
 * @param {string} params.country - Country code
 * @param {string} params.asin - ASIN to fetch performance for
 * @param {string} params.comparison - Comparison type: 'none' | 'wow' | 'mom'
 * @returns {Promise<Object>} Performance metrics with optional comparison
 */
async function getProductPerformanceByAsin({ userId, region, country, asin, comparison = 'none' }) {
    if (!asin) {
        throw new Error('ASIN is required');
    }

    const normalizedAsin = asin.trim().toUpperCase();
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const needsComparison = comparison !== 'none' && (comparison === 'wow' || comparison === 'mom');

    logger.info('[ProductPerformanceService] Fetching performance for ASIN', { 
        userId, region, country, asin: normalizedAsin, comparison 
    });

    try {
        // Build parallel fetch array - always fetch current period
        const fetchPromises = [
            BuyBoxData.findLatest(userObjectId, region, country),
            EconomicsMetrics.findLatest(userObjectId, region, country),
            fetchPPCDataForAsin(userObjectId, country, region, normalizedAsin)
        ];
        
        // If comparison requested, also fetch previous period docs in PARALLEL
        // This eliminates the sequential wait for current period to complete
        if (needsComparison) {
            const skipCount = comparison === 'wow' ? 1 : 4;
            fetchPromises.push(
                BuyBoxData.find({
                    User: userObjectId,
                    region: region,
                    country: country
                }).sort({ createdAt: -1 }).skip(skipCount).limit(1).lean(),
                
                EconomicsMetrics.find({
                    User: userObjectId,
                    region: region,
                    country: country
                }).sort({ createdAt: -1 }).skip(skipCount).limit(1).lean()
            );
        }

        // Execute all fetches in parallel
        const results = await Promise.all(fetchPromises);
        
        const buyBoxDoc = results[0];
        const economicsDoc = results[1];
        const ppcResult = results[2];
        const previousBuyBoxDoc = needsComparison ? (results[3]?.[0] || null) : null;
        const previousEconomicsDoc = needsComparison ? (results[4]?.[0] || null) : null;
        
        // Detect big accounts that need separate aggregation queries
        // and batch them together for parallel execution
        const bigAccountQueries = [];
        const bigAccountQueryMap = {}; // Maps index to 'current' or 'previous'
        
        const currentIsBigAccount = economicsDoc && (economicsDoc.isBig === true || !economicsDoc.asinWiseSales?.length);
        const previousIsBigAccount = previousEconomicsDoc && (previousEconomicsDoc.isBig === true || !previousEconomicsDoc.asinWiseSales?.length);
        
        if (currentIsBigAccount && economicsDoc._id) {
            bigAccountQueryMap[bigAccountQueries.length] = 'current';
            bigAccountQueries.push(
                AsinWiseSalesForBigAccounts.aggregate([
                    { $match: { metricsId: economicsDoc._id } },
                    { $unwind: '$asinSales' },
                    { $match: { 'asinSales.asin': normalizedAsin } },
                    {
                        $group: {
                            _id: '$asinSales.asin',
                            sales: { $sum: '$asinSales.sales.amount' },
                            grossProfit: { $sum: '$asinSales.grossProfit.amount' },
                            unitsSold: { $sum: '$asinSales.unitsSold' }
                        }
                    }
                ])
            );
        }
        
        if (previousIsBigAccount && previousEconomicsDoc._id) {
            bigAccountQueryMap[bigAccountQueries.length] = 'previous';
            bigAccountQueries.push(
                AsinWiseSalesForBigAccounts.aggregate([
                    { $match: { metricsId: previousEconomicsDoc._id } },
                    { $unwind: '$asinSales' },
                    { $match: { 'asinSales.asin': normalizedAsin } },
                    {
                        $group: {
                            _id: '$asinSales.asin',
                            sales: { $sum: '$asinSales.sales.amount' },
                            grossProfit: { $sum: '$asinSales.grossProfit.amount' },
                            unitsSold: { $sum: '$asinSales.unitsSold' }
                        }
                    }
                ])
            );
        }
        
        // Execute big account queries in parallel
        let currentBigAccountData = null;
        let previousBigAccountData = null;
        
        if (bigAccountQueries.length > 0) {
            const bigAccountResults = await Promise.all(bigAccountQueries);
            
            for (let i = 0; i < bigAccountResults.length; i++) {
                const data = bigAccountResults[i]?.[0] || null;
                if (bigAccountQueryMap[i] === 'current') {
                    currentBigAccountData = data;
                } else if (bigAccountQueryMap[i] === 'previous') {
                    previousBigAccountData = data;
                }
            }
        }
        
        // Extract current performance (pass pre-fetched big account data)
        const currentPerformance = await extractPerformanceFromDocs(
            buyBoxDoc, economicsDoc, ppcResult, normalizedAsin, userObjectId, currentBigAccountData
        );

        // Build response
        const result = {
            performance: currentPerformance,
            comparison: null
        };

        // If comparison requested, extract previous period performance
        if (needsComparison && (previousBuyBoxDoc || previousEconomicsDoc)) {
            const previousPerformance = await extractPerformanceFromDocs(
                previousBuyBoxDoc, previousEconomicsDoc, null, normalizedAsin, userObjectId, previousBigAccountData
            );
            
            if (previousPerformance) {
                result.comparison = buildComparisonResult(
                    currentPerformance, 
                    previousPerformance, 
                    comparison
                );
            }
        }

        logger.info('[ProductPerformanceService] Performance fetched successfully', {
            asin: normalizedAsin,
            hasComparison: !!result.comparison
        });

        return {
            success: true,
            data: result
        };

    } catch (error) {
        logger.error('[ProductPerformanceService] Error fetching performance', {
            error: error.message,
            userId,
            asin: normalizedAsin
        });
        throw error;
    }
}

/**
 * Fetch PPC data for a single ASIN
 */
async function fetchPPCDataForAsin(userId, country, region, asin) {
    try {
        const result = await ProductWiseSponsoredAdsItem.aggregate([
            { $match: { userId: userId, country: country, region: region, asin: asin } },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: '$batchId',
                    createdAt: { $first: '$createdAt' },
                    totalSpend: { $sum: '$spend' },
                    totalSales: { $sum: '$salesIn30Days' },
                    totalImpressions: { $sum: '$impressions' },
                    totalClicks: { $sum: '$clicks' }
                }
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 }
        ]);

        if (result.length > 0) {
            return result[0];
        }
        return null;
    } catch (error) {
        logger.error('[ProductPerformanceService] Error fetching PPC data', { error: error.message, asin });
        return null;
    }
}

/**
 * Extract performance metrics from docs for a single ASIN
 * OPTIMIZED: Accepts pre-fetched bigAccountData to avoid redundant aggregation queries
 * @param {Object} buyBoxDoc - BuyBox document
 * @param {Object} economicsDoc - Economics document
 * @param {Object} ppcResult - PPC aggregation result
 * @param {string} asin - Normalized ASIN
 * @param {ObjectId} userId - User ID
 * @param {Object} bigAccountData - Pre-fetched big account data (optional, for optimization)
 */
async function extractPerformanceFromDocs(buyBoxDoc, economicsDoc, ppcResult, asin, userId, bigAccountData = null) {
    let sessions = 0, pageViews = 0, conversionRate = 0, buyBoxPercentage = 0;
    let sales = 0, unitsSold = 0, grossProfit = 0;

    // Extract from BuyBox
    if (buyBoxDoc?.asinBuyBoxData) {
        const buyBoxItem = buyBoxDoc.asinBuyBoxData.find(item => {
            const childAsin = (item.childAsin || '').trim().toUpperCase();
            const parentAsin = (item.parentAsin || '').trim().toUpperCase();
            return childAsin === asin || parentAsin === asin;
        });

        if (buyBoxItem) {
            sessions = buyBoxItem.sessions || 0;
            pageViews = buyBoxItem.pageViews || 0;
            conversionRate = buyBoxItem.unitSessionPercentage || 0;
            buyBoxPercentage = buyBoxItem.buyBoxPercentage || 0;
            sales = buyBoxItem.sales?.amount || 0;
            unitsSold = buyBoxItem.unitsOrdered || 0;
        }
    }

    // Extract from Economics (more accurate for sales/profit)
    if (economicsDoc) {
        const isBigAccount = economicsDoc.isBig === true;
        const hasEmptyAsinData = !economicsDoc.asinWiseSales || economicsDoc.asinWiseSales.length === 0;

        if ((isBigAccount || hasEmptyAsinData) && economicsDoc._id) {
            // Use pre-fetched data if available, otherwise fetch
            let asinSalesData = bigAccountData;
            
            if (!asinSalesData) {
                const results = await AsinWiseSalesForBigAccounts.aggregate([
                    { $match: { metricsId: economicsDoc._id } },
                    { $unwind: '$asinSales' },
                    { $match: { 'asinSales.asin': asin } },
                    {
                        $group: {
                            _id: '$asinSales.asin',
                            sales: { $sum: '$asinSales.sales.amount' },
                            grossProfit: { $sum: '$asinSales.grossProfit.amount' },
                            unitsSold: { $sum: '$asinSales.unitsSold' }
                        }
                    }
                ]);
                asinSalesData = results[0] || null;
            }

            if (asinSalesData) {
                sales = asinSalesData.sales || sales;
                grossProfit = asinSalesData.grossProfit || 0;
                unitsSold = asinSalesData.unitsSold || unitsSold;
            }
        } else {
            const econItem = economicsDoc.asinWiseSales?.find(item =>
                (item.asin || '').trim().toUpperCase() === asin
            );

            if (econItem) {
                sales = econItem.sales?.amount || sales;
                grossProfit = econItem.grossProfit?.amount || 0;
                unitsSold = econItem.unitsSold || unitsSold;
            }
        }
    }

    // Extract PPC metrics
    const ppcSpend = ppcResult?.totalSpend || 0;
    const ppcSales = ppcResult?.totalSales || 0;
    const impressions = ppcResult?.totalImpressions || 0;
    const clicks = ppcResult?.totalClicks || 0;
    const acos = ppcSales > 0 ? (ppcSpend / ppcSales) * 100 : null;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

    return {
        sessions,
        pageViews,
        conversionRate: parseFloat(conversionRate.toFixed(2)),
        buyBoxPercentage: parseFloat(buyBoxPercentage.toFixed(2)),
        sales: parseFloat(sales.toFixed(2)),
        unitsSold,
        grossProfit: parseFloat(grossProfit.toFixed(2)),
        ppcSpend: parseFloat(ppcSpend.toFixed(2)),
        ppcSales: parseFloat(ppcSales.toFixed(2)),
        impressions,
        clicks,
        acos: acos !== null ? parseFloat(acos.toFixed(2)) : null,
        ctr: parseFloat(ctr.toFixed(2)),
        hasPPC: ppcSpend > 0,
        hasTraffic: sessions > 0
    };
}

/**
 * Fetch previous period performance for comparison
 * OPTIMIZED: Runs BuyBox and Economics queries in parallel
 */
async function fetchPreviousPeriodPerformance(userId, region, country, asin, comparison) {
    try {
        // Determine how many docs to skip based on comparison type
        const skipCount = comparison === 'wow' ? 1 : 4; // WoW = 1 week back, MoM = ~4 weeks back

        // Run both queries in PARALLEL instead of sequential
        const [previousBuyBoxDocs, previousEconomicsDocs] = await Promise.all([
            BuyBoxData.find({
                User: userId,
                region: region,
                country: country
            }).sort({ createdAt: -1 }).skip(skipCount).limit(1).lean(),
            
            EconomicsMetrics.find({
                User: userId,
                region: region,
                country: country
            }).sort({ createdAt: -1 }).skip(skipCount).limit(1).lean()
        ]);

        const previousBuyBoxDoc = previousBuyBoxDocs[0] || null;
        const previousEconomicsDoc = previousEconomicsDocs[0] || null;

        if (!previousBuyBoxDoc && !previousEconomicsDoc) {
            return null;
        }

        // Extract performance from previous docs (no PPC for previous period for now)
        return await extractPerformanceFromDocs(
            previousBuyBoxDoc, previousEconomicsDoc, null, asin, userId
        );

    } catch (error) {
        logger.error('[ProductPerformanceService] Error fetching previous period', { 
            error: error.message, 
            asin, 
            comparison 
        });
        return null;
    }
}

/**
 * Build comparison result object
 */
function buildComparisonResult(current, previous, comparisonType) {
    const calculateChange = (currentVal, previousVal) => {
        const delta = currentVal - previousVal;
        const percentChange = previousVal > 0 ? ((delta / previousVal) * 100) : (currentVal > 0 ? 100 : 0);
        return {
            current: currentVal,
            previous: previousVal,
            delta: parseFloat(delta.toFixed(2)),
            percentChange: parseFloat(percentChange.toFixed(2))
        };
    };

    return {
        hasComparison: true,
        type: comparisonType,
        changes: {
            sales: calculateChange(current.sales, previous.sales),
            unitsSold: calculateChange(current.unitsSold, previous.unitsSold),
            sessions: calculateChange(current.sessions, previous.sessions),
            pageViews: calculateChange(current.pageViews, previous.pageViews),
            conversionRate: calculateChange(current.conversionRate, previous.conversionRate)
        }
    };
}

module.exports = {
    aggregateProductPerformance,
    enrichProductsWithPerformance,
    getProductPerformanceByAsin
};

/**
 * ProductPerformanceService.js
 * 
 * Aggregates product-level performance metrics from multiple data sources:
 * - BuyBoxData: sessions, pageViews, unitSessionPercentage (conversion)
 * - Economics (LiveEconomicsService: fresh EconomicsMetrics or live DailySkuFinance): sales, units, grossProfit
 * - ProductWiseSponsoredAds: PPC spend, attributed sales, impressions, clicks
 * 
 * Used to enrich product lists with performance data for the "issues by product" page.
 */

const mongoose = require('mongoose');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const { loadLiveEconomics, loadEconomicsComparison, lastNDaysWindow, isStoredEconomicsDoc } = require('../Finance/LiveEconomicsService.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Aggregate performance metrics per ASIN from multiple data sources
 * @param {Object} params - Input parameters
 * @param {Array} params.productList - Array of products (with asin property)
 * @param {Object} params.buyBoxData - BuyBox data with asinBuyBoxData array
 * @param {Object} params.economicsMetrics - Economics metrics with asinWiseSales
 * @param {Object|null} params.economicsAsinSalesOverride - Optional ASIN -> sales row object from
 *   AsinFinanceWindowService.resolveAsinFinance (fresh EconomicsMetrics, else live DailySkuFinance —
 *   the same per-ASIN source as the dashboard). Every live caller passes it; an empty object means
 *   "no current per-ASIN finance" and deliberately does NOT fall through to the raw
 *   economicsMetrics.asinWiseSales below, which may be a stale April-2026 doc.
 * @returns {Map<string, Object>} Map of ASIN -> performance metrics
 */
function aggregateProductPerformance({
    productList,
    buyBoxData,
    productWiseSponsoredAds,
    economicsMetrics,
    economicsAsinSalesOverride = null
}) {
    const performanceMap = new Map();
    
    // Build lookup maps for efficient access
    
    // 1. BuyBox data (sessions, conversion, pageViews)
    const buyBoxMap = new Map();
    if (buyBoxData?.asinBuyBoxData && Array.isArray(buyBoxData.asinBuyBoxData)) {
        buyBoxData.asinBuyBoxData.forEach(item => {
            const asin = (item.childAsin || item.parentAsin || '').trim();
            if (asin) {
                const key = asin.toUpperCase();
                buyBoxMap.set(key, {
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
                const key = asin.toUpperCase();
                // Aggregate if multiple entries for same ASIN
                const existing = ppcMap.get(key) || {
                    ppcSpend: 0,
                    ppcSales: 0,
                    impressions: 0,
                    clicks: 0
                };
                existing.ppcSpend += item.spend || 0;
                existing.ppcSales += item.sales || item.salesIn7Days || item.salesIn14Days || item.salesIn30Days || 0;
                existing.impressions += item.impressions || 0;
                existing.clicks += item.clicks || 0;
                ppcMap.set(key, existing);
            }
        });
    }
    
    // 3. Per-ASIN sales (resolveAsinFinance: fresh EconomicsMetrics or live DailySkuFinance)
    const economicsMap = new Map();
    if (economicsAsinSalesOverride && typeof economicsAsinSalesOverride === 'object') {
        Object.entries(economicsAsinSalesOverride).forEach(([asin, data]) => {
            const key = (asin || '').trim().toUpperCase();
            if (!key) return;
            economicsMap.set(key, {
                totalSales: data.sales || 0,
                unitsSold: data.unitsSold || 0,
                grossProfit: data.grossProfit || 0
            });
        });
    } else if (economicsMetrics?.asinWiseSales && Array.isArray(economicsMetrics.asinWiseSales)) {
        economicsMetrics.asinWiseSales.forEach(item => {
            const key = (item.asin || '').trim().toUpperCase();
            if (!key) return;
            const row = {
                totalSales: item.sales?.amount || 0,
                unitsSold: item.unitsSold || 0,
                grossProfit: item.grossProfit?.amount || 0
            };
            const existing = economicsMap.get(key);
            if (existing) {
                existing.totalSales += row.totalSales;
                existing.unitsSold += row.unitsSold;
                existing.grossProfit += row.grossProfit;
            } else {
                economicsMap.set(key, row);
            }
        });
    }
    
    // 4. Build combined performance data for each product
    const productAsins = productList.map(p => (p.asin || '').trim()).filter(Boolean);
    
    productAsins.forEach(asin => {
        const key = asin.toUpperCase();
        const buyBox = buyBoxMap.get(key) || {};
        const ppc = ppcMap.get(key) || {};
        const economics = economicsMap.get(key) || {};
        const hasEconomicsRow = economicsMap.has(key);
        
        // Calculate derived metrics
        const ppcSpend = ppc.ppcSpend || 0;
        const ppcSales = ppc.ppcSales || 0;
        const clicks = ppc.clicks || 0;
        const impressions = ppc.impressions || 0;
        
        // ACOS = (spend / sales) * 100
        const acos = ppcSales > 0 ? (ppcSpend / ppcSales) * 100 : 0;
        // CTR = (clicks / impressions) * 100
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        
        // Sales / units: align with the dashboard — the resolved per-ASIN finance (resolveAsinFinance) wins when present
        const sales = hasEconomicsRow
            ? (Number(economics.totalSales) || 0)
            : (buyBox.sales || economics.totalSales || 0);
        const unitsSold = hasEconomicsRow
            ? (Number(economics.unitsSold) || 0)
            : (buyBox.unitsOrdered || economics.unitsSold || 0);
        const grossProfit = hasEconomicsRow
            ? (Number(economics.grossProfit) || 0)
            : (economics.grossProfit || 0);

        performanceMap.set(asin, {
            // Traffic metrics (from BuyBox/Sales and Traffic by ASIN)
            sessions: buyBox.sessions || 0,
            pageViews: buyBox.pageViews || 0,
            conversionRate: buyBox.unitSessionPercentage || 0,
            buyBoxPercentage: buyBox.buyBoxPercentage || 0,
            
            sales,
            unitsSold,
            grossProfit,
            
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
 *
 * Sales, units and gross profit come from the shared economics loader
 * (LiveEconomicsService): a fresh EconomicsMetrics doc, else live DailySkuFinance
 * for the 30 days ending yesterday. A comparison is two LIVE windows of equal
 * length (wow: last 7 days vs the 7 before; mom: last 30 vs the 30 before) — it
 * used to hop back 1 or 4 EconomicsMetrics docs, which since March 2026 compared
 * one stale month with another.
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
    const needsComparison = comparison === 'wow' || comparison === 'mom';

    logger.info('[ProductPerformanceService] Fetching performance for ASIN', { 
        userId, region, country, asin: normalizedAsin, comparison 
    });

    try {
        const fetchPromises = [
            BuyBoxData.findLatest(userObjectId, region, country),
            loadLiveEconomics(userObjectId, region, country, { asin: normalizedAsin }),
            fetchPPCDataForAsin(userObjectId, country, region, normalizedAsin)
        ];

        if (needsComparison) {
            // Traffic (sessions, page views) only exists per BuyBox report, so the
            // previous side of traffic is still the report before; money is windowed.
            const skipCount = comparison === 'wow' ? 1 : 4;
            fetchPromises.push(
                BuyBoxData.find({
                    User: userObjectId,
                    region: region,
                    country: country
                }).sort({ createdAt: -1 }).skip(skipCount).limit(1).lean(),
                loadEconomicsComparison(userObjectId, region, country, {
                    ...lastNDaysWindow(comparison === 'wow' ? 7 : 30),
                    asin: normalizedAsin
                })
            );
        }

        const results = await Promise.all(fetchPromises);
        
        const buyBoxDoc = results[0];
        const economicsDoc = results[1];
        const ppcResult = results[2];
        const previousBuyBoxDoc = needsComparison ? (results[3]?.[0] || null) : null;
        const economicsComparison = needsComparison ? (results[4] || null) : null;

        const currentPerformance = await extractPerformanceFromDocs(
            buyBoxDoc, economicsDoc, ppcResult, normalizedAsin, userObjectId
        );

        const result = {
            performance: currentPerformance,
            comparison: null
        };

        // Both windows need live finance: a missing side is "no data", and comparing
        // against it would read as a 100% change.
        if (economicsComparison?.current && economicsComparison?.previous) {
            const [currentWindowPerf, previousWindowPerf] = await Promise.all([
                extractPerformanceFromDocs(buyBoxDoc, economicsComparison.current, null, normalizedAsin, userObjectId),
                extractPerformanceFromDocs(previousBuyBoxDoc, economicsComparison.previous, null, normalizedAsin, userObjectId)
            ]);
            result.comparison = buildComparisonResult(currentWindowPerf, previousWindowPerf, comparison);
            result.comparison.currentWindow = economicsComparison.currentWindow;
            result.comparison.previousWindow = economicsComparison.previousWindow;
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
                    totalSales: { $sum: { $ifNull: ['$sales', { $ifNull: ['$salesIn30Days', 0] }] } },
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

        // Big-account rows are keyed by a stored doc's _id; a live-built doc has them inline.
        if ((isBigAccount || hasEmptyAsinData) && isStoredEconomicsDoc(economicsDoc)) {
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

/**
 * ProductPerformanceComparisonService.js
 * 
 * Provides week-on-week (WoW) and month-on-month (MoM) comparison
 * for product performance metrics.
 * 
 * Uses existing data from:
 * - BuyBoxData: sessions, pageViews, conversion, buy box %
 * - EconomicsMetrics: sales, units, gross profit
 * - ProductWiseSponsoredAds: PPC spend, sales, impressions, clicks
 */

const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Comparison period types
 */
const COMPARISON_TYPES = {
    WOW: 'wow',   // Week-on-week
    MOM: 'mom',   // Month-on-month
    NONE: 'none' // No comparison (current period only)
};

/**
 * Calculate the previous period date range based on comparison type
 * @param {string} startDate - Current period start date (YYYY-MM-DD)
 * @param {string} endDate - Current period end date (YYYY-MM-DD)
 * @param {string} comparisonType - 'wow' or 'mom'
 * @returns {Object} { prevStartDate, prevEndDate }
 */
function calculatePreviousPeriod(startDate, endDate, comparisonType) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const periodDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    
    let prevStart, prevEnd;
    
    if (comparisonType === COMPARISON_TYPES.WOW) {
        // Previous week: shift back 7 days
        prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1); // Day before current start
        prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - periodDays + 1);
    } else if (comparisonType === COMPARISON_TYPES.MOM) {
        // Previous month: shift back ~30 days (match period length)
        prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1);
        prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - periodDays + 1);
    } else {
        return null;
    }
    
    return {
        prevStartDate: prevStart.toISOString().split('T')[0],
        prevEndDate: prevEnd.toISOString().split('T')[0]
    };
}

/**
 * Calculate percentage change between two values
 * @param {number} current - Current value
 * @param {number} previous - Previous value
 * @returns {number|null} Percentage change or null if previous is 0
 */
function calculatePercentChange(current, previous) {
    if (previous === 0 || previous === null || previous === undefined) {
        // If previous is 0 and current > 0, that's "infinite" growth
        // Return null to indicate "new" or "N/A"
        return current > 0 ? null : 0;
    }
    return ((current - previous) / previous) * 100;
}

/**
 * Fetch previous period BuyBox data for comparison
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} country - Country
 * @param {string} comparisonType - 'wow' or 'mom'
 * @param {Object} currentBuyBoxData - Current period BuyBox data (for date range)
 * @returns {Promise<Object|null>} Previous period BuyBox data or null
 */
async function fetchPreviousBuyBoxData(userId, region, country, comparisonType, currentBuyBoxData) {
    if (!currentBuyBoxData?.dateRange || comparisonType === COMPARISON_TYPES.NONE) {
        logger.info('fetchPreviousBuyBoxData: Skipping - no dateRange or comparison is NONE', { 
            hasDateRange: !!currentBuyBoxData?.dateRange, 
            comparisonType 
        });
        return null;
    }
    
    try {
        // Get the list of all BuyBox documents for this user, sorted by date
        logger.info('fetchPreviousBuyBoxData: Querying BuyBoxData', { userId, region, country, comparisonType });
        const allDocs = await BuyBoxData.find({
            User: userId,
            region: region,
            country: country
        }).sort({ createdAt: -1 }).lean();
        
        logger.info('fetchPreviousBuyBoxData: Found documents', { 
            count: allDocs.length,
            dates: allDocs.slice(0, 3).map(d => ({ createdAt: d.createdAt, dateRange: d.dateRange }))
        });
        
        if (allDocs.length < 2) {
            // No previous period data available
            logger.info('No previous BuyBox data for comparison - need at least 2 docs', { userId, region, country, docsFound: allDocs.length });
            return null;
        }
        
        // The latest doc is current; find the previous one
        // For WoW, we want the doc from ~7 days ago; for MoM, ~30 days ago
        const currentCreatedAt = new Date(allDocs[0].createdAt);
        const targetDaysBack = comparisonType === COMPARISON_TYPES.WOW ? 7 : 30;
        const targetDate = new Date(currentCreatedAt);
        targetDate.setDate(targetDate.getDate() - targetDaysBack);
        
        // Find the closest doc to the target date
        let closestDoc = null;
        let closestDiff = Infinity;
        
        for (let i = 1; i < allDocs.length; i++) {
            const docDate = new Date(allDocs[i].createdAt);
            const diff = Math.abs(docDate - targetDate);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestDoc = allDocs[i];
            }
        }
        
        // Accept if within 3 days of target for WoW, 7 days for MoM
        const maxDiffDays = comparisonType === COMPARISON_TYPES.WOW ? 3 : 7;
        if (closestDoc && closestDiff <= maxDiffDays * 24 * 60 * 60 * 1000) {
            return closestDoc;
        }
        
        // Fall back to just using the second-most-recent doc
        return allDocs[1];
    } catch (error) {
        logger.error('Error fetching previous BuyBox data', { userId, error: error.message });
        return null;
    }
}

/**
 * Fetch previous period Economics data for comparison
 * @param {string} userId - User ID
 * @param {string} region - Region
 * @param {string} country - Country
 * @param {string} comparisonType - 'wow' or 'mom'
 * @param {Object} currentEconomicsData - Current period Economics data
 * @returns {Promise<Object|null>} Previous period Economics data or null
 */
async function fetchPreviousEconomicsData(userId, region, country, comparisonType, currentEconomicsData) {
    if (!currentEconomicsData?.dateRange || comparisonType === COMPARISON_TYPES.NONE) {
        logger.info('fetchPreviousEconomicsData: Skipping - no dateRange or comparison is NONE', { 
            hasDateRange: !!currentEconomicsData?.dateRange, 
            comparisonType 
        });
        return null;
    }
    
    try {
        logger.info('fetchPreviousEconomicsData: Querying EconomicsMetrics', { userId, region, country, comparisonType });
        const allDocs = await EconomicsMetrics.find({
            User: userId,
            region: region,
            country: country
        }).sort({ createdAt: -1 }).lean();
        
        logger.info('fetchPreviousEconomicsData: Found documents', { 
            count: allDocs.length,
            dates: allDocs.slice(0, 3).map(d => ({ createdAt: d.createdAt, dateRange: d.dateRange }))
        });
        
        if (allDocs.length < 2) {
            logger.info('No previous Economics data for comparison - need at least 2 docs', { userId, region, country, docsFound: allDocs.length });
            return null;
        }
        
        const currentCreatedAt = new Date(allDocs[0].createdAt);
        const targetDaysBack = comparisonType === COMPARISON_TYPES.WOW ? 7 : 30;
        const targetDate = new Date(currentCreatedAt);
        targetDate.setDate(targetDate.getDate() - targetDaysBack);
        
        let closestDoc = null;
        let closestDiff = Infinity;
        
        for (let i = 1; i < allDocs.length; i++) {
            const docDate = new Date(allDocs[i].createdAt);
            const diff = Math.abs(docDate - targetDate);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestDoc = allDocs[i];
            }
        }
        
        const maxDiffDays = comparisonType === COMPARISON_TYPES.WOW ? 3 : 7;
        if (closestDoc && closestDiff <= maxDiffDays * 24 * 60 * 60 * 1000) {
            return closestDoc;
        }
        
        return allDocs[1];
    } catch (error) {
        logger.error('Error fetching previous Economics data', { userId, error: error.message });
        return null;
    }
}

/**
 * Build comparison data for a single product
 * @param {Object} currentPerformance - Current period performance metrics
 * @param {Object} previousPerformance - Previous period performance metrics (or null)
 * @returns {Object} Comparison object with deltas and percent changes
 */
function buildProductComparison(currentPerformance, previousPerformance) {
    if (!previousPerformance) {
        return {
            hasComparison: false,
            previous: null,
            changes: null
        };
    }
    
    const changes = {
        sessions: {
            delta: (currentPerformance.sessions || 0) - (previousPerformance.sessions || 0),
            percentChange: calculatePercentChange(currentPerformance.sessions || 0, previousPerformance.sessions || 0)
        },
        pageViews: {
            delta: (currentPerformance.pageViews || 0) - (previousPerformance.pageViews || 0),
            percentChange: calculatePercentChange(currentPerformance.pageViews || 0, previousPerformance.pageViews || 0)
        },
        conversionRate: {
            delta: (currentPerformance.conversionRate || 0) - (previousPerformance.conversionRate || 0),
            percentChange: calculatePercentChange(currentPerformance.conversionRate || 0, previousPerformance.conversionRate || 0)
        },
        sales: {
            delta: (currentPerformance.sales || 0) - (previousPerformance.sales || 0),
            percentChange: calculatePercentChange(currentPerformance.sales || 0, previousPerformance.sales || 0)
        },
        unitsSold: {
            delta: (currentPerformance.unitsSold || 0) - (previousPerformance.unitsSold || 0),
            percentChange: calculatePercentChange(currentPerformance.unitsSold || 0, previousPerformance.unitsSold || 0)
        },
        ppcSpend: {
            delta: (currentPerformance.ppcSpend || 0) - (previousPerformance.ppcSpend || 0),
            percentChange: calculatePercentChange(currentPerformance.ppcSpend || 0, previousPerformance.ppcSpend || 0)
        },
        acos: {
            delta: (currentPerformance.acos || 0) - (previousPerformance.acos || 0),
            percentChange: null // ACOS change is the delta itself (percentage points)
        }
    };
    
    return {
        hasComparison: true,
        previous: previousPerformance,
        changes
    };
}

/**
 * Aggregate previous period performance per ASIN from BuyBox and Economics data
 * @param {Object} prevBuyBoxData - Previous period BuyBox data
 * @param {Object} prevEconomicsData - Previous period Economics data
 * @param {Array} prevPpcData - Previous period PPC data (optional)
 * @returns {Map<string, Object>} Map of ASIN -> previous performance
 */
function aggregatePreviousPerformance(prevBuyBoxData, prevEconomicsData, prevPpcData = []) {
    const prevPerfMap = new Map();
    
    // BuyBox data
    if (prevBuyBoxData?.asinBuyBoxData) {
        prevBuyBoxData.asinBuyBoxData.forEach(item => {
            const asin = (item.childAsin || item.parentAsin || '').trim().toUpperCase();
            if (asin) {
                prevPerfMap.set(asin, {
                    sessions: item.sessions || 0,
                    pageViews: item.pageViews || 0,
                    conversionRate: item.unitSessionPercentage || 0,
                    buyBoxPercentage: item.buyBoxPercentage || 0,
                    sales: item.sales?.amount || 0,
                    unitsSold: item.unitsOrdered || 0,
                    ppcSpend: 0,
                    ppcSales: 0,
                    acos: 0
                });
            }
        });
    }
    
    // Economics data
    if (prevEconomicsData?.asinWiseSales) {
        prevEconomicsData.asinWiseSales.forEach(item => {
            const asin = (item.asin || '').trim().toUpperCase();
            if (asin) {
                const existing = prevPerfMap.get(asin) || {
                    sessions: 0,
                    pageViews: 0,
                    conversionRate: 0,
                    buyBoxPercentage: 0,
                    sales: 0,
                    unitsSold: 0,
                    ppcSpend: 0,
                    ppcSales: 0,
                    acos: 0
                };
                // Prefer Economics sales if available (more accurate)
                if (item.sales?.amount) {
                    existing.sales = item.sales.amount;
                }
                if (item.unitsSold) {
                    existing.unitsSold = item.unitsSold;
                }
                prevPerfMap.set(asin, existing);
            }
        });
    }
    
    // PPC data (aggregate by ASIN)
    if (Array.isArray(prevPpcData)) {
        prevPpcData.forEach(item => {
            const asin = (item.asin || '').trim().toUpperCase();
            if (asin) {
                const existing = prevPerfMap.get(asin) || {
                    sessions: 0,
                    pageViews: 0,
                    conversionRate: 0,
                    buyBoxPercentage: 0,
                    sales: 0,
                    unitsSold: 0,
                    ppcSpend: 0,
                    ppcSales: 0,
                    acos: 0
                };
                existing.ppcSpend += item.spend || 0;
                existing.ppcSales += item.salesIn7Days || item.salesIn14Days || item.salesIn30Days || 0;
                if (existing.ppcSales > 0) {
                    existing.acos = (existing.ppcSpend / existing.ppcSales) * 100;
                }
                prevPerfMap.set(asin, existing);
            }
        });
    }
    
    return prevPerfMap;
}

/**
 * Enrich products with comparison data
 * @param {Array} products - Products with current performance
 * @param {Map} previousPerfMap - Map of ASIN -> previous performance
 * @param {string} comparisonType - 'wow', 'mom', or 'none'
 * @returns {Array} Products with added 'comparison' property
 */
function enrichProductsWithComparison(products, previousPerfMap, comparisonType) {
    return products.map(product => {
        const asin = (product.asin || '').trim().toUpperCase();
        const currentPerf = product.performance || {};
        const previousPerf = previousPerfMap.get(asin) || null;
        
        const comparison = buildProductComparison(currentPerf, previousPerf);
        comparison.type = comparisonType;
        
        return {
            ...product,
            comparison
        };
    });
}

/**
 * Main function: Fetch comparison data and enrich products
 * @param {Object} params - Parameters
 * @param {string} params.userId - User ID
 * @param {string} params.region - Region
 * @param {string} params.country - Country
 * @param {string} params.comparisonType - 'wow', 'mom', or 'none'
 * @param {Object} params.currentBuyBoxData - Current BuyBox data
 * @param {Object} params.currentEconomicsData - Current Economics data
 * @param {Array} params.products - Products with current performance
 * @returns {Promise<Object>} { products: [...with comparison], comparisonMeta: {...} }
 */
async function fetchAndEnrichWithComparison({
    userId,
    region,
    country,
    comparisonType = COMPARISON_TYPES.NONE,
    currentBuyBoxData,
    currentEconomicsData,
    products
}) {
    logger.info('fetchAndEnrichWithComparison called', { 
        userId, 
        region, 
        country, 
        comparisonType,
        productsCount: products?.length || 0,
        hasBuyBoxData: !!currentBuyBoxData,
        hasEconomicsData: !!currentEconomicsData,
        buyBoxDateRange: currentBuyBoxData?.dateRange,
        economicsDateRange: currentEconomicsData?.dateRange
    });
    
    if (comparisonType === COMPARISON_TYPES.NONE || !products || products.length === 0) {
        logger.info('fetchAndEnrichWithComparison: Skipping - comparison is NONE or no products', { comparisonType, productsCount: products?.length });
        return {
            products,
            comparisonMeta: {
                type: COMPARISON_TYPES.NONE,
                hasComparison: false,
                currentPeriod: currentBuyBoxData?.dateRange || null,
                previousPeriod: null
            }
        };
    }
    
    logger.info('Fetching comparison data', { userId, region, country, comparisonType });
    
    // Fetch previous period data
    const [prevBuyBoxData, prevEconomicsData] = await Promise.all([
        fetchPreviousBuyBoxData(userId, region, country, comparisonType, currentBuyBoxData),
        fetchPreviousEconomicsData(userId, region, country, comparisonType, currentEconomicsData)
    ]);
    
    logger.info('fetchAndEnrichWithComparison: Previous data fetch results', {
        hasPrevBuyBox: !!prevBuyBoxData,
        hasPrevEconomics: !!prevEconomicsData,
        prevBuyBoxAsinCount: prevBuyBoxData?.asinBuyBoxData?.length || 0,
        prevEconomicsAsinCount: prevEconomicsData?.asinWiseSales?.length || 0
    });
    
    if (!prevBuyBoxData && !prevEconomicsData) {
        logger.info('fetchAndEnrichWithComparison: No previous data found - returning without comparison');
        return {
            products,
            comparisonMeta: {
                type: comparisonType,
                hasComparison: false,
                currentPeriod: currentBuyBoxData?.dateRange || null,
                previousPeriod: null,
                reason: 'No previous period data available'
            }
        };
    }
    
    // Aggregate previous performance
    const previousPerfMap = aggregatePreviousPerformance(prevBuyBoxData, prevEconomicsData);
    
    logger.info('fetchAndEnrichWithComparison: Aggregated previous performance', {
        previousPerfMapSize: previousPerfMap.size,
        sampleAsins: Array.from(previousPerfMap.keys()).slice(0, 5)
    });
    
    // Enrich products with comparison
    const enrichedProducts = enrichProductsWithComparison(products, previousPerfMap, comparisonType);
    
    // Log sample of enriched products
    const productsWithComparison = enrichedProducts.filter(p => p.comparison?.hasComparison);
    logger.info('fetchAndEnrichWithComparison: Enrichment complete', {
        totalProducts: enrichedProducts.length,
        productsWithComparison: productsWithComparison.length,
        sampleComparison: productsWithComparison[0]?.comparison?.changes ? {
            asin: productsWithComparison[0]?.asin,
            sessionsDelta: productsWithComparison[0]?.comparison?.changes?.sessions?.delta,
            sessionsPercent: productsWithComparison[0]?.comparison?.changes?.sessions?.percentChange
        } : null
    });
    
    return {
        products: enrichedProducts,
        comparisonMeta: {
            type: comparisonType,
            hasComparison: true,
            currentPeriod: currentBuyBoxData?.dateRange || currentEconomicsData?.dateRange || null,
            previousPeriod: prevBuyBoxData?.dateRange || prevEconomicsData?.dateRange || null
        }
    };
}

module.exports = {
    COMPARISON_TYPES,
    calculatePreviousPeriod,
    calculatePercentChange,
    fetchPreviousBuyBoxData,
    fetchPreviousEconomicsData,
    buildProductComparison,
    aggregatePreviousPerformance,
    enrichProductsWithComparison,
    fetchAndEnrichWithComparison
};

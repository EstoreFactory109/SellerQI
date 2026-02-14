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

module.exports = {
    aggregateProductPerformance,
    enrichProductsWithPerformance
};

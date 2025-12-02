/**
 * Sponsored Ads Calculation Service
 * 
 * Calculates sponsored ads metrics including total cost, sales, and negative keywords metrics.
 */

/**
 * Calculate total cost and total sales in 30 days from sponsored ads data
 * @param {Array} productWiseSponsoredAds - Array of sponsored ads data
 * @returns {Object} Object containing totalCost, totalSalesIn30Days, and totalProductsPurchased
 */
const calculateSponsoredAdsMetrics = (productWiseSponsoredAds) => {
    // Initialize totals
    let totalCost = 0;
    let totalSalesIn30Days = 0;
    let totalProductsPurchased = 0;

    // Validate input
    if (!Array.isArray(productWiseSponsoredAds)) {
        console.warn('productWiseSponsoredAds is not an array, returning zero values');
        return {
            totalCost: 0,
            totalSalesIn30Days: 0,
            totalProductsPurchased: 0
        };
    }

    // Iterate through each sponsored ad item
    productWiseSponsoredAds.forEach((item) => {
        // Add spend (cost) to total cost
        if (item.spend !== undefined && item.spend !== null) {
            totalCost += parseFloat(String(item.spend)) || 0;
        }

        // Add sales in 30 days to total
        if (item.salesIn30Days !== undefined && item.salesIn30Days !== null) {
            totalSalesIn30Days += parseFloat(String(item.salesIn30Days)) || 0;
        }

        // Add purchased in 30 days to total
        if (item.purchasedIn30Days !== undefined && item.purchasedIn30Days !== null) {
            totalProductsPurchased += parseFloat(String(item.purchasedIn30Days)) || 0;
        }
    });
    
    const finalMetrics = {
        totalCost: parseFloat(totalCost.toFixed(2)),
        totalSalesIn30Days: parseFloat(totalSalesIn30Days.toFixed(2)),
        totalProductsPurchased: parseFloat(totalProductsPurchased.toFixed(2))
    };
    
    // Return the calculated totals
    return finalMetrics;
};

/**
 * Calculate negative keywords metrics by joining with adsKeywordsPerformanceData
 * @param {Array} negativeKeywords - Array of negative keywords with structure: {adGroupId, campaignId, keywordId, keywordText, state}
 * @param {Array} adsKeywordsPerformanceData - Array of keyword performance data with attributedSales30d and cost
 * @returns {Array} Array of objects containing keyword, campaignName, sales, spend, and ACOS
 */
const calculateNegativeKeywordsMetrics = (negativeKeywords, adsKeywordsPerformanceData) => {
    // Validate inputs
    if (!Array.isArray(negativeKeywords) || !Array.isArray(adsKeywordsPerformanceData)) {
        console.warn('Invalid input: negativeKeywords or adsKeywordsPerformanceData is not an array');
        return [];
    }

    // Create a map for faster lookup of keyword performance data (keeping this for potential future use)
    const keywordPerformanceMap = new Map();
    
    adsKeywordsPerformanceData.forEach(item => {
        // Create a unique key using keyword text and campaign name for better matching
        const key = `${item.keyword?.toLowerCase()}-${item.campaignName?.toLowerCase()}`;
        keywordPerformanceMap.set(key, {
            keyword: item.keyword,
            campaignName: item.campaignName,
            campaignId: item.campaignId,
            attributedSales30d: parseFloat(String(item.attributedSales30d)) || 0,
            cost: parseFloat(String(item.cost)) || 0,
            clicks: item.clicks || 0,
            impressions: item.impressions || 0,
            matchType: item.matchType
        });
    });

    // Join negative keywords with their performance data
    const result = negativeKeywords.map((keyword) => {
        const { keywordText, campaignId } = keyword;
        
        // First, try to find exact match by keyword and campaign ID
        let performanceData = adsKeywordsPerformanceData.find(perf => 
            perf.keyword?.toLowerCase() === keywordText?.toLowerCase() && 
            perf.campaignId === campaignId
        );
        
        // If not found, try to find by keyword text only (fallback)
        if (!performanceData) {
            performanceData = adsKeywordsPerformanceData.find(perf => 
                perf.keyword?.toLowerCase() === keywordText?.toLowerCase()
            );
        }
        
        // If still not found, try partial matching (more fuzzy)
        if (!performanceData) {
            performanceData = adsKeywordsPerformanceData.find(perf => 
                perf.keyword?.toLowerCase().includes(keywordText?.toLowerCase() || '') ||
                keywordText?.toLowerCase().includes(perf.keyword?.toLowerCase() || '')
            );
        }
        
        if (!performanceData) {
            return {
                keyword: keywordText || '',
                campaignName: 'No Campaign Found',
                sales: 0,
                spend: 0,
                acos: 0
            };
        }
        
        const attributedSales30d = parseFloat(String(performanceData.attributedSales30d)) || 0;
        const cost = parseFloat(String(performanceData.cost)) || 0;
        
        // Calculate ACOS using adsKeywordsPerformanceData
        // ACOS = (cost / attributedSales30d) * 100
        const acos = attributedSales30d > 0 
            ? (cost / attributedSales30d) * 100 
            : 0;
        
        const matchedKeyword = {
            keyword: keywordText || '',
            campaignName: performanceData.campaignName || 'Unknown Campaign',
            sales: parseFloat(attributedSales30d.toFixed(2)),
            spend: parseFloat(cost.toFixed(2)),
            acos: parseFloat(acos.toFixed(2))
        };
        
        return matchedKeyword;
    });
    
    return result;
};

module.exports = {
    calculateSponsoredAdsMetrics,
    calculateNegativeKeywordsMetrics
};


/**
 * Calculate total cost and total sales in 30 days from sponsored ads data
 * @param {Array} productWiseSponsoredAds - Array of sponsored ads data with the same structure as in profitability data
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
    productWiseSponsoredAds.forEach(item => {
        // Add spend (cost) to total cost
        if (item.spend !== undefined && item.spend !== null) {
            totalCost += parseFloat(item.spend) || 0;
        }

        // Add sales in 30 days to total
        if (item.salesIn30Days !== undefined && item.salesIn30Days !== null) {
            totalSalesIn30Days += parseFloat(item.salesIn30Days) || 0;
        }

        // Add purchased in 30 days to total
        if (item.purchasedIn30Days !== undefined && item.purchasedIn30Days !== null) {
            totalProductsPurchased += parseFloat(item.purchasedIn30Days) || 0;
        }
    });

    // Return the calculated totals
    return {
        totalCost: parseFloat(totalCost.toFixed(2)),
        totalSalesIn30Days: parseFloat(totalSalesIn30Days.toFixed(2)),
        totalProductsPurchased: parseFloat(totalProductsPurchased.toFixed(2))
    };
};

/**
 * Calculate negative keywords metrics by joining with sponsored ads data
 * @param {Array} negativeKeywords - Array of negative keywords with structure: {adGroupId, campaignId, keywordId, keywordText, state}
 * @param {Array} productWiseSponsoredAds - Array of sponsored ads data
 * @returns {Array} Array of objects containing keyword, campaignName, sales, spend, and ACOS
 */
const calculateNegativeKeywordsMetrics = (negativeKeywords, productWiseSponsoredAds) => {
    // Validate inputs
    if (!Array.isArray(negativeKeywords) || !Array.isArray(productWiseSponsoredAds)) {
        console.warn('Invalid input: negativeKeywords or productWiseSponsoredAds is not an array');
        return [];
    }

    // Create a map to aggregate sponsored ads data by campaignId
    const campaignDataMap = new Map();
    
    productWiseSponsoredAds.forEach(item => {
        const { campaignId, campaignName, spend, salesIn30Days } = item;
        
        if (!campaignDataMap.has(campaignId)) {
            campaignDataMap.set(campaignId, {
                campaignName: campaignName,
                totalSpend: 0,
                totalSales: 0
            });
        }
        
        const existing = campaignDataMap.get(campaignId);
        existing.totalSpend += parseFloat(spend) || 0;
        existing.totalSales += parseFloat(salesIn30Days) || 0;
    });

    // Join negative keywords with campaign data
    const result = negativeKeywords.map(keyword => {
        const { keywordText, campaignId } = keyword;
        const campaignData = campaignDataMap.get(campaignId);
        
        if (!campaignData) {
            // No matching campaign data found
            return {
                keyword: keywordText,
                campaignName: '',
                sales: 0,
                spend: 0,
                acos: 0
            };
        }
        
        // Calculate ACOS (Advertising Cost of Sales)
        // ACOS = (Spend / Sales) * 100
        const acos = campaignData.totalSales > 0 
            ? (campaignData.totalSpend / campaignData.totalSales) * 100 
            : 0;
        
        return {
            keyword: keywordText,
            campaignName: campaignData.campaignName,
            sales: parseFloat(campaignData.totalSales.toFixed(2)),
            spend: parseFloat(campaignData.totalSpend.toFixed(2)),
            acos: parseFloat(acos.toFixed(2))
        };
    });
    
    return result;
};

export default calculateSponsoredAdsMetrics;
export { calculateNegativeKeywordsMetrics };

/**
 * Calculate total cost and total sales in 30 days from sponsored ads data
 * @param {Array} productWiseSponsoredAds - Array of sponsored ads data with the same structure as in profitability data
 * @returns {Object} Object containing totalCost, totalSalesIn30Days, and totalProductsPurchased
 */
const calculateSponsoredAdsMetrics = (productWiseSponsoredAds) => {
    console.log("=== CALCULATING SPONSORED ADS METRICS ===");
    console.log("productWiseSponsoredAds: ", productWiseSponsoredAds);
    // Initialize totals
    console.log("productWiseSponsoredAds: ", productWiseSponsoredAds);
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
    console.log("totalSalesIn30Days: ", totalSalesIn30Days);
    
    const finalMetrics = {
        totalCost: parseFloat(totalCost.toFixed(2)),
        totalSalesIn30Days: parseFloat(totalSalesIn30Days.toFixed(2)),
        totalProductsPurchased: parseFloat(totalProductsPurchased.toFixed(2))
    };
    
    console.log("Final sponsored ads metrics for ACOS calculation:", finalMetrics);
    
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

    console.log('=== Calculating Negative Keywords Metrics ===');
    console.log('Negative Keywords:', negativeKeywords.length);
    console.log('Ads Keywords Performance Data:', adsKeywordsPerformanceData.length);
    
    // Debug: Show structure of both datasets
    console.log('\n=== Data Structure Analysis ===');
    if (negativeKeywords.length > 0) {
        console.log('Sample Negative Keyword:', negativeKeywords[0]);
        console.log('Negative Keywords Sample (first 3):', negativeKeywords.slice(0, 3).map(k => ({
            keywordText: k.keywordText,
            campaignId: k.campaignId,
            adGroupId: k.adGroupId
        })));
    }
    
    if (adsKeywordsPerformanceData.length > 0) {
        console.log('Sample Ads Performance Data:', adsKeywordsPerformanceData[0]);
        console.log('Ads Performance Sample (first 3):', adsKeywordsPerformanceData.slice(0, 3).map(k => ({
            keyword: k.keyword,
            campaignId: k.campaignId,
            campaignName: k.campaignName,
            cost: k.cost,
            attributedSales30d: k.attributedSales30d
        })));
    }
    
    // Show unique campaign IDs from both datasets for comparison
    const negativeKeywordCampaignIds = [...new Set(negativeKeywords.map(k => k.campaignId))];
    const performanceDataCampaignIds = [...new Set(adsKeywordsPerformanceData.map(k => k.campaignId))];
    
    console.log('Negative Keywords Campaign IDs (unique):', negativeKeywordCampaignIds.slice(0, 10));
    console.log('Performance Data Campaign IDs (unique):', performanceDataCampaignIds.slice(0, 10));
    console.log('Common Campaign IDs:', negativeKeywordCampaignIds.filter(id => performanceDataCampaignIds.includes(id)).slice(0, 10));

    // Create a map for faster lookup of keyword performance data (keeping this for potential future use)
    const keywordPerformanceMap = new Map();
    
    adsKeywordsPerformanceData.forEach(item => {
        // Create a unique key using keyword text and campaign name for better matching
        const key = `${item.keyword?.toLowerCase()}-${item.campaignName?.toLowerCase()}`;
        keywordPerformanceMap.set(key, {
            keyword: item.keyword,
            campaignName: item.campaignName,
            campaignId: item.campaignId,
            attributedSales30d: parseFloat(item.attributedSales30d) || 0,
            cost: parseFloat(item.cost) || 0,
            clicks: item.clicks || 0,
            impressions: item.impressions || 0,
            matchType: item.matchType
        });
    });

    // Join negative keywords with their performance data
    const result = negativeKeywords.map((keyword, index) => {
        const { keywordText, campaignId } = keyword;
        
        console.log(`\n=== Processing Negative Keyword ${index + 1} ===`);
        console.log('Negative Keyword Input:', {
            keywordText: keywordText,
            campaignId: campaignId,
            fullKeywordObject: keyword
        });
        
        // First, try to find exact match by keyword and campaign ID
        let performanceData = adsKeywordsPerformanceData.find(perf => 
            perf.keyword?.toLowerCase() === keywordText?.toLowerCase() && 
            perf.campaignId === campaignId
        );
        
        console.log('Exact match (keyword + campaignId):', performanceData ? 'FOUND' : 'NOT FOUND');
        
        // If not found, try to find by keyword text only (fallback)
        if (!performanceData) {
            performanceData = adsKeywordsPerformanceData.find(perf => 
                perf.keyword?.toLowerCase() === keywordText?.toLowerCase()
            );
            console.log('Fallback match (keyword only):', performanceData ? 'FOUND' : 'NOT FOUND');
            
            if (performanceData) {
                console.log('Fallback match details:', {
                    foundKeyword: performanceData.keyword,
                    foundCampaignId: performanceData.campaignId,
                    foundCampaignName: performanceData.campaignName
                });
            }
        }
        
        // If still not found, try partial matching (more fuzzy)
        if (!performanceData) {
            performanceData = adsKeywordsPerformanceData.find(perf => 
                perf.keyword?.toLowerCase().includes(keywordText?.toLowerCase()) ||
                keywordText?.toLowerCase().includes(perf.keyword?.toLowerCase())
            );
            console.log('Fuzzy match (partial):', performanceData ? 'FOUND' : 'NOT FOUND');
            
            if (performanceData) {
                console.log('Fuzzy match details:', {
                    searchedKeyword: keywordText,
                    foundKeyword: performanceData.keyword,
                    foundCampaignName: performanceData.campaignName
                });
            }
        }
        
        if (!performanceData) {
            console.log(`❌ NO MATCH FOUND for negative keyword: "${keywordText}"`);
            console.log('Available keywords sample:', adsKeywordsPerformanceData.slice(0, 5).map(k => ({
                keyword: k.keyword,
                campaignId: k.campaignId,
                campaignName: k.campaignName
            })));
            
            return {
                keyword: keywordText,
                campaignName: 'No Campaign Found',
                sales: 0,
                spend: 0,
                acos: 0
            };
        }
        
        const attributedSales30d = parseFloat(performanceData.attributedSales30d) || 0;
        const cost = parseFloat(performanceData.cost) || 0;
        
        // Calculate ACOS using adsKeywordsPerformanceData
        // ACOS = (cost / attributedSales30d) * 100
        const acos = attributedSales30d > 0 
            ? (cost / attributedSales30d) * 100 
            : 0;
        
        const matchedKeyword = {
            keyword: keywordText,
            campaignName: performanceData.campaignName || 'Unknown Campaign',
            sales: parseFloat(attributedSales30d.toFixed(2)),
            spend: parseFloat(cost.toFixed(2)),
            acos: parseFloat(acos.toFixed(2))
        };
        
        console.log(`✅ Negative Keyword Successfully Matched:`, {
            originalKeyword: keywordText,
            matchedKeyword: performanceData.keyword,
            campaignName: performanceData.campaignName,
            attributedSales30d: attributedSales30d,
            cost: cost,
            acos: acos.toFixed(2) + '%'
        });
        
        return matchedKeyword;
    });
    
    console.log('=== Negative Keywords Metrics Result ===');
    console.log('Total processed:', result.length);
    console.log('Sample results:', result.slice(0, 3));
    
    // Summary statistics
    const successfulMatches = result.filter(r => r.campaignName && r.campaignName !== 'No Campaign Found' && r.campaignName !== 'Unknown Campaign').length;
    const failedMatches = result.length - successfulMatches;
    const missingCampaignNames = result.filter(r => !r.campaignName || r.campaignName === 'No Campaign Found' || r.campaignName === 'Unknown Campaign');
    
    console.log('\n=== Matching Summary ===');
    console.log(`✅ Successful matches with campaign names: ${successfulMatches}`);
    console.log(`❌ Failed matches (missing campaign names): ${failedMatches}`);
    console.log('Keywords with missing campaign names:', missingCampaignNames.map(k => k.keyword));
    
    return result;
};

export default calculateSponsoredAdsMetrics;
export { calculateNegativeKeywordsMetrics };

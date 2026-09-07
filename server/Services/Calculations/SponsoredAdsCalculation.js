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

        const salesVal = item.sales ?? item.salesIn30Days;
        if (salesVal !== undefined && salesVal !== null) {
            totalSalesIn30Days += parseFloat(String(salesVal)) || 0;
        }

        const purchasedVal = item.purchases ?? item.purchasedIn30Days;
        if (purchasedVal !== undefined && purchasedVal !== null) {
            totalProductsPurchased += parseFloat(String(purchasedVal)) || 0;
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

    // WHY THIS IS INDEXED RATHER THAN SCANNED
    //
    // This used to be three `adsKeywordsPerformanceData.find(...)` calls INSIDE
    // `negativeKeywords.map(...)`, each re-lowercasing both sides on every comparison. That is
    // O(negative keywords × performance rows), and it is not a theoretical cost: one production
    // account carries 379,401 negative keywords (38 chunks) against 117,108 performance rows —
    // ~44 TRILLION comparisons per pass, each allocating one or two throwaway strings. At any
    // plausible rate that is not "slow", it is "never finishes".
    //
    // It ran inside `sched_calc_review`, synchronously, so it blocked the worker's event loop
    // outright: no lock extension, no heartbeat, BullMQ stall-reclaiming the job every 20 minutes
    // and failing it after three attempts, for over a week. Other accounts finished the same phase
    // in 17 seconds. The billions of short-lived lowercase strings are also the likeliest source
    // of the worker RSS sitting near 1.7GB while the live heap stayed small.
    //
    // The lookups below return exactly what `Array#find` returned — first match wins, and
    // `undefined` is a legal Map key so rows with no keyword or campaignId behave as the `?.`
    // comparisons did.

    // Lower-case each performance keyword ONCE instead of once per pair.
    const perfRows = adsKeywordsPerformanceData.map((perf) => ({ perf, kw: perf.keyword?.toLowerCase() }));

    const byKeywordAndCampaign = new Map(); // kw -> Map(campaignId -> perf)
    const byKeyword = new Map();            // kw -> perf
    for (const { perf, kw } of perfRows) {
        if (!byKeyword.has(kw)) byKeyword.set(kw, perf);
        let byCampaign = byKeywordAndCampaign.get(kw);
        if (!byCampaign) { byCampaign = new Map(); byKeywordAndCampaign.set(kw, byCampaign); }
        if (!byCampaign.has(perf.campaignId)) byCampaign.set(perf.campaignId, perf);
    }

    // The fuzzy fallback depends ONLY on the keyword text, never on the campaign, so its answer is
    // identical for every negative keyword sharing one. That account's 379,401 rows carry just
    // 2,450 distinct texts, so caching turns the one genuinely O(n×m) pass into ~287 million
    // comparisons instead of trillions — and it only runs for texts that matched nothing exactly.
    // Measured end to end on that account: the phase went from never completing to 115 seconds.
    const fuzzyCache = new Map();
    const findFuzzyMatch = (kwLower) => {
        if (!fuzzyCache.has(kwLower)) {
            fuzzyCache.set(kwLower, perfRows.find(({ kw }) =>
                kw?.includes(kwLower || '') || kwLower?.includes(kw || '')
            )?.perf);
        }
        return fuzzyCache.get(kwLower);
    };

    // Join negative keywords with their performance data
    const result = negativeKeywords.map((keyword) => {
        const { keywordText, campaignId } = keyword;
        const kwLower = keywordText?.toLowerCase();

        // Exact (keyword + campaign), then keyword only, then fuzzy — the original precedence.
        const performanceData = byKeywordAndCampaign.get(kwLower)?.get(campaignId)
            || byKeyword.get(kwLower)
            || findFuzzyMatch(kwLower);

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


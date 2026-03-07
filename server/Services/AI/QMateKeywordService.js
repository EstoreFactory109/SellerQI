const { AsinKeywordRecommendations } = require('../../models/amazon-ads/KeywordRecommendationsModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const logger = require('../../utils/Logger.js');

/**
 * QMateKeywordService - Provides keyword research/opportunity context for Qmate AI
 * Fetches and analyzes keyword recommendations to help users make bidding decisions
 */

/**
 * Get comprehensive keyword context for Qmate
 * @param {string} userId 
 * @param {string} country 
 * @param {string} region 
 * @param {Object} options - { asin: specific ASIN, limit: max keywords per category }
 * @returns {Promise<Object>} Keyword context for AI
 */
async function getQMateKeywordContext(userId, country, region, options = {}) {
    const startTime = Date.now();
    const { asin = null, limit = 50 } = options;

    try {
        // Fetch all ASIN keyword recommendations for the user
        const allAsinKeywords = await AsinKeywordRecommendations.find({
            userId: userId.toString(),
            country,
            region
        }).lean();

        if (!allAsinKeywords || allAsinKeywords.length === 0) {
            return {
                success: true,
                source: 'qmate_keyword_service',
                data: null
            };
        }

        // Get product info for ASINs
        const productInfo = await getProductInfoForAsins(userId, country, region, 
            allAsinKeywords.map(a => a.asin)
        );

        // Process all keywords to extract insights
        const processedData = processKeywordData(allAsinKeywords, productInfo, asin, limit);

        logger.info('[QMateKeywordService] Got keyword context', {
            userId,
            country,
            region,
            duration: Date.now() - startTime,
            totalAsins: allAsinKeywords.length,
            totalKeywords: processedData.summary.totalKeywords
        });

        return {
            success: true,
            source: 'qmate_keyword_service',
            data: processedData
        };

    } catch (error) {
        logger.error('[QMateKeywordService] Error getting keyword context', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get product info for ASINs
 */
async function getProductInfoForAsins(userId, country, region, asins) {
    try {
        const sellerData = await Seller.findOne({ User: userId }).lean();
        if (!sellerData?.sellerAccount) return {};

        const account = sellerData.sellerAccount.find(acc =>
            acc.country === country && acc.region === region
        );
        if (!account?.products) return {};

        const productInfo = {};
        const asinSet = new Set(asins);

        account.products.forEach(product => {
            if (asinSet.has(product.asin)) {
                productInfo[product.asin] = {
                    name: product.itemName || '',
                    sku: product.sku || ''
                };
            }
        });

        return productInfo;
    } catch (error) {
        logger.error('[QMateKeywordService] Error getting product info', { error: error.message });
        return {};
    }
}

/**
 * Process keyword data and extract insights for AI
 */
function processKeywordData(allAsinKeywords, productInfo, filterAsin, limit) {
    const allKeywords = [];
    const asinSummaries = [];
    
    // Process each ASIN's keywords
    for (const asinData of allAsinKeywords) {
        const asin = asinData.asin;
        const product = productInfo[asin] || { name: '', sku: '' };
        const keywords = asinData.keywordTargetList || [];
        
        // Extract BROAD match keywords
        const broadKeywords = [];
        keywords.forEach(kw => {
            if (kw.bidInfo && kw.bidInfo.length > 0) {
                const broadBid = kw.bidInfo.find(b => b.matchType === 'BROAD');
                if (broadBid) {
                    const keywordData = {
                        asin,
                        productName: product.name,
                        keyword: kw.keyword,
                        rank: broadBid.rank || null,
                        bid: broadBid.bid || 0,
                        suggestedBid: broadBid.suggestedBid || null,
                        impressionRank: kw.searchTermImpressionRank || null,
                        impressionShare: kw.searchTermImpressionShare || null,
                        theme: broadBid.theme || '',
                        translation: kw.translation || ''
                    };
                    broadKeywords.push(keywordData);
                    allKeywords.push(keywordData);
                }
            }
        });
        
        // Calculate ASIN summary
        const highRelevanceCount = broadKeywords.filter(k => k.rank && k.rank <= 10).length;
        const highImpressionCount = broadKeywords.filter(k => k.impressionShare && k.impressionShare >= 50).length;
        const avgBid = broadKeywords.length > 0
            ? broadKeywords.reduce((sum, k) => sum + (k.bid || 0), 0) / broadKeywords.length
            : 0;
        
        asinSummaries.push({
            asin,
            productName: product.name,
            totalKeywords: broadKeywords.length,
            highRelevanceCount,
            highImpressionCount,
            avgBid: parseFloat(avgBid.toFixed(2))
        });
    }
    
    // Filter by specific ASIN if requested
    const filteredKeywords = filterAsin
        ? allKeywords.filter(k => k.asin === filterAsin)
        : allKeywords;
    
    // Categorize keywords for bidding recommendations
    const categorizedKeywords = categorizeKeywords(filteredKeywords, limit);
    
    // Calculate overall summary
    const summary = {
        totalAsins: allAsinKeywords.length,
        totalKeywords: allKeywords.length,
        avgBidOverall: allKeywords.length > 0
            ? parseFloat((allKeywords.reduce((sum, k) => sum + (k.bid || 0), 0) / allKeywords.length).toFixed(2))
            : 0,
        highRelevanceTotal: allKeywords.filter(k => k.rank && k.rank <= 10).length,
        highImpressionTotal: allKeywords.filter(k => k.impressionShare && k.impressionShare >= 50).length
    };
    
    return {
        summary,
        asinSummaries: asinSummaries.slice(0, 20),
        ...categorizedKeywords
    };
}

/**
 * Categorize keywords for bidding recommendations
 * Uses Amazon's data + best practices to recommend bid/ignore
 * NOTE: We do NOT slice here - slicing happens at context building level for pagination
 */
function categorizeKeywords(keywords, limit) {
    // High Priority - BID ON THESE (High relevance + good impression share)
    // Criteria: rank <= 10 (highly relevant) AND (impressionShare >= 30 OR rank <= 5)
    const highPriorityKeywordsAll = keywords
        .filter(k => {
            const rank = k.rank || 999;
            const impressionShare = k.impressionShare || 0;
            return rank <= 10 && (impressionShare >= 30 || rank <= 5);
        })
        .sort((a, b) => (a.rank || 999) - (b.rank || 999));
    
    // Medium Priority - CONSIDER BIDDING (Decent relevance OR high impression)
    // Criteria: (rank > 10 AND rank <= 30) OR (impressionShare >= 50 AND rank > 10)
    const mediumPriorityKeywordsAll = keywords
        .filter(k => {
            const rank = k.rank || 999;
            const impressionShare = k.impressionShare || 0;
            const isHighPriority = rank <= 10 && (impressionShare >= 30 || rank <= 5);
            if (isHighPriority) return false;
            return (rank > 10 && rank <= 30) || (impressionShare >= 50 && rank > 10);
        })
        .sort((a, b) => (a.rank || 999) - (b.rank || 999));
    
    // Low Priority - IGNORE OR LOW BID (Poor relevance, low impression share)
    // Criteria: rank > 50 OR (rank > 30 AND impressionShare < 20)
    const lowPriorityKeywordsAll = keywords
        .filter(k => {
            const rank = k.rank || 999;
            const impressionShare = k.impressionShare || 0;
            return rank > 50 || (rank > 30 && impressionShare < 20);
        })
        .sort((a, b) => (b.rank || 0) - (a.rank || 0));
    
    // High Impression Share - Good visibility keywords
    const highImpressionKeywordsAll = keywords
        .filter(k => k.impressionShare && k.impressionShare >= 50)
        .sort((a, b) => (b.impressionShare || 0) - (a.impressionShare || 0));
    
    // Low Competition Opportunities - High relevance but low bid
    // Keywords where your suggested bid is below average but rank is good
    const avgBid = keywords.length > 0
        ? keywords.reduce((sum, k) => sum + (k.bid || 0), 0) / keywords.length
        : 0;
    
    const lowCompetitionKeywordsAll = keywords
        .filter(k => {
            const rank = k.rank || 999;
            const bid = k.bid || 0;
            return rank <= 20 && bid < avgBid * 0.7;
        })
        .sort((a, b) => (a.rank || 999) - (b.rank || 999));
    
    // Expensive Keywords - High bid but may not be worth it
    const expensiveKeywordsAll = keywords
        .filter(k => {
            const bid = k.bid || 0;
            const rank = k.rank || 999;
            return bid > avgBid * 1.5 && rank > 15;
        })
        .sort((a, b) => (b.bid || 0) - (a.bid || 0));
    
    // All keywords for general queries (sorted by rank)
    const allKeywordsSorted = keywords
        .sort((a, b) => (a.rank || 999) - (b.rank || 999));
    
    return {
        highPriorityKeywords: {
            data: highPriorityKeywordsAll,
            total: highPriorityKeywordsAll.length,
            description: 'Keywords you should definitely bid on - high relevance (rank ≤ 10) with good visibility',
            bidRecommendation: 'Bid at or slightly above the suggested median bid for these keywords'
        },
        mediumPriorityKeywords: {
            data: mediumPriorityKeywordsAll,
            total: mediumPriorityKeywordsAll.length,
            description: 'Keywords worth testing - decent relevance or high impression share',
            bidRecommendation: 'Start with the lower end of suggested bid range and adjust based on performance'
        },
        lowPriorityKeywords: {
            data: lowPriorityKeywordsAll,
            total: lowPriorityKeywordsAll.length,
            description: 'Keywords to ignore or bid very low - poor relevance or low visibility',
            bidRecommendation: 'Skip these or use minimum bids only if you have extra budget to test'
        },
        highImpressionKeywords: {
            data: highImpressionKeywordsAll,
            total: highImpressionKeywordsAll.length,
            description: 'Keywords with high impression share (≥50%) - these get good visibility in search results'
        },
        lowCompetitionKeywords: {
            data: lowCompetitionKeywordsAll,
            total: lowCompetitionKeywordsAll.length,
            description: 'Keywords with good relevance but lower-than-average suggested bids - potential opportunities'
        },
        expensiveKeywords: {
            data: expensiveKeywordsAll,
            total: expensiveKeywordsAll.length,
            description: 'Keywords with high suggested bids but mediocre relevance - may not be worth the cost'
        },
        allKeywords: {
            data: allKeywordsSorted,
            total: keywords.length
        }
    };
}

/**
 * Get keyword recommendations for a specific ASIN
 */
async function getKeywordsForAsin(userId, country, region, asin, limit = 50) {
    try {
        const asinData = await AsinKeywordRecommendations.findByAsin(
            userId.toString(), country, region, asin
        );

        if (!asinData) {
            return { success: true, data: null };
        }

        const productInfo = await getProductInfoForAsins(userId, country, region, [asin]);
        const product = productInfo[asin] || { name: '', sku: '' };

        const broadKeywords = [];
        (asinData.keywordTargetList || []).forEach(kw => {
            if (kw.bidInfo && kw.bidInfo.length > 0) {
                const broadBid = kw.bidInfo.find(b => b.matchType === 'BROAD');
                if (broadBid) {
                    broadKeywords.push({
                        asin,
                        productName: product.name,
                        keyword: kw.keyword,
                        rank: broadBid.rank || null,
                        bid: broadBid.bid || 0,
                        suggestedBid: broadBid.suggestedBid || null,
                        impressionRank: kw.searchTermImpressionRank || null,
                        impressionShare: kw.searchTermImpressionShare || null,
                        theme: broadBid.theme || '',
                        translation: kw.translation || ''
                    });
                }
            }
        });

        const categorized = categorizeKeywords(broadKeywords, limit);

        return {
            success: true,
            data: {
                asin,
                productName: product.name,
                totalKeywords: broadKeywords.length,
                ...categorized
            }
        };

    } catch (error) {
        logger.error('[QMateKeywordService] Error getting keywords for ASIN', {
            error: error.message,
            asin
        });
        return { success: false, error: error.message };
    }
}

module.exports = {
    getQMateKeywordContext,
    getKeywordsForAsin,
    getProductInfoForAsins
};

const { AsinKeywordRecommendations } = require('../../models/amazon-ads/KeywordRecommendationsModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const logger = require('../../utils/Logger.js');

/**
 * KeywordOpportunitiesService - Optimized service for Keyword Opportunities page
 * Provides efficient database queries with pagination and aggregation
 */
class KeywordOpportunitiesService {
    
    /**
     * Get product info (name, sku) for a list of ASINs
     * Queries the Seller model to get product details
     * 
     * @param {string} userId 
     * @param {string} country 
     * @param {string} region 
     * @param {Array<string>} asins - List of ASINs to get info for
     * @returns {Object} - Map of asin -> { name, sku }
     */
    static async getProductInfoForAsins(userId, country, region, asins) {
        try {
            if (!asins || asins.length === 0) {
                return {};
            }

            const sellerData = await Seller.findOne({ User: userId }).lean();
            
            if (!sellerData || !sellerData.sellerAccount) {
                return {};
            }

            // Find the account matching country and region
            const account = sellerData.sellerAccount.find(acc => 
                acc.country === country && acc.region === region
            );

            if (!account || !account.products) {
                return {};
            }

            // Build map of asin -> { name, sku } for only the requested ASINs
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
            logger.error("Error in getProductInfoForAsins:", error);
            return {};
        }
    }

    /**
     * Get initial page load data - first ASIN with summary metrics and first page of keywords
     * This is the primary endpoint for initial page load - returns everything needed to render the page
     * Includes productInfo for all ASINs so names/SKUs load immediately
     * 
     * @param {string} userId 
     * @param {string} country 
     * @param {string} region 
     * @param {number} keywordLimit - Number of keywords to return (default 10)
     * @returns {Object} - First ASIN data with summary, paginated keywords, and productInfo
     */
    static async getInitialPageData(userId, country, region, keywordLimit = 10) {
        try {
            // Use aggregation pipeline for optimized query
            const pipeline = [
                // Match user's data
                { $match: { userId, country, region } },
                // Sort by createdAt descending to get most recent first
                { $sort: { createdAt: -1 } },
                // Add computed fields for summary
                {
                    $addFields: {
                        broadKeywords: {
                            $filter: {
                                input: "$keywordTargetList",
                                as: "keyword",
                                cond: {
                                    $gt: [
                                        {
                                            $size: {
                                                $filter: {
                                                    input: { $ifNull: ["$$keyword.bidInfo", []] },
                                                    as: "bid",
                                                    cond: { $eq: ["$$bid.matchType", "BROAD"] }
                                                }
                                            }
                                        },
                                        0
                                    ]
                                }
                            }
                        }
                    }
                },
                // Project only needed fields for list view
                {
                    $project: {
                        asin: 1,
                        totalKeywords: 1,
                        fetchedAt: 1,
                        createdAt: 1,
                        broadKeywordCount: { $size: "$broadKeywords" },
                        // Calculate high relevance (rank <= 10)
                        highRelevanceCount: {
                            $size: {
                                $filter: {
                                    input: "$broadKeywords",
                                    as: "kw",
                                    cond: {
                                        $and: [
                                            { $ne: ["$$kw.bidInfo", null] },
                                            { $gt: [{ $size: { $ifNull: ["$$kw.bidInfo", []] } }, 0] },
                                            {
                                                $lte: [
                                                    { $arrayElemAt: [{ $ifNull: ["$$kw.bidInfo.rank", [null]] }, 0] },
                                                    10
                                                ]
                                            },
                                            {
                                                $ne: [
                                                    { $arrayElemAt: [{ $ifNull: ["$$kw.bidInfo.rank", [null]] }, 0] },
                                                    null
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        },
                        // Calculate high impression (searchTermImpressionShare >= 50)
                        highImpressionCount: {
                            $size: {
                                $filter: {
                                    input: "$broadKeywords",
                                    as: "kw",
                                    cond: {
                                        $and: [
                                            { $ne: ["$$kw.searchTermImpressionShare", null] },
                                            { $gte: ["$$kw.searchTermImpressionShare", 50] }
                                        ]
                                    }
                                }
                            }
                        },
                        // Calculate average bid from BROAD keywords
                        avgBid: {
                            $cond: {
                                if: { $gt: [{ $size: "$broadKeywords" }, 0] },
                                then: {
                                    $avg: {
                                        $map: {
                                            input: "$broadKeywords",
                                            as: "kw",
                                            in: {
                                                $ifNull: [
                                                    { $arrayElemAt: [{ $ifNull: ["$$kw.bidInfo.bid", [0]] }, 0] },
                                                    0
                                                ]
                                            }
                                        }
                                    }
                                },
                                else: 0
                            }
                        }
                    }
                }
            ];

            const allAsins = await AsinKeywordRecommendations.aggregate(pipeline);

            if (!allAsins || allAsins.length === 0) {
                return {
                    success: true,
                    data: {
                        asinsList: [],
                        totalAsins: 0,
                        selectedAsin: null,
                        summary: null,
                        keywords: [],
                        pagination: { page: 1, limit: keywordLimit, totalItems: 0, totalPages: 0, hasMore: false },
                        productInfo: {}
                    }
                };
            }

            // Get first ASIN's details with paginated keywords
            const firstAsin = allAsins[0].asin;
            const keywordsData = await this.getKeywordsForAsin(userId, country, region, firstAsin, 1, keywordLimit);

            // Build ASINs list with summary info
            const asinsList = allAsins.map(item => ({
                asin: item.asin,
                keywordCount: item.broadKeywordCount || 0,
                highRelevanceCount: item.highRelevanceCount || 0,
                highImpressionCount: item.highImpressionCount || 0,
                avgBid: item.avgBid || 0,
                fetchedAt: item.fetchedAt
            }));

            // Get product info (name, sku) for all ASINs - this makes names load immediately
            const allAsinIds = asinsList.map(item => item.asin);
            const productInfo = await this.getProductInfoForAsins(userId, country, region, allAsinIds);

            return {
                success: true,
                data: {
                    asinsList,
                    totalAsins: asinsList.length,
                    selectedAsin: firstAsin,
                    summary: {
                        totalKeywords: keywordsData.data.summary.totalKeywords,
                        avgBid: keywordsData.data.summary.avgBid,
                        highRelevanceCount: keywordsData.data.summary.highRelevanceCount,
                        highImpressionCount: keywordsData.data.summary.highImpressionCount
                    },
                    keywords: keywordsData.data.keywords,
                    pagination: keywordsData.data.pagination,
                    productInfo  // Map of asin -> { name, sku }
                }
            };

        } catch (error) {
            logger.error("Error in getInitialPageData:", error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get keywords for a specific ASIN with pagination
     * Returns paginated keywords with BROAD match type only
     * 
     * @param {string} userId 
     * @param {string} country 
     * @param {string} region 
     * @param {string} asin 
     * @param {number} page 
     * @param {number} limit 
     * @param {string} filter - 'all', 'highRank', 'highImpression'
     * @returns {Object} - Paginated keywords with summary
     */
    static async getKeywordsForAsin(userId, country, region, asin, page = 1, limit = 10, filter = 'all') {
        try {
            const asinData = await AsinKeywordRecommendations.findByAsin(userId, country, region, asin);

            if (!asinData) {
                return {
                    success: true,
                    data: {
                        asin,
                        summary: {
                            totalKeywords: 0,
                            avgBid: 0,
                            highRelevanceCount: 0,
                            highImpressionCount: 0
                        },
                        keywords: [],
                        pagination: { page, limit, totalItems: 0, totalPages: 0, hasMore: false }
                    }
                };
            }

            const allKeywords = asinData.keywordTargetList || [];
            
            // Transform and filter to only BROAD match type keywords
            let broadKeywords = [];
            allKeywords.forEach(keywordTarget => {
                if (keywordTarget.bidInfo && keywordTarget.bidInfo.length > 0) {
                    keywordTarget.bidInfo.forEach(bidInfo => {
                        if (bidInfo.matchType === 'BROAD') {
                            broadKeywords.push({
                                id: `${keywordTarget.recId}-${bidInfo.matchType}`,
                                keyword: keywordTarget.keyword || '',
                                matchType: bidInfo.matchType || '',
                                theme: bidInfo.theme || '',
                                rank: bidInfo.rank || null,
                                bid: bidInfo.bid || 0,
                                suggestedBid: bidInfo.suggestedBid || null,
                                translation: keywordTarget.translation || '',
                                userSelectedKeyword: keywordTarget.userSelectedKeyword || false,
                                searchTermImpressionRank: keywordTarget.searchTermImpressionRank || null,
                                searchTermImpressionShare: keywordTarget.searchTermImpressionShare || null,
                                recId: keywordTarget.recId || ''
                            });
                        }
                    });
                }
            });

            // Calculate summary from all BROAD keywords
            const totalKeywords = broadKeywords.length;
            const avgBid = broadKeywords.length > 0 
                ? broadKeywords.reduce((sum, k) => sum + (parseFloat(k.bid) || 0), 0) / broadKeywords.length
                : 0;
            const highRelevanceCount = broadKeywords.filter(k => k.rank !== null && k.rank <= 10).length;
            const highImpressionCount = broadKeywords.filter(k => k.searchTermImpressionShare !== null && k.searchTermImpressionShare >= 50).length;

            // Apply filter
            let filteredKeywords = broadKeywords;
            if (filter === 'highRank') {
                filteredKeywords = broadKeywords.filter(k => k.rank !== null && k.rank <= 10);
            } else if (filter === 'highImpression') {
                filteredKeywords = broadKeywords.filter(k => k.searchTermImpressionShare !== null && k.searchTermImpressionShare >= 50);
            }

            // Calculate pagination
            const totalItems = filteredKeywords.length;
            const totalPages = Math.ceil(totalItems / limit);
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;
            const paginatedKeywords = filteredKeywords.slice(startIndex, endIndex);
            const hasMore = page < totalPages;

            return {
                success: true,
                data: {
                    asin,
                    summary: {
                        totalKeywords,
                        avgBid: parseFloat(avgBid.toFixed(2)),
                        highRelevanceCount,
                        highImpressionCount
                    },
                    keywords: paginatedKeywords,
                    pagination: {
                        page,
                        limit,
                        totalItems,
                        totalPages,
                        hasMore
                    }
                }
            };

        } catch (error) {
            logger.error("Error in getKeywordsForAsin:", error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Search ASINs by ASIN, SKU, or product name
     * This is an optimized search that queries directly from the keyword recommendations
     * and optionally joins with product data for name/SKU search
     * 
     * @param {string} userId 
     * @param {string} country 
     * @param {string} region 
     * @param {string} query - Search query (ASIN, SKU, or product name)
     * @param {Array} productData - Optional product data for name/SKU lookup
     * @returns {Object} - Matching ASINs with summary
     */
    static async searchAsins(userId, country, region, query, productData = []) {
        try {
            if (!query || query.trim().length === 0) {
                // Return all ASINs if no query
                return await this.getAllAsinsSummary(userId, country, region);
            }

            const searchQuery = query.toLowerCase().trim();
            
            // First, find matching ASINs from product data (for name/SKU search)
            const matchingAsinsFromProducts = new Set();
            if (productData && productData.length > 0) {
                productData.forEach(product => {
                    const asin = (product.asin || '').toLowerCase();
                    const sku = (product.sku || '').toLowerCase();
                    const name = (product.name || product.itemName || product.title || '').toLowerCase();
                    
                    if (asin.includes(searchQuery) || sku.includes(searchQuery) || name.includes(searchQuery)) {
                        matchingAsinsFromProducts.add(product.asin);
                    }
                });
            }

            // Get all ASINs with keyword data
            const pipeline = [
                { $match: { userId, country, region } },
                {
                    $addFields: {
                        asinLower: { $toLower: "$asin" },
                        broadKeywords: {
                            $filter: {
                                input: "$keywordTargetList",
                                as: "keyword",
                                cond: {
                                    $gt: [
                                        {
                                            $size: {
                                                $filter: {
                                                    input: { $ifNull: ["$$keyword.bidInfo", []] },
                                                    as: "bid",
                                                    cond: { $eq: ["$$bid.matchType", "BROAD"] }
                                                }
                                            }
                                        },
                                        0
                                    ]
                                }
                            }
                        }
                    }
                },
                {
                    $match: {
                        $or: [
                            { asinLower: { $regex: searchQuery, $options: 'i' } },
                            { asin: { $in: Array.from(matchingAsinsFromProducts) } }
                        ]
                    }
                },
                {
                    $project: {
                        asin: 1,
                        totalKeywords: 1,
                        fetchedAt: 1,
                        broadKeywordCount: { $size: "$broadKeywords" },
                        highRelevanceCount: {
                            $size: {
                                $filter: {
                                    input: "$broadKeywords",
                                    as: "kw",
                                    cond: {
                                        $and: [
                                            { $ne: ["$$kw.bidInfo", null] },
                                            { $gt: [{ $size: { $ifNull: ["$$kw.bidInfo", []] } }, 0] },
                                            {
                                                $lte: [
                                                    { $arrayElemAt: [{ $ifNull: ["$$kw.bidInfo.rank", [null]] }, 0] },
                                                    10
                                                ]
                                            },
                                            {
                                                $ne: [
                                                    { $arrayElemAt: [{ $ifNull: ["$$kw.bidInfo.rank", [null]] }, 0] },
                                                    null
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        },
                        highImpressionCount: {
                            $size: {
                                $filter: {
                                    input: "$broadKeywords",
                                    as: "kw",
                                    cond: {
                                        $and: [
                                            { $ne: ["$$kw.searchTermImpressionShare", null] },
                                            { $gte: ["$$kw.searchTermImpressionShare", 50] }
                                        ]
                                    }
                                }
                            }
                        },
                        avgBid: {
                            $cond: {
                                if: { $gt: [{ $size: "$broadKeywords" }, 0] },
                                then: {
                                    $avg: {
                                        $map: {
                                            input: "$broadKeywords",
                                            as: "kw",
                                            in: {
                                                $ifNull: [
                                                    { $arrayElemAt: [{ $ifNull: ["$$kw.bidInfo.bid", [0]] }, 0] },
                                                    0
                                                ]
                                            }
                                        }
                                    }
                                },
                                else: 0
                            }
                        }
                    }
                },
                { $sort: { createdAt: -1 } }
            ];

            const results = await AsinKeywordRecommendations.aggregate(pipeline);

            const asinsList = results.map(item => ({
                asin: item.asin,
                keywordCount: item.broadKeywordCount || 0,
                highRelevanceCount: item.highRelevanceCount || 0,
                highImpressionCount: item.highImpressionCount || 0,
                avgBid: item.avgBid || 0,
                fetchedAt: item.fetchedAt
            }));

            return {
                success: true,
                data: {
                    asinsList,
                    totalResults: asinsList.length,
                    query: query
                }
            };

        } catch (error) {
            logger.error("Error in searchAsins:", error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get summary for all ASINs (used for dropdown)
     * Optimized query that returns only essential metadata
     * 
     * @param {string} userId 
     * @param {string} country 
     * @param {string} region 
     * @returns {Object} - List of ASINs with summary
     */
    static async getAllAsinsSummary(userId, country, region) {
        try {
            const pipeline = [
                { $match: { userId, country, region } },
                { $sort: { createdAt: -1 } },
                {
                    $addFields: {
                        broadKeywords: {
                            $filter: {
                                input: "$keywordTargetList",
                                as: "keyword",
                                cond: {
                                    $gt: [
                                        {
                                            $size: {
                                                $filter: {
                                                    input: { $ifNull: ["$$keyword.bidInfo", []] },
                                                    as: "bid",
                                                    cond: { $eq: ["$$bid.matchType", "BROAD"] }
                                                }
                                            }
                                        },
                                        0
                                    ]
                                }
                            }
                        }
                    }
                },
                {
                    $project: {
                        asin: 1,
                        fetchedAt: 1,
                        broadKeywordCount: { $size: "$broadKeywords" },
                        highRelevanceCount: {
                            $size: {
                                $filter: {
                                    input: "$broadKeywords",
                                    as: "kw",
                                    cond: {
                                        $and: [
                                            { $ne: ["$$kw.bidInfo", null] },
                                            { $gt: [{ $size: { $ifNull: ["$$kw.bidInfo", []] } }, 0] },
                                            {
                                                $lte: [
                                                    { $arrayElemAt: [{ $ifNull: ["$$kw.bidInfo.rank", [null]] }, 0] },
                                                    10
                                                ]
                                            },
                                            {
                                                $ne: [
                                                    { $arrayElemAt: [{ $ifNull: ["$$kw.bidInfo.rank", [null]] }, 0] },
                                                    null
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        },
                        highImpressionCount: {
                            $size: {
                                $filter: {
                                    input: "$broadKeywords",
                                    as: "kw",
                                    cond: {
                                        $and: [
                                            { $ne: ["$$kw.searchTermImpressionShare", null] },
                                            { $gte: ["$$kw.searchTermImpressionShare", 50] }
                                        ]
                                    }
                                }
                            }
                        },
                        avgBid: {
                            $cond: {
                                if: { $gt: [{ $size: "$broadKeywords" }, 0] },
                                then: {
                                    $avg: {
                                        $map: {
                                            input: "$broadKeywords",
                                            as: "kw",
                                            in: {
                                                $ifNull: [
                                                    { $arrayElemAt: [{ $ifNull: ["$$kw.bidInfo.bid", [0]] }, 0] },
                                                    0
                                                ]
                                            }
                                        }
                                    }
                                },
                                else: 0
                            }
                        }
                    }
                }
            ];

            const results = await AsinKeywordRecommendations.aggregate(pipeline);

            const asinsList = results.map(item => ({
                asin: item.asin,
                keywordCount: item.broadKeywordCount || 0,
                highRelevanceCount: item.highRelevanceCount || 0,
                highImpressionCount: item.highImpressionCount || 0,
                avgBid: item.avgBid || 0,
                fetchedAt: item.fetchedAt
            }));

            return {
                success: true,
                data: {
                    asinsList,
                    totalAsins: asinsList.length
                }
            };

        } catch (error) {
            logger.error("Error in getAllAsinsSummary:", error);
            return {
                success: false,
                error: error.message
            };
        }
    }

}

module.exports = KeywordOpportunitiesService;

/**
 * PPC Campaign Analysis Service
 * 
 * Provides lightweight, paginated data for the Campaign Audit page tabs.
 * Each function queries only the specific MongoDB collections needed,
 * avoiding the full Analyse pipeline.
 */

const mongoose = require('mongoose');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel');
const PPCUnitsSold = require('../../models/amazon-ads/PPCUnitsSoldModel');
const IssueSummary = require('../../models/system/IssueSummaryModel');
const adsKeywordsPerformanceModel = require('../../models/amazon-ads/adsKeywordsPerformanceModel');
const SearchTerms = require('../../models/amazon-ads/SearchTermsModel');
const Campaign = require('../../models/amazon-ads/CampaignModel');
const NegativeKeywords = require('../../models/amazon-ads/NegetiveKeywords');
const AdsGroup = require('../../models/amazon-ads/adsgroupModel');
const Keyword = require('../../models/amazon-ads/keywordModel');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel');
const logger = require('../../utils/logger');

/**
 * Helper to create pagination metadata
 */
const createPaginationMeta = (page, limit, totalItems) => {
    const totalPages = Math.ceil(totalItems / limit);
    return {
        page,
        limit,
        totalItems,
        totalPages,
        hasMore: page < totalPages
    };
};

/**
 * Get PPC KPI Summary for the top boxes
 * Returns: spend, sales, acos, tacos, unitsSold, totalIssues
 */
const getPPCKPISummary = async (userId, country, region) => {
    const startTime = Date.now();
    logger.info(`[PPCCampaignAnalysis] Getting KPI summary for user: ${userId}`);

    try {
        const userIdStr = userId?.toString() || userId;

        // Fetch data in parallel (EconomicsMetrics for total sales → TACoS)
        const [ppcMetrics, ppcUnitsSold, issueSummary, economicsMetrics] = await Promise.all([
            PPCMetrics.findLatestForUser(userIdStr, country, region),
            PPCUnitsSold.findLatestForUser(userIdStr, country, region),
            IssueSummary.getIssueSummary(userId, country, region),
            EconomicsMetrics.findOne({ User: userIdStr, country, region }).sort({ createdAt: -1 }).select('totalSales').lean()
        ]);

        const spend = ppcMetrics?.summary?.totalSpend || 0;
        const totalSales = economicsMetrics?.totalSales?.amount ?? 0;
        const tacos = totalSales > 0 ? Math.round((spend / totalSales) * 100 * 100) / 100 : 0;

        const summary = {
            spend,
            sales: ppcMetrics?.summary?.totalSales || 0,
            acos: ppcMetrics?.summary?.overallAcos || 0,
            tacos,
            roas: ppcMetrics?.summary?.overallRoas || 0,
            impressions: ppcMetrics?.summary?.totalImpressions || 0,
            clicks: ppcMetrics?.summary?.totalClicks || 0,
            ctr: ppcMetrics?.summary?.ctr || 0,
            cpc: ppcMetrics?.summary?.cpc || 0,
            unitsSold: ppcUnitsSold?.totalUnits || ppcUnitsSold?.summary?.totalUnits || 0,
            totalIssues: issueSummary?.totalSponsoredAdsErrors || 0,
            dateRange: ppcMetrics?.dateRange || null
        };

        logger.info(`[PPCCampaignAnalysis] KPI summary fetched in ${Date.now() - startTime}ms`);
        return summary;
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting KPI summary:', error);
        throw error;
    }
};

/**
 * Get High ACOS Campaigns (ACOS > 40% and sales > 0)
 * Tab 0: Aggregates ProductWiseSponsoredAds by campaign
 */
const getHighAcosCampaigns = async (userId, country, region, page = 1, limit = 10, startDate = null, endDate = null) => {
    const startTime = Date.now();
    logger.info(`[PPCCampaignAnalysis] Getting high ACOS campaigns for user: ${userId}, page: ${page}`);

    try {
        const userIdObj = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

        // Find the latest batch
        const latestItem = await ProductWiseSponsoredAdsItem.findOne({ userId: userIdObj, country, region })
            .sort({ createdAt: -1 })
            .select('batchId')
            .lean();

        if (!latestItem || !latestItem.batchId) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        // Build match stage with optional date filter
        const matchStage = { batchId: latestItem.batchId };
        if (startDate && endDate) {
            matchStage.date = { $gte: startDate, $lte: endDate };
        }

        // Aggregate by campaign to get total spend and sales
        const aggregationPipeline = [
            { $match: matchStage },
            {
                $group: {
                    _id: '$campaignId',
                    campaignName: { $first: '$campaignName' },
                    totalSpend: { $sum: '$spend' },
                    totalSales: { $sum: '$salesIn30Days' },
                    totalImpressions: { $sum: '$impressions' },
                    totalClicks: { $sum: '$clicks' }
                }
            },
            {
                $addFields: {
                    acos: {
                        $cond: [
                            { $gt: ['$totalSales', 0] },
                            { $multiply: [{ $divide: ['$totalSpend', '$totalSales'] }, 100] },
                            0
                        ]
                    }
                }
            },
            {
                $match: {
                    acos: { $gt: 40 },
                    totalSales: { $gt: 0 }
                }
            },
            { $sort: { acos: -1 } }
        ];

        // Get total count first
        const countPipeline = [...aggregationPipeline, { $count: 'total' }];
        const countResult = await ProductWiseSponsoredAdsItem.aggregate(countPipeline);
        const totalItems = countResult[0]?.total || 0;

        // Get paginated results
        const skip = (page - 1) * limit;
        const dataPipeline = [
            ...aggregationPipeline,
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    campaignId: '$_id',
                    campaignName: 1,
                    spend: { $round: ['$totalSpend', 2] },
                    sales: { $round: ['$totalSales', 2] },
                    acos: { $round: ['$acos', 2] },
                    impressions: '$totalImpressions',
                    clicks: '$totalClicks',
                    _id: 0
                }
            }
        ];

        const data = await ProductWiseSponsoredAdsItem.aggregate(dataPipeline);

        logger.info(`[PPCCampaignAnalysis] High ACOS campaigns fetched in ${Date.now() - startTime}ms, count: ${data.length}`);
        return {
            data,
            pagination: createPaginationMeta(page, limit, totalItems)
        };
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting high ACOS campaigns:', error);
        throw error;
    }
};

/**
 * Get Wasted Spend Keywords (cost > 0 and sales < 0.01)
 * Tab 1: Aggregates keywords by keyword+campaign+adGroup
 */
const getWastedSpendKeywords = async (userId, country, region, page = 1, limit = 10, startDate = null, endDate = null) => {
    const startTime = Date.now();
    logger.info(`[PPCCampaignAnalysis] Getting wasted spend keywords for user: ${userId}, page: ${page}`);

    try {
        const userIdObj = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

        // Find the latest keywords document
        const keywordsDoc = await adsKeywordsPerformanceModel.findOne({ userId: userIdObj, country, region })
            .sort({ createdAt: -1 })
            .lean();

        if (!keywordsDoc || !keywordsDoc.keywordsData || keywordsDoc.keywordsData.length === 0) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        let keywordsData = keywordsDoc.keywordsData;

        // Filter by date if provided
        if (startDate && endDate) {
            keywordsData = keywordsData.filter(k => {
                if (!k.date) return true;
                return k.date >= startDate && k.date <= endDate;
            });
        }

        // Aggregate by keyword+campaign+adGroup
        const aggregatedMap = new Map();
        keywordsData.forEach(keyword => {
            const uniqueKey = `${keyword.keyword || ''}|${keyword.campaignId || ''}|${keyword.adGroupId || keyword.adGroupName || ''}`;
            
            if (aggregatedMap.has(uniqueKey)) {
                const existing = aggregatedMap.get(uniqueKey);
                existing.cost += parseFloat(keyword.cost) || 0;
                existing.attributedSales30d += parseFloat(keyword.attributedSales30d) || 0;
                existing.impressions += parseFloat(keyword.impressions) || 0;
                existing.clicks += parseFloat(keyword.clicks) || 0;
            } else {
                aggregatedMap.set(uniqueKey, {
                    keyword: keyword.keyword,
                    keywordId: keyword.keywordId,
                    campaignName: keyword.campaignName,
                    campaignId: keyword.campaignId,
                    adGroupName: keyword.adGroupName,
                    adGroupId: keyword.adGroupId,
                    matchType: keyword.matchType,
                    cost: parseFloat(keyword.cost) || 0,
                    attributedSales30d: parseFloat(keyword.attributedSales30d) || 0,
                    impressions: parseFloat(keyword.impressions) || 0,
                    clicks: parseFloat(keyword.clicks) || 0
                });
            }
        });

        // Filter for wasted spend (cost > 0 and sales < 0.01)
        const wastedKeywords = Array.from(aggregatedMap.values())
            .filter(k => k.cost > 0 && k.attributedSales30d < 0.01)
            .sort((a, b) => b.cost - a.cost);

        const totalItems = wastedKeywords.length;
        const skip = (page - 1) * limit;
        const paginatedData = wastedKeywords.slice(skip, skip + limit).map(k => ({
            keyword: k.keyword,
            keywordId: k.keywordId,
            campaignName: k.campaignName || 'Unknown Campaign',
            campaignId: k.campaignId,
            adGroupName: k.adGroupName,
            adGroupId: k.adGroupId,
            matchType: k.matchType,
            spend: parseFloat(k.cost.toFixed(2)),
            sales: parseFloat(k.attributedSales30d.toFixed(2)),
            impressions: k.impressions,
            clicks: k.clicks
        }));

        logger.info(`[PPCCampaignAnalysis] Wasted spend keywords fetched in ${Date.now() - startTime}ms, count: ${paginatedData.length}`);
        return {
            data: paginatedData,
            pagination: createPaginationMeta(page, limit, totalItems)
        };
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting wasted spend keywords:', error);
        throw error;
    }
};

/**
 * Get Campaigns Without Negative Keywords
 * Tab 2: Cross-references campaigns with negative keywords
 */
const getCampaignsWithoutNegatives = async (userId, country, region, page = 1, limit = 10) => {
    const startTime = Date.now();
    logger.info(`[PPCCampaignAnalysis] Getting campaigns without negatives for user: ${userId}, page: ${page}`);

    try {
        const userIdStr = userId?.toString() || userId;

        // Fetch campaigns, negative keywords, and ad groups in parallel
        const [campaignDoc, negKeywordsDoc, adsGroupDoc] = await Promise.all([
            Campaign.findOne({ userId: userIdStr, country, region }).sort({ createdAt: -1 }).lean(),
            NegativeKeywords.findOne({ userId: userIdStr, country, region }).sort({ createdAt: -1 }).lean(),
            AdsGroup.findOne({ userId: userIdStr, country, region }).sort({ createdAt: -1 }).lean()
        ]);

        const campaignData = campaignDoc?.campaignData || [];
        const negativeKeywords = negKeywordsDoc?.negativeKeywordsData || [];
        const adsGroupData = adsGroupDoc?.adsGroupData || [];

        if (campaignData.length === 0) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        // Create a set of campaign IDs that have negative keywords
        const campaignIdsWithNegatives = new Set();
        negativeKeywords.forEach(negKeyword => {
            if (negKeyword.campaignId) {
                campaignIdsWithNegatives.add(negKeyword.campaignId);
            }
        });

        // Find campaigns without negative keywords
        const campaignsWithoutNegatives = campaignData.filter(campaign => 
            !campaignIdsWithNegatives.has(campaign.campaignId)
        );

        // Build result array with ad groups
        const result = [];
        campaignsWithoutNegatives.forEach(campaign => {
            const adGroups = adsGroupData.filter(ag => ag.campaignId === campaign.campaignId);
            
            if (adGroups.length > 0) {
                adGroups.forEach(adGroup => {
                    result.push({
                        campaignId: campaign.campaignId,
                        campaignName: campaign.name,
                        adGroupId: adGroup.adGroupId,
                        adGroupName: adGroup.name,
                        negatives: 'No negative keywords'
                    });
                });
            } else {
                result.push({
                    campaignId: campaign.campaignId,
                    campaignName: campaign.name,
                    adGroupId: 'N/A',
                    adGroupName: 'No ad groups found',
                    negatives: 'No negative keywords'
                });
            }
        });

        const totalItems = result.length;
        const skip = (page - 1) * limit;
        const paginatedData = result.slice(skip, skip + limit);

        logger.info(`[PPCCampaignAnalysis] Campaigns without negatives fetched in ${Date.now() - startTime}ms, count: ${paginatedData.length}`);
        return {
            data: paginatedData,
            pagination: createPaginationMeta(page, limit, totalItems)
        };
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting campaigns without negatives:', error);
        throw error;
    }
};

/**
 * Get Top Performing Keywords (ACOS < 20%, sales > 100, impressions > 1000)
 * Tab 3: Similar to wasted spend but with different filter criteria
 */
const getTopPerformingKeywords = async (userId, country, region, page = 1, limit = 10, startDate = null, endDate = null) => {
    const startTime = Date.now();
    logger.info(`[PPCCampaignAnalysis] Getting top performing keywords for user: ${userId}, page: ${page}`);

    try {
        const userIdObj = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

        // Find the latest keywords document
        const keywordsDoc = await adsKeywordsPerformanceModel.findOne({ userId: userIdObj, country, region })
            .sort({ createdAt: -1 })
            .lean();

        if (!keywordsDoc || !keywordsDoc.keywordsData || keywordsDoc.keywordsData.length === 0) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        let keywordsData = keywordsDoc.keywordsData;

        // Filter by date if provided
        if (startDate && endDate) {
            keywordsData = keywordsData.filter(k => {
                if (!k.date) return true;
                return k.date >= startDate && k.date <= endDate;
            });
        }

        // Aggregate by keyword+campaign+adGroup
        const aggregatedMap = new Map();
        keywordsData.forEach(keyword => {
            const uniqueKey = `${keyword.keyword || ''}|${keyword.campaignId || ''}|${keyword.adGroupId || keyword.adGroupName || ''}`;
            
            if (aggregatedMap.has(uniqueKey)) {
                const existing = aggregatedMap.get(uniqueKey);
                existing.cost += parseFloat(keyword.cost) || 0;
                existing.attributedSales30d += parseFloat(keyword.attributedSales30d) || 0;
                existing.impressions += parseFloat(keyword.impressions) || 0;
                existing.clicks += parseFloat(keyword.clicks) || 0;
            } else {
                aggregatedMap.set(uniqueKey, {
                    keyword: keyword.keyword,
                    keywordId: keyword.keywordId,
                    campaignName: keyword.campaignName,
                    campaignId: keyword.campaignId,
                    adGroupName: keyword.adGroupName,
                    adGroupId: keyword.adGroupId,
                    matchType: keyword.matchType,
                    cost: parseFloat(keyword.cost) || 0,
                    attributedSales30d: parseFloat(keyword.attributedSales30d) || 0,
                    impressions: parseFloat(keyword.impressions) || 0,
                    clicks: parseFloat(keyword.clicks) || 0
                });
            }
        });

        // Filter for top performing (ACOS < 20%, sales > 100, impressions > 1000)
        const topKeywords = Array.from(aggregatedMap.values())
            .map(k => {
                const acos = k.attributedSales30d > 0 ? (k.cost / k.attributedSales30d) * 100 : 0;
                return { ...k, acos };
            })
            .filter(k => k.acos < 20 && k.acos > 0 && k.attributedSales30d > 100 && k.impressions > 1000)
            .sort((a, b) => b.attributedSales30d - a.attributedSales30d);

        const totalItems = topKeywords.length;
        const skip = (page - 1) * limit;
        const paginatedData = topKeywords.slice(skip, skip + limit).map(k => ({
            keyword: k.keyword,
            keywordId: k.keywordId,
            campaignName: k.campaignName || 'Unknown Campaign',
            campaignId: k.campaignId,
            adGroupName: k.adGroupName,
            adGroupId: k.adGroupId,
            matchType: k.matchType,
            spend: parseFloat(k.cost.toFixed(2)),
            sales: parseFloat(k.attributedSales30d.toFixed(2)),
            impressions: k.impressions,
            clicks: k.clicks,
            acos: parseFloat(k.acos.toFixed(2))
        }));

        logger.info(`[PPCCampaignAnalysis] Top performing keywords fetched in ${Date.now() - startTime}ms, count: ${paginatedData.length}`);
        return {
            data: paginatedData,
            pagination: createPaginationMeta(page, limit, totalItems)
        };
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting top performing keywords:', error);
        throw error;
    }
};

/**
 * Get Search Terms with Zero Sales (clicks >= 10 and sales < 0.01)
 * Tab 4: Aggregates search terms
 */
const getSearchTermsZeroSales = async (userId, country, region, page = 1, limit = 10, startDate = null, endDate = null) => {
    const startTime = Date.now();
    logger.info(`[PPCCampaignAnalysis] Getting search terms with zero sales for user: ${userId}, page: ${page}`);

    try {
        const userIdStr = userId?.toString() || userId;

        // Find the latest search terms document
        const searchTermsDoc = await SearchTerms.findOne({ userId: userIdStr, country, region })
            .sort({ createdAt: -1 })
            .lean();

        if (!searchTermsDoc || !searchTermsDoc.searchTermData || searchTermsDoc.searchTermData.length === 0) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        let searchTermData = searchTermsDoc.searchTermData;

        // Filter by date if provided
        if (startDate && endDate) {
            searchTermData = searchTermData.filter(st => {
                if (!st.date) return true;
                return st.date >= startDate && st.date <= endDate;
            });
        }

        // Aggregate by searchTerm+campaign+adGroup
        const aggregatedMap = new Map();
        searchTermData.forEach(term => {
            const uniqueKey = `${term.searchTerm || ''}|${term.campaignId || ''}|${term.adGroupId || term.adGroupName || ''}`;
            
            if (aggregatedMap.has(uniqueKey)) {
                const existing = aggregatedMap.get(uniqueKey);
                existing.sales += parseFloat(term.sales) || 0;
                existing.spend += parseFloat(term.spend) || 0;
                existing.clicks += parseFloat(term.clicks) || 0;
                existing.impressions += parseFloat(term.impressions) || 0;
            } else {
                aggregatedMap.set(uniqueKey, {
                    searchTerm: term.searchTerm,
                    keyword: term.keyword,
                    campaignName: term.campaignName,
                    campaignId: term.campaignId,
                    adGroupName: term.adGroupName,
                    adGroupId: term.adGroupId,
                    sales: parseFloat(term.sales) || 0,
                    spend: parseFloat(term.spend) || 0,
                    clicks: parseFloat(term.clicks) || 0,
                    impressions: parseFloat(term.impressions) || 0
                });
            }
        });

        // Filter for zero sales (clicks >= 10 and sales < 0.01)
        const zeroSalesTerms = Array.from(aggregatedMap.values())
            .filter(t => t.clicks >= 10 && t.sales < 0.01)
            .sort((a, b) => b.spend - a.spend);

        const totalItems = zeroSalesTerms.length;
        const skip = (page - 1) * limit;
        const paginatedData = zeroSalesTerms.slice(skip, skip + limit).map(t => ({
            searchTerm: t.searchTerm,
            keyword: t.keyword,
            campaignName: t.campaignName || 'Unknown Campaign',
            campaignId: t.campaignId,
            adGroupName: t.adGroupName,
            adGroupId: t.adGroupId,
            clicks: t.clicks,
            spend: parseFloat(t.spend.toFixed(2)),
            sales: parseFloat(t.sales.toFixed(2)),
            impressions: t.impressions
        }));

        logger.info(`[PPCCampaignAnalysis] Search terms with zero sales fetched in ${Date.now() - startTime}ms, count: ${paginatedData.length}`);
        return {
            data: paginatedData,
            pagination: createPaginationMeta(page, limit, totalItems)
        };
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting search terms with zero sales:', error);
        throw error;
    }
};

/**
 * Get Auto Campaign Insights (sales > 30, auto campaign, not in manual campaigns)
 * Tab 5: Cross-references search terms with campaign types and manual keywords
 */
const getAutoCampaignInsights = async (userId, country, region, page = 1, limit = 10, startDate = null, endDate = null) => {
    const startTime = Date.now();
    logger.info(`[PPCCampaignAnalysis] Getting auto campaign insights for user: ${userId}, page: ${page}`);

    try {
        const userIdStr = userId?.toString() || userId;

        // Fetch search terms, campaigns, and keywords in parallel
        const [searchTermsDoc, campaignDoc, keywordDoc] = await Promise.all([
            SearchTerms.findOne({ userId: userIdStr, country, region }).sort({ createdAt: -1 }).lean(),
            Campaign.findOne({ userId: userIdStr, country, region }).sort({ createdAt: -1 }).lean(),
            Keyword.findOne({ userId: userIdStr, country, region }).sort({ createdAt: -1 }).lean()
        ]);

        if (!searchTermsDoc || !searchTermsDoc.searchTermData || searchTermsDoc.searchTermData.length === 0) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        const campaignData = campaignDoc?.campaignData || [];
        const keywords = keywordDoc?.keywordData || [];

        let searchTermData = searchTermsDoc.searchTermData;

        // Filter by date if provided
        if (startDate && endDate) {
            searchTermData = searchTermData.filter(st => {
                if (!st.date) return true;
                return st.date >= startDate && st.date <= endDate;
            });
        }

        // Identify auto and manual campaigns
        const autoCampaigns = campaignData.filter(c => c.targetingType === 'auto');
        const autoCampaignIds = new Set(autoCampaigns.map(c => c.campaignId));
        
        const manualCampaigns = campaignData.filter(c => c.targetingType === 'manual');
        const manualCampaignIds = new Set(manualCampaigns.map(c => c.campaignId));

        // Get keywords from manual campaigns (lowercase for comparison)
        const manualKeywords = new Set(
            keywords
                .filter(k => manualCampaignIds.has(k.campaignId))
                .map(k => (k.keywordText || '').toLowerCase())
        );

        // Aggregate search terms
        const aggregatedMap = new Map();
        searchTermData.forEach(term => {
            const uniqueKey = `${term.searchTerm || ''}|${term.campaignId || ''}|${term.adGroupId || term.adGroupName || ''}`;
            
            if (aggregatedMap.has(uniqueKey)) {
                const existing = aggregatedMap.get(uniqueKey);
                existing.sales += parseFloat(term.sales) || 0;
                existing.spend += parseFloat(term.spend) || 0;
                existing.clicks += parseFloat(term.clicks) || 0;
                existing.impressions += parseFloat(term.impressions) || 0;
            } else {
                aggregatedMap.set(uniqueKey, {
                    searchTerm: term.searchTerm,
                    keyword: term.keyword,
                    campaignName: term.campaignName,
                    campaignId: term.campaignId,
                    adGroupName: term.adGroupName,
                    adGroupId: term.adGroupId,
                    sales: parseFloat(term.sales) || 0,
                    spend: parseFloat(term.spend) || 0,
                    clicks: parseFloat(term.clicks) || 0,
                    impressions: parseFloat(term.impressions) || 0
                });
            }
        });

        // Filter for auto campaign insights
        const autoInsights = Array.from(aggregatedMap.values())
            .filter(t => {
                // Must have sales > 30
                if (t.sales <= 30) return false;
                // Must belong to an auto campaign
                if (!t.campaignId || !autoCampaignIds.has(t.campaignId)) return false;
                // Must NOT exist in manual campaigns
                const existsInManual = manualKeywords.has((t.searchTerm || '').toLowerCase());
                return !existsInManual;
            })
            .map(t => {
                const acos = t.sales > 0 ? (t.spend / t.sales) * 100 : 0;
                return {
                    ...t,
                    acos,
                    action: 'Migrate to Manual Campaign'
                };
            })
            .sort((a, b) => b.sales - a.sales);

        const totalItems = autoInsights.length;
        const skip = (page - 1) * limit;
        const paginatedData = autoInsights.slice(skip, skip + limit).map(t => ({
            searchTerm: t.searchTerm,
            keyword: t.keyword || '',
            campaignName: t.campaignName || 'Unknown Campaign',
            campaignId: t.campaignId,
            adGroupName: t.adGroupName,
            adGroupId: t.adGroupId,
            sales: parseFloat(t.sales.toFixed(2)),
            spend: parseFloat(t.spend.toFixed(2)),
            clicks: t.clicks,
            impressions: t.impressions,
            acos: parseFloat(t.acos.toFixed(2)),
            action: t.action
        }));

        logger.info(`[PPCCampaignAnalysis] Auto campaign insights fetched in ${Date.now() - startTime}ms, count: ${paginatedData.length}`);
        return {
            data: paginatedData,
            pagination: createPaginationMeta(page, limit, totalItems)
        };
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting auto campaign insights:', error);
        throw error;
    }
};

/**
 * Get tab counts for all campaign analysis tabs
 * Used to show counts in tab labels without loading full data
 */
const getTabCounts = async (userId, country, region) => {
    const startTime = Date.now();
    logger.info(`[PPCCampaignAnalysis] Getting tab counts for user: ${userId}`);

    try {
        // Fetch all tab data with limit 0 to get just counts
        const [highAcos, wastedSpend, noNegatives, topKeywords, zeroSales, autoInsights] = await Promise.all([
            getHighAcosCampaigns(userId, country, region, 1, 1),
            getWastedSpendKeywords(userId, country, region, 1, 1),
            getCampaignsWithoutNegatives(userId, country, region, 1, 1),
            getTopPerformingKeywords(userId, country, region, 1, 1),
            getSearchTermsZeroSales(userId, country, region, 1, 1),
            getAutoCampaignInsights(userId, country, region, 1, 1)
        ]);

        const counts = {
            highAcos: highAcos.pagination.totalItems,
            wastedSpend: wastedSpend.pagination.totalItems,
            noNegatives: noNegatives.pagination.totalItems,
            topKeywords: topKeywords.pagination.totalItems,
            zeroSales: zeroSales.pagination.totalItems,
            autoInsights: autoInsights.pagination.totalItems
        };

        logger.info(`[PPCCampaignAnalysis] Tab counts fetched in ${Date.now() - startTime}ms`);
        return counts;
    } catch (error) {
        logger.error('[PPCCampaignAnalysis] Error getting tab counts:', error);
        throw error;
    }
};

module.exports = {
    getPPCKPISummary,
    getHighAcosCampaigns,
    getWastedSpendKeywords,
    getCampaignsWithoutNegatives,
    getTopPerformingKeywords,
    getSearchTermsZeroSales,
    getAutoCampaignInsights,
    getTabCounts
};

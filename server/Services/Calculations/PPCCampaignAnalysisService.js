/**
 * PPC Campaign Analysis Service
 * 
 * Provides lightweight, paginated data for the Campaign Audit page tabs.
 * Each function queries only the specific MongoDB collections needed,
 * avoiding the full Analyse pipeline.
 */

const mongoose = require('mongoose');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel');
const IssueSummary = require('../../models/system/IssueSummaryModel');
const adsKeywordsPerformanceModel = require('../../models/amazon-ads/adsKeywordsPerformanceModel');
const SearchTerms = require('../../models/amazon-ads/SearchTermsModel');
const Campaign = require('../../models/amazon-ads/CampaignModel');
const NegativeKeywords = require('../../models/amazon-ads/NegetiveKeywords');
const AdsGroup = require('../../models/amazon-ads/adsgroupModel');
const Keyword = require('../../models/amazon-ads/keywordModel');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel');
const SalesOnlyMetrics = require('../../models/MCP/SalesOnlyMetricsModel');
const logger = require('../../utils/Logger');
const { loadLatestSnapshotDoc, loadKeywordSnapshot } = require('../../utils/ppcSnapshotLoader');

/**
 * Parse YYYY-MM-DD-like input as a local date range.
 * Returns inclusive [startOfDay, endOfDay] Date objects.
 */
const buildInclusiveDateRange = (startDate, endDate) => {
    if (!startDate || !endDate) return null;

    const parseDateInput = (value) => {
        if (value instanceof Date) return new Date(value.getTime());
        if (typeof value !== 'string') return null;

        // Prefer local parsing for date-only strings to avoid UTC drift.
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (dateOnly) {
            const [, y, m, d] = dateOnly;
            return new Date(Number(y), Number(m) - 1, Number(d));
        }

        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const start = parseDateInput(startDate);
    const end = parseDateInput(endDate);
    if (!start || !end) return null;

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

const isInInclusiveRange = (value, range) => {
    if (!range) return true;
    if (!value) return true;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return true;
    return parsed >= range.start && parsed <= range.end;
};

/**
 * ProductWiseSponsoredAdsItem stores `date` as String (YYYY-MM-DD).
 * MongoDB must filter with string bounds — comparing that field to BSON Date matches nothing.
 */
const toYyyyMmDd = (value) => {
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const y = value.getFullYear();
        const mo = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${mo}-${d}`;
    }
    return null;
};

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
 * Resolves a Mongo $match stage for collections that store one day per document
 * inside an array field (adsKeywordsPerformance.keywordsData, SearchTerms.searchTermData).
 *
 * Tries the per-day window first ({metricDate: {$gte,$lte}}). If no per-day docs
 * exist for the window, falls back to the latest legacy doc (no metricDate) so
 * users who haven't been migrated still see something.
 *
 * Returns `null` when the user has no data at all.
 */
const resolveDailyOrLegacyMatch = async (Model, baseMatch, startStr, endStr) => {
    const dailyQuery = {
        ...baseMatch,
        metricDate: { $exists: true, $type: 'string', $ne: null },
    };
    if (startStr && endStr) {
        dailyQuery.metricDate = { $gte: startStr, $lte: endStr };
    }

    const hasDaily = await Model.exists(dailyQuery);
    if (hasDaily) return dailyQuery;

    const legacy = await Model.findOne({
        ...baseMatch,
        $or: [{ metricDate: { $exists: false } }, { metricDate: null }],
    })
        .sort({ createdAt: -1 })
        .select('_id')
        .lean();

    if (!legacy) return null;
    return { ...baseMatch, _id: legacy._id };
};

/** Default ~31-day string window (UTC) for product-wise / report-style data when no range passed. */
const defaultReportWindowStrings = () => {
    const now = new Date();
    const endD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const startD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1 - 30));
    return { startStr: startD.toISOString().split('T')[0], endStr: endD.toISOString().split('T')[0] };
};

/**
 * Resolve the (startDate, endDate) window for the KPI summary.
 * - If both dates are provided (YYYY-MM-DD), they're used as-is.
 * - Otherwise we fall back to the production default: yesterday-30 … yesterday (UTC).
 */
const resolveKpiDateRange = (startDate, endDate) => {
    const norm = (v) => toYyyyMmDd(v);
    const s = norm(startDate);
    const e = norm(endDate);
    if (s && e) {
        const isCustom = s <= e;
        if (!isCustom) {
            // Caller passed start > end — swap to keep query valid; flag as custom.
            return { startDate: e, endDate: s, isCustom: true };
        }
        return { startDate: s, endDate: e, isCustom: true };
    }
    const { startStr, endStr } = defaultReportWindowStrings();
    return { startDate: startStr, endDate: endStr, isCustom: false };
};

/**
 * Aggregate PPC totals (sales / spend / units / impressions / clicks) over the
 * given date range — entirely in MongoDB.
 *
 * One `$match` on `metricDate` + one `$group` per collection. Output is at
 * most a single document. No per-day rows are pulled back into Node.
 */
const aggregatePpcTotals = async (userIdStr, country, region, startDate, endDate) => {
    const rows = await PPCMetrics.aggregate([
        {
            $match: {
                userId: userIdStr,
                country,
                region,
                metricDate: { $gte: startDate, $lte: endDate },
            },
        },
        {
            $group: {
                _id: null,
                totalSales: { $sum: { $ifNull: ['$summary.totalSales', 0] } },
                totalSpend: { $sum: { $ifNull: ['$summary.totalSpend', 0] } },
                totalImpressions: { $sum: { $ifNull: ['$summary.totalImpressions', 0] } },
                totalClicks: { $sum: { $ifNull: ['$summary.totalClicks', 0] } },
                totalUnitsSoldClicks1d: { $sum: { $ifNull: ['$summary.totalUnitsSoldClicks1d', 0] } },
                totalPurchases: { $sum: { $ifNull: ['$summary.totalPurchases', 0] } },
                daysWithData: { $sum: 1 },
                minDate: { $min: '$metricDate' },
                maxDate: { $max: '$metricDate' },
            },
        },
    ]);
    return rows && rows[0]
        ? rows[0]
        : {
              totalSales: 0,
              totalSpend: 0,
              totalImpressions: 0,
              totalClicks: 0,
              totalUnitsSoldClicks1d: 0,
              totalPurchases: 0,
              daysWithData: 0,
              minDate: null,
              maxDate: null,
          };
};

/**
 * Aggregate per-day PPC metrics for the selected window — drives the
 * "PPC Performance Over Time" chart. One row per calendar day, derived
 * fields (acos/ctr/cpc/roas) computed in-pipeline from the sums.
 *
 * Defensive: $group on metricDate so duplicate per-day docs (if any) sum
 * cleanly instead of getting overwritten.
 */
const aggregatePpcDaily = async (userIdStr, country, region, startDate, endDate) => {
    return PPCMetrics.aggregate([
        {
            $match: {
                userId: userIdStr,
                country,
                region,
                metricDate: { $gte: startDate, $lte: endDate },
            },
        },
        {
            $group: {
                _id: '$metricDate',
                sales: { $sum: { $ifNull: ['$summary.totalSales', 0] } },
                spend: { $sum: { $ifNull: ['$summary.totalSpend', 0] } },
                impressions: { $sum: { $ifNull: ['$summary.totalImpressions', 0] } },
                clicks: { $sum: { $ifNull: ['$summary.totalClicks', 0] } },
                unitsSold: { $sum: { $ifNull: ['$summary.totalUnitsSoldClicks1d', 0] } },
            },
        },
        {
            $addFields: {
                acos: {
                    $cond: [{ $gt: ['$sales', 0] },
                        { $multiply: [{ $divide: ['$spend', '$sales'] }, 100] }, 0],
                },
                ctr: {
                    $cond: [{ $gt: ['$impressions', 0] },
                        { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0],
                },
                cpc: {
                    $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0],
                },
                roas: {
                    $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$sales', '$spend'] }, 0],
                },
            },
        },
        { $sort: { _id: 1 } },
        {
            $project: {
                _id: 0,
                date: '$_id',
                sales: { $round: ['$sales', 2] },
                spend: { $round: ['$spend', 2] },
                impressions: 1,
                clicks: 1,
                unitsSold: 1,
                acos: { $round: ['$acos', 2] },
                ctr: { $round: ['$ctr', 2] },
                cpc: { $round: ['$cpc', 2] },
                roas: { $round: ['$roas', 2] },
            },
        },
    ]);
};

/**
 * Aggregate total (organic + PPC) sales over the same window from the per-day
 * SalesOnlyMetrics collection. Used as the TACOS denominator.
 *
 * NOTE: SalesOnlyMetrics stores `User` as an ObjectId, distinct from
 * PPCMetrics' string userId.
 */
const aggregateTotalSales = async (userId, country, region, startDate, endDate) => {
    let userObjectId = null;
    try {
        userObjectId =
            typeof userId === 'string'
                ? new mongoose.Types.ObjectId(userId)
                : userId;
    } catch (_) {
        return { totalSales: 0, currencyCode: 'USD', daysWithData: 0 };
    }

    const rows = await SalesOnlyMetrics.aggregate([
        {
            $match: {
                User: userObjectId,
                region,
                country,
                date: { $gte: startDate, $lte: endDate },
            },
        },
        {
            $group: {
                _id: null,
                totalSales: { $sum: { $ifNull: ['$sales.amount', 0] } },
                unitsSold: { $sum: { $ifNull: ['$unitsSold', 0] } },
                currencyCode: { $first: '$sales.currencyCode' },
                daysWithData: { $sum: 1 },
            },
        },
    ]);
    return rows && rows[0]
        ? rows[0]
        : { totalSales: 0, unitsSold: 0, currencyCode: 'USD', daysWithData: 0 };
};

/**
 * Get PPC KPI Summary for the top boxes of the Campaign Audit page.
 *
 * - Honors `{ startDate, endDate }` from the request (YYYY-MM-DD).
 * - All summation happens inside MongoDB — no per-day rows are pulled into Node.
 *
 * Returns: { spend, sales, acos, tacos, unitsSold, totalSales, totalIssues, dateRange, dataAvailability }
 */
const getPPCKPISummary = async (userId, country, region, startDate = null, endDate = null) => {
    const startTime = Date.now();

    const window = resolveKpiDateRange(startDate, endDate);
    logger.info(
        `[PPCCampaignAnalysis] KPI summary user=${userId} country=${country} region=${region} ` +
            `window=${window.startDate}→${window.endDate} custom=${window.isCustom}`
    );

    try {
        const userIdStr = userId?.toString() || userId;

        const [ppcTotals, salesTotals, issueSummary, ppcDaily] = await Promise.all([
            aggregatePpcTotals(userIdStr, country, region, window.startDate, window.endDate),
            aggregateTotalSales(userIdStr, country, region, window.startDate, window.endDate),
            IssueSummary.getIssueSummary(userId, country, region),
            aggregatePpcDaily(userIdStr, country, region, window.startDate, window.endDate),
        ]);

        const ppcSales = Number(ppcTotals.totalSales || 0);
        const ppcSpend = Number(ppcTotals.totalSpend || 0);
        const totalSales = Number(salesTotals.totalSales || 0);
        const unitsSold = Math.round(Number(ppcTotals.totalUnitsSoldClicks1d || 0));
        const orders = Math.round(Number(ppcTotals.totalPurchases || 0));
        const impressions = Math.round(Number(ppcTotals.totalImpressions || 0));
        const clicks = Math.round(Number(ppcTotals.totalClicks || 0));

        const acos = ppcSales > 0 ? Math.round((ppcSpend / ppcSales) * 100 * 100) / 100 : 0;
        const roas = ppcSpend > 0 ? Math.round((ppcSales / ppcSpend) * 100) / 100 : 0;
        const tacos = totalSales > 0 ? Math.round((ppcSpend / totalSales) * 100 * 100) / 100 : 0;
        const ctr = impressions > 0 ? Math.round((clicks / impressions) * 100 * 100) / 100 : 0;
        const cpc = clicks > 0 ? Math.round((ppcSpend / clicks) * 100) / 100 : 0;

        const summary = {
            spend: Math.round(ppcSpend * 100) / 100,
            sales: Math.round(ppcSales * 100) / 100,
            totalSales: Math.round(totalSales * 100) / 100,
            currencyCode: salesTotals.currencyCode || 'USD',
            acos,
            tacos,
            roas,
            impressions,
            clicks,
            ctr,
            cpc,
            unitsSold,
            orders,
            totalIssues: issueSummary?.totalSponsoredAdsErrors || 0,
            timeseries: Array.isArray(ppcDaily) ? ppcDaily : [],
            dateRange: { startDate: window.startDate, endDate: window.endDate },
            dataAvailability: {
                isCustomDateRange: window.isCustom,
                ppcDaysWithData: ppcTotals.daysWithData || 0,
                salesDaysWithData: salesTotals.daysWithData || 0,
                ppcDateRangeCovered:
                    ppcTotals.minDate && ppcTotals.maxDate
                        ? { startDate: ppcTotals.minDate, endDate: ppcTotals.maxDate }
                        : null,
            },
        };

        logger.info(
            `[PPCCampaignAnalysis] KPI summary fetched in ${Date.now() - startTime}ms ` +
                `(ppcDays=${summary.dataAvailability.ppcDaysWithData}, salesDays=${summary.dataAvailability.salesDaysWithData})`
        );
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

        const matchStage = { userId: userIdObj, country, region };
        const startStr = startDate && endDate ? toYyyyMmDd(startDate) : null;
        const endStr = startDate && endDate ? toYyyyMmDd(endDate) : null;
        if (startStr && endStr) {
            matchStage.date = { $gte: startStr, $lte: endStr };
        } else {
            const w = defaultReportWindowStrings();
            matchStage.date = { $gte: w.startStr, $lte: w.endStr };
        }

        let effectiveMatch = { ...matchStage };
        const countInWindow = await ProductWiseSponsoredAdsItem.countDocuments(effectiveMatch);
        if (countInWindow === 0) {
            const latestItem = await ProductWiseSponsoredAdsItem.findOne({ userId: userIdObj, country, region })
                .sort({ createdAt: -1 })
                .select('batchId')
                .lean();
            if (!latestItem || !latestItem.batchId) {
                return { data: [], pagination: createPaginationMeta(page, limit, 0) };
            }
            effectiveMatch = { userId: userIdObj, country, region, batchId: latestItem.batchId };
            if (startStr && endStr) {
                effectiveMatch.date = { $gte: startStr, $lte: endStr };
            }
        }

        // Aggregate by campaign to get total spend and sales
        const aggregationPipeline = [
            { $match: effectiveMatch },
            {
                $group: {
                    _id: '$campaignId',
                    campaignName: { $first: '$campaignName' },
                    totalSpend: { $sum: '$spend' },
                    totalSales: { $sum: { $ifNull: ['$sales', { $ifNull: ['$salesIn30Days', 0] }] } },
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
                    },
                    ctr: {
                        $cond: [
                            { $gt: ['$totalImpressions', 0] },
                            { $multiply: [{ $divide: ['$totalClicks', '$totalImpressions'] }, 100] },
                            0
                        ]
                    },
                    cpc: {
                        $cond: [
                            { $gt: ['$totalClicks', 0] },
                            { $divide: ['$totalSpend', '$totalClicks'] },
                            0
                        ]
                    },
                    roas: {
                        $cond: [
                            { $gt: ['$totalSpend', 0] },
                            { $divide: ['$totalSales', '$totalSpend'] },
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
                    ctr: { $round: ['$ctr', 2] },
                    cpc: { $round: ['$cpc', 2] },
                    roas: { $round: ['$roas', 2] },
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

        const startStr = startDate && endDate ? toYyyyMmDd(startDate) : null;
        const endStr = startDate && endDate ? toYyyyMmDd(endDate) : null;
        const window = startStr && endStr ? { startStr, endStr } : defaultReportWindowStrings();

        const match = await resolveDailyOrLegacyMatch(
            adsKeywordsPerformanceModel,
            { userId: userIdObj, country, region },
            window.startStr,
            window.endStr
        );
        if (!match) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        const skip = (page - 1) * limit;
        const aggregationResult = await adsKeywordsPerformanceModel.aggregate([
            { $match: match },
            { $unwind: '$keywordsData' },
            { $match: { 'keywordsData.adKeywordStatus': 'ENABLED' } },
            {
                $group: {
                    _id: {
                        keyword: '$keywordsData.keyword',
                        campaignId: '$keywordsData.campaignId',
                        adGroupKey: { $ifNull: ['$keywordsData.adGroupId', '$keywordsData.adGroupName'] },
                    },
                    keyword: { $first: '$keywordsData.keyword' },
                    keywordId: { $first: '$keywordsData.keywordId' },
                    campaignName: { $first: '$keywordsData.campaignName' },
                    campaignId: { $first: '$keywordsData.campaignId' },
                    adGroupName: { $first: '$keywordsData.adGroupName' },
                    adGroupId: { $first: '$keywordsData.adGroupId' },
                    matchType: { $first: '$keywordsData.matchType' },
                    status: { $last: '$keywordsData.adKeywordStatus' },
                    spend: { $sum: { $ifNull: ['$keywordsData.cost', 0] } },
                    sales: { $sum: { $ifNull: ['$keywordsData.attributedSales30d', 0] } },
                    impressions: { $sum: { $ifNull: ['$keywordsData.impressions', 0] } },
                    clicks: { $sum: { $ifNull: ['$keywordsData.clicks', 0] } },
                },
            },
            { $match: { spend: { $gt: 0 }, sales: { $lt: 0.01 } } },
            {
                $addFields: {
                    ctr: {
                        $cond: [{ $gt: ['$impressions', 0] },
                            { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0],
                    },
                    cpc: {
                        $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0],
                    },
                    roas: {
                        $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$sales', '$spend'] }, 0],
                    },
                },
            },
            { $sort: { spend: -1 } },
            {
                $facet: {
                    total: [{ $count: 'count' }],
                    totalSpend: [{ $group: { _id: null, sum: { $sum: '$spend' } } }],
                    data: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                keyword: 1,
                                keywordId: 1,
                                campaignName: { $ifNull: ['$campaignName', 'Unknown Campaign'] },
                                campaignId: 1,
                                adGroupName: 1,
                                adGroupId: 1,
                                matchType: 1,
                                status: 1,
                                spend: { $round: ['$spend', 2] },
                                sales: { $round: ['$sales', 2] },
                                impressions: 1,
                                clicks: 1,
                                ctr: { $round: ['$ctr', 2] },
                                cpc: { $round: ['$cpc', 2] },
                                roas: { $round: ['$roas', 2] },
                            },
                        },
                    ],
                },
            },
        ]);

        const facet = aggregationResult[0] || { total: [], totalSpend: [], data: [] };
        const totalItems = facet.total[0]?.count || 0;
        const totalWastedSpend = Math.round((facet.totalSpend[0]?.sum || 0) * 100) / 100;

        logger.info(`[PPCCampaignAnalysis] Wasted spend keywords fetched in ${Date.now() - startTime}ms, count: ${facet.data.length}`);
        return {
            data: facet.data,
            pagination: createPaginationMeta(page, limit, totalItems),
            totalWastedSpend,
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

        const [campaignDoc, negKeywordsDoc, adsGroupDoc] = await Promise.all([
            loadLatestSnapshotDoc(Campaign, userIdStr, country, region),
            loadLatestSnapshotDoc(NegativeKeywords, userIdStr, country, region),
            loadLatestSnapshotDoc(AdsGroup, userIdStr, country, region)
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

        const startStr = startDate && endDate ? toYyyyMmDd(startDate) : null;
        const endStr = startDate && endDate ? toYyyyMmDd(endDate) : null;
        const window = startStr && endStr ? { startStr, endStr } : defaultReportWindowStrings();

        const match = await resolveDailyOrLegacyMatch(
            adsKeywordsPerformanceModel,
            { userId: userIdObj, country, region },
            window.startStr,
            window.endStr
        );
        if (!match) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        const skip = (page - 1) * limit;
        const aggregationResult = await adsKeywordsPerformanceModel.aggregate([
            { $match: match },
            { $unwind: '$keywordsData' },
            {
                $group: {
                    _id: {
                        keyword: '$keywordsData.keyword',
                        campaignId: '$keywordsData.campaignId',
                        adGroupKey: { $ifNull: ['$keywordsData.adGroupId', '$keywordsData.adGroupName'] },
                    },
                    keyword: { $first: '$keywordsData.keyword' },
                    keywordId: { $first: '$keywordsData.keywordId' },
                    campaignName: { $first: '$keywordsData.campaignName' },
                    campaignId: { $first: '$keywordsData.campaignId' },
                    adGroupName: { $first: '$keywordsData.adGroupName' },
                    adGroupId: { $first: '$keywordsData.adGroupId' },
                    matchType: { $first: '$keywordsData.matchType' },
                    spend: { $sum: { $ifNull: ['$keywordsData.cost', 0] } },
                    sales: { $sum: { $ifNull: ['$keywordsData.attributedSales30d', 0] } },
                    impressions: { $sum: { $ifNull: ['$keywordsData.impressions', 0] } },
                    clicks: { $sum: { $ifNull: ['$keywordsData.clicks', 0] } },
                },
            },
            {
                $addFields: {
                    acos: {
                        $cond: [{ $gt: ['$sales', 0] },
                            { $multiply: [{ $divide: ['$spend', '$sales'] }, 100] }, 0],
                    },
                    ctr: {
                        $cond: [{ $gt: ['$impressions', 0] },
                            { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0],
                    },
                    cpc: {
                        $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0],
                    },
                    roas: {
                        $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$sales', '$spend'] }, 0],
                    },
                },
            },
            {
                $match: {
                    acos: { $gt: 0, $lt: 20 },
                    sales: { $gt: 100 },
                    impressions: { $gt: 1000 },
                },
            },
            { $sort: { sales: -1 } },
            {
                $facet: {
                    total: [{ $count: 'count' }],
                    data: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                keyword: 1,
                                keywordId: 1,
                                campaignName: { $ifNull: ['$campaignName', 'Unknown Campaign'] },
                                campaignId: 1,
                                adGroupName: 1,
                                adGroupId: 1,
                                matchType: 1,
                                spend: { $round: ['$spend', 2] },
                                sales: { $round: ['$sales', 2] },
                                impressions: 1,
                                clicks: 1,
                                acos: { $round: ['$acos', 2] },
                                ctr: { $round: ['$ctr', 2] },
                                cpc: { $round: ['$cpc', 2] },
                                roas: { $round: ['$roas', 2] },
                            },
                        },
                    ],
                },
            },
        ]);

        const facet = aggregationResult[0] || { total: [], data: [] };
        const totalItems = facet.total[0]?.count || 0;

        logger.info(`[PPCCampaignAnalysis] Top performing keywords fetched in ${Date.now() - startTime}ms, count: ${facet.data.length}`);
        return {
            data: facet.data,
            pagination: createPaginationMeta(page, limit, totalItems),
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

        const startStr = startDate && endDate ? toYyyyMmDd(startDate) : null;
        const endStr = startDate && endDate ? toYyyyMmDd(endDate) : null;
        const window = startStr && endStr ? { startStr, endStr } : defaultReportWindowStrings();

        const match = await resolveDailyOrLegacyMatch(
            SearchTerms,
            { userId: userIdStr, country, region },
            window.startStr,
            window.endStr
        );
        if (!match) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        const skip = (page - 1) * limit;
        const aggregationResult = await SearchTerms.aggregate([
            { $match: match },
            { $unwind: '$searchTermData' },
            {
                $group: {
                    _id: {
                        searchTerm: '$searchTermData.searchTerm',
                        campaignId: '$searchTermData.campaignId',
                        adGroupKey: { $ifNull: ['$searchTermData.adGroupId', '$searchTermData.adGroupName'] },
                    },
                    searchTerm: { $first: '$searchTermData.searchTerm' },
                    keyword: { $first: '$searchTermData.keyword' },
                    campaignName: { $first: '$searchTermData.campaignName' },
                    campaignId: { $first: '$searchTermData.campaignId' },
                    adGroupName: { $first: '$searchTermData.adGroupName' },
                    adGroupId: { $first: '$searchTermData.adGroupId' },
                    sales: { $sum: { $ifNull: ['$searchTermData.sales', 0] } },
                    spend: { $sum: { $ifNull: ['$searchTermData.spend', 0] } },
                    clicks: { $sum: { $ifNull: ['$searchTermData.clicks', 0] } },
                    impressions: { $sum: { $ifNull: ['$searchTermData.impressions', 0] } },
                },
            },
            { $match: { clicks: { $gte: 10 }, sales: { $lt: 0.01 } } },
            {
                $addFields: {
                    ctr: {
                        $cond: [{ $gt: ['$impressions', 0] },
                            { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0],
                    },
                    cpc: {
                        $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0],
                    },
                },
            },
            { $sort: { spend: -1 } },
            {
                $facet: {
                    total: [{ $count: 'count' }],
                    data: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                searchTerm: 1,
                                keyword: 1,
                                campaignName: { $ifNull: ['$campaignName', 'Unknown Campaign'] },
                                campaignId: 1,
                                adGroupName: 1,
                                adGroupId: 1,
                                clicks: 1,
                                spend: { $round: ['$spend', 2] },
                                sales: { $round: ['$sales', 2] },
                                impressions: 1,
                                ctr: { $round: ['$ctr', 2] },
                                cpc: { $round: ['$cpc', 2] },
                            },
                        },
                    ],
                },
            },
        ]);

        const facet = aggregationResult[0] || { total: [], data: [] };
        const totalItems = facet.total[0]?.count || 0;

        logger.info(`[PPCCampaignAnalysis] Search terms with zero sales fetched in ${Date.now() - startTime}ms, count: ${facet.data.length}`);
        return {
            data: facet.data,
            pagination: createPaginationMeta(page, limit, totalItems),
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

        // Pre-fetch the two reference sets (tiny snapshot docs). Avoiding $lookup
        // here keeps the heavy aggregation purely against SearchTerms.
        const [campaignDoc, keywordDoc] = await Promise.all([
            loadLatestSnapshotDoc(Campaign, userIdStr, country, region),
            loadKeywordSnapshot(userIdStr, country, region),
        ]);

        const campaignData = campaignDoc?.campaignData || [];
        const keywords = keywordDoc?.keywordData || [];

        const autoCampaignIds = campaignData
            .filter((c) => (c.targetingTypeLower || c.targetingType || '').toLowerCase() === 'auto')
            .map((c) => c.campaignId)
            .filter((id) => id != null);

        if (autoCampaignIds.length === 0) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        const manualCampaignIds = new Set(
            campaignData.filter((c) => (c.targetingTypeLower || c.targetingType || '').toLowerCase() === 'manual').map((c) => c.campaignId)
        );
        const manualKeywordsLower = Array.from(new Set(
            keywords
                .filter((k) => manualCampaignIds.has(k.campaignId))
                .map((k) => (k.keywordText || '').toLowerCase())
                .filter(Boolean)
        ));

        const startStr = startDate && endDate ? toYyyyMmDd(startDate) : null;
        const endStr = startDate && endDate ? toYyyyMmDd(endDate) : null;
        const window = startStr && endStr ? { startStr, endStr } : defaultReportWindowStrings();

        const match = await resolveDailyOrLegacyMatch(
            SearchTerms,
            { userId: userIdStr, country, region },
            window.startStr,
            window.endStr
        );
        if (!match) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        const skip = (page - 1) * limit;
        const aggregationResult = await SearchTerms.aggregate([
            { $match: match },
            { $unwind: '$searchTermData' },
            { $match: { 'searchTermData.campaignId': { $in: autoCampaignIds } } },
            ...(manualKeywordsLower.length > 0
                ? [{
                    $match: {
                        $expr: {
                            $not: {
                                $in: [
                                    { $toLower: { $ifNull: ['$searchTermData.searchTerm', ''] } },
                                    manualKeywordsLower,
                                ],
                            },
                        },
                    },
                }]
                : []),
            {
                $group: {
                    _id: {
                        searchTerm: '$searchTermData.searchTerm',
                        campaignId: '$searchTermData.campaignId',
                        adGroupKey: { $ifNull: ['$searchTermData.adGroupId', '$searchTermData.adGroupName'] },
                    },
                    searchTerm: { $first: '$searchTermData.searchTerm' },
                    keyword: { $first: '$searchTermData.keyword' },
                    campaignName: { $first: '$searchTermData.campaignName' },
                    campaignId: { $first: '$searchTermData.campaignId' },
                    adGroupName: { $first: '$searchTermData.adGroupName' },
                    adGroupId: { $first: '$searchTermData.adGroupId' },
                    sales: { $sum: { $ifNull: ['$searchTermData.sales', 0] } },
                    spend: { $sum: { $ifNull: ['$searchTermData.spend', 0] } },
                    clicks: { $sum: { $ifNull: ['$searchTermData.clicks', 0] } },
                    impressions: { $sum: { $ifNull: ['$searchTermData.impressions', 0] } },
                },
            },
            { $match: { sales: { $gt: 30 } } },
            {
                $addFields: {
                    acos: {
                        $cond: [{ $gt: ['$sales', 0] },
                            { $multiply: [{ $divide: ['$spend', '$sales'] }, 100] }, 0],
                    },
                    ctr: {
                        $cond: [{ $gt: ['$impressions', 0] },
                            { $multiply: [{ $divide: ['$clicks', '$impressions'] }, 100] }, 0],
                    },
                    cpc: {
                        $cond: [{ $gt: ['$clicks', 0] }, { $divide: ['$spend', '$clicks'] }, 0],
                    },
                    roas: {
                        $cond: [{ $gt: ['$spend', 0] }, { $divide: ['$sales', '$spend'] }, 0],
                    },
                },
            },
            { $sort: { sales: -1 } },
            {
                $facet: {
                    total: [{ $count: 'count' }],
                    data: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                searchTerm: 1,
                                keyword: { $ifNull: ['$keyword', ''] },
                                campaignName: { $ifNull: ['$campaignName', 'Unknown Campaign'] },
                                campaignId: 1,
                                adGroupName: 1,
                                adGroupId: 1,
                                sales: { $round: ['$sales', 2] },
                                spend: { $round: ['$spend', 2] },
                                clicks: 1,
                                impressions: 1,
                                acos: { $round: ['$acos', 2] },
                                ctr: { $round: ['$ctr', 2] },
                                cpc: { $round: ['$cpc', 2] },
                                roas: { $round: ['$roas', 2] },
                                action: { $literal: 'Migrate to Manual Campaign' },
                            },
                        },
                    ],
                },
            },
        ]);

        const facet = aggregationResult[0] || { total: [], data: [] };
        const totalItems = facet.total[0]?.count || 0;

        logger.info(`[PPCCampaignAnalysis] Auto campaign insights fetched in ${Date.now() - startTime}ms, count: ${facet.data.length}`);
        return {
            data: facet.data,
            pagination: createPaginationMeta(page, limit, totalItems),
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
const getTabCounts = async (userId, country, region, startDate = null, endDate = null) => {
    const startTime = Date.now();
    logger.info(`[PPCCampaignAnalysis] Getting tab counts for user: ${userId} window=${startDate || 'default'}→${endDate || 'default'}`);

    try {
        // Fetch all tab data with limit 0 to get just counts. The five tabs
        // with a time dimension honor the Calendar window; "Campaigns Without
        // Negatives" is snapshot-based and ignores the dates.
        const [highAcos, wastedSpend, noNegatives, topKeywords, zeroSales, autoInsights] = await Promise.all([
            getHighAcosCampaigns(userId, country, region, 1, 1, startDate, endDate),
            getWastedSpendKeywords(userId, country, region, 1, 1, startDate, endDate),
            getCampaignsWithoutNegatives(userId, country, region, 1, 1),
            getTopPerformingKeywords(userId, country, region, 1, 1, startDate, endDate),
            getSearchTermsZeroSales(userId, country, region, 1, 1, startDate, endDate),
            getAutoCampaignInsights(userId, country, region, 1, 1, startDate, endDate)
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

/**
 * Total wasted spend for dashboard / KPI boxes — same rules as Campaign Audit Tab 1.
 * Aggregates per-day keyword docs, groups by keyword+campaign+adGroup, ENABLED only,
 * spend > 0 && sales < 0.01.
 */
const getTotalWastedSpend = async (userId, country, region, startDate = null, endDate = null) => {
    const result = await getWastedSpendKeywords(userId, country, region, 1, 1, startDate, endDate);
    return {
        totalItems: result.pagination?.totalItems || 0,
        totalWastedSpend: result.totalWastedSpend ?? 0,
    };
};

module.exports = {
    getPPCKPISummary,
    getHighAcosCampaigns,
    getWastedSpendKeywords,
    getTotalWastedSpend,
    getCampaignsWithoutNegatives,
    getTopPerformingKeywords,
    getSearchTermsZeroSales,
    getAutoCampaignInsights,
    getTabCounts
};

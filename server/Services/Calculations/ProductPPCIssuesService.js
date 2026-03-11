/**
 * ProductPPCIssuesService.js
 * 
 * Service for calculating PPC-related issues for a single ASIN.
 * Joins data from:
 * - ProductWiseSponsoredAdsItem (ASIN-level PPC performance)
 * - Keyword model (keywords per ad group)
 * - adsKeywordsPerformance model (keyword performance metrics)
 * 
 * Returns actionable PPC issues specific to the product.
 */

const mongoose = require('mongoose');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const Keyword = require('../../models/amazon-ads/keywordModel.js');
const adsKeywordsPerformanceModel = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const SearchTerms = require('../../models/amazon-ads/SearchTermsModel.js');
const logger = require('../../utils/Logger.js');

// Thresholds for issue detection
const THRESHOLDS = {
    LOW_IMPRESSIONS: 100,
    HIGH_ACOS: 40,
    LOW_CTR: 0.2,
    HIGH_SPEND_NO_SALES_RATIO: 0.8,
    MIN_SPEND_FOR_ANALYSIS: 1,
    MIN_CLICKS_FOR_CTR: 10,
    FEW_KEYWORDS: 3
};

/**
 * Get PPC issues for a single ASIN
 * @param {Object} params - Parameters
 * @param {string} params.userId - User ID
 * @param {string} params.region - Region (NA, EU, FE)
 * @param {string} params.country - Country code
 * @param {string} params.asin - ASIN to fetch PPC issues for
 * @returns {Promise<Object>} PPC issues data
 */
async function getProductPPCIssues({ userId, region, country, asin }) {
    if (!asin) {
        throw new Error('ASIN is required');
    }

    const normalizedAsin = asin.trim().toUpperCase();
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    logger.info('[ProductPPCIssuesService] Fetching PPC issues', { userId, region, country, asin: normalizedAsin });

    try {
        // Fetch all data in parallel
        const [ppcData, keywordData, keywordPerformance, searchTermsData] = await Promise.all([
            fetchAsinPPCData(userObjectId, country, region, normalizedAsin),
            fetchKeywordsByAdGroups(userId, country, region),
            fetchKeywordPerformance(userObjectId, country, region),
            fetchSearchTerms(userId, country, region)
        ]);

        // If no PPC data for this ASIN, return "no ads" issue
        if (!ppcData || ppcData.length === 0) {
            return {
                success: true,
                data: {
                    asin: normalizedAsin,
                    hasAds: false,
                    summary: {
                        totalIssues: 1,
                        criticalIssues: 1,
                        warningIssues: 0
                    },
                    issues: [{
                        type: 'NO_ADS_RUNNING',
                        severity: 'critical',
                        title: 'No Ads Running',
                        description: 'This product is not being advertised in any Sponsored Products campaigns.',
                        recommendation: 'Create a Sponsored Products campaign to increase visibility and sales for this product.',
                        data: null
                    }],
                    ppcMetrics: null,
                    adGroups: [],
                    keywords: []
                }
            };
        }

        // Aggregate PPC metrics for this ASIN
        const ppcMetrics = aggregatePPCMetrics(ppcData);

        // Get ad groups this ASIN is in
        const adGroupIds = [...new Set(ppcData.map(item => item.adGroupId))];
        const campaignIds = [...new Set(ppcData.map(item => item.campaignId))];

        // Get keywords for these ad groups
        const relevantKeywords = getKeywordsForAdGroups(keywordData, adGroupIds, campaignIds);
        const relevantKeywordPerformance = getKeywordPerformanceForAdGroups(keywordPerformance, adGroupIds, campaignIds);
        const relevantSearchTerms = getSearchTermsForAdGroups(searchTermsData, adGroupIds, campaignIds);

        // Detect issues
        const issues = detectPPCIssues(ppcMetrics, relevantKeywords, relevantKeywordPerformance, adGroupIds);

        // Build ad group summary
        const adGroupSummary = buildAdGroupSummary(ppcData, relevantKeywords, relevantKeywordPerformance);

        // Build Campaign Audit-style keyword tables (filtered to this ASIN's ad groups)
        const keywordTables = buildKeywordTables(relevantKeywordPerformance, relevantSearchTerms);

        // Count issues by severity
        const criticalIssues = issues.filter(i => i.severity === 'critical').length;
        const warningIssues = issues.filter(i => i.severity === 'warning').length;

        const result = {
            asin: normalizedAsin,
            hasAds: true,
            summary: {
                totalIssues: issues.length,
                criticalIssues,
                warningIssues
            },
            ppcMetrics: {
                spend: ppcMetrics.totalSpend,
                sales: ppcMetrics.totalSales,
                impressions: ppcMetrics.totalImpressions,
                clicks: ppcMetrics.totalClicks,
                acos: ppcMetrics.acos,
                ctr: ppcMetrics.ctr,
                cpc: ppcMetrics.cpc,
                conversionRate: ppcMetrics.conversionRate,
                roas: ppcMetrics.roas
            },
            issues,
            adGroups: adGroupSummary,
            keywords: relevantKeywords.slice(0, 20),
            // Campaign Audit-style tables (same as PPC Dashboard but filtered to this ASIN)
            keywordTables
        };

        logger.info('[ProductPPCIssuesService] PPC issues fetched successfully', {
            asin: normalizedAsin,
            totalIssues: issues.length,
            adGroupCount: adGroupIds.length,
            keywordCount: relevantKeywords.length
        });

        return {
            success: true,
            data: result
        };

    } catch (error) {
        logger.error('[ProductPPCIssuesService] Error fetching PPC issues', {
            error: error.message,
            userId,
            asin: normalizedAsin
        });
        throw error;
    }
}

/**
 * Fetch PPC data for a specific ASIN from ProductWiseSponsoredAdsItem
 */
async function fetchAsinPPCData(userId, country, region, asin) {
    try {
        const result = await ProductWiseSponsoredAdsItem.aggregate([
            { $match: { userId: userId, country: country, region: region } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: null, latestBatchId: { $first: '$batchId' }, items: { $push: '$$ROOT' } } },
            { $unwind: '$items' },
            { $match: { $expr: { $eq: ['$items.batchId', '$latestBatchId'] } } },
            { $match: { 'items.asin': asin } },
            { $replaceRoot: { newRoot: '$items' } }
        ]);

        return result;
    } catch (error) {
        logger.error('[ProductPPCIssuesService] Error fetching ASIN PPC data', { error: error.message, asin });
        return [];
    }
}

/**
 * Fetch keywords from Keyword model
 */
async function fetchKeywordsByAdGroups(userId, country, region) {
    try {
        const doc = await Keyword.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 }).lean();

        return doc?.keywordData || [];
    } catch (error) {
        logger.error('[ProductPPCIssuesService] Error fetching keywords', { error: error.message });
        return [];
    }
}

/**
 * Fetch keyword performance from adsKeywordsPerformance model
 */
async function fetchKeywordPerformance(userId, country, region) {
    try {
        const doc = await adsKeywordsPerformanceModel.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 }).lean();

        return doc?.keywordsData || [];
    } catch (error) {
        logger.error('[ProductPPCIssuesService] Error fetching keyword performance', { error: error.message });
        return [];
    }
}

/**
 * Fetch search terms from SearchTerms model
 */
async function fetchSearchTerms(userId, country, region) {
    try {
        const doc = await SearchTerms.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 }).lean();

        return doc?.searchTermData || [];
    } catch (error) {
        logger.error('[ProductPPCIssuesService] Error fetching search terms', { error: error.message });
        return [];
    }
}

/**
 * Aggregate PPC metrics for an ASIN
 */
function aggregatePPCMetrics(ppcData) {
    const totalSpend = ppcData.reduce((sum, item) => sum + (item.spend || 0), 0);
    const totalSales = ppcData.reduce((sum, item) => sum + (item.salesIn30Days || 0), 0);
    const totalImpressions = ppcData.reduce((sum, item) => sum + (item.impressions || 0), 0);
    const totalClicks = ppcData.reduce((sum, item) => sum + (item.clicks || 0), 0);
    const totalPurchased = ppcData.reduce((sum, item) => sum + (item.purchasedIn30Days || 0), 0);

    return {
        totalSpend,
        totalSales,
        totalImpressions,
        totalClicks,
        totalPurchased,
        acos: totalSales > 0 ? (totalSpend / totalSales) * 100 : null,
        ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null,
        cpc: totalClicks > 0 ? totalSpend / totalClicks : null,
        conversionRate: totalClicks > 0 ? (totalPurchased / totalClicks) * 100 : null,
        roas: totalSpend > 0 ? totalSales / totalSpend : null
    };
}

/**
 * Get keywords for specific ad groups
 */
function getKeywordsForAdGroups(allKeywords, adGroupIds, campaignIds) {
    return allKeywords.filter(kw => 
        adGroupIds.includes(kw.adGroupId) || campaignIds.includes(kw.campaignId)
    ).map(kw => ({
        keywordId: kw.keywordId,
        keywordText: kw.keywordText,
        matchType: kw.matchType,
        bid: kw.bid,
        state: kw.state,
        campaignId: kw.campaignId,
        adGroupId: kw.adGroupId
    }));
}

/**
 * Get keyword performance for specific ad groups
 */
function getKeywordPerformanceForAdGroups(allPerformance, adGroupIds, campaignIds) {
    return allPerformance.filter(kp =>
        adGroupIds.includes(String(kp.adGroupId)) || campaignIds.includes(String(kp.campaignId))
    );
}

/**
 * Get search terms for specific ad groups
 */
function getSearchTermsForAdGroups(allSearchTerms, adGroupIds, campaignIds) {
    return allSearchTerms.filter(st =>
        adGroupIds.includes(String(st.adGroupId)) || campaignIds.includes(String(st.campaignId))
    );
}

/**
 * Detect PPC issues based on metrics and keywords
 */
function detectPPCIssues(ppcMetrics, keywords, keywordPerformance, adGroupIds) {
    const issues = [];

    // 1. Low impressions (despite active campaigns)
    if (ppcMetrics.totalImpressions < THRESHOLDS.LOW_IMPRESSIONS && ppcMetrics.totalSpend > 0) {
        issues.push({
            type: 'LOW_IMPRESSIONS',
            severity: 'warning',
            title: 'Low Ad Impressions',
            description: `This product received only ${ppcMetrics.totalImpressions} impressions. Low impressions indicate your ads are not being shown frequently.`,
            recommendation: 'Increase keyword bids, add more relevant keywords, or check if your targeting is too narrow.',
            data: { impressions: ppcMetrics.totalImpressions }
        });
    }

    // 2. High ACOS (unprofitable ads)
    if (ppcMetrics.acos !== null && ppcMetrics.acos > THRESHOLDS.HIGH_ACOS) {
        issues.push({
            type: 'HIGH_ACOS',
            severity: 'critical',
            title: 'High ACOS - Unprofitable Ads',
            description: `ACOS is ${ppcMetrics.acos.toFixed(1)}%, which is above the ${THRESHOLDS.HIGH_ACOS}% threshold. Your ad spend is high relative to sales.`,
            recommendation: 'Review and pause underperforming keywords, adjust bids downward, or improve product listing to increase conversion.',
            data: { acos: ppcMetrics.acos, spend: ppcMetrics.totalSpend, sales: ppcMetrics.totalSales }
        });
    }

    // 3. Low CTR (ads shown but not clicked)
    if (ppcMetrics.ctr !== null && ppcMetrics.ctr < THRESHOLDS.LOW_CTR && ppcMetrics.totalImpressions > THRESHOLDS.LOW_IMPRESSIONS) {
        issues.push({
            type: 'LOW_CTR',
            severity: 'warning',
            title: 'Low Click-Through Rate',
            description: `CTR is ${ppcMetrics.ctr.toFixed(2)}%, which is below ${THRESHOLDS.LOW_CTR}%. Shoppers are seeing your ads but not clicking.`,
            recommendation: 'Improve main image, ensure competitive pricing, or refine targeting to more relevant keywords.',
            data: { ctr: ppcMetrics.ctr, impressions: ppcMetrics.totalImpressions, clicks: ppcMetrics.totalClicks }
        });
    }

    // 4. High spend with zero/low sales
    if (ppcMetrics.totalSpend > THRESHOLDS.MIN_SPEND_FOR_ANALYSIS && ppcMetrics.totalSales < 1) {
        issues.push({
            type: 'HIGH_SPEND_NO_SALES',
            severity: 'critical',
            title: 'Spending Without Sales',
            description: `Spent $${ppcMetrics.totalSpend.toFixed(2)} on ads with no attributed sales. This is wasted ad spend.`,
            recommendation: 'Pause or reduce bids on underperforming keywords. Review product listing for conversion issues.',
            data: { spend: ppcMetrics.totalSpend, sales: ppcMetrics.totalSales }
        });
    }

    // 5. Few keywords in ad groups
    const enabledKeywords = keywords.filter(kw => kw.state === 'ENABLED' || kw.state === 'enabled');
    if (enabledKeywords.length < THRESHOLDS.FEW_KEYWORDS && enabledKeywords.length > 0) {
        issues.push({
            type: 'FEW_KEYWORDS',
            severity: 'warning',
            title: 'Limited Keyword Coverage',
            description: `Only ${enabledKeywords.length} active keyword(s) targeting this product. Limited keywords reduce visibility.`,
            recommendation: 'Add more relevant keywords using Amazon\'s keyword research tools or auto campaign search term reports.',
            data: { keywordCount: enabledKeywords.length, keywords: enabledKeywords.slice(0, 5).map(k => k.keywordText) }
        });
    }

    // 6. Mostly paused/disabled keywords
    const pausedKeywords = keywords.filter(kw => kw.state !== 'ENABLED' && kw.state !== 'enabled');
    if (keywords.length > 0 && pausedKeywords.length / keywords.length > 0.7) {
        issues.push({
            type: 'MOSTLY_PAUSED_KEYWORDS',
            severity: 'warning',
            title: 'Most Keywords Paused',
            description: `${pausedKeywords.length} of ${keywords.length} keywords are paused or disabled. This limits ad delivery.`,
            recommendation: 'Review paused keywords and re-enable those that could be profitable with adjusted bids.',
            data: { totalKeywords: keywords.length, pausedKeywords: pausedKeywords.length }
        });
    }

    // 7. Underperforming keywords in ad groups (from keyword performance)
    const wastedSpendKeywords = keywordPerformance.filter(kp =>
        (kp.cost || 0) > 5 && (kp.attributedSales30d || 0) < 1
    );
    if (wastedSpendKeywords.length > 0) {
        const totalWastedSpend = wastedSpendKeywords.reduce((sum, kp) => sum + (kp.cost || 0), 0);
        issues.push({
            type: 'WASTED_SPEND_KEYWORDS',
            severity: 'critical',
            title: 'Keywords Wasting Budget',
            description: `${wastedSpendKeywords.length} keyword(s) in this product's ad groups have spent $${totalWastedSpend.toFixed(2)} with no sales.`,
            recommendation: 'Pause these underperforming keywords or add them as negative keywords.',
            data: {
                count: wastedSpendKeywords.length,
                totalWastedSpend,
                keywords: wastedSpendKeywords.slice(0, 5).map(kp => ({
                    keyword: kp.keyword,
                    cost: kp.cost,
                    clicks: kp.clicks
                }))
            }
        });
    }

    // 8. Clicks but no conversions (if significant clicks)
    if (ppcMetrics.totalClicks >= THRESHOLDS.MIN_CLICKS_FOR_CTR && ppcMetrics.totalPurchased === 0) {
        issues.push({
            type: 'CLICKS_NO_CONVERSIONS',
            severity: 'warning',
            title: 'Clicks Without Conversions',
            description: `${ppcMetrics.totalClicks} clicks on ads but no purchases attributed. The product listing may need optimization.`,
            recommendation: 'Improve product images, A+ content, bullet points, and reviews to increase conversion rate.',
            data: { clicks: ppcMetrics.totalClicks, conversions: ppcMetrics.totalPurchased }
        });
    }

    return issues;
}

/**
 * Build ad group summary with keywords and performance
 */
function buildAdGroupSummary(ppcData, keywords, keywordPerformance) {
    const adGroupMap = new Map();

    // Group PPC data by ad group
    ppcData.forEach(item => {
        const key = item.adGroupId;
        if (!adGroupMap.has(key)) {
            adGroupMap.set(key, {
                adGroupId: item.adGroupId,
                campaignId: item.campaignId,
                campaignName: item.campaignName,
                spend: 0,
                sales: 0,
                impressions: 0,
                clicks: 0,
                keywords: [],
                keywordPerformance: []
            });
        }
        const ag = adGroupMap.get(key);
        ag.spend += item.spend || 0;
        ag.sales += item.salesIn30Days || 0;
        ag.impressions += item.impressions || 0;
        ag.clicks += item.clicks || 0;
    });

    // Add keywords to each ad group
    keywords.forEach(kw => {
        const ag = adGroupMap.get(kw.adGroupId);
        if (ag) {
            ag.keywords.push({
                keywordText: kw.keywordText,
                matchType: kw.matchType,
                bid: kw.bid,
                state: kw.state
            });
        }
    });

    // Add keyword performance to each ad group
    keywordPerformance.forEach(kp => {
        const ag = adGroupMap.get(String(kp.adGroupId));
        if (ag) {
            ag.keywordPerformance.push({
                keyword: kp.keyword,
                matchType: kp.matchType,
                clicks: kp.clicks,
                cost: kp.cost,
                sales: kp.attributedSales30d
            });
        }
    });

    // Calculate ACOS for each ad group
    return Array.from(adGroupMap.values()).map(ag => ({
        ...ag,
        acos: ag.sales > 0 ? (ag.spend / ag.sales) * 100 : null,
        keywordCount: ag.keywords.length
    }));
}

/**
 * Build Campaign Audit-style keyword tables filtered to ASIN's ad groups
 * Returns: wastedSpend, topPerforming, searchTermsZeroSales
 */
function buildKeywordTables(keywordPerformance, searchTerms) {
    // Aggregate keyword performance by keyword+campaign+adGroup
    const keywordMap = new Map();
    keywordPerformance.forEach(kp => {
        const uniqueKey = `${kp.keyword || ''}|${kp.campaignId || ''}|${kp.adGroupId || ''}`;
        
        if (keywordMap.has(uniqueKey)) {
            const existing = keywordMap.get(uniqueKey);
            existing.cost += parseFloat(kp.cost) || 0;
            existing.attributedSales30d += parseFloat(kp.attributedSales30d) || 0;
            existing.impressions += parseFloat(kp.impressions) || 0;
            existing.clicks += parseFloat(kp.clicks) || 0;
        } else {
            keywordMap.set(uniqueKey, {
                keyword: kp.keyword,
                keywordId: kp.keywordId,
                campaignName: kp.campaignName,
                campaignId: kp.campaignId,
                adGroupName: kp.adGroupName,
                adGroupId: kp.adGroupId,
                matchType: kp.matchType,
                cost: parseFloat(kp.cost) || 0,
                attributedSales30d: parseFloat(kp.attributedSales30d) || 0,
                impressions: parseFloat(kp.impressions) || 0,
                clicks: parseFloat(kp.clicks) || 0,
                adKeywordStatus: kp.adKeywordStatus || null
            });
        }
    });

    const aggregatedKeywords = Array.from(keywordMap.values());

    // 1. Wasted Spend Keywords (cost > 0 and sales < 0.01)
    const wastedSpend = aggregatedKeywords
        .filter(k => k.cost > 0 && k.attributedSales30d < 0.01)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 50)
        .map(k => ({
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
            status: k.adKeywordStatus || null
        }));

    // 2. Top Performing Keywords (ACOS < 20%, sales > 10, impressions > 100)
    // Lower thresholds for product-level to show more results
    const topPerforming = aggregatedKeywords
        .map(k => {
            const acos = k.attributedSales30d > 0 ? (k.cost / k.attributedSales30d) * 100 : 0;
            return { ...k, acos };
        })
        .filter(k => k.acos < 30 && k.acos > 0 && k.attributedSales30d > 5 && k.impressions > 50)
        .sort((a, b) => b.attributedSales30d - a.attributedSales30d)
        .slice(0, 50)
        .map(k => ({
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

    // 3. Search Terms with Zero Sales (clicks >= 5 and sales < 0.01)
    // Lower threshold for product-level
    const searchTermMap = new Map();
    searchTerms.forEach(st => {
        const uniqueKey = `${st.searchTerm || ''}|${st.campaignId || ''}|${st.adGroupId || ''}`;
        
        if (searchTermMap.has(uniqueKey)) {
            const existing = searchTermMap.get(uniqueKey);
            existing.sales += parseFloat(st.sales) || 0;
            existing.spend += parseFloat(st.spend) || 0;
            existing.clicks += parseFloat(st.clicks) || 0;
            existing.impressions += parseFloat(st.impressions) || 0;
        } else {
            searchTermMap.set(uniqueKey, {
                searchTerm: st.searchTerm,
                keyword: st.keyword,
                campaignName: st.campaignName,
                campaignId: st.campaignId,
                adGroupName: st.adGroupName,
                adGroupId: st.adGroupId,
                sales: parseFloat(st.sales) || 0,
                spend: parseFloat(st.spend) || 0,
                clicks: parseFloat(st.clicks) || 0,
                impressions: parseFloat(st.impressions) || 0
            });
        }
    });

    const searchTermsZeroSales = Array.from(searchTermMap.values())
        .filter(t => t.clicks >= 5 && t.sales < 0.01)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 50)
        .map(t => ({
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

    return {
        wastedSpend: {
            data: wastedSpend,
            total: wastedSpend.length,
            totalWastedSpend: wastedSpend.reduce((sum, k) => sum + k.spend, 0)
        },
        topPerforming: {
            data: topPerforming,
            total: topPerforming.length
        },
        searchTermsZeroSales: {
            data: searchTermsZeroSales,
            total: searchTermsZeroSales.length,
            totalWastedSpend: searchTermsZeroSales.reduce((sum, t) => sum + t.spend, 0)
        }
    };
}

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
 * Get wasted spend keywords for a specific ASIN (paginated)
 */
async function getProductWastedSpendKeywords({ userId, region, country, asin, page = 1, limit = 10 }) {
    if (!asin) {
        throw new Error('ASIN is required');
    }

    const normalizedAsin = asin.trim().toUpperCase();
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    try {
        const [ppcData, keywordPerformance] = await Promise.all([
            fetchAsinPPCData(userObjectId, country, region, normalizedAsin),
            fetchKeywordPerformance(userObjectId, country, region)
        ]);

        if (!ppcData || ppcData.length === 0) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0), totalWastedSpend: 0 };
        }

        const adGroupIds = [...new Set(ppcData.map(item => item.adGroupId))];
        const campaignIds = [...new Set(ppcData.map(item => item.campaignId))];
        const relevantKeywordPerformance = getKeywordPerformanceForAdGroups(keywordPerformance, adGroupIds, campaignIds);

        // Aggregate keyword performance
        const keywordMap = new Map();
        relevantKeywordPerformance.forEach(kp => {
            const uniqueKey = `${kp.keyword || ''}|${kp.campaignId || ''}|${kp.adGroupId || ''}`;
            
            if (keywordMap.has(uniqueKey)) {
                const existing = keywordMap.get(uniqueKey);
                existing.cost += parseFloat(kp.cost) || 0;
                existing.attributedSales30d += parseFloat(kp.attributedSales30d) || 0;
                existing.impressions += parseFloat(kp.impressions) || 0;
                existing.clicks += parseFloat(kp.clicks) || 0;
            } else {
                keywordMap.set(uniqueKey, {
                    keyword: kp.keyword,
                    keywordId: kp.keywordId,
                    campaignName: kp.campaignName,
                    campaignId: kp.campaignId,
                    adGroupName: kp.adGroupName,
                    adGroupId: kp.adGroupId,
                    matchType: kp.matchType,
                    cost: parseFloat(kp.cost) || 0,
                    attributedSales30d: parseFloat(kp.attributedSales30d) || 0,
                    impressions: parseFloat(kp.impressions) || 0,
                    clicks: parseFloat(kp.clicks) || 0,
                    adKeywordStatus: kp.adKeywordStatus || null
                });
            }
        });

        // Filter for wasted spend (cost > 0 and sales < 0.01)
        const wastedKeywords = Array.from(keywordMap.values())
            .filter(k => k.cost > 0 && k.attributedSales30d < 0.01)
            .sort((a, b) => b.cost - a.cost);

        const totalItems = wastedKeywords.length;
        const totalWastedSpend = wastedKeywords.reduce((sum, k) => sum + k.cost, 0);
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
            clicks: k.clicks,
            status: k.adKeywordStatus || null
        }));

        return {
            data: paginatedData,
            pagination: createPaginationMeta(page, limit, totalItems),
            totalWastedSpend: parseFloat(totalWastedSpend.toFixed(2))
        };
    } catch (error) {
        logger.error('[ProductPPCIssuesService] Error getting wasted spend keywords', { error: error.message, asin });
        throw error;
    }
}

/**
 * Get top performing keywords for a specific ASIN (paginated)
 */
async function getProductTopPerformingKeywords({ userId, region, country, asin, page = 1, limit = 10 }) {
    if (!asin) {
        throw new Error('ASIN is required');
    }

    const normalizedAsin = asin.trim().toUpperCase();
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    try {
        const [ppcData, keywordPerformance] = await Promise.all([
            fetchAsinPPCData(userObjectId, country, region, normalizedAsin),
            fetchKeywordPerformance(userObjectId, country, region)
        ]);

        if (!ppcData || ppcData.length === 0) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0) };
        }

        const adGroupIds = [...new Set(ppcData.map(item => item.adGroupId))];
        const campaignIds = [...new Set(ppcData.map(item => item.campaignId))];
        const relevantKeywordPerformance = getKeywordPerformanceForAdGroups(keywordPerformance, adGroupIds, campaignIds);

        // Aggregate keyword performance
        const keywordMap = new Map();
        relevantKeywordPerformance.forEach(kp => {
            const uniqueKey = `${kp.keyword || ''}|${kp.campaignId || ''}|${kp.adGroupId || ''}`;
            
            if (keywordMap.has(uniqueKey)) {
                const existing = keywordMap.get(uniqueKey);
                existing.cost += parseFloat(kp.cost) || 0;
                existing.attributedSales30d += parseFloat(kp.attributedSales30d) || 0;
                existing.impressions += parseFloat(kp.impressions) || 0;
                existing.clicks += parseFloat(kp.clicks) || 0;
            } else {
                keywordMap.set(uniqueKey, {
                    keyword: kp.keyword,
                    keywordId: kp.keywordId,
                    campaignName: kp.campaignName,
                    campaignId: kp.campaignId,
                    adGroupName: kp.adGroupName,
                    adGroupId: kp.adGroupId,
                    matchType: kp.matchType,
                    cost: parseFloat(kp.cost) || 0,
                    attributedSales30d: parseFloat(kp.attributedSales30d) || 0,
                    impressions: parseFloat(kp.impressions) || 0,
                    clicks: parseFloat(kp.clicks) || 0
                });
            }
        });

        // Filter for top performing (ACOS < 30%, sales > 5, impressions > 50)
        const topKeywords = Array.from(keywordMap.values())
            .map(k => {
                const acos = k.attributedSales30d > 0 ? (k.cost / k.attributedSales30d) * 100 : 0;
                return { ...k, acos };
            })
            .filter(k => k.acos < 30 && k.acos > 0 && k.attributedSales30d > 5 && k.impressions > 50)
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

        return {
            data: paginatedData,
            pagination: createPaginationMeta(page, limit, totalItems)
        };
    } catch (error) {
        logger.error('[ProductPPCIssuesService] Error getting top performing keywords', { error: error.message, asin });
        throw error;
    }
}

/**
 * Get search terms with zero sales for a specific ASIN (paginated)
 */
async function getProductSearchTermsZeroSales({ userId, region, country, asin, page = 1, limit = 10 }) {
    if (!asin) {
        throw new Error('ASIN is required');
    }

    const normalizedAsin = asin.trim().toUpperCase();
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    try {
        const [ppcData, searchTermsData] = await Promise.all([
            fetchAsinPPCData(userObjectId, country, region, normalizedAsin),
            fetchSearchTerms(userId, country, region)
        ]);

        if (!ppcData || ppcData.length === 0) {
            return { data: [], pagination: createPaginationMeta(page, limit, 0), totalWastedSpend: 0 };
        }

        const adGroupIds = [...new Set(ppcData.map(item => item.adGroupId))];
        const campaignIds = [...new Set(ppcData.map(item => item.campaignId))];
        const relevantSearchTerms = getSearchTermsForAdGroups(searchTermsData, adGroupIds, campaignIds);

        // Aggregate search terms
        const searchTermMap = new Map();
        relevantSearchTerms.forEach(st => {
            const uniqueKey = `${st.searchTerm || ''}|${st.campaignId || ''}|${st.adGroupId || ''}`;
            
            if (searchTermMap.has(uniqueKey)) {
                const existing = searchTermMap.get(uniqueKey);
                existing.sales += parseFloat(st.sales) || 0;
                existing.spend += parseFloat(st.spend) || 0;
                existing.clicks += parseFloat(st.clicks) || 0;
                existing.impressions += parseFloat(st.impressions) || 0;
            } else {
                searchTermMap.set(uniqueKey, {
                    searchTerm: st.searchTerm,
                    keyword: st.keyword,
                    campaignName: st.campaignName,
                    campaignId: st.campaignId,
                    adGroupName: st.adGroupName,
                    adGroupId: st.adGroupId,
                    sales: parseFloat(st.sales) || 0,
                    spend: parseFloat(st.spend) || 0,
                    clicks: parseFloat(st.clicks) || 0,
                    impressions: parseFloat(st.impressions) || 0
                });
            }
        });

        // Filter for zero sales (clicks >= 5 and sales < 0.01)
        const zeroSalesTerms = Array.from(searchTermMap.values())
            .filter(t => t.clicks >= 5 && t.sales < 0.01)
            .sort((a, b) => b.spend - a.spend);

        const totalItems = zeroSalesTerms.length;
        const totalWastedSpend = zeroSalesTerms.reduce((sum, t) => sum + t.spend, 0);
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

        return {
            data: paginatedData,
            pagination: createPaginationMeta(page, limit, totalItems),
            totalWastedSpend: parseFloat(totalWastedSpend.toFixed(2))
        };
    } catch (error) {
        logger.error('[ProductPPCIssuesService] Error getting search terms zero sales', { error: error.message, asin });
        throw error;
    }
}

/**
 * Get tab counts for product PPC keyword tables
 */
async function getProductPPCKeywordTabCounts({ userId, region, country, asin }) {
    if (!asin) {
        throw new Error('ASIN is required');
    }

    const normalizedAsin = asin.trim().toUpperCase();
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    try {
        const [ppcData, keywordPerformance, searchTermsData] = await Promise.all([
            fetchAsinPPCData(userObjectId, country, region, normalizedAsin),
            fetchKeywordPerformance(userObjectId, country, region),
            fetchSearchTerms(userId, country, region)
        ]);

        if (!ppcData || ppcData.length === 0) {
            return {
                wastedSpend: { total: 0, totalWastedSpend: 0 },
                topPerforming: { total: 0 },
                searchTermsZeroSales: { total: 0, totalWastedSpend: 0 }
            };
        }

        const adGroupIds = [...new Set(ppcData.map(item => item.adGroupId))];
        const campaignIds = [...new Set(ppcData.map(item => item.campaignId))];
        const relevantKeywordPerformance = getKeywordPerformanceForAdGroups(keywordPerformance, adGroupIds, campaignIds);
        const relevantSearchTerms = getSearchTermsForAdGroups(searchTermsData, adGroupIds, campaignIds);

        // Aggregate keywords
        const keywordMap = new Map();
        relevantKeywordPerformance.forEach(kp => {
            const uniqueKey = `${kp.keyword || ''}|${kp.campaignId || ''}|${kp.adGroupId || ''}`;
            if (keywordMap.has(uniqueKey)) {
                const existing = keywordMap.get(uniqueKey);
                existing.cost += parseFloat(kp.cost) || 0;
                existing.attributedSales30d += parseFloat(kp.attributedSales30d) || 0;
                existing.impressions += parseFloat(kp.impressions) || 0;
                existing.clicks += parseFloat(kp.clicks) || 0;
            } else {
                keywordMap.set(uniqueKey, {
                    cost: parseFloat(kp.cost) || 0,
                    attributedSales30d: parseFloat(kp.attributedSales30d) || 0,
                    impressions: parseFloat(kp.impressions) || 0,
                    clicks: parseFloat(kp.clicks) || 0
                });
            }
        });

        const aggregatedKeywords = Array.from(keywordMap.values());

        // Count wasted spend
        const wastedKeywords = aggregatedKeywords.filter(k => k.cost > 0 && k.attributedSales30d < 0.01);
        const wastedSpendTotal = wastedKeywords.reduce((sum, k) => sum + k.cost, 0);

        // Count top performing
        const topKeywords = aggregatedKeywords.filter(k => {
            const acos = k.attributedSales30d > 0 ? (k.cost / k.attributedSales30d) * 100 : 0;
            return acos < 30 && acos > 0 && k.attributedSales30d > 5 && k.impressions > 50;
        });

        // Aggregate search terms
        const searchTermMap = new Map();
        relevantSearchTerms.forEach(st => {
            const uniqueKey = `${st.searchTerm || ''}|${st.campaignId || ''}|${st.adGroupId || ''}`;
            if (searchTermMap.has(uniqueKey)) {
                const existing = searchTermMap.get(uniqueKey);
                existing.sales += parseFloat(st.sales) || 0;
                existing.spend += parseFloat(st.spend) || 0;
                existing.clicks += parseFloat(st.clicks) || 0;
            } else {
                searchTermMap.set(uniqueKey, {
                    sales: parseFloat(st.sales) || 0,
                    spend: parseFloat(st.spend) || 0,
                    clicks: parseFloat(st.clicks) || 0
                });
            }
        });

        const zeroSalesTerms = Array.from(searchTermMap.values()).filter(t => t.clicks >= 5 && t.sales < 0.01);
        const searchTermsWastedSpend = zeroSalesTerms.reduce((sum, t) => sum + t.spend, 0);

        return {
            wastedSpend: { total: wastedKeywords.length, totalWastedSpend: parseFloat(wastedSpendTotal.toFixed(2)) },
            topPerforming: { total: topKeywords.length },
            searchTermsZeroSales: { total: zeroSalesTerms.length, totalWastedSpend: parseFloat(searchTermsWastedSpend.toFixed(2)) }
        };
    } catch (error) {
        logger.error('[ProductPPCIssuesService] Error getting tab counts', { error: error.message, asin });
        throw error;
    }
}

module.exports = {
    getProductPPCIssues,
    getProductWastedSpendKeywords,
    getProductTopPerformingKeywords,
    getProductSearchTermsZeroSales,
    getProductPPCKeywordTabCounts
};

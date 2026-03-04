/**
 * QMatePPCService
 * 
 * Specialized service for PPC/Advertising data for QMate AI.
 * Provides detailed campaign analysis, keyword performance, and ad optimization insights.
 * 
 * Data Sources:
 * - PPCMetrics: Overall PPC performance summary
 * - adsKeywordsPerformance: Keyword-level performance data
 * - SearchTerms: Search term performance for targeting
 * - Campaign: Campaign configuration data
 * - IssuesDataChunks: PPC-related issues and recommendations
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const adsKeywordsPerformance = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const SearchTerms = require('../../models/amazon-ads/SearchTermsModel.js');
const Campaign = require('../../models/amazon-ads/CampaignModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const mongoose = require('mongoose');

/**
 * Get high ACOS campaigns for optimization
 * Returns campaigns with ACOS above threshold
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} acosThreshold - ACOS threshold (default 50%)
 * @returns {Promise<Object>} High ACOS campaigns
 */
async function getHighAcosCampaigns(userId, country, region, acosThreshold = 50) {
    const startTime = Date.now();
    
    try {
        const userIdStr = userId?.toString() || userId;
        
        const keywordsData = await adsKeywordsPerformance.findOne({ userId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!keywordsData || !keywordsData.keywordsData) {
            return {
                success: false,
                source: 'none',
                error: 'No keywords data found',
                data: null
            };
        }
        
        // Group keywords by campaign
        const campaignMap = new Map();
        
        keywordsData.keywordsData.forEach(keyword => {
            const campaignId = keyword.campaignId?.toString() || 'unknown';
            const campaignName = keyword.campaignName || 'Unknown Campaign';
            
            if (!campaignMap.has(campaignId)) {
                campaignMap.set(campaignId, {
                    campaignId,
                    campaignName,
                    totalSpend: 0,
                    totalSales: 0,
                    totalClicks: 0,
                    totalImpressions: 0,
                    keywordCount: 0
                });
            }
            
            const campaign = campaignMap.get(campaignId);
            campaign.totalSpend += parseFloat(keyword.cost) || 0;
            campaign.totalSales += parseFloat(keyword.attributedSales30d) || 0;
            campaign.totalClicks += keyword.clicks || 0;
            campaign.totalImpressions += keyword.impressions || 0;
            campaign.keywordCount++;
        });
        
        // Calculate ACOS and filter high ACOS campaigns
        const highAcosCampaigns = Array.from(campaignMap.values())
            .map(c => {
                const acos = c.totalSales > 0 ? (c.totalSpend / c.totalSales) * 100 : (c.totalSpend > 0 ? 999 : 0);
                const roas = c.totalSpend > 0 ? c.totalSales / c.totalSpend : 0;
                return {
                    ...c,
                    acos: parseFloat(acos.toFixed(2)),
                    roas: parseFloat(roas.toFixed(2)),
                    totalSpend: parseFloat(c.totalSpend.toFixed(2)),
                    totalSales: parseFloat(c.totalSales.toFixed(2))
                };
            })
            .filter(c => c.acos >= acosThreshold && c.totalSpend > 5)
            .sort((a, b) => b.totalSpend - a.totalSpend)
            .slice(0, 15);
        
        const totalWastedOnHighAcos = highAcosCampaigns.reduce((sum, c) => {
            const wastedPortion = c.totalSpend - (c.totalSales * (acosThreshold / 100));
            return sum + Math.max(0, wastedPortion);
        }, 0);
        
        logger.info('[QMatePPCService] Got high ACOS campaigns', {
            userId, country, region,
            duration: Date.now() - startTime,
            highAcosCampaignsCount: highAcosCampaigns.length
        });
        
        return {
            success: true,
            source: 'ads_keywords_performance',
            data: {
                highAcosCampaigns,
                count: highAcosCampaigns.length,
                totalWastedOnHighAcos: parseFloat(totalWastedOnHighAcos.toFixed(2)),
                threshold: acosThreshold
            }
        };
        
    } catch (error) {
        logger.error('[QMatePPCService] Error getting high ACOS campaigns', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get zero-sales keywords (bleeding keywords)
 * Keywords with spend but no sales
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} minSpend - Minimum spend to consider (default $5)
 * @returns {Promise<Object>} Zero-sales keywords
 */
async function getZeroSalesKeywords(userId, country, region, minSpend = 5) {
    const startTime = Date.now();
    
    try {
        const keywordsData = await adsKeywordsPerformance.findOne({ userId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!keywordsData || !keywordsData.keywordsData) {
            return {
                success: false,
                source: 'none',
                error: 'No keywords data found',
                data: null
            };
        }
        
        // Filter keywords with spend but no sales
        const zeroSalesKeywords = keywordsData.keywordsData
            .filter(kw => {
                const cost = parseFloat(kw.cost) || 0;
                const sales = parseFloat(kw.attributedSales30d) || 0;
                return cost >= minSpend && sales < 0.01;
            })
            .sort((a, b) => (parseFloat(b.cost) || 0) - (parseFloat(a.cost) || 0))
            .slice(0, 30)
            .map(kw => ({
                keyword: kw.keyword,
                campaignName: kw.campaignName,
                adGroupName: kw.adGroupName,
                matchType: kw.matchType,
                spend: parseFloat((kw.cost || 0).toFixed(2)),
                clicks: kw.clicks || 0,
                impressions: kw.impressions || 0,
                status: kw.adKeywordStatus || 'unknown',
                recommendation: 'Consider adding as negative keyword or pausing'
            }));
        
        const totalWasted = zeroSalesKeywords.reduce((sum, kw) => sum + kw.spend, 0);
        
        logger.info('[QMatePPCService] Got zero-sales keywords', {
            userId, country, region,
            duration: Date.now() - startTime,
            zeroSalesCount: zeroSalesKeywords.length,
            totalWasted
        });
        
        return {
            success: true,
            source: 'ads_keywords_performance',
            data: {
                zeroSalesKeywords,
                count: zeroSalesKeywords.length,
                totalWasted: parseFloat(totalWasted.toFixed(2)),
                minSpendThreshold: minSpend
            }
        };
        
    } catch (error) {
        logger.error('[QMatePPCService] Error getting zero-sales keywords', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get top performing keywords
 * Keywords with best ROAS/sales
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} limit - Max keywords to return
 * @returns {Promise<Object>} Top performing keywords
 */
async function getTopPerformingKeywords(userId, country, region, limit = 20) {
    const startTime = Date.now();
    
    try {
        const keywordsData = await adsKeywordsPerformance.findOne({ userId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!keywordsData || !keywordsData.keywordsData) {
            return {
                success: false,
                source: 'none',
                error: 'No keywords data found',
                data: null
            };
        }
        
        // Get keywords with sales and calculate ROAS
        const topKeywords = keywordsData.keywordsData
            .filter(kw => (parseFloat(kw.attributedSales30d) || 0) > 0)
            .map(kw => {
                const sales = parseFloat(kw.attributedSales30d) || 0;
                const cost = parseFloat(kw.cost) || 0;
                const roas = cost > 0 ? sales / cost : 999;
                const acos = sales > 0 ? (cost / sales) * 100 : 0;
                
                return {
                    keyword: kw.keyword,
                    campaignName: kw.campaignName,
                    adGroupName: kw.adGroupName,
                    matchType: kw.matchType,
                    sales: parseFloat(sales.toFixed(2)),
                    spend: parseFloat(cost.toFixed(2)),
                    clicks: kw.clicks || 0,
                    impressions: kw.impressions || 0,
                    roas: parseFloat(roas.toFixed(2)),
                    acos: parseFloat(acos.toFixed(2)),
                    conversionRate: kw.clicks > 0 
                        ? parseFloat(((sales / (cost / kw.clicks)) * 100).toFixed(2)) 
                        : 0
                };
            })
            .sort((a, b) => b.sales - a.sales)
            .slice(0, limit);
        
        logger.info('[QMatePPCService] Got top performing keywords', {
            userId, country, region,
            duration: Date.now() - startTime,
            topKeywordsCount: topKeywords.length
        });
        
        return {
            success: true,
            source: 'ads_keywords_performance',
            data: {
                topKeywords,
                count: topKeywords.length
            }
        };
        
    } catch (error) {
        logger.error('[QMatePPCService] Error getting top performing keywords', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get search term analysis
 * Identifies converting and non-converting search terms
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Search term analysis
 */
async function getSearchTermAnalysis(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const searchTermsData = await SearchTerms.findOne({ userId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!searchTermsData || !searchTermsData.searchTermData) {
            return {
                success: false,
                source: 'none',
                error: 'No search terms data found',
                data: null
            };
        }
        
        const terms = searchTermsData.searchTermData;
        
        // Separate converting and non-converting terms
        const convertingTerms = terms
            .filter(t => (t.sales || 0) > 0)
            .sort((a, b) => (b.sales || 0) - (a.sales || 0))
            .slice(0, 20)
            .map(t => ({
                searchTerm: t.searchTerm,
                keyword: t.keyword,
                campaignName: t.campaignName,
                sales: parseFloat((t.sales || 0).toFixed(2)),
                spend: parseFloat((t.spend || 0).toFixed(2)),
                clicks: t.clicks || 0,
                acos: t.sales > 0 ? parseFloat(((t.spend / t.sales) * 100).toFixed(2)) : 0,
                recommendation: 'Consider adding as exact match keyword'
            }));
        
        const wastedTerms = terms
            .filter(t => (t.spend || 0) > 5 && (t.sales || 0) < 0.01)
            .sort((a, b) => (b.spend || 0) - (a.spend || 0))
            .slice(0, 20)
            .map(t => ({
                searchTerm: t.searchTerm,
                keyword: t.keyword,
                campaignName: t.campaignName,
                spend: parseFloat((t.spend || 0).toFixed(2)),
                clicks: t.clicks || 0,
                impressions: t.impressions || 0,
                recommendation: 'Consider adding as negative keyword'
            }));
        
        const totalWastedOnTerms = wastedTerms.reduce((sum, t) => sum + t.spend, 0);
        
        logger.info('[QMatePPCService] Got search term analysis', {
            userId, country, region,
            duration: Date.now() - startTime,
            convertingCount: convertingTerms.length,
            wastedCount: wastedTerms.length
        });
        
        return {
            success: true,
            source: 'search_terms',
            data: {
                convertingTerms,
                wastedTerms,
                totalWastedOnTerms: parseFloat(totalWastedOnTerms.toFixed(2)),
                summary: {
                    totalTerms: terms.length,
                    convertingCount: convertingTerms.length,
                    wastedCount: wastedTerms.length
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMatePPCService] Error getting search term analysis', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get campaign overview with status
 * Returns all campaigns with their current state
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Campaign overview
 */
async function getCampaignOverview(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userIdStr = userId?.toString() || userId;
        
        const [campaignData, ppcMetrics] = await Promise.all([
            Campaign.findOne({ userId: userIdStr, country, region })
                .sort({ createdAt: -1 }).lean(),
            PPCMetrics.findLatestForUser(userIdStr, country, region)
        ]);
        
        if (!campaignData || !campaignData.campaignData) {
            return {
                success: false,
                source: 'none',
                error: 'No campaign data found',
                data: null
            };
        }
        
        const campaigns = campaignData.campaignData;
        
        // Count by state
        const stateCounts = {
            enabled: campaigns.filter(c => c.state?.toLowerCase() === 'enabled').length,
            paused: campaigns.filter(c => c.state?.toLowerCase() === 'paused').length,
            archived: campaigns.filter(c => c.state?.toLowerCase() === 'archived').length,
            total: campaigns.length
        };
        
        // Count by type
        const typeCounts = {
            sponsoredProducts: campaigns.filter(c => 
                c.campaignType?.toLowerCase()?.includes('sponsored products') || 
                c.campaignType?.toLowerCase() === 'sp'
            ).length,
            sponsoredBrands: campaigns.filter(c => 
                c.campaignType?.toLowerCase()?.includes('sponsored brands') || 
                c.campaignType?.toLowerCase() === 'sb'
            ).length,
            sponsoredDisplay: campaigns.filter(c => 
                c.campaignType?.toLowerCase()?.includes('sponsored display') || 
                c.campaignType?.toLowerCase() === 'sd'
            ).length
        };
        
        // Get campaign list with budgets
        const campaignList = campaigns
            .filter(c => c.state?.toLowerCase() === 'enabled')
            .map(c => ({
                campaignId: c.campaignId,
                name: c.name,
                type: c.campaignType,
                targetingType: c.targetingType,
                dailyBudget: c.dailyBudget || 0,
                state: c.state,
                startDate: c.startDate
            }))
            .sort((a, b) => (b.dailyBudget || 0) - (a.dailyBudget || 0))
            .slice(0, 20);
        
        const totalDailyBudget = campaignList.reduce((sum, c) => sum + (c.dailyBudget || 0), 0);
        
        logger.info('[QMatePPCService] Got campaign overview', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalCampaigns: campaigns.length,
            enabledCampaigns: stateCounts.enabled
        });
        
        return {
            success: true,
            source: 'campaign_data',
            data: {
                stateCounts,
                typeCounts,
                campaigns: campaignList,
                totalDailyBudget: parseFloat(totalDailyBudget.toFixed(2)),
                ppcSummary: ppcMetrics?.summary || null
            }
        };
        
    } catch (error) {
        logger.error('[QMatePPCService] Error getting campaign overview', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get PPC issues and recommendations from issues data
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} PPC issues
 */
async function getPPCIssues(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Get sponsored ads errors from IssuesDataChunks
        const sponsoredAdsErrors = await IssuesDataChunks.getFieldData(
            userObjectId, country, region, 'sponsoredAdsError'
        );
        
        if (!sponsoredAdsErrors || sponsoredAdsErrors.length === 0) {
            return {
                success: false,
                source: 'none',
                error: 'No PPC issues data found',
                data: null
            };
        }
        
        // Categorize issues
        const highAcosIssues = [];
        const lowImpressionIssues = [];
        const budgetIssues = [];
        const otherIssues = [];
        
        sponsoredAdsErrors.forEach(issue => {
            const issueType = (issue.type || issue.errorType || '').toLowerCase();
            
            if (issueType.includes('acos') || issueType.includes('high cost')) {
                highAcosIssues.push(issue);
            } else if (issueType.includes('impression') || issueType.includes('visibility')) {
                lowImpressionIssues.push(issue);
            } else if (issueType.includes('budget')) {
                budgetIssues.push(issue);
            } else {
                otherIssues.push(issue);
            }
        });
        
        logger.info('[QMatePPCService] Got PPC issues', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalIssues: sponsoredAdsErrors.length
        });
        
        return {
            success: true,
            source: 'issues_data_chunks',
            data: {
                totalIssues: sponsoredAdsErrors.length,
                highAcosIssues: highAcosIssues.slice(0, 10),
                lowImpressionIssues: lowImpressionIssues.slice(0, 10),
                budgetIssues: budgetIssues.slice(0, 10),
                otherIssues: otherIssues.slice(0, 10)
            }
        };
        
    } catch (error) {
        logger.error('[QMatePPCService] Error getting PPC issues', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get complete PPC context for QMate AI
 * Combines all PPC data sources
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {Object} options - Options
 * @returns {Promise<Object>} Complete PPC context
 */
async function getQMatePPCContext(userId, country, region, options = {}) {
    const startTime = Date.now();
    
    try {
        // Fetch all PPC data in parallel
        const [
            highAcosResult,
            zeroSalesResult,
            topKeywordsResult,
            searchTermsResult,
            campaignResult,
            ppcIssuesResult,
            ppcMetrics
        ] = await Promise.all([
            getHighAcosCampaigns(userId, country, region, options.acosThreshold || 50),
            getZeroSalesKeywords(userId, country, region, options.minSpend || 5),
            getTopPerformingKeywords(userId, country, region, options.topKeywordsLimit || 15),
            getSearchTermAnalysis(userId, country, region),
            getCampaignOverview(userId, country, region),
            getPPCIssues(userId, country, region),
            PPCMetrics.findLatestForUser(userId?.toString(), country, region)
        ]);
        
        const context = {
            summary: null,
            highAcosCampaigns: null,
            zeroSalesKeywords: null,
            topPerformingKeywords: null,
            searchTerms: null,
            campaigns: null,
            issues: null
        };
        
        // Add PPC summary
        if (ppcMetrics) {
            context.summary = {
                totalSpend: ppcMetrics.summary?.totalSpend || 0,
                totalSalesFromAds: ppcMetrics.summary?.totalSales || 0,
                overallAcos: ppcMetrics.summary?.overallAcos || 0,
                overallRoas: ppcMetrics.summary?.overallRoas || 0,
                totalImpressions: ppcMetrics.summary?.totalImpressions || 0,
                totalClicks: ppcMetrics.summary?.totalClicks || 0,
                ctr: ppcMetrics.summary?.ctr || 0,
                cpc: ppcMetrics.summary?.cpc || 0,
                dateRange: ppcMetrics.dateRange,
                campaignTypeBreakdown: ppcMetrics.campaignTypeBreakdown || null
            };
        }
        
        // Add high ACOS data
        if (highAcosResult?.success) {
            context.highAcosCampaigns = highAcosResult.data;
        }
        
        // Add zero sales keywords
        if (zeroSalesResult?.success) {
            context.zeroSalesKeywords = zeroSalesResult.data;
        }
        
        // Add top performing keywords
        if (topKeywordsResult?.success) {
            context.topPerformingKeywords = topKeywordsResult.data;
        }
        
        // Add search terms analysis
        if (searchTermsResult?.success) {
            context.searchTerms = searchTermsResult.data;
        }
        
        // Add campaign overview
        if (campaignResult?.success) {
            context.campaigns = campaignResult.data;
        }
        
        // Add PPC issues
        if (ppcIssuesResult?.success) {
            context.issues = ppcIssuesResult.data;
        }
        
        // Calculate optimization opportunities
        const totalWasted = 
            (context.highAcosCampaigns?.totalWastedOnHighAcos || 0) +
            (context.zeroSalesKeywords?.totalWasted || 0) +
            (context.searchTerms?.totalWastedOnTerms || 0);
        
        context.optimizationOpportunity = {
            totalWastedSpend: parseFloat(totalWasted.toFixed(2)),
            highAcosCount: context.highAcosCampaigns?.count || 0,
            zeroSalesCount: context.zeroSalesKeywords?.count || 0,
            wastedSearchTermsCount: context.searchTerms?.summary?.wastedCount || 0
        };
        
        logger.info('[QMatePPCService] Got complete PPC context', {
            userId, country, region,
            duration: Date.now() - startTime,
            hasSummary: !!context.summary,
            totalWasted
        });
        
        return {
            success: true,
            source: 'combined_ppc_sources',
            data: context
        };
        
    } catch (error) {
        logger.error('[QMatePPCService] Error getting PPC context', {
            error: error.message,
            stack: error.stack,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

module.exports = {
    getHighAcosCampaigns,
    getZeroSalesKeywords,
    getTopPerformingKeywords,
    getSearchTermAnalysis,
    getCampaignOverview,
    getPPCIssues,
    getQMatePPCContext
};

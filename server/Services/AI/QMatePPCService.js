/**
 * QMatePPCService
 * 
 * Specialized service for PPC/Advertising data for QMate AI.
 * Provides detailed campaign analysis, keyword performance, and ad optimization insights.
 * 
 * IMPORTANT: This service now uses PPCCampaignAnalysisService to ensure data consistency
 * with the Campaign Analysis Dashboard. All tab data (High ACOS, Wasted Spend, etc.)
 * comes from the same source as the frontend dashboard.
 * 
 * Data Sources:
 * - PPCMetrics: Overall PPC performance summary and dateWiseMetrics
 * - PPCUnitsSold: Units sold from PPC
 * - PPCCampaignAnalysisService: All 6 dashboard tabs + KPI summary
 * - EconomicsMetrics: Total sales for TACOS calculation
 * - IssuesDataChunks: PPC-related issues and recommendations
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const PPCUnitsSold = require('../../models/amazon-ads/PPCUnitsSoldModel.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const PPCCampaignAnalysisService = require('../Calculations/PPCCampaignAnalysisService.js');
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
 * Uses PPCCampaignAnalysisService to ensure data consistency with the dashboard.
 * 
 * This provides the EXACT same data as the Campaign Analysis Dashboard:
 * - KPI Summary: PPC sales, spend, ACOS, TACOS, units sold, total issues
 * - DateWise metrics for charts
 * - All 6 tabs: High ACOS, Wasted Spend, No Negatives, Top Keywords, Zero Sales, Auto Insights
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {Object} options - Options (startDate, endDate for filtering)
 * @returns {Promise<Object>} Complete PPC context matching dashboard
 */
async function getQMatePPCContext(userId, country, region, options = {}) {
    const startTime = Date.now();
    const { startDate, endDate, limit = 50 } = options;
    
    try {
        const userIdStr = userId?.toString() || userId;
        
        // Fetch all PPC data in parallel - using same sources as dashboard
        const [
            kpiSummary,
            ppcMetrics,
            tabCounts,
            highAcosData,
            wastedSpendData,
            noNegativesData,
            topKeywordsData,
            zeroSalesData,
            autoInsightsData,
            ppcIssuesResult
        ] = await Promise.all([
            // KPI Summary (same as dashboard top boxes)
            PPCCampaignAnalysisService.getPPCKPISummary(userId, country, region),
            // PPCMetrics for dateWise data and campaign breakdown
            PPCMetrics.findLatestForUser(userIdStr, country, region),
            // Tab counts for overview
            PPCCampaignAnalysisService.getTabCounts(userId, country, region),
            // All 6 tabs data (same as dashboard tabs) - get more items for QMate context
            PPCCampaignAnalysisService.getHighAcosCampaigns(userId, country, region, 1, limit, startDate, endDate),
            PPCCampaignAnalysisService.getWastedSpendKeywords(userId, country, region, 1, limit, startDate, endDate),
            PPCCampaignAnalysisService.getCampaignsWithoutNegatives(userId, country, region, 1, limit),
            PPCCampaignAnalysisService.getTopPerformingKeywords(userId, country, region, 1, limit, startDate, endDate),
            PPCCampaignAnalysisService.getSearchTermsZeroSales(userId, country, region, 1, limit, startDate, endDate),
            PPCCampaignAnalysisService.getAutoCampaignInsights(userId, country, region, 1, limit, startDate, endDate),
            // PPC issues from IssuesDataChunks
            getPPCIssues(userId, country, region)
        ]);
        
        // Build context matching dashboard structure
        const context = {
            // KPI Summary - exactly matching dashboard top boxes
            summary: {
                ppcSales: kpiSummary?.sales || 0,
                ppcSpend: kpiSummary?.spend || 0,
                acos: kpiSummary?.acos || 0,
                tacos: kpiSummary?.tacos || 0,
                roas: kpiSummary?.roas || 0,
                unitsSold: kpiSummary?.unitsSold || 0,
                totalIssues: kpiSummary?.totalIssues || 0,
                impressions: kpiSummary?.impressions || 0,
                clicks: kpiSummary?.clicks || 0,
                ctr: kpiSummary?.ctr || 0,
                cpc: kpiSummary?.cpc || 0,
                dateRange: kpiSummary?.dateRange || ppcMetrics?.dateRange || null
            },
            
            // Campaign type breakdown (SP, SB, SD)
            campaignTypeBreakdown: ppcMetrics?.campaignTypeBreakdown || null,
            
            // DateWise metrics for charts - PPC sales and spend over time
            dateWiseMetrics: ppcMetrics?.dateWiseMetrics || [],
            
            // Tab counts for overview
            tabCounts: {
                highAcosCampaigns: tabCounts?.highAcos || highAcosData?.pagination?.totalItems || 0,
                wastedSpendKeywords: tabCounts?.wastedSpend || wastedSpendData?.pagination?.totalItems || 0,
                campaignsWithoutNegatives: tabCounts?.noNegatives || noNegativesData?.pagination?.totalItems || 0,
                topPerformingKeywords: tabCounts?.topKeywords || topKeywordsData?.pagination?.totalItems || 0,
                searchTermsZeroSales: tabCounts?.zeroSales || zeroSalesData?.pagination?.totalItems || 0,
                autoCampaignInsights: tabCounts?.autoInsights || autoInsightsData?.pagination?.totalItems || 0
            },
            
            // High ACOS Campaigns (ACOS > 40%, sales > 0) - Tab 0
            highAcosCampaigns: {
                data: highAcosData?.data || [],
                total: highAcosData?.pagination?.totalItems || 0,
                criteria: 'ACOS > 40% with sales > 0'
            },
            
            // Wasted Spend Keywords (cost > 0, sales < 0.01) - Tab 1
            wastedSpendKeywords: {
                data: wastedSpendData?.data || [],
                total: wastedSpendData?.pagination?.totalItems || 0,
                totalWastedSpend: (wastedSpendData?.data || []).reduce((sum, k) => sum + (k.spend || 0), 0),
                criteria: 'Keywords with spend but no sales'
            },
            
            // Campaigns Without Negative Keywords - Tab 2
            campaignsWithoutNegatives: {
                data: noNegativesData?.data || [],
                total: noNegativesData?.pagination?.totalItems || 0,
                criteria: 'Campaigns missing negative keywords'
            },
            
            // Top Performing Keywords (ACOS < 20%, sales > 100, impressions > 1000) - Tab 3
            topPerformingKeywords: {
                data: topKeywordsData?.data || [],
                total: topKeywordsData?.pagination?.totalItems || 0,
                criteria: 'ACOS < 20%, sales > 100, impressions > 1000'
            },
            
            // Search Terms with Zero Sales (clicks >= 10, sales < 0.01) - Tab 4
            searchTermsZeroSales: {
                data: zeroSalesData?.data || [],
                total: zeroSalesData?.pagination?.totalItems || 0,
                totalWastedSpend: (zeroSalesData?.data || []).reduce((sum, t) => sum + (t.spend || 0), 0),
                criteria: 'Search terms with 10+ clicks but no sales'
            },
            
            // Auto Campaign Insights (sales > 30, auto campaign, not in manual) - Tab 5
            autoCampaignInsights: {
                data: autoInsightsData?.data || [],
                total: autoInsightsData?.pagination?.totalItems || 0,
                criteria: 'High-performing auto terms to migrate to manual campaigns'
            },
            
            // PPC Issues
            issues: ppcIssuesResult?.success ? ppcIssuesResult.data : null,
            
            // Optimization opportunity summary
            optimizationSummary: {
                totalWastedSpend: parseFloat((
                    (wastedSpendData?.data || []).reduce((sum, k) => sum + (k.spend || 0), 0) +
                    (zeroSalesData?.data || []).reduce((sum, t) => sum + (t.spend || 0), 0)
                ).toFixed(2)),
                highAcosCampaignsCount: highAcosData?.pagination?.totalItems || 0,
                wastedKeywordsCount: wastedSpendData?.pagination?.totalItems || 0,
                zeroSalesTermsCount: zeroSalesData?.pagination?.totalItems || 0,
                campaignsNeedingNegatives: noNegativesData?.pagination?.totalItems || 0,
                autoTermsToMigrate: autoInsightsData?.pagination?.totalItems || 0
            }
        };
        
        logger.info('[QMatePPCService] Got complete PPC context (dashboard aligned)', {
            userId, country, region,
            duration: Date.now() - startTime,
            hasSummary: !!context.summary,
            highAcosCount: context.highAcosCampaigns.total,
            wastedSpendCount: context.wastedSpendKeywords.total,
            dateWiseCount: context.dateWiseMetrics.length
        });
        
        return {
            success: true,
            source: 'ppc_campaign_analysis_service',
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

/**
 * QMateAccountService
 * 
 * Specialized service for account-level data for QMate AI.
 * Provides historical health scores, issue trends, and account-wide analytics.
 * 
 * Data Sources:
 * - AccountHistory: Historical health scores and issue counts
 * - IssueSummary: Current issue summary
 * - V2SellerPerformance: Account health metrics
 * - sellerCentralModel: Account information
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const AccountHistory = require('../../models/user-auth/AccountHistory.js');
const IssueSummary = require('../../models/system/IssueSummaryModel.js');
const V2SellerPerformance = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1SellerPerformance = require('../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const mongoose = require('mongoose');

/**
 * Get historical health scores
 * Track health score changes over time
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Historical health data
 */
async function getHistoricalHealthScores(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const accountHistory = await AccountHistory.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!accountHistory || !accountHistory.accountHistory?.length) {
            return {
                success: true,
                source: 'account_history',
                data: {
                    hasHistory: false,
                    history: [],
                    summary: { currentScore: 0, trend: 'stable' }
                }
            };
        }
        
        // Sort by date (newest first)
        const history = accountHistory.accountHistory
            .filter(entry => entry.Date && entry.HealthScore)
            .sort((a, b) => new Date(b.Date) - new Date(a.Date))
            .slice(0, 30)
            .map(entry => ({
                date: entry.Date,
                healthScore: parseFloat(entry.HealthScore) || 0,
                totalProducts: entry.TotalProducts || 0,
                productsWithIssues: entry.ProductsWithIssues || 0,
                totalIssues: entry.TotalNumberOfIssues || 0
            }));
        
        // Calculate trend
        let trend = 'stable';
        if (history.length >= 2) {
            const latestScore = history[0].healthScore;
            const previousScore = history[Math.min(6, history.length - 1)].healthScore;
            const scoreDiff = latestScore - previousScore;
            
            if (scoreDiff > 5) trend = 'improving';
            else if (scoreDiff < -5) trend = 'declining';
        }
        
        // Calculate averages
        const avgScore = history.length > 0
            ? parseFloat((history.reduce((sum, h) => sum + h.healthScore, 0) / history.length).toFixed(2))
            : 0;
        
        const avgIssues = history.length > 0
            ? Math.round(history.reduce((sum, h) => sum + h.totalIssues, 0) / history.length)
            : 0;
        
        logger.info('[QMateAccountService] Got historical health scores', {
            userId, country, region,
            duration: Date.now() - startTime,
            historyCount: history.length
        });
        
        return {
            success: true,
            source: 'account_history',
            data: {
                hasHistory: true,
                history: history.reverse(), // Chronological order for charts
                summary: {
                    currentScore: history.length > 0 ? history[history.length - 1].healthScore : 0,
                    trend,
                    averageScore: avgScore,
                    averageIssues: avgIssues,
                    dataPointsCount: history.length
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateAccountService] Error getting historical health scores', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get issue trends over time
 * Track how issues change over time
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Issue trends
 */
async function getIssueTrends(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const accountHistory = await AccountHistory.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!accountHistory || !accountHistory.accountHistory?.length) {
            return {
                success: true,
                source: 'account_history',
                data: {
                    hasTrends: false,
                    trends: [],
                    summary: { issueChange: 0 }
                }
            };
        }
        
        // Sort and prepare trend data
        const sortedHistory = accountHistory.accountHistory
            .filter(entry => entry.Date)
            .sort((a, b) => new Date(a.Date) - new Date(b.Date));
        
        const trends = sortedHistory.slice(-14).map(entry => ({
            date: entry.Date,
            totalIssues: entry.TotalNumberOfIssues || 0,
            productsWithIssues: entry.ProductsWithIssues || 0,
            healthScore: parseFloat(entry.HealthScore) || 0
        }));
        
        // Calculate issue change
        let issueChange = 0;
        let percentChange = 0;
        if (trends.length >= 2) {
            const latestIssues = trends[trends.length - 1].totalIssues;
            const previousIssues = trends[0].totalIssues;
            issueChange = latestIssues - previousIssues;
            percentChange = previousIssues > 0 
                ? parseFloat(((issueChange / previousIssues) * 100).toFixed(2))
                : 0;
        }
        
        // Identify if issues are increasing or decreasing
        let trendDirection = 'stable';
        if (issueChange > 5) trendDirection = 'increasing';
        else if (issueChange < -5) trendDirection = 'decreasing';
        
        logger.info('[QMateAccountService] Got issue trends', {
            userId, country, region,
            duration: Date.now() - startTime,
            trendsCount: trends.length
        });
        
        return {
            success: true,
            source: 'account_history',
            data: {
                hasTrends: true,
                trends,
                summary: {
                    issueChange,
                    percentChange,
                    trendDirection,
                    dataPointsCount: trends.length
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateAccountService] Error getting issue trends', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get current account status summary
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Account status
 */
async function getAccountStatus(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Fetch data in parallel
        const [issueSummary, v2Performance, sellerData] = await Promise.all([
            IssueSummary.getIssueSummary(userObjectId, country, region),
            V2SellerPerformance.findOne({ User: userObjectId, country, region }).sort({ createdAt: -1 }).lean(),
            Seller.findOne({ User: userObjectId }).select('sellerAccount').lean()
        ]);
        
        // Find matching seller account
        const account = sellerData?.sellerAccount?.find(
            acc => acc.country === country && acc.region === region
        );
        
        // Calculate overall health
        let healthScore = 100;
        const issues = [];
        
        if (v2Performance) {
            if (v2Performance.CancellationRate && v2Performance.CancellationRate !== 'GOOD' && v2Performance.CancellationRate !== '') {
                healthScore -= 15;
                issues.push({ metric: 'Cancellation Rate', status: v2Performance.CancellationRate, impact: 'high' });
            }
            if (v2Performance.orderWithDefectsStatus && v2Performance.orderWithDefectsStatus !== 'GOOD' && v2Performance.orderWithDefectsStatus !== '') {
                healthScore -= 20;
                issues.push({ metric: 'Order Defects', status: v2Performance.orderWithDefectsStatus, impact: 'critical' });
            }
            if (v2Performance.lateShipmentRateStatus && v2Performance.lateShipmentRateStatus !== 'GOOD' && v2Performance.lateShipmentRateStatus !== '') {
                healthScore -= 15;
                issues.push({ metric: 'Late Shipment Rate', status: v2Performance.lateShipmentRateStatus, impact: 'high' });
            }
        }
        
        healthScore = Math.max(0, healthScore);
        
        let accountHealthStatus = 'Healthy';
        if (healthScore < 50) accountHealthStatus = 'Critical';
        else if (healthScore < 80) accountHealthStatus = 'At Risk';
        
        logger.info('[QMateAccountService] Got account status', {
            userId, country, region,
            duration: Date.now() - startTime,
            healthScore
        });
        
        return {
            success: true,
            source: 'v2_account_data',
            data: {
                accountInfo: {
                    marketplace: country,
                    region,
                    totalProducts: account?.products?.length || 0,
                    activeProducts: account?.products?.filter(p => p.status === 'Active')?.length || 0
                },
                health: {
                    score: healthScore,
                    status: accountHealthStatus,
                    ahrScore: v2Performance?.ahrScore || null
                },
                issues: {
                    total: issueSummary?.totalIssues || 0,
                    ranking: issueSummary?.totalRankingErrors || 0,
                    conversion: issueSummary?.totalConversionErrors || 0,
                    inventory: issueSummary?.totalInventoryErrors || 0,
                    profitability: issueSummary?.totalProfitabilityErrors || 0,
                    sponsoredAds: issueSummary?.totalSponsoredAdsErrors || 0,
                    account: issueSummary?.totalAccountErrors || 0
                },
                performanceIssues: issues,
                productsWithIssues: issueSummary?.numberOfProductsWithIssues || 0
            }
        };
        
    } catch (error) {
        logger.error('[QMateAccountService] Error getting account status', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get account comparison across marketplaces
 * Compare performance across different marketplaces
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Marketplace comparison
 */
async function getMarketplaceComparison(userId) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const sellerData = await Seller.findOne({ User: userObjectId })
            .select('sellerAccount')
            .lean();
        
        if (!sellerData?.sellerAccount?.length) {
            return {
                success: true,
                source: 'seller_central',
                data: {
                    hasMultipleMarketplaces: false,
                    marketplaces: []
                }
            };
        }
        
        // Get issue summary for each marketplace
        const marketplaceData = await Promise.all(
            sellerData.sellerAccount.map(async (account) => {
                const issueSummary = await IssueSummary.getIssueSummary(
                    userObjectId, 
                    account.country, 
                    account.region
                ).catch(() => null);
                
                return {
                    country: account.country,
                    region: account.region,
                    totalProducts: account.products?.length || 0,
                    activeProducts: account.products?.filter(p => p.status === 'Active')?.length || 0,
                    totalIssues: issueSummary?.totalIssues || 0,
                    productsWithIssues: issueSummary?.numberOfProductsWithIssues || 0
                };
            })
        );
        
        logger.info('[QMateAccountService] Got marketplace comparison', {
            userId,
            duration: Date.now() - startTime,
            marketplacesCount: marketplaceData.length
        });
        
        return {
            success: true,
            source: 'seller_central',
            data: {
                hasMultipleMarketplaces: marketplaceData.length > 1,
                marketplaces: marketplaceData
            }
        };
        
    } catch (error) {
        logger.error('[QMateAccountService] Error getting marketplace comparison', {
            error: error.message, userId
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get complete account context for QMate AI
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Complete account context
 */
async function getQMateAccountContext(userId, country, region) {
    const startTime = Date.now();
    
    try {
        // Fetch all account data in parallel
        const [
            historicalResult,
            trendsResult,
            statusResult,
            comparisonResult
        ] = await Promise.all([
            getHistoricalHealthScores(userId, country, region),
            getIssueTrends(userId, country, region),
            getAccountStatus(userId, country, region),
            getMarketplaceComparison(userId)
        ]);
        
        const context = {
            historicalHealth: null,
            issueTrends: null,
            currentStatus: null,
            marketplaceComparison: null
        };
        
        if (historicalResult?.success) {
            context.historicalHealth = historicalResult.data;
        }
        
        if (trendsResult?.success) {
            context.issueTrends = trendsResult.data;
        }
        
        if (statusResult?.success) {
            context.currentStatus = statusResult.data;
        }
        
        if (comparisonResult?.success) {
            context.marketplaceComparison = comparisonResult.data;
        }
        
        // Generate account insights
        const healthTrend = context.historicalHealth?.summary?.trend || 'stable';
        const issueTrend = context.issueTrends?.summary?.trendDirection || 'stable';
        const currentScore = context.currentStatus?.health?.score || 0;
        
        context.insights = {
            overallStatus: context.currentStatus?.health?.status || 'Unknown',
            healthTrend,
            issueTrend,
            recommendations: [
                ...(currentScore < 80 ? ['Review and resolve performance issues to improve account health'] : []),
                ...(issueTrend === 'increasing' ? ['Issues are increasing - prioritize resolution'] : []),
                ...(healthTrend === 'declining' ? ['Health score is declining - investigate root causes'] : []),
                ...(currentScore >= 90 && issueTrend !== 'increasing' ? ['Account is in good health - focus on growth'] : [])
            ].slice(0, 3)
        };
        
        logger.info('[QMateAccountService] Got complete account context', {
            userId, country, region,
            duration: Date.now() - startTime
        });
        
        return {
            success: true,
            source: 'combined_account_sources',
            data: context
        };
        
    } catch (error) {
        logger.error('[QMateAccountService] Error getting account context', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

module.exports = {
    getHistoricalHealthScores,
    getIssueTrends,
    getAccountStatus,
    getMarketplaceComparison,
    getQMateAccountContext
};

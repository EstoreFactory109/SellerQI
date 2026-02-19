/**
 * IssueSummaryService
 * 
 * Service for calculating and storing issue summaries for dashboard quick access.
 * This service uses the EXACT same calculation logic as DashboardCalculation.js
 * to ensure consistency across the application.
 * 
 * The precomputed issue counts are stored in IssueSummary model and used by:
 * - Main dashboard "Total Issues" display
 * - Quick stats cards
 * - Analytics overview
 * 
 * The data is refreshed:
 * 1. After first-time integration (integration worker)
 * 2. After scheduled data fetches that affect issue calculations
 */

const logger = require('../../utils/Logger.js');
const IssueSummary = require('../../models/system/IssueSummaryModel.js');
const { AnalyseService } = require('../main/Analyse.js');
const { analyseData } = require('./DashboardCalculation.js');

/**
 * Calculate and store issue summary for a user
 * Uses the same calculation flow as Integration.addNewAccountHistory()
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} source - Source of calculation ('integration', 'schedule', 'manual')
 * @returns {Promise<Object>} Result object with success status and data
 */
async function calculateAndStoreIssueSummary(userId, country, region, source = 'integration') {
    const startTime = Date.now();
    
    logger.info('[IssueSummaryService] Starting issue summary calculation', {
        userId,
        country,
        region,
        source
    });
    
    try {
        // Step 1: Get raw analyse data (same as Integration.addNewAccountHistory)
        const getAnalyseData = await AnalyseService.Analyse(userId, country, region);
        
        if (!getAnalyseData || getAnalyseData.status !== 200) {
            logger.error('[IssueSummaryService] Failed to get analyse data', {
                userId,
                country,
                region,
                status: getAnalyseData?.status,
                hasMessage: !!getAnalyseData?.message
            });
            return {
                success: false,
                error: `Failed to get analyse data: status ${getAnalyseData?.status}`
            };
        }
        
        // Step 2: Calculate dashboard data using DashboardCalculation
        // This is the SAME calculation used throughout the app
        const calculationResult = await analyseData(getAnalyseData.message, userId);
        
        if (!calculationResult?.dashboardData) {
            logger.error('[IssueSummaryService] Failed to calculate dashboard data', {
                userId,
                country,
                region,
                hasResult: !!calculationResult,
                hasDashboardData: !!calculationResult?.dashboardData
            });
            return {
                success: false,
                error: 'Failed to calculate dashboard data'
            };
        }
        
        // Step 3: Extract issue counts from dashboard data
        // These are the EXACT same values used in the dashboard
        const dashboardData = calculationResult.dashboardData;
        
        const totalRankingErrors = dashboardData.TotalRankingerrors || 0;
        const totalConversionErrors = dashboardData.totalErrorInConversion || 0;
        const totalAccountErrors = dashboardData.totalErrorInAccount || 0;
        const totalProfitabilityErrors = dashboardData.totalProfitabilityErrors || 0;
        const totalSponsoredAdsErrors = dashboardData.totalSponsoredAdsErrors || 0;
        const totalInventoryErrors = dashboardData.totalInventoryErrors || 0;
        
        // Calculate total issues (same formula as Dashboard.jsx)
        const totalIssues = totalProfitabilityErrors + 
                           totalSponsoredAdsErrors + 
                           totalInventoryErrors + 
                           totalRankingErrors + 
                           totalConversionErrors + 
                           totalAccountErrors;
        
        const numberOfProductsWithIssues = dashboardData.productWiseError?.length || 0;
        const totalActiveProducts = dashboardData.ActiveProducts?.length || 0;
        
        // Step 4: Store in IssueSummary model
        const issueData = {
            totalIssues,
            totalProfitabilityErrors,
            totalSponsoredAdsErrors,
            totalInventoryErrors,
            totalRankingErrors,
            totalConversionErrors,
            totalAccountErrors,
            numberOfProductsWithIssues,
            totalActiveProducts
        };
        
        const savedSummary = await IssueSummary.upsertIssueSummary(
            userId,
            country,
            region,
            issueData,
            source
        );
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssueSummaryService] Issue summary calculation completed', {
            userId,
            country,
            region,
            source,
            duration,
            totalIssues,
            breakdown: {
                ranking: totalRankingErrors,
                conversion: totalConversionErrors,
                account: totalAccountErrors,
                profitability: totalProfitabilityErrors,
                sponsoredAds: totalSponsoredAdsErrors,
                inventory: totalInventoryErrors
            }
        });
        
        return {
            success: true,
            data: savedSummary,
            duration
        };
        
    } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.error('[IssueSummaryService] Error calculating issue summary', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region,
            source,
            duration
        });
        
        return {
            success: false,
            error: error.message,
            duration
        };
    }
}

/**
 * Get cached issue summary or return null if not available
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object|null>} Issue summary or null
 */
async function getIssueSummary(userId, country, region) {
    try {
        const summary = await IssueSummary.getIssueSummary(userId, country, region);
        
        if (!summary) {
            logger.debug('[IssueSummaryService] No cached issue summary found', {
                userId,
                country,
                region
            });
            return null;
        }
        
        // Check if data is stale (more than 24 hours old)
        const lastCalc = new Date(summary.lastCalculatedAt);
        const hoursSinceCalc = (Date.now() - lastCalc.getTime()) / (1000 * 60 * 60);
        
        logger.debug('[IssueSummaryService] Retrieved cached issue summary', {
            userId,
            country,
            region,
            totalIssues: summary.totalIssues,
            isStale: summary.isStale,
            hoursSinceCalc: Math.round(hoursSinceCalc)
        });
        
        return summary;
        
    } catch (error) {
        logger.error('[IssueSummaryService] Error getting issue summary', {
            error: error.message,
            userId,
            country,
            region
        });
        return null;
    }
}

/**
 * Mark issue summary as stale (needs recalculation)
 * Called when data sources are updated
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<boolean>} Success status
 */
async function markIssueSummaryStale(userId, country, region) {
    try {
        await IssueSummary.markAsStale(userId, country, region);
        
        logger.debug('[IssueSummaryService] Marked issue summary as stale', {
            userId,
            country,
            region
        });
        
        return true;
        
    } catch (error) {
        logger.error('[IssueSummaryService] Error marking issue summary as stale', {
            error: error.message,
            userId,
            country,
            region
        });
        return false;
    }
}

/**
 * Refresh stale issue summaries
 * Can be called by a scheduled job to update stale data
 * 
 * @param {number} limit - Maximum number of summaries to refresh
 * @returns {Promise<Object>} Result with count of refreshed summaries
 */
async function refreshStaleSummaries(limit = 10) {
    const startTime = Date.now();
    let refreshed = 0;
    let failed = 0;
    
    try {
        const staleSummaries = await IssueSummary.getStaleSummaries(limit);
        
        logger.info('[IssueSummaryService] Starting refresh of stale summaries', {
            count: staleSummaries.length,
            limit
        });
        
        for (const summary of staleSummaries) {
            try {
                const result = await calculateAndStoreIssueSummary(
                    summary.userId,
                    summary.country,
                    summary.region,
                    'schedule'
                );
                
                if (result.success) {
                    refreshed++;
                } else {
                    failed++;
                }
            } catch (err) {
                failed++;
                logger.error('[IssueSummaryService] Error refreshing individual summary', {
                    error: err.message,
                    userId: summary.userId,
                    country: summary.country,
                    region: summary.region
                });
            }
        }
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssueSummaryService] Stale summary refresh completed', {
            refreshed,
            failed,
            total: staleSummaries.length,
            duration
        });
        
        return {
            success: true,
            refreshed,
            failed,
            duration
        };
        
    } catch (error) {
        logger.error('[IssueSummaryService] Error in refreshStaleSummaries', {
            error: error.message,
            stack: error.stack
        });
        
        return {
            success: false,
            error: error.message,
            refreshed,
            failed
        };
    }
}

/**
 * Calculate issue summary using pre-fetched dashboard data
 * This is more efficient when dashboard data is already available
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} dashboardData - Pre-calculated dashboard data
 * @param {string} source - Source of calculation
 * @returns {Promise<Object>} Result object with success status and data
 */
async function storeIssueSummaryFromDashboardData(userId, country, region, dashboardData, source = 'integration') {
    try {
        if (!dashboardData) {
            logger.error('[IssueSummaryService] No dashboard data provided', {
                userId,
                country,
                region
            });
            return {
                success: false,
                error: 'No dashboard data provided'
            };
        }
        
        // Extract issue counts from dashboard data
        const totalRankingErrors = dashboardData.TotalRankingerrors || 0;
        const totalConversionErrors = dashboardData.totalErrorInConversion || 0;
        const totalAccountErrors = dashboardData.totalErrorInAccount || 0;
        const totalProfitabilityErrors = dashboardData.totalProfitabilityErrors || 0;
        const totalSponsoredAdsErrors = dashboardData.totalSponsoredAdsErrors || 0;
        const totalInventoryErrors = dashboardData.totalInventoryErrors || 0;
        
        const totalIssues = totalProfitabilityErrors + 
                           totalSponsoredAdsErrors + 
                           totalInventoryErrors + 
                           totalRankingErrors + 
                           totalConversionErrors + 
                           totalAccountErrors;
        
        const numberOfProductsWithIssues = dashboardData.productWiseError?.length || 0;
        const totalActiveProducts = dashboardData.ActiveProducts?.length || 0;
        
        const issueData = {
            totalIssues,
            totalProfitabilityErrors,
            totalSponsoredAdsErrors,
            totalInventoryErrors,
            totalRankingErrors,
            totalConversionErrors,
            totalAccountErrors,
            numberOfProductsWithIssues,
            totalActiveProducts
        };
        
        const savedSummary = await IssueSummary.upsertIssueSummary(
            userId,
            country,
            region,
            issueData,
            source
        );
        
        logger.info('[IssueSummaryService] Stored issue summary from dashboard data', {
            userId,
            country,
            region,
            source,
            totalIssues
        });
        
        return {
            success: true,
            data: savedSummary
        };
        
    } catch (error) {
        logger.error('[IssueSummaryService] Error storing issue summary from dashboard data', {
            error: error.message,
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

module.exports = {
    calculateAndStoreIssueSummary,
    getIssueSummary,
    markIssueSummaryStale,
    refreshStaleSummaries,
    storeIssueSummaryFromDashboardData
};

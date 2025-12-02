/**
 * History Calculation Service
 * 
 * This service calculates ONLY the data needed for account history recording.
 * It's a simplified version of the full dashboard calculation, optimized for
 * history storage purposes.
 */

const logger = require('../../utils/Logger.js');

/**
 * Calculate history-specific data from analyse data
 * @param {Object} analyseData - Raw data from AnalyseService
 * @param {Object} dashboardData - Calculated dashboard data
 * @returns {Object} History-specific calculated data
 */
const calculateHistoryData = (analyseData, dashboardData) => {
    try {
        // Extract only what's needed for history
        const historyData = {
            // Health Score
            healthScore: analyseData?.AccountData?.getAccountHealthPercentge?.Percentage || 0,
            
            // Total Products
            totalProducts: dashboardData?.TotalProduct?.length || 0,
            
            // Active Products
            activeProducts: dashboardData?.ActiveProducts?.length || 0,
            
            // Products with Issues
            productsWithIssues: dashboardData?.productWiseError?.length || 0,
            
            // Total Issues breakdown
            totalIssues: calculateTotalIssues(dashboardData),
            
            // Issues by category
            issuesByCategory: {
                ranking: dashboardData?.TotalRankingerrors || 0,
                conversion: dashboardData?.totalErrorInConversion || 0,
                account: dashboardData?.totalErrorInAccount || 0,
                profitability: dashboardData?.totalProfitabilityErrors || 0,
                sponsoredAds: dashboardData?.totalSponsoredAdsErrors || 0,
                inventory: dashboardData?.totalInventoryErrors || 0
            },
            
            // Financial summary
            financialSummary: {
                totalSales: dashboardData?.TotalWeeklySale || 0,
                grossProfit: analyseData?.FinanceData?.Gross_Profit || 0,
                ppcSpend: analyseData?.FinanceData?.ProductAdsPayment || 0,
                fbaFees: analyseData?.FinanceData?.FBA_Fees || 0,
                refunds: analyseData?.FinanceData?.Refunds || 0
            },
            
            // Sponsored Ads summary
            sponsoredAdsSummary: {
                totalCost: dashboardData?.sponsoredAdsMetrics?.totalCost || 0,
                totalSales: dashboardData?.sponsoredAdsMetrics?.totalSalesIn30Days || 0,
                acos: calculateACOS(dashboardData?.sponsoredAdsMetrics)
            },
            
            // Inventory summary
            inventorySummary: {
                planningIssues: dashboardData?.InventoryAnalysis?.inventoryPlanning?.length || 0,
                strandedInventory: dashboardData?.InventoryAnalysis?.strandedInventory?.length || 0,
                nonCompliance: dashboardData?.InventoryAnalysis?.inboundNonCompliance?.length || 0,
                replenishmentNeeded: dashboardData?.InventoryAnalysis?.replenishment?.filter(
                    item => item?.status === 'Error'
                ).length || 0
            },
            
            // Top error products (for quick reference)
            topErrorProducts: [
                dashboardData?.first,
                dashboardData?.second,
                dashboardData?.third,
                dashboardData?.fourth
            ].filter(Boolean),
            
            // Date range
            dateRange: {
                startDate: dashboardData?.startDate || new Date().toISOString().split('T')[0],
                endDate: dashboardData?.endDate || new Date().toISOString().split('T')[0]
            },
            
            // Country/Region
            country: dashboardData?.Country || 'US',
            
            // Timestamp
            calculatedAt: new Date().toISOString()
        };
        
        return historyData;
    } catch (error) {
        logger.error('Error calculating history data:', error);
        return getDefaultHistoryData();
    }
};

/**
 * Calculate total issues from dashboard data
 * @param {Object} dashboardData - Dashboard data
 * @returns {number} Total issues count
 */
const calculateTotalIssues = (dashboardData) => {
    if (!dashboardData) return 0;
    
    return (
        (dashboardData.TotalRankingerrors || 0) +
        (dashboardData.totalErrorInConversion || 0) +
        (dashboardData.totalErrorInAccount || 0) +
        (dashboardData.totalProfitabilityErrors || 0) +
        (dashboardData.totalSponsoredAdsErrors || 0) +
        (dashboardData.totalInventoryErrors || 0)
    );
};

/**
 * Calculate ACOS from sponsored ads metrics
 * @param {Object} sponsoredAdsMetrics - Sponsored ads metrics
 * @returns {number} ACOS percentage
 */
const calculateACOS = (sponsoredAdsMetrics) => {
    if (!sponsoredAdsMetrics) return 0;
    
    const { totalCost, totalSalesIn30Days } = sponsoredAdsMetrics;
    
    if (!totalSalesIn30Days || totalSalesIn30Days === 0) return 0;
    
    return parseFloat(((totalCost / totalSalesIn30Days) * 100).toFixed(2));
};

/**
 * Get default history data when calculation fails
 * @returns {Object} Default history data
 */
const getDefaultHistoryData = () => {
    return {
        healthScore: 0,
        totalProducts: 0,
        activeProducts: 0,
        productsWithIssues: 0,
        totalIssues: 0,
        issuesByCategory: {
            ranking: 0,
            conversion: 0,
            account: 0,
            profitability: 0,
            sponsoredAds: 0,
            inventory: 0
        },
        financialSummary: {
            totalSales: 0,
            grossProfit: 0,
            ppcSpend: 0,
            fbaFees: 0,
            refunds: 0
        },
        sponsoredAdsSummary: {
            totalCost: 0,
            totalSales: 0,
            acos: 0
        },
        inventorySummary: {
            planningIssues: 0,
            strandedInventory: 0,
            nonCompliance: 0,
            replenishmentNeeded: 0
        },
        topErrorProducts: [],
        dateRange: {
            startDate: new Date().toISOString().split('T')[0],
            endDate: new Date().toISOString().split('T')[0]
        },
        country: 'US',
        calculatedAt: new Date().toISOString()
    };
};

/**
 * Extract minimal data needed for addAccountHistory function
 * This matches the signature of the existing addAccountHistory function
 * @param {Object} analyseData - Raw data from AnalyseService
 * @param {Object} dashboardData - Calculated dashboard data
 * @returns {Object} Data needed for addAccountHistory
 */
const extractHistoryParams = (analyseData, dashboardData) => {
    const historyData = calculateHistoryData(analyseData, dashboardData);
    
    return {
        healthScore: historyData.healthScore,
        totalProducts: historyData.totalProducts.toString(),
        productsWithIssues: historyData.productsWithIssues.toString(),
        totalIssues: historyData.totalIssues.toString()
    };
};

module.exports = {
    calculateHistoryData,
    calculateTotalIssues,
    calculateACOS,
    getDefaultHistoryData,
    extractHistoryParams
};


/**
 * Default Data Structure Service
 * 
 * Provides default data structures for dashboard when no data is available.
 */

/**
 * Creates a default empty dashboard data structure
 * @returns {Object} Default dashboard data object
 */
const createDefaultDashboardData = () => {
    return {
        Country: "US",
        createdAccountDate: null,
        Brand: null, // Add brand to default structure
        accountHealthPercentage: { Percentage: 0, status: 'UNKNOWN' },
        accountFinance: {},
        totalErrorInAccount: 0,
        totalErrorInConversion: 0,
        TotalRankingerrors: 0,
        totalInventoryErrors: 0,
        first: null,
        second: null,
        third: null,
        fourth: null,
        productsWithOutBuyboxError: 0,
        amazonReadyProducts: [],
        TotalProduct: [],
        ActiveProducts: [],
        TotalWeeklySale: 0,
        TotalSales: [],
        reimbustment: { totalReimbursement: 0 },
        productWiseError: [],
        rankingProductWiseErrors: [],
        conversionProductWiseErrors: [],
        inventoryProductWiseErrors: [],
        InventoryAnalysis: {
            inventoryPlanning: [],
            strandedInventory: [],
            inboundNonCompliance: [],
            replenishment: []
        },
        AccountErrors: {},
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        profitibilityData: [],
        sponsoredAdsMetrics: { totalCost: 0, totalSalesIn30Days: 0, totalProductsPurchased: 0 },
        negativeKeywordsMetrics: [],
        ProductWiseSponsoredAdsGraphData: [],
        totalProfitabilityErrors: 0,
        totalSponsoredAdsErrors: 0,
        ProductWiseSponsoredAds: [],
        profitabilityErrorDetails: [],
        sponsoredAdsErrorDetails: [],
        keywords: [],
        searchTerms: [],
        campaignData: [],
        adsKeywordsPerformanceData: [],
        GetOrderData: [],
        dateWiseTotalCosts: [],
        campaignWiseTotalSalesAndCost: [],
        negetiveKeywords: [],
        AdsGroupData: [],
        keywordTrackingData: {},
        isEmptyData: true,
        dataAvailabilityStatus: 'NO_DATA',
        DifferenceData: 0
    };
};

/**
 * Merges partial data with defaults to ensure complete data structure
 * @param {Object} partialData - Partial data to merge
 * @returns {Object} Complete data structure with defaults
 */
const mergeWithDefaults = (partialData) => {
    const defaults = createDefaultDashboardData();
    return {
        ...defaults,
        ...partialData,
        // Ensure nested objects are also merged
        accountHealthPercentage: {
            ...defaults.accountHealthPercentage,
            ...(partialData?.accountHealthPercentage || {})
        },
        accountFinance: {
            ...defaults.accountFinance,
            ...(partialData?.accountFinance || {})
        },
        reimbustment: {
            ...defaults.reimbustment,
            ...(partialData?.reimbustment || {})
        },
        InventoryAnalysis: {
            ...defaults.InventoryAnalysis,
            ...(partialData?.InventoryAnalysis || {})
        },
        sponsoredAdsMetrics: {
            ...defaults.sponsoredAdsMetrics,
            ...(partialData?.sponsoredAdsMetrics || {})
        }
    };
};

module.exports = {
    createDefaultDashboardData,
    mergeWithDefaults
};


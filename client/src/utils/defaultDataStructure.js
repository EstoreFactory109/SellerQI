/**
 * Generates default/empty data structure for accounts with no data available
 * This ensures components receive valid data structures with zero values instead of null/undefined
 */

export const createDefaultDashboardData = () => {
  return {
    Country: "US",
    createdAccountDate: new Date().toISOString().split('T')[0],
    accountHealthPercentage: { Percentage: 0, status: 'NO_DATA' },
    accountFinance: {
      Total_Sales: 0,
      Total_Units: 0,
      Total_Orders: 0,
      Net_Proceeds: 0
    },
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
    sponsoredAdsMetrics: {
      totalCost: 0,
      totalSalesIn30Days: 0,
      totalProductsPurchased: 0
    },
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
    negetiveKeywords: [],
    AdsGroupData: [],
    // Flag to indicate this is empty data
    isEmptyData: true,
    dataAvailabilityStatus: 'NO_DATA'
  };
};

/**
 * Checks if the current data is empty/default data
 */
export const isEmptyDashboardData = (data) => {
  if (!data) return true;
  return data.isEmptyData === true || data.dataAvailabilityStatus === 'NO_DATA';
};

/**
 * Creates default data for specific components when they need to show zero values
 */
export const createComponentDefaults = {
  profitability: () => ({
    data: [],
    totalProfitabilityErrors: 0,
    errorDetails: []
  }),
  
  sponsoredAds: () => ({
    data: [],
    totalSponsoredAdsErrors: 0,
    metrics: {
      totalCost: 0,
      totalSalesIn30Days: 0,
      totalProductsPurchased: 0
    },
    errorDetails: []
  }),
  
  inventory: () => ({
    inventoryPlanning: [],
    strandedInventory: [],
    inboundNonCompliance: [],
    replenishment: [],
    totalInventoryErrors: 0
  }),
  
  rankings: () => ({
    productWiseErrors: [],
    totalRankingErrors: 0
  }),
  
  conversion: () => ({
    productWiseErrors: [],
    totalConversionErrors: 0
  }),
  
  finance: () => ({
    Total_Sales: 0,
    Total_Units: 0,
    Total_Orders: 0,
    Net_Proceeds: 0,
    TotalWeeklySale: 0,
    TotalSales: [],
    reimbustment: { totalReimbursement: 0 }
  })
};

/**
 * Merges partial data with default structure to ensure all fields exist
 */
export const mergeWithDefaults = (partialData, defaultData = null) => {
  const defaults = defaultData || createDefaultDashboardData();
  
  if (!partialData) {
    return { ...defaults, isEmptyData: true, dataAvailabilityStatus: 'NO_DATA' };
  }
  
  // If we have some data, mark it as partial data available
  const merged = { ...defaults, ...partialData };
  merged.isEmptyData = false;
  merged.dataAvailabilityStatus = 'PARTIAL_DATA';
  
  return merged;
}; 
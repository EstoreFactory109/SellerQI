/**
 * ScheduleConfig.js
 * 
 * Configuration for scheduling different API functions based on days of the week.
 * This file defines which functions should run on which days.
 */

// Sunday (weekly) - Functions that run only on Sunday
const SUNDAY_FUNCTIONS = {
    'productReview': {
        service: require('../Sp_API/NumberOfProductReviews.js'),
        functionName: 'addReviewDataTODatabase',
        description: 'Product Reviews Data',
        apiDataKey: 'productReview'
    },
    'keywordRecommendations': {
        service: require('../AmazonAds/KeyWordsRecommendations.js'),
        functionName: 'getKeywordRecommendations',
        description: 'Keyword Recommendations',
        requiresAdsToken: true,
        apiDataKey: 'keywordRecommendations'
    }
};

// Monday, Wednesday, Friday (3x/week) - Amazon Ads functions and MCP Economics
const MON_WED_FRI_FUNCTIONS = {
    // Amazon Ads functions
    'ppcSpendsBySKU': {
        service: require('../AmazonAds/GetPPCProductWise.js'),
        functionName: 'getPPCSpendsBySKU',
        description: 'PPC Spends by SKU',
        requiresAdsToken: true,
        apiDataKey: 'ppcSpendsBySKU'
    },
    'adsKeywordsPerformanceData': {
        service: require('../AmazonAds/GetWastedSpendKeywords.js'),
        functionName: 'getKeywordPerformanceReport',
        description: 'Ads Keywords Performance',
        requiresAdsToken: true,
        apiDataKey: 'adsKeywordsPerformanceData'
    },
    'ppcSpendsDateWise': {
        service: require('../AmazonAds/GetDateWiseSpendKeywords.js'),
        functionName: 'getPPCSpendsDateWise',
        description: 'PPC Spends Date Wise',
        requiresAdsToken: true,
        apiDataKey: 'ppcSpendsDateWise'
    },
    'adsKeywords': {
        service: require('../AmazonAds/Keywords.js'),
        functionName: 'getKeywords',
        description: 'Ads Keywords',
        requiresAdsToken: true,
        apiDataKey: 'adsKeywords'
    },
    'campaignData': {
        service: require('../AmazonAds/GetCampaigns.js'),
        functionName: 'getCampaign',
        description: 'Campaign Data',
        requiresAdsToken: true,
        apiDataKey: 'campaignData'
    },
    'adGroupsData': {
        service: require('../AmazonAds/AdGroups.js'),
        functionName: 'getAdGroups',
        description: 'Ad Groups Data',
        requiresAdsToken: true,
        apiDataKey: 'adGroupsData'
    },
    'negativeKeywords': {
        service: require('../AmazonAds/NegetiveKeywords.js'),
        functionName: 'getNegativeKeywords',
        description: 'Negative Keywords',
        requiresAdsToken: true,
        apiDataKey: 'negativeKeywords'
    },
    'searchKeywords': {
        service: require('../AmazonAds/GetSearchKeywords.js'),
        functionName: 'getSearchKeywords',
        description: 'Search Keywords',
        requiresAdsToken: true,
        apiDataKey: 'searchKeywords'
    },
    // PPC Metrics (Aggregated) - SP, SB, SD campaign data
    'ppcMetricsAggregated': {
        service: require('../AmazonAds/GetPPCMetrics.js'),
        functionName: 'getPPCMetrics',
        description: 'PPC Metrics (Aggregated)',
        requiresAdsToken: true,
        apiDataKey: 'ppcMetricsAggregated'
    },
    // MCP Economics
    'mcpEconomicsData': {
        service: require('../MCP/MCPEconomicsIntegration.js'),
        functionName: 'fetchAndStoreEconomicsData',
        description: 'MCP Economics Data',
        requiresRefreshToken: true,
        apiDataKey: 'mcpEconomicsData'
    }
};

// Tuesday, Thursday, Saturday, Sunday - MCP BuyBox Data (excludes Mon/Wed/Fri when ads reports run)
const OTHER_DAYS_FUNCTIONS = {
    'mcpBuyBoxData': {
        service: require('../MCP/MCPBuyBoxIntegration.js'),
        functionName: 'fetchAndStoreBuyBoxData',
        description: 'MCP BuyBox Data',
        requiresRefreshToken: true,
        apiDataKey: 'mcpBuyBoxData'
    }
};

// Saturday (weekly) - Reimbursement calculation functions
const SATURDAY_FUNCTIONS = {
    'calculateShipmentDiscrepancy': {
        service: require('../Calculations/Reimbursement.js'),
        functionName: 'calculateShipmentDiscrepancy',
        description: 'Shipment Discrepancy Reimbursement'
    },
    'calculateLostInventoryReimbursement': {
        service: require('../Calculations/Reimbursement.js'),
        functionName: 'calculateLostInventoryReimbursement',
        description: 'Lost Inventory Reimbursement'
    },
    'calculateDamagedInventoryReimbursement': {
        service: require('../Calculations/Reimbursement.js'),
        functionName: 'calculateDamagedInventoryReimbursement',
        description: 'Damaged Inventory Reimbursement'
    },
    'calculateDisposedInventoryReimbursement': {
        service: require('../Calculations/Reimbursement.js'),
        functionName: 'calculateDisposedInventoryReimbursement',
        description: 'Disposed Inventory Reimbursement'
    },
    'calculateFeeReimbursement': {
        service: require('../Calculations/Reimbursement.js'),
        functionName: 'calculateFeeReimbursement',
        description: 'Fee Reimbursement'
    }
};

// Daily - All other functions that run every day
const DAILY_FUNCTIONS = {
    'v2data': {
        service: require('../Sp_API/V2_Seller_Performance_Report.js'),
        functionName: null, // Default export, use service directly
        description: 'V2 Seller Performance Report',
        requiresAccessToken: true,
        apiDataKey: 'v2data',
        isDefaultExport: true
    },
    'v1data': {
        service: require('../Sp_API/GET_V1_SELLER_PERFORMANCE_REPORT.js'),
        functionName: null, // Default export, use service directly
        description: 'V1 Seller Performance Report',
        requiresAccessToken: true,
        apiDataKey: 'v1data',
        isDefaultExport: true
    },
    'RestockinventoryData': {
        service: require('../Sp_API/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT.js'),
        functionName: null, // Default export, use service directly
        description: 'Restock Inventory Recommendations',
        requiresAccessToken: true,
        apiDataKey: 'RestockinventoryData',
        isDefaultExport: true
    },
    'fbaInventoryPlanningData': {
        service: require('../Sp_API/GET_FBA_INVENTORY_PLANNING_DATA.js'),
        functionName: null, // Default export, use service directly
        description: 'FBA Inventory Planning',
        requiresAccessToken: true,
        apiDataKey: 'fbaInventoryPlanningData',
        isDefaultExport: true
    },
    'strandedInventoryData': {
        service: require('../Sp_API/GET_STRANDED_INVENTORY_UI_DATA.js'),
        functionName: null, // Default export, use service directly
        description: 'Stranded Inventory',
        requiresAccessToken: true,
        apiDataKey: 'strandedInventoryData',
        isDefaultExport: true
    },
    'inboundNonComplianceData': {
        service: require('../Sp_API/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA.js'),
        functionName: null, // Default export, use service directly
        description: 'Inbound Non-Compliance',
        requiresAccessToken: true,
        apiDataKey: 'inboundNonComplianceData',
        isDefaultExport: true
    },
    'shipment': {
        service: require('../Sp_API/shipment.js'),
        functionName: null, // Default export, use service directly
        description: 'Shipment Data',
        requiresAccessToken: true,
        apiDataKey: 'shipment',
        isDefaultExport: true
    },
    'brandData': {
        service: require('../Sp_API/GetBrand.js'),
        functionName: 'getBrand',
        description: 'Brand Data',
        requiresAccessToken: true,
        apiDataKey: 'brandData'
    }
};

/**
 * Get functions that should run on a specific day
 * @param {number} dayOfWeek - 0 (Sunday) to 6 (Saturday)
 * @returns {Object} Object with function configurations
 */
function getFunctionsForDay(dayOfWeek) {
    const functions = {};

    // Sunday = 0
    if (dayOfWeek === 0) {
        Object.assign(functions, SUNDAY_FUNCTIONS);
    }

    // Monday = 1, Wednesday = 3, Friday = 5
    if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
        Object.assign(functions, MON_WED_FRI_FUNCTIONS);
    }

    // Saturday = 6
    if (dayOfWeek === 6) {
        Object.assign(functions, SATURDAY_FUNCTIONS);
    }

    // Daily functions run every day
    Object.assign(functions, DAILY_FUNCTIONS);

    // Other days functions (Tuesday=2, Thursday=4, Saturday=6, Sunday=0) - excludes Mon/Wed/Fri
    // Note: Saturday and Sunday already have their own functions, but we add OTHER_DAYS_FUNCTIONS to them too
    if (dayOfWeek === 0 || dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 6) {
        Object.assign(functions, OTHER_DAYS_FUNCTIONS);
    }

    return functions;
}

/**
 * Check if a specific function should run today
 * @param {string} functionKey - Key of the function
 * @param {number} dayOfWeek - 0 (Sunday) to 6 (Saturday)
 * @returns {boolean}
 */
function shouldRunFunction(functionKey, dayOfWeek) {
    // Check if it's a daily function
    if (DAILY_FUNCTIONS[functionKey]) {
        return true;
    }

    // Check Sunday functions
    if (dayOfWeek === 0 && SUNDAY_FUNCTIONS[functionKey]) {
        return true;
    }

    // Check Monday/Wednesday/Friday functions
    if ((dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) && MON_WED_FRI_FUNCTIONS[functionKey]) {
        return true;
    }

    // Check Saturday functions
    if (dayOfWeek === 6 && SATURDAY_FUNCTIONS[functionKey]) {
        return true;
    }

    return false;
}

module.exports = {
    SUNDAY_FUNCTIONS,
    MON_WED_FRI_FUNCTIONS,
    SATURDAY_FUNCTIONS,
    DAILY_FUNCTIONS,
    OTHER_DAYS_FUNCTIONS,
    getFunctionsForDay,
    shouldRunFunction
};


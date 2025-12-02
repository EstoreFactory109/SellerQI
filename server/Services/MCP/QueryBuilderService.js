/**
 * QueryBuilderService.js
 * 
 * Service for building GraphQL queries for Amazon Data Kiosk API
 * Based on MCP seller-server query builders
 */

const { MARKETPLACES } = require('./constants.js');

/**
 * Build Sales and Traffic query by date
 * @param {Object} params - Query parameters
 * @param {string} params.startDate - Start date (YYYY-MM-DD)
 * @param {string} params.endDate - End date (YYYY-MM-DD)
 * @param {string} params.granularity - DAY, WEEK, or MONTH
 * @param {string} params.marketplace - Marketplace code (US, CA, UK, etc.)
 * @param {boolean} params.includeB2B - Include B2B metrics
 * @returns {string} GraphQL query
 */
function buildSalesAndTrafficByDateQuery({ startDate, endDate, granularity, marketplace, includeB2B = false }) {
    const marketplaceId = MARKETPLACES[marketplace] || MARKETPLACES.US;

    return `
query {
  salesAndTrafficByDate(
    aggregateBy: ${granularity}
    startDate: "${startDate}"
    endDate: "${endDate}"
    marketplaceIds: ["${marketplaceId}"]
  ) {
    startDate
    endDate
    marketplaceId
    sales {
      orderedProductSales {
        amount
        currencyCode
      }
      ${includeB2B ? `
      orderedProductSalesB2B {
        amount
        currencyCode
      }` : ''}
      averageSalesPerOrderItem {
        amount
        currencyCode
      }
      ${includeB2B ? `
      averageSalesPerOrderItemB2B {
        amount
        currencyCode
      }` : ''}
      averageSellingPrice {
        amount
        currencyCode
      }
      unitsOrdered
      unitsOrderedB2B
      totalOrderItems
      totalOrderItemsB2B
    }
    traffic {
      browserPageViews
      browserPageViewsB2B
      mobileAppPageViews
      mobileAppPageViewsB2B
      pageViews
      pageViewsB2B
      browserSessions
      browserSessionsB2B
      mobileAppSessions
      mobileAppSessionsB2B
      sessions
      sessionsB2B
      buyBoxPercentage
      buyBoxPercentageB2B
      orderItemSessionPercentage
      orderItemSessionPercentageB2B
      unitSessionPercentage
      unitSessionPercentageB2B
    }
  }
}`.trim();
}

/**
 * Build Sales and Traffic query by ASIN
 * @param {Object} params - Query parameters
 * @param {string} params.startDate - Start date (YYYY-MM-DD)
 * @param {string} params.endDate - End date (YYYY-MM-DD)
 * @param {string} params.granularity - PARENT, CHILD, or SKU
 * @param {string} params.marketplace - Marketplace code
 * @param {boolean} params.includeB2B - Include B2B metrics
 * @returns {string} GraphQL query
 */
function buildSalesAndTrafficByAsinQuery({ startDate, endDate, granularity, marketplace, includeB2B = false }) {
    const marketplaceId = MARKETPLACES[marketplace] || MARKETPLACES.US;

    return `
query {
  salesAndTrafficByAsin(
    aggregateBy: ${granularity}
    startDate: "${startDate}"
    endDate: "${endDate}"
    marketplaceIds: ["${marketplaceId}"]
  ) {
    startDate
    endDate
    marketplaceId
    parentAsin
    childAsin
    sku
    sales {
      orderedProductSales {
        amount
        currencyCode
      }
      ${includeB2B ? `
      orderedProductSalesB2B {
        amount
        currencyCode
      }` : ''}
      averageSalesPerOrderItem {
        amount
        currencyCode
      }
      averageSellingPrice {
        amount
        currencyCode
      }
      unitsOrdered
      unitsOrderedB2B
      totalOrderItems
      totalOrderItemsB2B
    }
    traffic {
      browserPageViews
      mobileAppPageViews
      pageViews
      browserSessions
      mobileAppSessions
      sessions
      buyBoxPercentage
      orderItemSessionPercentage
      unitSessionPercentage
    }
  }
}`.trim();
}

/**
 * Build Economics query
 * @param {Object} params - Query parameters
 * @param {string} params.startDate - Start date (YYYY-MM-DD)
 * @param {string} params.endDate - End date (YYYY-MM-DD)
 * @param {string} params.dateGranularity - DAY, WEEK, MONTH, or RANGE
 * @param {string} params.productIdGranularity - PARENT_ASIN, CHILD_ASIN, FNSKU, or MSKU
 * @param {string} params.marketplace - Marketplace code
 * @param {boolean} params.includeFeeComponents - Include fee component breakdowns
 * @param {Array<string>} params.feeTypesForComponents - Fee types to include components for
 * @returns {string} GraphQL query
 */
function buildEconomicsQuery({
    startDate,
    endDate,
    dateGranularity,
    productIdGranularity,
    marketplace,
    includeFeeComponents = false,
    feeTypesForComponents = []
}) {
    const marketplaceId = MARKETPLACES[marketplace] || MARKETPLACES.US;

    let feeComponentsSection = '';
    if (includeFeeComponents && feeTypesForComponents.length > 0) {
        const feeTypesList = feeTypesForComponents.map(type => type).join(', ');
        feeComponentsSection = `
      includeComponentsForFeeTypes: [${feeTypesList}]`;
    }

    return `
query {
  economics(
    startDate: "${startDate}"
    endDate: "${endDate}"
    aggregateBy: {
      date: ${dateGranularity}
      productId: ${productIdGranularity}
    }
    marketplaceIds: ["${marketplaceId}"]${feeComponentsSection}
  ) {
    startDate
    endDate
    marketplaceId
    parentAsin
    childAsin
    fnsku
    msku
    sales {
      orderedProductSales {
        amount
        currencyCode
      }
      netProductSales {
        amount
        currencyCode
      }
      averageSellingPrice {
        amount
        currencyCode
      }
      unitsOrdered
      unitsRefunded
      netUnitsSold
    }
    fees {
      totalFees {
        amount
        currencyCode
      }
      fbaFulfillmentFee {
        amount
        currencyCode
      }
      fbaStorageFee {
        amount
        currencyCode
      }
      referralFee {
        amount
        currencyCode
      }
      perItemSellingFee {
        amount
        currencyCode
      }
      ${includeFeeComponents ? `
      feeComponents {
        feeType
        amount {
          amount
          currencyCode
        }
      }` : ''}
    }
    advertising {
      advertisingSpend {
        amount
        currencyCode
      }
    }
    sellerProvidedCosts {
      costOfGoods {
        amount
        currencyCode
      }
      shippingCost {
        amount
        currencyCode
      }
    }
    netProceeds {
      amount
      currencyCode
    }
  }
}`.trim();
}

/**
 * Build Economics Preview query
 * @param {Object} params - Query parameters
 * @param {string} params.startDate - Start date (YYYY-MM-DD) - must not be earlier than today
 * @param {string} params.endDate - End date (YYYY-MM-DD) - must not be more than 30 days after today
 * @param {string} params.marketplace - Marketplace code
 * @param {Array<string>} params.feeTypes - Fee types to include in preview
 * @returns {string} GraphQL query
 */
function buildEconomicsPreviewQuery({ startDate, endDate, marketplace, feeTypes = [] }) {
    const marketplaceId = MARKETPLACES[marketplace] || MARKETPLACES.US;
    const feeTypesList = feeTypes.map(type => type).join(', ');

    return `
query {
  economicsPreview(
    startDate: "${startDate}"
    endDate: "${endDate}"
    marketplaceIds: ["${marketplaceId}"]
    feeTypes: [${feeTypesList}]
  ) {
    startDate
    endDate
    marketplaceId
    parentAsin
    childAsin
    fnsku
    msku
    sales {
      orderedProductSales {
        amount
        currencyCode
      }
      netProductSales {
        amount
        currencyCode
      }
      unitsOrdered
    }
    fees {
      totalFees {
        amount
        currencyCode
      }
      fbaFulfillmentFee {
        amount
        currencyCode
      }
      fbaStorageFee {
        amount
        currencyCode
      }
      referralFee {
        amount
        currencyCode
      }
    }
    netProceeds {
      amount
      currencyCode
    }
  }
}`.trim();
}

module.exports = {
    buildSalesAndTrafficByDateQuery,
    buildSalesAndTrafficByAsinQuery,
    buildEconomicsQuery,
    buildEconomicsPreviewQuery
};


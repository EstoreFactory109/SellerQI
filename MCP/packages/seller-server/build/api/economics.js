// src/api/economics.ts
import { makeApiRequest } from 'common';
import { API_VERSION, SCHEMA_NAMES } from 'common';
/**
 * Create a GraphQL query for Economics data
 * @param query The GraphQL query string
 * @returns Promise that resolves to the query result
 */
export async function createEconomicsQuery(query) {
    const body = { query };
    return makeApiRequest(`/dataKiosk/${API_VERSION}/queries`, "POST", body);
}
/**
 * Build a GraphQL query for Economics data based on parameters
 * @param startDate Start date in YYYY-MM-DD format
 * @param endDate End date in YYYY-MM-DD format
 * @param dateGranularity How to aggregate by date (day, week, month, range)
 * @param productIdGranularity How to aggregate by product (MSKU, FNSKU, CHILD_ASIN, PARENT_ASIN)
 * @param marketplaceIds Array of marketplace IDs
 * @param includeFeeComponents Whether to include fee component breakdowns
 * @param feeTypes Array of fee types to include components for
 * @returns A GraphQL query string
 */
export function buildEconomicsQuery(startDate, endDate, dateGranularity, productIdGranularity, marketplaceIds, includeFeeComponents = false, feeTypes = []) {
    // Create the marketplace array string
    const marketplaceString = marketplaceIds.map(id => `"${id}"`).join(', ');
    // Create the fee components string if needed
    let feeComponentsString = '';
    if (includeFeeComponents && feeTypes.length > 0) {
        feeComponentsString = `
      includeComponentsForFeeTypes: [${feeTypes.join(', ')}]`;
    }
    // Build the complete query
    return `query EconomicsQuery {
  ${SCHEMA_NAMES.ECONOMICS} {
    economics(
      startDate: "${startDate}"
      endDate: "${endDate}"
      aggregateBy: {
        date: ${dateGranularity}
        productId: ${productIdGranularity}
      }
      marketplaceIds: [${marketplaceString}]${feeComponentsString}
    ) {
      startDate
      endDate
      marketplaceId
      parentAsin
      ${productIdGranularity === 'CHILD_ASIN' || productIdGranularity === 'FNSKU' || productIdGranularity === 'MSKU' ? 'childAsin' : ''}
      ${productIdGranularity === 'FNSKU' || productIdGranularity === 'MSKU' ? 'fnsku' : ''}
      ${productIdGranularity === 'MSKU' ? 'msku' : ''}
      
      # Sales data
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
      
      # Fees data
      fees {
        feeTypeName
        charges {
          aggregatedDetail {
            amount {
              amount
              currencyCode
            }
            amountPerUnit {
              amount
              currencyCode
            }
            promotionAmount {
              amount
              currencyCode
            }
            taxAmount {
              amount
              currencyCode
            }
            totalAmount {
              amount
              currencyCode
            }
            quantity
          }
          ${includeFeeComponents ? `
          components {
            name
            aggregatedDetail {
              amount {
                amount
                currencyCode
              }
              totalAmount {
                amount
                currencyCode
              }
            }
          }` : ''}
        }
      }
      
      # Ads data (if available)
      ads {
        adTypeName
        charge {
          aggregatedDetail {
            amount {
              amount
              currencyCode
            }
            totalAmount {
              amount
              currencyCode
            }
          }
        }
      }
      
      # Cost data (if provided by seller)
      cost {
        costOfGoodsSold {
          amount
          currencyCode
        }
        fbaCost {
          shippingToAmazonCost {
            amount
            currencyCode
          }
        }
        mfnCost {
          fulfillmentCost {
            amount
            currencyCode
          }
          storageCost {
            amount
            currencyCode
          }
        }
      }
      
      # Net proceeds
      netProceeds {
        total {
          amount
          currencyCode
        }
        perUnit {
          amount
          currencyCode
        }
      }
    }
  }
}`;
}
/**
 * Build a GraphQL query for Economics Preview based on parameters
 * @param startDate Start date in YYYY-MM-DD format (must not be earlier than today)
 * @param endDate End date in YYYY-MM-DD format (must not be more than 30 days after today)
 * @param marketplaceIds Array of marketplace IDs
 * @param feeTypes Array of fee types to preview
 * @returns A GraphQL query string
 */
export function buildEconomicsPreviewQuery(startDate, endDate, marketplaceIds, feeTypes) {
    // Create the marketplace array string
    const marketplaceString = marketplaceIds.map(id => `"${id}"`).join(', ');
    // Create the fee types array string
    const feeTypesString = feeTypes.join(', ');
    // Build the complete query
    return `query EconomicsPreviewQuery {
  ${SCHEMA_NAMES.ECONOMICS} {
    economicsPreview(
      startDate: "${startDate}"
      endDate: "${endDate}"
      aggregateBy: {
        date: RANGE
        productId: MSKU
      }
      marketplaceIds: [${marketplaceString}]
      feeTypes: [${feeTypesString}]
    ) {
      startDate
      endDate
      marketplaceId
      parentAsin
      childAsin
      msku
      
      # Sales data
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
      
      # Fees data
      fees {
        feeTypeName
        charges {
          aggregatedDetail {
            amount {
              amount
              currencyCode
            }
            amountPerUnit {
              amount
              currencyCode
            }
            totalAmount {
              amount
              currencyCode
            }
            quantity
          }
        }
      }
      
      # Net proceeds
      netProceeds {
        total {
          amount
          currencyCode
        }
        perUnit {
          amount
          currencyCode
        }
      }
    }
  }
}`;
}

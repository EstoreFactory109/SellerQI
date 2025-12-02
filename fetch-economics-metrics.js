/**
 * Script to fetch economics metrics from Amazon Data Kiosk API
 * 
 * Usage: node fetch-economics-metrics.js <userId> <region> <marketplace>
 * Example: node fetch-economics-metrics.js 507f1f77bcf86cd799439011 NA US
 * 
 * This script fetches:
 * - Gross Profit
 * - PPC Spent
 * - FBA Fees
 * - Storage Fees
 * - Refunds
 */

require('dotenv').config();
const mongoose = require('mongoose');
const DataKioskService = require('./server/Services/MCP/DataKioskService');
const QueryBuilderService = require('./server/Services/MCP/QueryBuilderService');
const logger = require('./server/utils/Logger');

// Connect to MongoDB
const connectDB = async () => {
    try {
        const config = require('./server/config/config.js');
        await mongoose.connect(config.MONGODB_URI);
        logger.info('MongoDB connected');
    } catch (error) {
        logger.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

/**
 * Build a comprehensive economics query with all required fields
 */
function buildComprehensiveEconomicsQuery(startDate, endDate, marketplace) {
    const { MARKETPLACES } = require('./server/Services/MCP/constants.js');
    const marketplaceId = MARKETPLACES[marketplace] || MARKETPLACES.US;

    return `
query EconomicsQuery {
  analytics_economics_2024_03_15 {
    economics(
      startDate: "${startDate}"
      endDate: "${endDate}"
      aggregateBy: {
        date: RANGE
        productId: PARENT_ASIN
      }
      marketplaceIds: ["${marketplaceId}"]
    ) {
      startDate
      endDate
      marketplaceId
      parentAsin
      
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
      
      # Fees data - includes FBA fees and storage fees
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
        }
      }
      
      # Ads data (PPC Spent)
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
      
      # Cost data
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
}`.trim();
}

/**
 * Process the JSONL document and calculate metrics
 */
function processEconomicsData(jsonlContent) {
    const lines = jsonlContent.trim().split('\n').filter(line => line.trim());
    const data = lines.map(line => JSON.parse(line));
    
    // Initialize totals
    let totalGrossProfit = 0;
    let totalPPCSpent = 0;
    let totalFBAFees = 0;
    let totalStorageFees = 0;
    let totalRefunds = 0;
    let currencyCode = 'USD';
    
    // Process each record
    data.forEach(record => {
        if (record.data?.analytics_economics_2024_03_15?.economics) {
            const economics = record.data.analytics_economics_2024_03_15.economics;
            
            economics.forEach(item => {
                // Get currency code from first record
                if (!currencyCode && item.sales?.netProductSales?.currencyCode) {
                    currencyCode = item.sales.netProductSales.currencyCode;
                }
                
                // Calculate Gross Profit = Net Product Sales - Cost of Goods Sold
                const netSales = parseFloat(item.sales?.netProductSales?.amount || 0);
                const cogs = parseFloat(item.cost?.costOfGoodsSold?.amount || 0);
                const grossProfit = netSales - cogs;
                totalGrossProfit += grossProfit;
                
                // Calculate PPC Spent (from ads)
                if (item.ads && Array.isArray(item.ads)) {
                    item.ads.forEach(ad => {
                        const adSpend = parseFloat(ad.charge?.aggregatedDetail?.totalAmount?.amount || 0);
                        totalPPCSpent += adSpend;
                    });
                }
                
                // Calculate FBA Fees
                if (item.fees && Array.isArray(item.fees)) {
                    item.fees.forEach(fee => {
                        const feeTypeName = fee.feeTypeName?.toLowerCase() || '';
                        const feeAmount = parseFloat(fee.charges?.aggregatedDetail?.totalAmount?.amount || 0);
                        
                        // FBA Fulfillment Fee
                        if (feeTypeName.includes('fba') && feeTypeName.includes('fulfillment')) {
                            totalFBAFees += feeAmount;
                        }
                        
                        // Storage Fee
                        if (feeTypeName.includes('storage')) {
                            totalStorageFees += feeAmount;
                        }
                    });
                }
                
                // Calculate Refunds
                // Refunds can be calculated from unitsRefunded * average selling price
                const unitsRefunded = parseFloat(item.sales?.unitsRefunded || 0);
                const avgPrice = parseFloat(item.sales?.averageSellingPrice?.amount || 0);
                const refundAmount = unitsRefunded * avgPrice;
                totalRefunds += refundAmount;
            });
        }
    });
    
    return {
        grossProfit: {
            amount: totalGrossProfit.toFixed(2),
            currencyCode: currencyCode
        },
        ppcSpent: {
            amount: totalPPCSpent.toFixed(2),
            currencyCode: currencyCode
        },
        fbaFees: {
            amount: totalFBAFees.toFixed(2),
            currencyCode: currencyCode
        },
        storageFees: {
            amount: totalStorageFees.toFixed(2),
            currencyCode: currencyCode
        },
        refunds: {
            amount: totalRefunds.toFixed(2),
            currencyCode: currencyCode
        }
    };
}

/**
 * Main function
 */
async function fetchEconomicsMetrics(userId, region, marketplace, startDate, endDate) {
    try {
        await connectDB();
        
        logger.info(`Fetching economics metrics for user ${userId}, region ${region}, marketplace ${marketplace}`);
        logger.info(`Date range: ${startDate} to ${endDate}`);
        
        // Build the query
        const graphqlQuery = buildComprehensiveEconomicsQuery(startDate, endDate, marketplace);
        
        // Create the query
        logger.info('Creating query...');
        const queryResult = await DataKioskService.createQuery(userId, region, graphqlQuery);
        const queryId = queryResult.queryId;
        
        logger.info(`Query created with ID: ${queryId}`);
        logger.info('Waiting for query to complete (this may take a few minutes)...');
        
        // Wait for query completion
        const documentDetails = await DataKioskService.waitForQueryCompletion(
            userId,
            region,
            queryId,
            300000, // 5 minutes max wait
            10000   // Poll every 10 seconds
        );
        
        logger.info('Query completed. Downloading document...');
        
        // Download the document
        const documentContent = await DataKioskService.downloadDocument(documentDetails.url);
        
        // Process the data
        logger.info('Processing data...');
        const metrics = processEconomicsData(documentContent);
        
        // Display results
        console.log('\n========================================');
        console.log('ECONOMICS METRICS SUMMARY');
        console.log('========================================');
        console.log(`Date Range: ${startDate} to ${endDate}`);
        console.log(`Marketplace: ${marketplace}`);
        console.log('----------------------------------------');
        console.log(`Gross Profit: ${metrics.grossProfit.currencyCode} ${metrics.grossProfit.amount}`);
        console.log(`PPC Spent: ${metrics.ppcSpent.currencyCode} ${metrics.ppcSpent.amount}`);
        console.log(`FBA Fees: ${metrics.fbaFees.currencyCode} ${metrics.fbaFees.amount}`);
        console.log(`Storage Fees: ${metrics.storageFees.currencyCode} ${metrics.storageFees.amount}`);
        console.log(`Refunds: ${metrics.refunds.currencyCode} ${metrics.refunds.amount}`);
        console.log('========================================\n');
        
        // Close MongoDB connection
        await mongoose.connection.close();
        
        return metrics;
    } catch (error) {
        logger.error('Error fetching economics metrics:', error);
        await mongoose.connection.close();
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.error('Usage: node fetch-economics-metrics.js <userId> <region> <marketplace> [startDate] [endDate]');
        console.error('Example: node fetch-economics-metrics.js 507f1f77bcf86cd799439011 NA US 2025-10-30 2025-11-29');
        process.exit(1);
    }
    
    const userId = args[0];
    const region = args[1];
    const marketplace = args[2];
    const startDate = args[3] || '2025-10-30';
    const endDate = args[4] || '2025-11-29';
    
    fetchEconomicsMetrics(userId, region, marketplace, startDate, endDate)
        .then(() => {
            process.exit(0);
        })
        .catch(error => {
            console.error('Error:', error.message);
            process.exit(1);
        });
}

module.exports = { fetchEconomicsMetrics, processEconomicsData };


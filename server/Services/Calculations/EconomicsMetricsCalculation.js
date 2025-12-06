/**
 * EconomicsMetricsCalculation.js
 * 
 * Service for calculating economics metrics from Amazon Data Kiosk API JSONL data
 * Processes raw economics data and calculates:
 * - Total Sales
 * - Gross Profit
 * - PPC Spent
 * - Amazon Fees (FBA fulfillment, storage, referral, closing, per-item fees)
 * - Refunds
 * - Datewise breakdowns
 * - ASIN-wise breakdowns
 */

const logger = require('../../utils/Logger');

/**
 * List of Amazon fee types (fees charged by Amazon for their services)
 * These include: FBA fulfillment, storage, referral, closing, per-item, etc.
 */
const AMAZON_FEE_TYPES = [
    'fba', 'fulfillment', 'fulfilment', 'storage', 'referral', 
    'closing', 'per_item', 'per-item', 'peritem', 'variable_closing',
    'high_volume', 'subscription', 'refund_administration',
    'disposal', 'removal', 'return', 'label', 'prep', 'inbound',
    'inventory_placement', 'oversize', 'media', 'gift_wrap'
];

/**
 * Check if a fee type name is an Amazon fee
 * @param {string} feeTypeName - The fee type name to check
 * @returns {boolean} True if it's an Amazon fee
 */
function isAmazonFee(feeTypeName) {
    if (!feeTypeName) return false;
    const feeTypeNameLower = feeTypeName.toLowerCase().replace(/[_-]/g, '');
    return AMAZON_FEE_TYPES.some(amazonFee => 
        feeTypeNameLower.includes(amazonFee.replace(/[_-]/g, ''))
    );
}

/**
 * Process economics data from JSONL format and calculate all metrics
 * @param {string} documentContent - JSONL document content from Data Kiosk API
 * @param {string} startDate - Start date of the query
 * @param {string} endDate - End date of the query
 * @param {string} marketplace - Marketplace code
 * @returns {Object} Calculated metrics with all breakdowns
 */
function calculateEconomicsMetrics(documentContent, startDate, endDate, marketplace) {
    // Parse JSONL data
    const lines = documentContent.trim().split('\n').filter(line => line.trim());
    logger.info(`Processing JSONL document`, {
        totalLines: lines.length,
        firstLinePreview: lines[0]?.substring(0, 200) || 'empty'
    });
    
    const data = lines.map(line => JSON.parse(line));
    logger.info(`Parsed ${data.length} records from JSONL`);

    // Initialize totals
    let totalSales = 0;
    let totalGrossProfit = 0;
    let totalPPCSpent = 0;
    let totalFBAFees = 0;
    let totalStorageFees = 0;
    let totalFees = 0; // Total of all fees (all fee types combined)
    let totalAmazonFees = 0; // Amazon-specific fees (FBA, storage, referral, etc.)
    let totalRefunds = 0;
    let currencyCode = 'USD';
    
    // Data structures for datewise and ASIN-wise breakdowns
    const datewiseSales = {}; // { date: { sales, grossProfit } }
    const datewiseGrossProfit = {}; // { date: amount }
    const asinWiseSales = {}; // { asin: { sales, grossProfit, unitsSold, ppcSpent, fbaFees, storageFees, amazonFees } }

    /**
     * Process a single economics item
     * @param {Object} item - Economics data item
     */
    const processEconomicsItem = (item) => {
        // Get currency code from first record
        if (!currencyCode && item.sales?.netProductSales?.currencyCode) {
            currencyCode = item.sales.netProductSales.currencyCode;
        }

        // Get date and ASIN for grouping
        const date = item.startDate || item.endDate; // Use startDate or endDate for date grouping
        const asin = item.parentAsin || 'UNKNOWN';
        
        // Calculate sales and gross profit
        const netSales = parseFloat(item.sales?.netProductSales?.amount || 0);
        const orderedSales = parseFloat(item.sales?.orderedProductSales?.amount || 0);
        const cogs = parseFloat(item.cost?.costOfGoodsSold?.amount || 0);
        const grossProfit = netSales - cogs;
        const unitsSold = parseFloat(item.sales?.netUnitsSold || 0);
        
        // Update totals
        totalSales += orderedSales;
        totalGrossProfit += grossProfit;
        
        // Update datewise data
        if (date) {
            if (!datewiseSales[date]) {
                datewiseSales[date] = { sales: 0, grossProfit: 0 };
            }
            datewiseSales[date].sales += orderedSales;
            datewiseSales[date].grossProfit += grossProfit;
            
            if (!datewiseGrossProfit[date]) {
                datewiseGrossProfit[date] = 0;
            }
            datewiseGrossProfit[date] += grossProfit;
        }
        
        // Initialize ASIN-wise data structure if needed
        if (asin && asin !== 'UNKNOWN') {
            if (!asinWiseSales[asin]) {
                asinWiseSales[asin] = { 
                    sales: 0, 
                    grossProfit: 0, 
                    unitsSold: 0,
                    ppcSpent: 0,
                    fbaFees: 0,
                    storageFees: 0,
                    totalFees: 0,
                    amazonFees: 0, // Amazon-specific fees (FBA, storage, referral, etc.)
                    feeBreakdown: {}, // { feeTypeName: amount }
                    asin: asin
                };
            }
            // Update ASIN-wise sales and profit
            asinWiseSales[asin].sales += orderedSales;
            asinWiseSales[asin].grossProfit += grossProfit;
            asinWiseSales[asin].unitsSold += unitsSold;
        }

        // Calculate PPC Spent (from ads) - track per ASIN
        let itemPPCSpent = 0;
        if (item.ads && Array.isArray(item.ads)) {
            item.ads.forEach(ad => {
                // charge is already AggregatedDetail type, not wrapped
                const adSpend = parseFloat(ad.charge?.totalAmount?.amount || ad.charge?.amount?.amount || 0);
                itemPPCSpent += adSpend;
                totalPPCSpent += adSpend;
            });
        }
        
        // Update ASIN-wise PPC
        if (asin && asin !== 'UNKNOWN') {
            asinWiseSales[asin].ppcSpent += itemPPCSpent;
        }

        // Calculate ALL Fees - track per ASIN with breakdown
        let itemFBAFees = 0;
        let itemStorageFees = 0;
        let itemTotalFees = 0;
        let itemAmazonFees = 0;
        
        if (item.fees && Array.isArray(item.fees)) {
            item.fees.forEach(fee => {
                const feeTypeName = fee.feeTypeName || 'Unknown';
                const feeTypeNameLower = feeTypeName.toLowerCase();
                
                // Handle charges array - sum all charges for this fee type
                let feeAmount = 0;
                if (fee.charges && Array.isArray(fee.charges)) {
                    fee.charges.forEach(charge => {
                        const chargeAmount = parseFloat(
                            charge?.aggregatedDetail?.totalAmount?.amount || 
                            charge?.aggregatedDetail?.amount?.amount || 
                            0
                        );
                        feeAmount += chargeAmount;
                    });
                } else if (fee.charges?.aggregatedDetail?.totalAmount?.amount) {
                    feeAmount = parseFloat(fee.charges.aggregatedDetail.totalAmount.amount);
                }

                // Add to total fees (all fee types)
                itemTotalFees += feeAmount;
                totalFees += feeAmount; // Add to overall total fees

                // Categorize as Amazon fee (all fees are now considered Amazon fees)
                if (isAmazonFee(feeTypeName)) {
                    itemAmazonFees += feeAmount;
                    totalAmazonFees += feeAmount;
                }

                // Categorize specific fee types for backward compatibility
                // FBA Fulfillment Fee
                if (feeTypeNameLower.includes('fba') && (feeTypeNameLower.includes('fulfillment') || feeTypeNameLower.includes('fulfilment'))) {
                    itemFBAFees += feeAmount;
                    totalFBAFees += feeAmount;
                }
                // Storage Fee
                else if (feeTypeNameLower.includes('storage')) {
                    itemStorageFees += feeAmount;
                    totalStorageFees += feeAmount;
                }

                // Track fee breakdown per ASIN
                if (asin && asin !== 'UNKNOWN' && feeAmount !== 0) {
                    if (!asinWiseSales[asin].feeBreakdown[feeTypeName]) {
                        asinWiseSales[asin].feeBreakdown[feeTypeName] = 0;
                    }
                    asinWiseSales[asin].feeBreakdown[feeTypeName] += feeAmount;
                }
            });
        }
        
        // Update ASIN-wise fees
        if (asin && asin !== 'UNKNOWN') {
            asinWiseSales[asin].fbaFees += itemFBAFees;
            asinWiseSales[asin].storageFees += itemStorageFees;
            asinWiseSales[asin].totalFees += itemTotalFees;
            asinWiseSales[asin].amazonFees += itemAmazonFees;
        }

        // Calculate Refunds
        // Refunds can be calculated from unitsRefunded * average selling price
        const unitsRefunded = parseFloat(item.sales?.unitsRefunded || 0);
        const avgPrice = parseFloat(item.sales?.averageSellingPrice?.amount || 0);
        const refundAmount = unitsRefunded * avgPrice;
        totalRefunds += refundAmount;
    };

    // Process each record
    let processedCount = 0;
    data.forEach((record, index) => {
        // Handle nested structure (if data is wrapped)
        if (record.data?.analytics_economics_2024_03_15?.economics) {
            logger.debug(`Processing nested structure record ${index + 1}`);
            const economics = record.data.analytics_economics_2024_03_15.economics;
            economics.forEach(item => {
                processEconomicsItem(item);
                processedCount++;
            });
        } 
        // Handle direct structure (data is directly in the record)
        else if (record.sales || record.fees || record.ads) {
            logger.debug(`Processing direct structure record ${index + 1}`, {
                hasSales: !!record.sales,
                hasFees: !!record.fees,
                hasAds: !!record.ads,
                feeCount: record.fees?.length || 0,
                adCount: record.ads?.length || 0
            });
            // This is a direct economics record
            processEconomicsItem(record);
            processedCount++;
        } else {
            logger.warn('Unknown record format, skipping', {
                recordIndex: index + 1,
                recordKeys: Object.keys(record),
                hasData: !!record.data,
                hasSales: !!record.sales
            });
        }
    });
    
    logger.info(`Finished processing records`, {
        totalRecords: data.length,
        processedRecords: processedCount,
        totals: {
            totalSales,
            grossProfit: totalGrossProfit,
            ppcSpent: totalPPCSpent,
            fbaFees: totalFBAFees,
            storageFees: totalStorageFees,
            totalFees: totalFees,
            amazonFees: totalAmazonFees,
            refunds: totalRefunds
        },
        datewiseCount: Object.keys(datewiseSales).length,
        asinCount: Object.keys(asinWiseSales).length
    });

    // Convert datewise data to sorted arrays
    const datewiseSalesArray = Object.keys(datewiseSales)
        .sort()
        .map(date => ({
            date,
            sales: {
                amount: parseFloat(datewiseSales[date].sales.toFixed(2)),
                currencyCode
            },
            grossProfit: {
                amount: parseFloat(datewiseSales[date].grossProfit.toFixed(2)),
                currencyCode
            }
        }));

    const datewiseGrossProfitArray = Object.keys(datewiseGrossProfit)
        .sort()
        .map(date => ({
            date,
            grossProfit: {
                amount: parseFloat(datewiseGrossProfit[date].toFixed(2)),
                currencyCode
            }
        }));

    // Convert ASIN-wise data to array and sort by sales (descending)
    const asinWiseSalesArray = Object.values(asinWiseSales)
        .map(asinData => {
            // Convert feeBreakdown object to array format
            const feeBreakdownArray = Object.entries(asinData.feeBreakdown || {})
                .map(([feeType, amount]) => ({
                    feeType: feeType,
                    amount: parseFloat(amount.toFixed(2))
                }))
                .filter(item => item.amount !== 0); // Remove zero amounts

            return {
            asin: asinData.asin,
            sales: {
                amount: parseFloat(asinData.sales.toFixed(2)),
                currencyCode
            },
            grossProfit: {
                amount: parseFloat(asinData.grossProfit.toFixed(2)),
                currencyCode
            },
            unitsSold: asinData.unitsSold,
            ppcSpent: {
                amount: parseFloat(asinData.ppcSpent.toFixed(2)),
                currencyCode
            },
            fbaFees: {
                amount: parseFloat(asinData.fbaFees.toFixed(2)),
                currencyCode
            },
            storageFees: {
                amount: parseFloat(asinData.storageFees.toFixed(2)),
                currencyCode
                },
                totalFees: {
                    amount: parseFloat(asinData.totalFees.toFixed(2)),
                    currencyCode
                },
                amazonFees: {
                    amount: parseFloat(asinData.amazonFees.toFixed(2)),
                    currencyCode
                },
                feeBreakdown: feeBreakdownArray
            };
        })
        .sort((a, b) => b.sales.amount - a.sales.amount);

    // Build and return the metrics object
    const metrics = {
        dateRange: {
            startDate,
            endDate
        },
        marketplace,
        totalSales: {
            amount: parseFloat(totalSales.toFixed(2)),
            currencyCode
        },
        grossProfit: {
            amount: parseFloat(totalGrossProfit.toFixed(2)),
            currencyCode
        },
        ppcSpent: {
            amount: parseFloat(totalPPCSpent.toFixed(2)),
            currencyCode
        },
        fbaFees: {
            amount: parseFloat(totalFBAFees.toFixed(2)),
            currencyCode
        },
        storageFees: {
            amount: parseFloat(totalStorageFees.toFixed(2)),
            currencyCode
        },
        totalFees: {
            amount: parseFloat(totalFees.toFixed(2)),
            currencyCode
        },
        amazonFees: {
            amount: parseFloat(totalAmazonFees.toFixed(2)),
            currencyCode
        },
        refunds: {
            amount: parseFloat(totalRefunds.toFixed(2)),
            currencyCode
        },
        datewiseSales: datewiseSalesArray,
        datewiseGrossProfit: datewiseGrossProfitArray,
        asinWiseSales: asinWiseSalesArray
    };

    return metrics;
}

module.exports = {
    calculateEconomicsMetrics
};


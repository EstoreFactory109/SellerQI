/**
 * EconomicsMetricsCalculation.js
 * 
 * Service for calculating economics metrics from Amazon Data Kiosk API JSONL data
 * Processes raw economics data and calculates:
 * - Total Sales (orderedProductSales)
 * - Gross Profit (netProceeds.total - actual profit after all fees)
 * - PPC Spent (from ads data)
 * - Amazon Fees (FBA fulfillment, storage, referral, closing, per-item fees)
 * - Refunds (orderedProductSales - netProductSales)
 * - Datewise breakdowns
 * - ASIN-wise breakdowns
 * 
 * IMPORTANT: This uses netProceeds.total from Amazon API as the gross profit,
 * which is the actual profit after all fees are deducted.
 */

const logger = require('../../utils/Logger');

/**
 * Fee type categories for proper classification
 */
const FEE_TYPE_CATEGORIES = {
    FBA_FULFILLMENT: ['FbaFulfilmentFee', 'FbaFulfillmentFee', 'FBA_FULFILLMENT_FEE', 'FBA_FULFILLMENT_FEES'],
    STORAGE: ['FbaStorageFee', 'FBA_STORAGE_FEE', 'MONTHLY_INVENTORY_STORAGE_FEES', 'BASE_MONTHLY_STORAGE_FEE', 'STORAGE_UTILIZATION_SURCHARGE', 'AGED_INVENTORY_SURCHARGE'],
    REFERRAL: ['ReferralFee', 'REFERRAL_FEE', 'REFERRAL_FEES'],
    REFUND_RELATED: ['RefundedReferralFee', 'RefundCommissionFee', 'REFUND_ADMINISTRATION'],
    REIMBURSEMENT: ['FBAInventoryReimbursement', 'FBA_INVENTORY_REIMBURSEMENT'],
    DISPOSAL: ['DisposalFee', 'DISPOSAL_FEE', 'RemovalFee', 'REMOVAL_FEE'],
    OTHER: ['ClosingFee', 'CLOSING_FEES', 'PerItemFee', 'PER_ITEM_SELLING_FEES']
};

/**
 * Check if fee type matches a category
 * @param {string} feeTypeName - The fee type name to check
 * @param {string} category - Category to check against
 * @returns {boolean} True if matches
 */
function isFeeType(feeTypeName, category) {
    if (!feeTypeName || !FEE_TYPE_CATEGORIES[category]) return false;
    const normalizedName = feeTypeName.toLowerCase().replace(/[_-]/g, '');
    return FEE_TYPE_CATEGORIES[category].some(typeName => 
        normalizedName === typeName.toLowerCase().replace(/[_-]/g, '') ||
        normalizedName.includes(typeName.toLowerCase().replace(/[_-]/g, ''))
    );
}

/**
 * Check if a fee type name is an Amazon fee (excluding reimbursements)
 * @param {string} feeTypeName - The fee type name to check
 * @returns {boolean} True if it's an Amazon fee
 */
function isAmazonFee(feeTypeName) {
    if (!feeTypeName) return false;
    // Reimbursements are negative fees (credits), not fees
    if (isFeeType(feeTypeName, 'REIMBURSEMENT')) return false;
    // All other fee types are Amazon fees
    return true;
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
    let totalGrossProfit = 0; // This will be netProceeds.total (actual profit)
    let totalPPCSpent = 0;
    let totalFBAFees = 0;
    let totalStorageFees = 0;
    let totalFees = 0; // Total of all fees (all fee types combined)
    let totalAmazonFees = 0; // Amazon-specific fees (FBA, storage, referral, etc.)
    let totalRefunds = 0; // Calculated as orderedProductSales - netProductSales
    let currencyCode = 'USD';
    
    // Data structures for datewise and ASIN-wise breakdowns
    const datewiseSales = {}; // { date: { sales, grossProfit } }
    const datewiseGrossProfit = {}; // { date: amount }
    const datewiseFeesAndRefunds = {}; // { date: { fbaFulfillmentFee, storageFee, refunds: { units, amount } } }
    const asinWiseSales = {}; // { asin: { sales, grossProfit, unitsSold, ppcSpent, fbaFees, storageFees, amazonFees } }

    /**
     * Process a single economics item
     * @param {Object} item - Economics data item
     */
    const processEconomicsItem = (item) => {
        // Get currency code from first record with sales
        if (item.sales?.orderedProductSales?.currencyCode) {
            currencyCode = item.sales.orderedProductSales.currencyCode;
        } else if (item.sales?.netProductSales?.currencyCode) {
            currencyCode = item.sales.netProductSales.currencyCode;
        }

        // Get date and ASIN for grouping
        const date = item.startDate || item.endDate; // Use startDate or endDate for date grouping
        const childAsin = item.childAsin || null;
        const parentAsin = item.parentAsin || null;
        const asin = childAsin || parentAsin || 'UNKNOWN';
        
        // Calculate sales values
        const orderedSales = parseFloat(item.sales?.orderedProductSales?.amount || 0);
        const netSales = parseFloat(item.sales?.netProductSales?.amount || 0);
        const unitsSold = parseFloat(item.sales?.netUnitsSold || 0);
        const unitsRefunded = parseFloat(item.sales?.unitsRefunded || 0);
        
        // CRITICAL FIX: Use netProceeds.total as gross profit (actual profit after all fees)
        // This is the accurate profit value from Amazon
        const grossProfit = parseFloat(item.netProceeds?.total?.amount || 0);
        
        // CRITICAL FIX: Calculate refunds as the difference between ordered and net sales
        // This accurately captures the refund amount
        const refundAmount = orderedSales - netSales;
        
        // Update totals
        totalSales += orderedSales;
        totalGrossProfit += grossProfit;
        
        // Only count positive refund amounts (refunds should be positive)
        if (refundAmount > 0) {
            totalRefunds += refundAmount;
        }
        
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
            
            // Initialize datewise fees and refunds if not exists
            if (!datewiseFeesAndRefunds[date]) {
                datewiseFeesAndRefunds[date] = {
                    fbaFulfillmentFee: 0,
                    storageFee: 0,
                    refunds: { units: 0, amount: 0 }
                };
            }
            
            // Update datewise refunds
            datewiseFeesAndRefunds[date].refunds.units += unitsRefunded;
            if (refundAmount > 0) {
                datewiseFeesAndRefunds[date].refunds.amount += refundAmount;
            }
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
                    refunds: 0, // Refund amount for this ASIN
                    feeBreakdown: {}, // { feeTypeName: amount }
                    asin: asin,
                    parentAsin: parentAsin  // Store parent ASIN for grouping
                };
            }
            // Update ASIN-wise sales and profit
            asinWiseSales[asin].sales += orderedSales;
            asinWiseSales[asin].grossProfit += grossProfit;
            asinWiseSales[asin].unitsSold += unitsSold;
            if (refundAmount > 0) {
                asinWiseSales[asin].refunds += refundAmount;
            }
        }

        // Calculate PPC Spent (from ads) - track per ASIN
        let itemPPCSpent = 0;
        if (item.ads && Array.isArray(item.ads)) {
            item.ads.forEach(ad => {
                // Handle the nested structure: charge.aggregatedDetail.totalAmount.amount
                const adSpend = parseFloat(
                    ad.charge?.aggregatedDetail?.totalAmount?.amount || 
                    ad.charge?.aggregatedDetail?.amount?.amount ||
                    ad.charge?.totalAmount?.amount || 
                    ad.charge?.amount?.amount || 
                    0
                );
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

                // Add to total fees (all fee types) - only positive fees
                // Negative amounts are reimbursements/credits
                if (feeAmount > 0) {
                itemTotalFees += feeAmount;
                    totalFees += feeAmount;
                }

                // Categorize as Amazon fee (excludes reimbursements which are credits)
                if (isAmazonFee(feeTypeName) && feeAmount > 0) {
                    itemAmazonFees += feeAmount;
                    totalAmazonFees += feeAmount;
                }

                // Categorize specific fee types using improved matching
                // FBA Fulfillment Fee
                if (isFeeType(feeTypeName, 'FBA_FULFILLMENT') && feeAmount > 0) {
                    itemFBAFees += feeAmount;
                    totalFBAFees += feeAmount;
                    // Update datewise FBA fulfillment fee
                    if (date && datewiseFeesAndRefunds[date]) {
                        datewiseFeesAndRefunds[date].fbaFulfillmentFee += feeAmount;
                    }
                }
                // Storage Fee
                else if (isFeeType(feeTypeName, 'STORAGE') && feeAmount > 0) {
                    itemStorageFees += feeAmount;
                    totalStorageFees += feeAmount;
                    // Update datewise storage fee
                    if (date && datewiseFeesAndRefunds[date]) {
                        datewiseFeesAndRefunds[date].storageFee += feeAmount;
                    }
                }

                // Track fee breakdown per ASIN (include all fee amounts for transparency)
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

    // Convert datewise fees and refunds to sorted array
    const datewiseFeesAndRefundsArray = Object.keys(datewiseFeesAndRefunds)
        .sort()
        .map(date => ({
            date,
            fbaFulfillmentFee: {
                amount: parseFloat(datewiseFeesAndRefunds[date].fbaFulfillmentFee.toFixed(2)),
                currencyCode
            },
            storageFee: {
                amount: parseFloat(datewiseFeesAndRefunds[date].storageFee.toFixed(2)),
                currencyCode
            },
            refunds: {
                units: datewiseFeesAndRefunds[date].refunds.units,
                amount: parseFloat(datewiseFeesAndRefunds[date].refunds.amount.toFixed(2)),
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
            parentAsin: asinData.parentAsin || null,  // Include parent ASIN for grouping
            sales: {
                amount: parseFloat(asinData.sales.toFixed(2)),
                currencyCode
            },
            grossProfit: {
                amount: parseFloat(asinData.grossProfit.toFixed(2)),
                currencyCode
            },
            unitsSold: asinData.unitsSold,
                refunds: {
                    amount: parseFloat((asinData.refunds || 0).toFixed(2)),
                    currencyCode
                },
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
        datewiseFeesAndRefunds: datewiseFeesAndRefundsArray,
        asinWiseSales: asinWiseSalesArray
    };

    return metrics;
}

/**
 * Process economics data from JSONL format and calculate date-wise metrics only
 * This is used with DAY granularity query to get accurate date-wise breakdowns
 * @param {string} documentContent - JSONL document content from Data Kiosk API
 * @param {string} startDate - Start date of the query
 * @param {string} endDate - End date of the query
 * @param {string} marketplace - Marketplace code
 * @returns {Object} Datewise metrics with breakdowns
 */
function calculateDatewiseMetrics(documentContent, startDate, endDate, marketplace) {
    // Parse JSONL data
    const lines = documentContent.trim().split('\n').filter(line => line.trim());
    logger.info(`Processing JSONL document for datewise metrics`, {
        totalLines: lines.length,
        firstLinePreview: lines[0]?.substring(0, 200) || 'empty'
    });
    
    const data = lines.map(line => JSON.parse(line));
    logger.info(`Parsed ${data.length} records from JSONL for datewise`);

    // Data structures for datewise breakdowns
    const datewiseSales = {}; // { date: { sales, grossProfit } }
    const datewiseGrossProfit = {}; // { date: amount }
    const datewiseFeesAndRefunds = {}; // { date: { fbaFulfillmentFee, storageFee, refunds: { units, amount } } }
    let currencyCode = 'USD';

    /**
     * Process a single economics item for datewise aggregation
     * @param {Object} item - Economics data item
     */
    const processItem = (item) => {
        // Get currency code
        if (item.sales?.orderedProductSales?.currencyCode) {
            currencyCode = item.sales.orderedProductSales.currencyCode;
        }

        // Get date for grouping - for DAY granularity, startDate = endDate = the specific day
        const date = item.startDate;
        if (!date) return;
        
        // Calculate values
        const orderedSales = parseFloat(item.sales?.orderedProductSales?.amount || 0);
        const netSales = parseFloat(item.sales?.netProductSales?.amount || 0);
        const grossProfit = parseFloat(item.netProceeds?.total?.amount || 0);
        const unitsRefunded = parseFloat(item.sales?.unitsRefunded || 0);
        const refundAmount = Math.max(0, orderedSales - netSales);
        
        // Initialize date entry if not exists
        if (!datewiseSales[date]) {
            datewiseSales[date] = { sales: 0, grossProfit: 0 };
        }
        if (!datewiseGrossProfit[date]) {
            datewiseGrossProfit[date] = 0;
        }
        if (!datewiseFeesAndRefunds[date]) {
            datewiseFeesAndRefunds[date] = {
                fbaFulfillmentFee: 0,
                storageFee: 0,
                refunds: { units: 0, amount: 0 }
            };
        }
        
        // Aggregate sales and profit
        datewiseSales[date].sales += orderedSales;
        datewiseSales[date].grossProfit += grossProfit;
        datewiseGrossProfit[date] += grossProfit;
        
        // Aggregate refunds
        datewiseFeesAndRefunds[date].refunds.units += unitsRefunded;
        datewiseFeesAndRefunds[date].refunds.amount += refundAmount;
        
        // Process fees
        if (item.fees && Array.isArray(item.fees)) {
            item.fees.forEach(fee => {
                const feeTypeName = fee.feeTypeName || 'Unknown';
                
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
                }
                
                // Only count positive fees
                if (feeAmount > 0) {
                    if (isFeeType(feeTypeName, 'FBA_FULFILLMENT')) {
                        datewiseFeesAndRefunds[date].fbaFulfillmentFee += feeAmount;
                    } else if (isFeeType(feeTypeName, 'STORAGE')) {
                        datewiseFeesAndRefunds[date].storageFee += feeAmount;
                    }
                }
            });
        }
    };

    // Process each record
    data.forEach((record, index) => {
        if (record.data?.analytics_economics_2024_03_15?.economics) {
            record.data.analytics_economics_2024_03_15.economics.forEach(processItem);
        } else if (record.sales || record.fees || record.netProceeds) {
            processItem(record);
        }
    });

    // Convert to sorted arrays
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

    const datewiseFeesAndRefundsArray = Object.keys(datewiseFeesAndRefunds)
        .sort()
        .map(date => ({
            date,
            fbaFulfillmentFee: {
                amount: parseFloat(datewiseFeesAndRefunds[date].fbaFulfillmentFee.toFixed(2)),
                currencyCode
            },
            storageFee: {
                amount: parseFloat(datewiseFeesAndRefunds[date].storageFee.toFixed(2)),
                currencyCode
            },
            refunds: {
                units: datewiseFeesAndRefunds[date].refunds.units,
                amount: parseFloat(datewiseFeesAndRefunds[date].refunds.amount.toFixed(2)),
                currencyCode
            }
        }));

    logger.info(`Finished processing datewise records`, {
        datewiseCount: datewiseSalesArray.length,
        dateRange: datewiseSalesArray.length > 0 ? 
            `${datewiseSalesArray[0].date} to ${datewiseSalesArray[datewiseSalesArray.length - 1].date}` : 
            'no dates'
    });

    return {
        datewiseSales: datewiseSalesArray,
        datewiseGrossProfit: datewiseGrossProfitArray,
        datewiseFeesAndRefunds: datewiseFeesAndRefundsArray,
        currencyCode
    };
}

/**
 * Process economics data from JSONL format and calculate ASIN-wise daily metrics
 * This is used with DAY + CHILD_ASIN granularity query to get accurate ASIN-wise daily breakdowns
 * Each record will have: date, ASIN, sales, grossProfit, unitsSold, refunds, ppcSpent, fbaFees, storageFees, totalFees, amazonFees
 * 
 * @param {string} documentContent - JSONL document content from Data Kiosk API
 * @param {string} startDate - Start date of the query
 * @param {string} endDate - End date of the query
 * @param {string} marketplace - Marketplace code
 * @returns {Object} ASIN-wise daily metrics
 */
function calculateAsinWiseDailyMetrics(documentContent, startDate, endDate, marketplace) {
    // Parse JSONL data
    const lines = documentContent.trim().split('\n').filter(line => line.trim());
    logger.info(`Processing JSONL document for ASIN-wise daily metrics`, {
        totalLines: lines.length,
        firstLinePreview: lines[0]?.substring(0, 200) || 'empty'
    });
    
    const data = lines.map(line => JSON.parse(line));
    logger.info(`Parsed ${data.length} records from JSONL for ASIN-wise daily`);

    // Data structure for ASIN-wise daily data
    // Key: "date|asin" for uniqueness
    const asinDailyData = {};
    let currencyCode = 'USD';

    /**
     * Process a single economics item for ASIN-wise daily aggregation
     * @param {Object} item - Economics data item
     */
    const processItem = (item) => {
        // Get currency code
        if (item.sales?.orderedProductSales?.currencyCode) {
            currencyCode = item.sales.orderedProductSales.currencyCode;
        }

        // Get date and ASIN - for DAY granularity, startDate = endDate = the specific day
        const date = item.startDate;
        const childAsin = item.childAsin || null;
        const parentAsin = item.parentAsin || null;
        const asin = childAsin || parentAsin || 'UNKNOWN';
        
        if (!date || asin === 'UNKNOWN') return;
        
        const key = `${date}|${asin}`;
        
        // Initialize entry if not exists
        if (!asinDailyData[key]) {
            asinDailyData[key] = {
                date: date,
                asin: asin,
                parentAsin: parentAsin,  // Store parent ASIN for grouping
                sales: 0,
                grossProfit: 0,
                unitsSold: 0,
                unitsRefunded: 0,
                refunds: 0,
                ppcSpent: 0,
                fbaFees: 0,
                storageFees: 0,
                totalFees: 0,
                amazonFees: 0,
                feeBreakdown: {}
            };
        }
        
        // Calculate values
        const orderedSales = parseFloat(item.sales?.orderedProductSales?.amount || 0);
        const netSales = parseFloat(item.sales?.netProductSales?.amount || 0);
        const grossProfit = parseFloat(item.netProceeds?.total?.amount || 0);
        const netUnitsSold = parseFloat(item.sales?.netUnitsSold || 0);
        const unitsRefunded = parseFloat(item.sales?.unitsRefunded || 0);
        const refundAmount = Math.max(0, orderedSales - netSales);
        
        // Aggregate sales and profit
        asinDailyData[key].sales += orderedSales;
        asinDailyData[key].grossProfit += grossProfit;
        asinDailyData[key].unitsSold += netUnitsSold;
        asinDailyData[key].unitsRefunded += unitsRefunded;
        asinDailyData[key].refunds += refundAmount;
        
        // Process PPC/ads
        if (item.ads && Array.isArray(item.ads)) {
            item.ads.forEach(ad => {
                const adSpend = parseFloat(
                    ad.charge?.aggregatedDetail?.totalAmount?.amount || 
                    ad.charge?.aggregatedDetail?.amount?.amount ||
                    ad.charge?.totalAmount?.amount || 
                    ad.charge?.amount?.amount || 
                    0
                );
                asinDailyData[key].ppcSpent += adSpend;
            });
        }
        
        // Process fees
        if (item.fees && Array.isArray(item.fees)) {
            item.fees.forEach(fee => {
                const feeTypeName = fee.feeTypeName || 'Unknown';
                
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
                }
                
                // Only count positive fees
                if (feeAmount > 0) {
                    asinDailyData[key].totalFees += feeAmount;
                    
                    // Categorize as Amazon fee
                    if (isAmazonFee(feeTypeName)) {
                        asinDailyData[key].amazonFees += feeAmount;
                    }
                    
                    // Categorize specific fee types
                    if (isFeeType(feeTypeName, 'FBA_FULFILLMENT')) {
                        asinDailyData[key].fbaFees += feeAmount;
                    } else if (isFeeType(feeTypeName, 'STORAGE')) {
                        asinDailyData[key].storageFees += feeAmount;
                    }
                    
                    // Track fee breakdown
                    if (!asinDailyData[key].feeBreakdown[feeTypeName]) {
                        asinDailyData[key].feeBreakdown[feeTypeName] = 0;
                    }
                    asinDailyData[key].feeBreakdown[feeTypeName] += feeAmount;
                }
            });
        }
    };

    // Process each record
    data.forEach((record, index) => {
        if (record.data?.analytics_economics_2024_03_15?.economics) {
            record.data.analytics_economics_2024_03_15.economics.forEach(processItem);
        } else if (record.sales || record.fees || record.netProceeds) {
            processItem(record);
        }
    });

    // Convert to sorted array format matching the schema
    const asinWiseSalesArray = Object.values(asinDailyData)
        .map(item => {
            // Convert feeBreakdown object to array format
            const feeBreakdownArray = Object.entries(item.feeBreakdown || {})
                .map(([feeType, amount]) => ({
                    feeType: feeType,
                    amount: parseFloat(amount.toFixed(2))
                }))
                .filter(fb => fb.amount !== 0);

            return {
                date: item.date,
                asin: item.asin,
                parentAsin: item.parentAsin || null,  // Include parent ASIN for grouping
                sales: {
                    amount: parseFloat(item.sales.toFixed(2)),
                    currencyCode
                },
                grossProfit: {
                    amount: parseFloat(item.grossProfit.toFixed(2)),
                    currencyCode
                },
                unitsSold: item.unitsSold,
                refunds: {
                    amount: parseFloat(item.refunds.toFixed(2)),
                    currencyCode
                },
                ppcSpent: {
                    amount: parseFloat(item.ppcSpent.toFixed(2)),
                    currencyCode
                },
                fbaFees: {
                    amount: parseFloat(item.fbaFees.toFixed(2)),
                    currencyCode
                },
                storageFees: {
                    amount: parseFloat(item.storageFees.toFixed(2)),
                    currencyCode
                },
                totalFees: {
                    amount: parseFloat(item.totalFees.toFixed(2)),
                    currencyCode
                },
                amazonFees: {
                    amount: parseFloat(item.amazonFees.toFixed(2)),
                    currencyCode
                },
                feeBreakdown: feeBreakdownArray
            };
        })
        // Sort by date first, then by sales amount descending
        .sort((a, b) => {
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) return dateCompare;
            return b.sales.amount - a.sales.amount;
        });

    logger.info(`Finished processing ASIN-wise daily records`, {
        totalRecords: asinWiseSalesArray.length,
        uniqueAsins: new Set(asinWiseSalesArray.map(r => r.asin)).size,
        uniqueDates: new Set(asinWiseSalesArray.map(r => r.date)).size,
        dateRange: asinWiseSalesArray.length > 0 ? 
            `${asinWiseSalesArray[0].date} to ${asinWiseSalesArray[asinWiseSalesArray.length - 1].date}` : 
            'no dates'
    });

    return {
        asinWiseSales: asinWiseSalesArray,
        currencyCode
    };
}

module.exports = {
    calculateEconomicsMetrics,
    calculateDatewiseMetrics,
    calculateAsinWiseDailyMetrics,
    isFeeType,
    isAmazonFee
};


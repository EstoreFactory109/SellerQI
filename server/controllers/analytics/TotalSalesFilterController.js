/**
 * TotalSalesFilterController.js
 * 
 * Controller for filtering total sales component values from EconomicsMetrics model
 * Supports:
 * - Last 30 days: Returns total values from latest document
 * - Last 7 days: Gets datewise values from latest document, sums them
 * - Custom range: Checks all documents, gets datewise values for range, sums them
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');

/**
 * Filter total sales data based on date range
 * GET /api/total-sales/filter?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&periodType=last30|last7|custom
 */
const filterTotalSales = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { startDate, endDate, periodType = 'last30' } = req.query;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    // Validate dates for custom range
    if (periodType === 'custom' && (!startDate || !endDate)) {
        throw new ApiError(400, 'startDate and endDate are required for custom range');
    }

    try {
        let result = {};

        if (periodType === 'last30') {
            // Last 30 days: Return total values from latest document
            result = await getLast30DaysData(userId, country, region);
        } else if (periodType === 'last7') {
            // Last 7 days: Get datewise values from latest document, sum them
            // Use dates from frontend if provided, otherwise calculate default
            result = await getLast7DaysData(userId, country, region, startDate, endDate);
        } else if (periodType === 'custom') {
            // Custom range: Check all documents, get datewise values for range, sum them
            result = await getCustomRangeData(userId, country, region, startDate, endDate);
        } else {
            throw new ApiError(400, 'Invalid periodType. Must be: last30, last7, or custom');
        }

        logger.info('Total sales filter completed', {
            userId,
            country,
            region,
            periodType,
            startDate,
            endDate,
            resultKeys: Object.keys(result)
        });

        return res.status(200).json(
            new ApiResponse(200, result, 'Total sales data filtered successfully')
        );
    } catch (error) {
        logger.error('Error filtering total sales', {
            userId,
            country,
            region,
            periodType,
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
});

/**
 * Get last 30 days data - calculate totals by summing datewise values
 * 
 * IMPORTANT: To ensure consistency with custom range filter, we calculate
 * totalSales by summing datewiseSales instead of using stored pre-aggregated values.
 * This guarantees: same dates → same result, regardless of filter type.
 */
async function getLast30DaysData(userId, country, region) {
    // Get the latest economics metrics document
    const latestMetrics = await EconomicsMetrics.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!latestMetrics) {
        logger.warn('No economics metrics found for last 30 days', { userId, country, region });
        return createEmptyResult();
    }

    const currencyCode = latestMetrics.totalSales?.currencyCode || 'USD';
    
    // Get datewise data from the document
    const datewiseSales = latestMetrics.datewiseSales || [];
    const datewiseFeesAndRefunds = latestMetrics.datewiseFeesAndRefunds || [];
    const datewiseAmazonFees = latestMetrics.datewiseAmazonFees || [];
    
    // Calculate totals by summing datewise values (same method as custom range)
    let totalSales = 0;
    let totalFbaFees = 0;
    let totalAmazonFees = 0; // Changed from totalStorageFees to totalAmazonFees
    let totalRefunds = 0;
    
    datewiseSales.forEach(item => {
        totalSales += item.sales?.amount || 0;
    });
    
    datewiseFeesAndRefunds.forEach(item => {
        totalFbaFees += item.fbaFulfillmentFee?.amount || 0;
        totalRefunds += item.refunds?.amount || 0;
    });
    
    // Calculate total Amazon fees from datewiseAmazonFees
    datewiseAmazonFees.forEach(item => {
        totalAmazonFees += item.totalAmount?.amount || 0;
    });
    
    // Prepare datewise chart data
    const datewiseChartData = datewiseSales.map(item => {
        const itemDate = new Date(item.date);
        const dateKey = itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        return {
            date: dateKey,
            totalSales: item.sales?.amount || 0,
            grossProfit: item.grossProfit?.amount || 0,
            originalDate: item.date
        };
    }).sort((a, b) => new Date(a.originalDate) - new Date(b.originalDate));

    // Get PPC spent from actual datewise PPC data (not estimated)
    // Use the same date range as the economics metrics
    const dateRange = latestMetrics.dateRange || {};
    let ppcSpent = 0;
    
    if (dateRange.startDate && dateRange.endDate) {
        ppcSpent = await getDatewisePPCSpend(userId, country, region, dateRange.startDate, dateRange.endDate);
    }
    
    // Fallback to stored value if no datewise PPC data found
    if (ppcSpent === 0) {
        ppcSpent = latestMetrics.ppcSpent?.amount || 0;
    }
    
    // Calculate gross profit: Sales - Amazon Fees - Refunds
    // Note: Amazon Fees includes FBA fees, storage fees, referral fees, etc.
    // PPC is subtracted in frontend for display, not in backend calculation
    const calculatedGrossProfit = totalSales - totalAmazonFees - totalRefunds;
    
    // Calculate Other Amazon Fees = Total Amazon Fees - FBA Fees (for Total Sales component)
    const otherAmazonFees = Math.max(0, totalAmazonFees - totalFbaFees);

    // Return calculated totals (sum of datewise values)
    return {
        totalSales: { amount: parseFloat(totalSales.toFixed(2)), currencyCode },
        grossProfit: { amount: parseFloat(calculatedGrossProfit.toFixed(2)), currencyCode },
        ppcSpent: { amount: parseFloat(ppcSpent.toFixed(2)), currencyCode },
        fbaFees: { amount: parseFloat(totalFbaFees.toFixed(2)), currencyCode },
        amazonFees: { amount: parseFloat(totalAmazonFees.toFixed(2)), currencyCode }, // Total Amazon fees (for Profitability page)
        otherAmazonFees: { amount: parseFloat(otherAmazonFees.toFixed(2)), currencyCode }, // Amazon fees excluding FBA (for Total Sales component)
        refunds: { amount: parseFloat(totalRefunds.toFixed(2)), currencyCode },
        dateRange: latestMetrics.dateRange || { startDate: null, endDate: null },
        datewiseChartData: datewiseChartData,
        currencyCode: currencyCode
    };
}

/**
 * Get last 7 days data - get datewise values from latest document, sum them
 * Uses dates from frontend if provided, otherwise calculates default (7 days ending yesterday)
 * 
 * IMPORTANT: When custom dates are provided (startDateParam, endDateParam), this function
 * delegates to getCustomRangeData to ensure all historical documents are queried.
 * This is necessary because the "7 days" filter with custom dates might need data
 * from multiple documents (e.g., historical date ranges).
 * 
 * All totals are calculated by summing datewise values for consistency.
 */
async function getLast7DaysData(userId, country, region, startDateParam = null, endDateParam = null) {
    // If custom dates are provided, delegate to getCustomRangeData for full historical support
    // This ensures we query ALL documents, not just the latest one
    if (startDateParam && endDateParam) {
        logger.info('7-day filter with custom dates - delegating to getCustomRangeData for historical data support', {
            userId,
            country,
            region,
            startDate: startDateParam,
            endDate: endDateParam
        });
        return await getCustomRangeData(userId, country, region, startDateParam, endDateParam);
    }
    
    // Default behavior: Calculate last 7 days from yesterday and use latest document
    let startDate, endDate;
    
    // Default: Calculate last 7 days date range (6 days before yesterday to yesterday)
    endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // Yesterday
    endDate.setHours(23, 59, 59, 999);
    startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6); // 6 days before yesterday = 7 days total
    startDate.setHours(0, 0, 0, 0);

    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    // Get the latest economics metrics document
    const latestMetrics = await EconomicsMetrics.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!latestMetrics) {
        logger.warn('No economics metrics found for last 7 days', { userId, country, region });
        return createEmptyResult();
    }

    // Get datewise data from the document
    const datewiseSales = latestMetrics.datewiseSales || [];
    const datewiseFeesAndRefunds = latestMetrics.datewiseFeesAndRefunds || [];
    const datewiseAmazonFees = latestMetrics.datewiseAmazonFees || [];

    // Filter and sum data for last 7 days
    const filteredSales = datewiseSales.filter(item => {
        const itemDate = new Date(item.date);
        return itemDate >= startDate && itemDate <= endDate;
    });

    const filteredFeesAndRefunds = datewiseFeesAndRefunds.filter(item => {
        const itemDate = new Date(item.date);
        return itemDate >= startDate && itemDate <= endDate;
    });

    const filteredAmazonFees = datewiseAmazonFees.filter(item => {
        const itemDate = new Date(item.date);
        return itemDate >= startDate && itemDate <= endDate;
    });

    // Sum up the values
    let totalSales = 0;
    let totalFbaFees = 0;
    let totalAmazonFees = 0; // Changed from totalStorageFees to totalAmazonFees
    let totalRefunds = 0;
    let currencyCode = latestMetrics.totalSales?.currencyCode || 'USD';

    filteredSales.forEach(item => {
        totalSales += item.sales?.amount || 0;
    });

    filteredFeesAndRefunds.forEach(item => {
        totalFbaFees += item.fbaFulfillmentFee?.amount || 0;
        totalRefunds += item.refunds?.amount || 0;
    });

    // Calculate total Amazon fees and Other Amazon Fees from filtered datewiseAmazonFees
    // For Total Sales component: Sum fees that are NOT FbaFulfilmentFee from feeBreakdown
    let otherAmazonFees = 0;
    filteredAmazonFees.forEach(item => {
        totalAmazonFees += item.totalAmount?.amount || 0;
        
        // Calculate Other Amazon Fees by summing non-FBA fees from feeBreakdown
        if (Array.isArray(item.feeBreakdown)) {
            item.feeBreakdown.forEach(fee => {
                // Exclude FBA Fulfillment fees (check various naming conventions)
                const feeType = fee.feeType || '';
                const isFbaFee = feeType.toLowerCase().includes('fbafulfil') || 
                                 feeType.toLowerCase().includes('fba_fulfil') ||
                                 feeType === 'FbaFulfilmentFee' ||
                                 feeType === 'FbaFulfillmentFee';
                if (!isFbaFee && fee.amount > 0) {
                    otherAmazonFees += fee.amount;
                }
            });
        }
    });

    // Get PPC spent from actual datewise PPC data (not estimated)
    let totalPpcSpent = await getDatewisePPCSpend(userId, country, region, startDateStr, endDateStr);
    
    // Fallback to proportional calculation if no datewise PPC data found
    if (totalPpcSpent === 0 && latestMetrics.ppcSpent?.amount > 0) {
        totalPpcSpent = calculateProportionalPPC(
            latestMetrics.ppcSpent?.amount || 0,
            filteredSales.length,
            datewiseSales.length
        );
    }

    // Calculate gross profit: Sales - Amazon Fees - Refunds
    // Note: Amazon Fees includes FBA fees, storage fees, referral fees, etc.
    // PPC is subtracted in frontend for display, not in backend calculation
    const calculatedGrossProfit = totalSales - totalAmazonFees - totalRefunds;

    // Prepare datewise data for chart
    const datewiseChartData = filteredSales.map(item => {
        const itemDate = new Date(item.date);
        const dateKey = itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        return {
            date: dateKey,
            totalSales: item.sales?.amount || 0,
            grossProfit: item.grossProfit?.amount || 0, // Chart uses Amazon's gross profit for daily breakdown
            originalDate: item.date
        };
    });

    return {
        totalSales: { amount: parseFloat(totalSales.toFixed(2)), currencyCode },
        grossProfit: { amount: parseFloat(calculatedGrossProfit.toFixed(2)), currencyCode },
        ppcSpent: { amount: parseFloat(totalPpcSpent.toFixed(2)), currencyCode },
        fbaFees: { amount: parseFloat(totalFbaFees.toFixed(2)), currencyCode },
        amazonFees: { amount: parseFloat(totalAmazonFees.toFixed(2)), currencyCode }, // Total Amazon fees (for Profitability page)
        otherAmazonFees: { amount: parseFloat(otherAmazonFees.toFixed(2)), currencyCode }, // Amazon fees excluding FBA (for Total Sales component)
        refunds: { amount: parseFloat(totalRefunds.toFixed(2)), currencyCode },
        dateRange: {
            startDate: startDateStr,
            endDate: endDateStr
        },
        datewiseChartData: datewiseChartData,
        currencyCode
    };
}

/**
 * Get custom range data - check all documents, get datewise values for range, sum them
 * 
 * IMPORTANT: All totals are calculated by summing datewise values.
 * This ensures consistency across all filter types since:
 * - Stored totalSales = sum(datewiseSales) (guaranteed by our calculation fix)
 * - Custom range totalSales = sum(filtered datewiseSales)
 * 
 * When dates match exactly, the result will be identical to getLast30DaysData
 * because we're summing the same datewise values.
 * 
 * Also aggregates ASIN-wise data from all documents for the date range.
 */
async function getCustomRangeData(userId, country, region, startDateStr, endDateStr) {
    // Parse dates
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    // Get all economics metrics documents for this user, country, and region
    const allMetrics = await EconomicsMetrics.find({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!allMetrics || allMetrics.length === 0) {
        logger.warn('No economics metrics found for custom range', { userId, country, region });
        return createEmptyResult();
    }

    logger.info('Processing custom date range - calculating from datewise data', {
        userId,
        country,
        region,
        requestedRange: { startDate: startDateStr, endDate: endDateStr }
    });

    // Aggregate data from all documents that overlap with the date range
    let totalSales = 0;
    let totalFbaFees = 0;
    let totalAmazonFees = 0; // Total Amazon fees (for Profitability page)
    let otherAmazonFees = 0; // Amazon fees excluding FBA (for Total Sales component)
    let totalRefunds = 0;
    let currencyCode = 'USD';
    const processedDates = new Set(); // Track processed dates to avoid duplicates for sales
    const processedFeeDates = new Set(); // Track processed dates to avoid duplicates for fees
    const processedAmazonFeeDates = new Set(); // Track processed dates to avoid duplicates for Amazon fees
    
    // ASIN-wise aggregation: Map of "asin-date" -> asin data (to avoid duplicates)
    const asinDateMap = new Map();

    for (const metrics of allMetrics) {
        // Check if document's date range overlaps with requested range
        const docStartDate = new Date(metrics.dateRange?.startDate);
        const docEndDate = new Date(metrics.dateRange?.endDate);
        docStartDate.setHours(0, 0, 0, 0);
        docEndDate.setHours(23, 59, 59, 999);

        // Check for overlap
        if (startDate <= docEndDate && endDate >= docStartDate) {
            // Get currency code from first document
            if (!currencyCode && metrics.totalSales?.currencyCode) {
                currencyCode = metrics.totalSales.currencyCode;
            }

            // Process datewise sales
            const datewiseSales = metrics.datewiseSales || [];
            datewiseSales.forEach(item => {
                const itemDate = new Date(item.date);
                const dateKey = itemDate.toISOString().split('T')[0];

                // Only process if within range and not already processed
                if (itemDate >= startDate && itemDate <= endDate && !processedDates.has(dateKey)) {
                    totalSales += item.sales?.amount || 0;
                    processedDates.add(dateKey);
                }
            });

            // Process datewise fees and refunds
            const datewiseFeesAndRefunds = metrics.datewiseFeesAndRefunds || [];
            datewiseFeesAndRefunds.forEach(item => {
                const itemDate = new Date(item.date);
                const dateKey = itemDate.toISOString().split('T')[0];

                // Only process if within range and not already processed for fees
                if (itemDate >= startDate && itemDate <= endDate && !processedFeeDates.has(dateKey)) {
                    totalFbaFees += item.fbaFulfillmentFee?.amount || 0;
                    totalRefunds += item.refunds?.amount || 0;
                    processedFeeDates.add(dateKey);
                }
            });

            // Process datewise Amazon fees
            const datewiseAmazonFees = metrics.datewiseAmazonFees || [];
            datewiseAmazonFees.forEach(item => {
                const itemDate = new Date(item.date);
                const dateKey = itemDate.toISOString().split('T')[0];

                // Only process if within range and not already processed for Amazon fees
                if (itemDate >= startDate && itemDate <= endDate && !processedAmazonFeeDates.has(dateKey)) {
                    totalAmazonFees += item.totalAmount?.amount || 0;
                    
                    // Calculate Other Amazon Fees by summing non-FBA fees from feeBreakdown
                    if (Array.isArray(item.feeBreakdown)) {
                        item.feeBreakdown.forEach(fee => {
                            // Exclude FBA Fulfillment fees (check various naming conventions)
                            const feeType = fee.feeType || '';
                            const isFbaFee = feeType.toLowerCase().includes('fbafulfil') || 
                                             feeType.toLowerCase().includes('fba_fulfil') ||
                                             feeType === 'FbaFulfilmentFee' ||
                                             feeType === 'FbaFulfillmentFee';
                            if (!isFbaFee && fee.amount > 0) {
                                otherAmazonFees += fee.amount;
                            }
                        });
                    }
                    
                    processedAmazonFeeDates.add(dateKey);
                }
            });
            
            // Process ASIN-wise sales data
            const asinWiseSales = metrics.asinWiseSales || [];
            asinWiseSales.forEach(item => {
                // Check if item has a date field (for daily breakdown)
                if (item.date) {
                    const itemDate = new Date(item.date);
                    const dateKey = itemDate.toISOString().split('T')[0];
                    
                    // Only process if within date range
                    if (itemDate >= startDate && itemDate <= endDate) {
                        // Use "asin-date" as unique key to avoid duplicates
                        const uniqueKey = `${item.asin}-${dateKey}`;
                        
                        if (!asinDateMap.has(uniqueKey)) {
                            asinDateMap.set(uniqueKey, {
                                date: item.date,
                                asin: item.asin,
                                parentAsin: item.parentAsin || null,
                                sales: item.sales || { amount: 0, currencyCode: 'USD' },
                                grossProfit: item.grossProfit || { amount: 0, currencyCode: 'USD' },
                                unitsSold: item.unitsSold || 0,
                                refunds: item.refunds || { amount: 0, currencyCode: 'USD' },
                                ppcSpent: item.ppcSpent || { amount: 0, currencyCode: 'USD' },
                                fbaFees: item.fbaFees || { amount: 0, currencyCode: 'USD' },
                                storageFees: item.storageFees || { amount: 0, currencyCode: 'USD' },
                                amazonFees: item.amazonFees || { amount: 0, currencyCode: 'USD' },
                                totalFees: item.totalFees || { amount: 0, currencyCode: 'USD' }
                            });
                        }
                    }
                } else {
                    // For data without dates (aggregated), include if document overlaps with range
                    // Use just ASIN as key since there's no date
                    const uniqueKey = `${item.asin}-nodatе`;
                    
                    if (!asinDateMap.has(uniqueKey)) {
                        asinDateMap.set(uniqueKey, {
                            date: null,
                            asin: item.asin,
                            parentAsin: item.parentAsin || null,
                            sales: item.sales || { amount: 0, currencyCode: 'USD' },
                            grossProfit: item.grossProfit || { amount: 0, currencyCode: 'USD' },
                            unitsSold: item.unitsSold || 0,
                            refunds: item.refunds || { amount: 0, currencyCode: 'USD' },
                            ppcSpent: item.ppcSpent || { amount: 0, currencyCode: 'USD' },
                            fbaFees: item.fbaFees || { amount: 0, currencyCode: 'USD' },
                            storageFees: item.storageFees || { amount: 0, currencyCode: 'USD' },
                            amazonFees: item.amazonFees || { amount: 0, currencyCode: 'USD' },
                            totalFees: item.totalFees || { amount: 0, currencyCode: 'USD' }
                        });
                    }
                }
            });
        }
    }
    
    // Convert ASIN-wise data map to array
    const asinWiseSalesArray = Array.from(asinDateMap.values());
    
    logger.info('ASIN-wise data aggregated for custom range', {
        userId,
        country,
        region,
        totalAsinRecords: asinWiseSalesArray.length,
        dateRange: { startDate: startDateStr, endDate: endDateStr }
    });
    
    // Get PPC spent from actual datewise PPC data (not estimated)
    let totalPpcSpent = await getDatewisePPCSpend(userId, country, region, startDateStr, endDateStr);
    
    // Fallback to proportional calculation if no datewise PPC data found
    if (totalPpcSpent === 0) {
        // Calculate proportional PPC from economics metrics as fallback
        for (const metrics of allMetrics) {
            const docStartDate = new Date(metrics.dateRange?.startDate);
            const docEndDate = new Date(metrics.dateRange?.endDate);
            docStartDate.setHours(0, 0, 0, 0);
            docEndDate.setHours(23, 59, 59, 999);

            if (startDate <= docEndDate && endDate >= docStartDate) {
                const overlapDays = calculateOverlapDays(startDate, endDate, docStartDate, docEndDate);
                const docTotalDays = Math.ceil((docEndDate - docStartDate + 1) / (1000 * 60 * 60 * 24));
                if (docTotalDays > 0) {
                    const proportion = overlapDays / docTotalDays;
                    totalPpcSpent += (metrics.ppcSpent?.amount || 0) * proportion;
                }
            }
        }
    }

    // Prepare datewise data for chart - aggregate by date across all documents
    const datewiseChartDataMap = new Map();
    const processedChartDates = new Set();
    
    for (const metrics of allMetrics) {
        const docStartDate = new Date(metrics.dateRange?.startDate);
        const docEndDate = new Date(metrics.dateRange?.endDate);
        docStartDate.setHours(0, 0, 0, 0);
        docEndDate.setHours(23, 59, 59, 999);

        // Check for overlap
        if (startDate <= docEndDate && endDate >= docStartDate) {
            const datewiseSales = metrics.datewiseSales || [];
            const datewiseFeesAndRefunds = metrics.datewiseFeesAndRefunds || [];
            
            // Process sales - use existing grossProfit from datewiseSales
            // The grossProfit in datewiseSales is already calculated correctly (netSales - cogs)
            datewiseSales.forEach(item => {
                const itemDate = new Date(item.date);
                const dateKey = itemDate.toISOString().split('T')[0];
                
                if (itemDate >= startDate && itemDate <= endDate && !processedChartDates.has(dateKey)) {
                    const displayDate = itemDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    datewiseChartDataMap.set(dateKey, {
                        date: displayDate,
                        totalSales: item.sales?.amount || 0,
                        grossProfit: item.grossProfit?.amount || 0, // Use existing grossProfit from database
                        originalDate: item.date
                    });
                    processedChartDates.add(dateKey);
                }
            });
        }
    }
    
    const datewiseChartData = Array.from(datewiseChartDataMap.values())
        .sort((a, b) => new Date(a.originalDate) - new Date(b.originalDate));

    // Calculate gross profit: Sales - Amazon Fees - Refunds
    // Note: Amazon Fees includes FBA fees, storage fees, referral fees, etc.
    // PPC is subtracted in frontend for display, not in backend calculation
    const calculatedGrossProfit = totalSales - totalAmazonFees - totalRefunds;

    return {
        totalSales: { amount: parseFloat(totalSales.toFixed(2)), currencyCode },
        grossProfit: { amount: parseFloat(calculatedGrossProfit.toFixed(2)), currencyCode },
        ppcSpent: { amount: parseFloat(totalPpcSpent.toFixed(2)), currencyCode },
        fbaFees: { amount: parseFloat(totalFbaFees.toFixed(2)), currencyCode },
        amazonFees: { amount: parseFloat(totalAmazonFees.toFixed(2)), currencyCode }, // Total Amazon fees (for Profitability page)
        otherAmazonFees: { amount: parseFloat(otherAmazonFees.toFixed(2)), currencyCode }, // Amazon fees excluding FBA (from feeBreakdown, for Total Sales component)
        refunds: { amount: parseFloat(totalRefunds.toFixed(2)), currencyCode },
        dateRange: {
            startDate: formatDate(startDate),
            endDate: formatDate(endDate)
        },
        datewiseChartData: datewiseChartData,
        asinWiseSales: asinWiseSalesArray, // ASIN-wise data aggregated from all documents for the date range
        currencyCode
    };
}

/**
 * Get actual datewise PPC spend from PPCMetrics model
 * Uses the calculateMetricsForDateRange method which searches ALL documents
 * and sums actual datewise spend values for the requested date range.
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<number>} Total PPC spend for the date range
 */
async function getDatewisePPCSpend(userId, country, region, startDate, endDate) {
    try {
        // Use PPCMetrics model's calculateMetricsForDateRange to get actual datewise PPC
        const ppcResult = await PPCMetrics.calculateMetricsForDateRange(
            userId,
            country,
            region,
            startDate,
            endDate
        );
        
        if (ppcResult && ppcResult.found && ppcResult.summary?.totalSpend > 0) {
            logger.info('Got actual datewise PPC spend from PPCMetrics', {
                userId,
                country,
                region,
                startDate,
                endDate,
                totalSpend: ppcResult.summary.totalSpend,
                daysWithData: ppcResult.numberOfDays
            });
            return ppcResult.summary.totalSpend;
        }
        
        return 0;
    } catch (error) {
        logger.warn('Error fetching datewise PPC spend, will use fallback', {
            userId,
            country,
            region,
            startDate,
            endDate,
            error: error.message
        });
        return 0;
    }
}

/**
 * Calculate proportional PPC spent for last 7 days (fallback when no datewise PPC data)
 */
function calculateProportionalPPC(totalPpcSpent, filteredDays, totalDays) {
    if (totalDays === 0) return 0;
    return (totalPpcSpent * filteredDays) / totalDays;
}

/**
 * Calculate overlap days between two date ranges
 */
function calculateOverlapDays(range1Start, range1End, range2Start, range2End) {
    const overlapStart = new Date(Math.max(range1Start.getTime(), range2Start.getTime()));
    const overlapEnd = new Date(Math.min(range1End.getTime(), range2End.getTime()));
    
    if (overlapStart > overlapEnd) return 0;
    
    return Math.ceil((overlapEnd - overlapStart + 1) / (1000 * 60 * 60 * 24));
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Create empty result structure
 */
function createEmptyResult() {
    return {
        totalSales: { amount: 0, currencyCode: 'USD' },
        grossProfit: { amount: 0, currencyCode: 'USD' },
        ppcSpent: { amount: 0, currencyCode: 'USD' },
        fbaFees: { amount: 0, currencyCode: 'USD' },
        amazonFees: { amount: 0, currencyCode: 'USD' }, // Total Amazon fees (for Profitability page)
        otherAmazonFees: { amount: 0, currencyCode: 'USD' }, // Amazon fees excluding FBA (for Total Sales component)
        refunds: { amount: 0, currencyCode: 'USD' },
        dateRange: { startDate: null, endDate: null },
        asinWiseSales: [], // Empty ASIN-wise data
        currencyCode: 'USD'
    };
}

module.exports = {
    filterTotalSales
};


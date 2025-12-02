/**
 * Dashboard Calculation Service
 * 
 * This service handles all dashboard calculations that were previously done
 * in the separate calculation server. All calculations are now performed
 * in the IBEX backend.
 */

const Profitability = require('./ProfitabilityCalculation.js');
const { calculateSponsoredAdsMetrics, calculateNegativeKeywordsMetrics } = require('./SponsoredAdsCalculation.js');
const { createDefaultDashboardData, mergeWithDefaults } = require('./DefaultDataStructure.js');
const CreateTaskService = require('./CreateTasksService.js');
const logger = require('../../utils/Logger.js');

/**
 * Calculate date-wise total costs from PPC spend data
 * @param {Array} dateWisePPCData - Array of PPC spend data
 * @returns {Array} Date-wise costs array
 */
const calculateDateWiseTotalCosts = (dateWisePPCData) => {
    if (!Array.isArray(dateWisePPCData)) {
        return [];
    }
    
    const dateWiseCosts = {};
    
    dateWisePPCData.forEach((item) => {
        if (!item || !item.date) {
            return; // Skip invalid items
        }
        
        // Handle different date formats
        let dateStr;
        if (item.date instanceof Date) {
            // If it's a Date object, convert to YYYY-MM-DD string
            dateStr = item.date.toISOString().split('T')[0];
        } else if (typeof item.date === 'string') {
            // If it's a string, extract date part (handles ISO format or YYYY-MM-DD)
            dateStr = item.date.split('T')[0].split(' ')[0]; // Handle both ISO and space-separated formats
        } else {
            // Skip if date is not a valid format
            logger.warn('Invalid date format in calculateDateWiseTotalCosts:', item.date);
            return;
        }
        
        // Validate cost is a number (can be string or number)
        const cost = typeof item.cost === 'number' ? item.cost : parseFloat(String(item.cost)) || 0;
        
        if (!dateWiseCosts[dateStr]) {
            dateWiseCosts[dateStr] = { cost: 0, sales: 0 };
        }
        
        dateWiseCosts[dateStr].cost += cost;
        dateWiseCosts[dateStr].sales += parseFloat(String(item.sales7d)) || 0;
    });
    
    // Convert to array format and sort by date
    return Object.entries(dateWiseCosts).map(([date, { cost, sales }]) => ({
        date,
        totalCost: Math.round(cost * 100) / 100, // Round to 2 decimal places
        sales: Math.round(sales * 100) / 100 // Round to 2 decimal places
    })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
};

/**
 * Calculate campaign-wise total sales and cost from PPC spend data
 * @param {Array} dateWisePPCData - Array of PPC spend data
 * @returns {Array} Campaign-wise sales and cost array
 */
const calculateCampaignWiseTotalSalesAndCost = (dateWisePPCData) => {
    if (!Array.isArray(dateWisePPCData)) {
        return [];
    }
    
    const campaignWiseData = {};
    
    dateWisePPCData.forEach((item) => {
        if (item && item.campaignId) {
            const campaignId = item.campaignId;
            
            if (!campaignWiseData[campaignId]) {
                campaignWiseData[campaignId] = {
                    campaignName: item.campaignName || 'Unknown Campaign',
                    spend: 0,
                    sales: 0
                };
            }
            
            campaignWiseData[campaignId].spend += parseFloat(String(item.cost)) || 0;
            campaignWiseData[campaignId].sales += parseFloat(String(item.sales7d)) || 0;
        }
    });
    
    // Convert to array format and sort by totalSpend (descending)
    return Object.entries(campaignWiseData).map(([campaignId, { campaignName, spend, sales }]) => ({
        campaignId,
        campaignName,
        totalSpend: Math.round(spend * 100) / 100, // Round to 2 decimal places
        totalSales: Math.round(sales * 100) / 100 // Round to 2 decimal places
    })).sort((a, b) => b.totalSpend - a.totalSpend);
};

/**
 * Calculate profitability errors
 * @param {Array} profitibilityData - Array of profitability data
 * @returns {Object} Total errors and error details
 */
const calculateProfitabilityErrors = (profitibilityData) => {
    let totalErrors = 0;
    const errorDetails = [];
    
    profitibilityData.forEach((item) => {
        // Calculate net profit (assuming COGS is 0 initially, will be updated when user enters values)
        const netProfit = (item.sales || 0) - (item.ads || 0) - (item.amzFee || 0);
        
        // Determine status based on profit margin
        const profitMargin = item.sales > 0 ? (netProfit / item.sales) * 100 : 0;
        
        // Count as error if profit margin is below 10% or negative
        if (profitMargin < 10 || netProfit < 0) {
            totalErrors++;
            errorDetails.push({
                asin: item.asin,
                sales: item.sales,
                netProfit: netProfit,
                profitMargin: profitMargin,
                errorType: netProfit < 0 ? 'negative_profit' : 'low_margin'
            });
        }
    });
    
    return { totalErrors, errorDetails };
};

/**
 * Calculate sponsored ads errors
 * @param {Array} productWiseSponsoredAds - Array of sponsored ads data
 * @param {Array} negativeKeywordsMetrics - Array of negative keywords metrics
 * @returns {Object} Total errors and error details
 */
const calculateSponsoredAdsErrors = (productWiseSponsoredAds, negativeKeywordsMetrics) => {
    let totalErrors = 0;
    const errorDetails = [];
    
    // Count products with high ACOS or no sales but high spend
    if (Array.isArray(productWiseSponsoredAds)) {
        productWiseSponsoredAds.forEach((product) => {
            const spend = parseFloat(String(product.spend)) || 0;
            const sales = parseFloat(String(product.salesIn30Days)) || 0;
            const acos = sales > 0 ? (spend / sales) * 100 : 0;
            
            let errorType = null;
            // Count as error if:
            // 1. ACOS > 50% (unprofitable)
            // 2. Spend > $5 with no sales
            // 3. Spend > $10 with ACOS > 30% (marginally profitable)
            if (acos > 50 && sales > 0) {
                errorType = 'high_acos';
            } else if (spend > 5 && sales === 0) {
                errorType = 'no_sales_high_spend';
            } else if (spend > 10 && acos > 30) {
                errorType = 'marginal_profit';
            }
            
            if (errorType) {
                totalErrors++;
                errorDetails.push({
                    asin: product.asin,
                    campaignName: product.campaignName || 'Unknown Campaign',
                    spend: spend,
                    sales: sales,
                    acos: acos,
                    errorType: errorType,
                    source: 'product'
                });
            }
        });
    }
    
    // Also count negative keywords with issues
    if (Array.isArray(negativeKeywordsMetrics)) {
        negativeKeywordsMetrics.forEach((keyword) => {
            let errorType = null;
            // Count keywords with extremely high ACOS or no sales but spend
            if (keyword.acos > 100 && keyword.sales > 0) {
                errorType = 'extreme_high_acos';
            } else if (keyword.spend > 5 && keyword.sales === 0) {
                errorType = 'keyword_no_sales';
            }
            
            if (errorType) {
                totalErrors++;
                errorDetails.push({
                    keyword: keyword.keyword,
                    campaignName: keyword.campaignName,
                    spend: keyword.spend,
                    sales: keyword.sales,
                    acos: keyword.acos,
                    errorType: errorType,
                    source: 'keyword'
                });
            }
        });
    }
    
    return { totalErrors, errorDetails };
};

/**
 * Main analysis function - calculates dashboard data from raw input
 * @param {Object} data - Raw input data from Analyse service
 * @param {string} userId - User ID for task creation
 * @returns {Object} Calculated dashboard data
 */
const analyseData = async (data, userId = null) => {
    logger.info("=== DashboardCalculation: Processing data ===");

    // Check if we have any meaningful data
    const hasValidData = data && (
        (Array.isArray(data.TotalProducts) && data.TotalProducts.length > 0) ||
        (data.SalesByProducts && Array.isArray(data.SalesByProducts) && data.SalesByProducts.length > 0) ||
        (data.ProductWiseSponsoredAds && Array.isArray(data.ProductWiseSponsoredAds) && data.ProductWiseSponsoredAds.length > 0) ||
        (data.FinanceData && Object.keys(data.FinanceData).length > 0)
    );

    // If no meaningful data is available, return default empty data structure
    if (!hasValidData) {
        logger.warn("No valid data found, returning default empty data structure");
        const defaultData = createDefaultDashboardData();
        // Preserve any available country or date information
        if (data?.Country) defaultData.Country = data.Country;
        if (data?.createdAccountDate) defaultData.createdAccountDate = data.createdAccountDate;
        if (data?.startDate) defaultData.startDate = data.startDate;
        if (data?.endDate) defaultData.endDate = data.endDate;
        if (data?.keywordTrackingData) defaultData.keywordTrackingData = data.keywordTrackingData;
        
        return { dashboardData: defaultData };
    }

    logger.info("Valid data found, proceeding with analysis");
    
    // Calculate and log date-wise total costs
    const dateWiseTotalCosts = calculateDateWiseTotalCosts(data.GetDateWisePPCspendData || []);
    
    // Calculate and log campaign-wise total sales and cost
    const campaignWiseTotalSalesAndCost = calculateCampaignWiseTotalSalesAndCost(data.GetDateWisePPCspendData || []);
    
    // Safely extract data with fallbacks
    const TotalProducts = data.TotalProducts || [];
    const accountHealthPercentage = data.AccountData?.getAccountHealthPercentge || { Percentage: 0, status: 'UNKNOWN' };
    const accountFinance = data.FinanceData || {};
    const totalErrorInAccount = data.AccountData?.accountHealth?.TotalErrors || 0;
    const amazonReadyProducts = data.ConversionData?.AmazonReadyproducts || [];
    
    // Get active products first - this will be used to filter all analysis
    const activeProducts = [];
    const activeProductSet = new Set();
    
    // Safely process TotalProducts
    if (Array.isArray(TotalProducts)) {
        TotalProducts.forEach((elm) => {
            if (elm && elm.asin && elm.status === "Active") {
                activeProducts.push(elm.asin);
                activeProductSet.add(elm.asin);
            }
        });
    }

    // Filter all input data to only include active products with better error handling
    const activeSalesByProducts = Array.isArray(data.SalesByProducts) ? 
        data.SalesByProducts.filter((product) => product && product.asin && activeProductSet.has(product.asin)) : [];
    const activeProductWiseSponsoredAds = Array.isArray(data.ProductWiseSponsoredAds) ? 
        data.ProductWiseSponsoredAds.filter((product) => product && product.asin && activeProductSet.has(product.asin)) : [];
    const activeProductWiseFBAData = Array.isArray(data.ProductWiseFBAData) ? 
        data.ProductWiseFBAData.filter((product) => product && product.asin && activeProductSet.has(product.asin)) : [];
    const activeFBAFeesData = Array.isArray(data.FBAFeesData) ? 
        data.FBAFeesData.filter((product) => product && product.asin && activeProductSet.has(product.asin)) : [];

    // Only calculate profitability for active products with error handling
    let profitibilityData = [];
    let sponsoredAdsMetrics = { totalCost: 0, totalSalesIn30Days: 0, totalProductsPurchased: 0 };
    let negativeKeywordsMetrics = [];
    
    try {
        profitibilityData = Profitability(activeSalesByProducts, activeProductWiseSponsoredAds, activeProductWiseFBAData, activeFBAFeesData);
    } catch (error) {
        logger.error("Error calculating profitability data:", error);
        profitibilityData = [];
    }
    
    try {
        sponsoredAdsMetrics = calculateSponsoredAdsMetrics(activeProductWiseSponsoredAds);
    } catch (error) {
        logger.error("Error calculating sponsored ads metrics:", error);
        sponsoredAdsMetrics = { totalCost: 0, totalSalesIn30Days: 0, totalProductsPurchased: 0 };
    }
    
    try {
        negativeKeywordsMetrics = calculateNegativeKeywordsMetrics(data.negetiveKeywords || [], data.adsKeywordsPerformanceData || []);
    } catch (error) {
        logger.error("Error calculating negative keywords metrics:", error);
        negativeKeywordsMetrics = [];
    }

    // Process inventory analysis data (filter for active products)
    const inventoryAnalysis = data.InventoryAnalysis || {
        inventoryPlanning: [],
        strandedInventory: [],
        inboundNonCompliance: [],
        replenishment: []
    };
    
    // Filter inventory analysis to only include active products
    const activeInventoryAnalysis = {
        inventoryPlanning: inventoryAnalysis.inventoryPlanning ? inventoryAnalysis.inventoryPlanning.filter((item) => item && item.asin && activeProductSet.has(item.asin)) : [],
        strandedInventory: inventoryAnalysis.strandedInventory ? inventoryAnalysis.strandedInventory.filter((item) => item && item.asin && activeProductSet.has(item.asin)) : [],
        inboundNonCompliance: inventoryAnalysis.inboundNonCompliance ? inventoryAnalysis.inboundNonCompliance.filter((item) => item && item.asin && activeProductSet.has(item.asin)) : [],
        replenishment: inventoryAnalysis.replenishment ? inventoryAnalysis.replenishment.filter((item) => item && item.asin && activeProductSet.has(item.asin)) : []
    };
    
    // Calculate total inventory errors (only for active products)
    const totalInventoryErrors = (activeInventoryAnalysis.inventoryPlanning?.length || 0) + 
                               (activeInventoryAnalysis.strandedInventory?.length || 0) + 
                               (activeInventoryAnalysis.inboundNonCompliance?.length || 0) +
                               (activeInventoryAnalysis.replenishment?.filter((item) => item && item.status === "Error").length || 0);

    const productWiseError = [];
    const rankingProductWiseErrors = [];
    const conversionProductWiseErrors = [];
    const inventoryProductWiseErrors = [];

    const seenAsins = new Set();

    // Conversion error arrays (filter for active products only) with safe data access
    const aplusError = Array.isArray(data.ConversionData?.aPlusResult) ? 
        data.ConversionData.aPlusResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const imageResultError = Array.isArray(data.ConversionData?.imageResult) ? 
        data.ConversionData.imageResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const videoResultError = Array.isArray(data.ConversionData?.videoResult) ? 
        data.ConversionData.videoResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const productReviewResultError = Array.isArray(data.ConversionData?.productReviewResult) ? 
        data.ConversionData.productReviewResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const productStarRatingResultError = Array.isArray(data.ConversionData?.productStarRatingResult) ? 
        data.ConversionData.productStarRatingResult.filter((p) => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];

    // FIXED: wrap each product without buybox error with a `.data` property to match the structure (filter for active products)
    const productsWithOutBuyboxError = Array.isArray(data.ConversionData?.ProductWithOutBuybox) ? 
        data.ConversionData.ProductWithOutBuybox
            .filter((p) => p && p.status === "Error" && p.asin && activeProductSet.has(p.asin))
            .map((p) => ({ asin: p.asin, data: p })) : [];

    const totalErrorInConversion =
        aplusError.length +
        imageResultError.length +
        videoResultError.length +
        productReviewResultError.length +
        productStarRatingResultError.length +
        productsWithOutBuyboxError.length;

    // This is for getting conversion error for each product
    const getConversionErrors = (asin) => {
        let errorCount = 0;
        const convData = { asin };

        const sources = [
            { key: 'aplusErrorData', list: aplusError },
            { key: 'imageResultErrorData', list: imageResultError },
            { key: 'videoResultErrorData', list: videoResultError },
            { key: 'productReviewResultErrorData', list: productReviewResultError },
            { key: 'productStarRatingResultErrorData', list: productStarRatingResultError },
            { key: 'productsWithOutBuyboxErrorData', list: productsWithOutBuyboxError },
        ];

        sources.forEach(source => {
            const found = source.list.find((p) => p.asin === asin);
            if (found) {
                convData[source.key] = found.data;
                errorCount++;
            }
        });

        return { data: convData, errorCount };
    };

    // This is for getting inventory errors for each product (using filtered active inventory data)
    const getInventoryErrors = (asin) => {
        let errorCount = 0;
        const invData = { asin };

        // Check inventory planning errors
        const planningError = activeInventoryAnalysis.inventoryPlanning?.find((item) => item.asin === asin);
        if (planningError) {
            invData.inventoryPlanningErrorData = planningError;
            // Count individual errors within planning data
            if (planningError.longTermStorageFees?.status === "Error") errorCount++;
            if (planningError.unfulfillable?.status === "Error") errorCount++;
        }

        // Check stranded inventory errors
        const strandedError = activeInventoryAnalysis.strandedInventory?.find((item) => item.asin === asin);
        if (strandedError) {
            invData.strandedInventoryErrorData = strandedError;
            errorCount++;
        }

        // Check inbound non-compliance errors
        const complianceError = activeInventoryAnalysis.inboundNonCompliance?.find((item) => item.asin === asin);
        if (complianceError) {
            invData.inboundNonComplianceErrorData = complianceError;
            errorCount++;
        }

        // Check replenishment/restock errors
        const replenishmentError = activeInventoryAnalysis.replenishment?.find((item) => item && item.asin === asin && item.status === "Error");
        if (replenishmentError) {
            invData.replenishmentErrorData = replenishmentError;
            errorCount++;
        }

        return { data: invData, errorCount };
    };

    let TotalRankingerrors = 0;

    // Process ranking data only for active products with safe data access
    const rankingResultArray = data.RankingsData?.RankingResultArray || [];
    if (Array.isArray(rankingResultArray)) {
        rankingResultArray.forEach((elm) => {
            if (!elm || !elm.asin) return;
            
            const asin = elm.asin;
            
            // Skip if product is not active
            if (!activeProductSet.has(asin)) {
                return;
            }
            
            if (seenAsins.has(asin)) return;
            seenAsins.add(asin);

            const title = elm.data?.Title?.substring(0, 50) || "N/A";
            const productDetails = activeSalesByProducts.find((p) => p.asin === asin);
            const sales = productDetails?.amount || 0;
            const quantity = productDetails?.quantity || 0;

            const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);
            const { data: inventoryData, errorCount: inventoryErrors } = getInventoryErrors(asin);

            // Find the product in TotalProducts by ASIN
            const totalProduct = TotalProducts.find((p) => p.asin === asin);

            const elmTotalErrors = elm.data?.TotalErrors || 0;
            let productwiseTotalError = elmTotalErrors + conversionErrors + inventoryErrors;
            if (elmTotalErrors > 0) {
                TotalRankingerrors += elmTotalErrors;
            }

            conversionProductWiseErrors.push(conversionData);
            conversionProductWiseErrors[conversionProductWiseErrors.length - 1].Title = elm.data?.Title || "N/A";

            // Add inventory errors to inventoryProductWiseErrors array
            if (inventoryErrors > 0) {
                inventoryProductWiseErrors.push({
                    ...inventoryData,
                    Title: elm.data?.Title || "N/A"
                });
            }

            rankingProductWiseErrors.push(
                elmTotalErrors > 0
                    ? elm
                    : { asin, data: { Title: title } }
            );
            
            productWiseError.push({
                asin,
                sku: totalProduct?.sku || "N/A",
                name: title,
                price: totalProduct?.price || 0,
                MainImage: data.ConversionData?.imageResult?.find((item) => item.asin === elm.asin)?.data?.MainImage || null,
                errors: productwiseTotalError,
                rankingErrors: elmTotalErrors > 0 ? elm : undefined,
                conversionErrors: conversionData,
                inventoryErrors: inventoryData,
                sales,
                quantity
            });
        });
    }

    // Process all active products for inventory errors that weren't captured in ranking processing
    activeProducts.forEach((asin) => {
        // Skip if already processed in ranking data
        if (seenAsins.has(asin)) return;
        
        const { data: inventoryData, errorCount: inventoryErrors } = getInventoryErrors(asin);
        
        if (inventoryErrors > 0) {
            // Find the product details
            const totalProduct = TotalProducts.find((p) => p.asin === asin);
            const title = totalProduct?.itemName?.substring(0, 50) || totalProduct?.title?.substring(0, 50) || "N/A";
            
            // Add to inventoryProductWiseErrors array
            inventoryProductWiseErrors.push({
                ...inventoryData,
                Title: title
            });
            
            // Also add to productWiseError array for completeness
            const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);
            const productDetails = activeSalesByProducts.find((p) => p.asin === asin);
            const sales = productDetails?.amount || 0;
            const quantity = productDetails?.quantity || 0;
            
            productWiseError.push({
                asin,
                sku: totalProduct?.sku || "N/A",
                name: title,
                price: totalProduct?.price || 0,
                MainImage: data.ConversionData?.imageResult?.find((item) => item.asin === asin)?.data?.MainImage || null,
                errors: inventoryErrors + conversionErrors,
                rankingErrors: undefined,
                conversionErrors: conversionData,
                inventoryErrors: inventoryData,
                sales,
                quantity
            });
        }
    });

    // Backend keyword errors (only for active products) with safe data access
    const backendKeywordResultArray = data.RankingsData?.BackendKeywordResultArray || [];
    if (Array.isArray(backendKeywordResultArray)) {
        backendKeywordResultArray.forEach((elm) => {
            if (!elm || !elm.asin || !elm.data) return;
            
            const asin = elm.asin;
            
            // Skip if product is not active
            if (!activeProductSet.has(asin)) {
                return;
            }
            
            const numberOfErrors = elm.data.NumberOfErrors || 0;
            if (numberOfErrors > 0) {
                TotalRankingerrors += numberOfErrors;

                const productWiseErrorElm = productWiseError.find((p) => p.asin === asin);
                if (productWiseErrorElm) {
                    productWiseErrorElm.errors += numberOfErrors;
                } else {
                    // If product doesn't exist in productWiseError array yet, create it
                    const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);
                    const { data: inventoryData, errorCount: inventoryErrors } = getInventoryErrors(asin);
                    const totalProduct = TotalProducts.find((p) => p.asin === asin);
                    const title = totalProduct?.itemName || totalProduct?.title?.substring(0, 50) || "N/A";
                    
                    productWiseError.push({
                        asin,
                        sku: totalProduct?.sku || "N/A",
                        name: title,
                        price: totalProduct?.price || 0,
                        MainImage: data.ConversionData?.imageResult?.find((item) => item.asin === asin)?.data?.MainImage || null,
                        errors: numberOfErrors + conversionErrors + inventoryErrors,
                        rankingErrors: undefined,
                        conversionErrors: conversionData,
                        inventoryErrors: inventoryData,
                        sales: 0,
                        quantity: 0
                    });
                }

                let rankingErrors = rankingProductWiseErrors.find((p) => p.asin === asin);
                if (!rankingErrors) {
                    const fallbackTitle =
                        TotalProducts.find((p) => p.asin === asin)?.itemName?.substring(0, 50) ||
                        TotalProducts.find((p) => p.asin === asin)?.title?.substring(0, 50) ||
                        elm.data?.Title?.substring(0, 50) ||
                        "N/A";

                    rankingErrors = {
                        asin,
                        data: {
                            Title: fallbackTitle
                        }
                    };
                    rankingProductWiseErrors.push(rankingErrors);
                }

                if (elm.data.charLim?.status === "Error") {
                    rankingErrors.data.charLim = elm.data.charLim;
                }
                if (elm.data.dublicateWords === "Error") {
                    rankingErrors.data.dublicateWords = elm.data.dublicateWords;
                }
            }
        });
    }

  
    // Top ranking error products
    const UniqueProductWisError = Array.from(
        new Map(productWiseError.map(obj => [obj.asin, obj])).values()
    ).sort((a, b) => b.errors - a.errors);

    const getTopErrorProduct = (errorData, index) =>
        errorData[index]
            ? {
                asin: errorData[index].asin,
                name: errorData[index].name?.substring(0, 50) || "N/A",
                errors: errorData[index].errors,
            }
            : null;

    const first = getTopErrorProduct(UniqueProductWisError, 0);
    const second = getTopErrorProduct(UniqueProductWisError, 1);
    const third = getTopErrorProduct(UniqueProductWisError, 2);
    const fourth = getTopErrorProduct(UniqueProductWisError, 3);

    // Add backend keyword errors to top 4 if applicable (only for active products) with safe data access
    const uniqueBackendKeywordData = Array.isArray(backendKeywordResultArray) ? 
        Array.from(
            new Map(backendKeywordResultArray.filter((obj) => obj && obj.asin && activeProductSet.has(obj.asin)).map(obj => [obj.asin, obj])).values()
        ) : [];

    uniqueBackendKeywordData.forEach((elm) => {
        if (elm.data?.NumberOfErrors === 1) {
            [first, second, third, fourth].forEach(slot => {
                if (slot && slot.asin === elm.asin) {
                    slot.errors++;
                }
            });
        }
    });

    // Calculate profitability and sponsored ads errors (already filtered for active products) with error handling
    let profitabilityErrorsData = { totalErrors: 0, errorDetails: [] };
    let sponsoredAdsErrorsData = { totalErrors: 0, errorDetails: [] };
    
    try {
        profitabilityErrorsData = calculateProfitabilityErrors(profitibilityData);
    } catch (error) {
        logger.error("Error calculating profitability errors:", error);
    }
    
    try {
        sponsoredAdsErrorsData = calculateSponsoredAdsErrors(activeProductWiseSponsoredAds, negativeKeywordsMetrics);
    } catch (error) {
        logger.error("Error calculating sponsored ads errors:", error);
    }

    const dashboardData = {
        Country: data.Country || "US",
        createdAccountDate: data.createdAccountDate || null,
        Brand: data.Brand || null, // Add brand name to dashboard data
        accountHealthPercentage,
        accountFinance,
        totalErrorInAccount,
        totalErrorInConversion,
        TotalRankingerrors,
        totalInventoryErrors,
        first,
        second,
        third,
        fourth,
        productsWithOutBuyboxError: productsWithOutBuyboxError.length,
        amazonReadyProducts,
        TotalProduct: TotalProducts,
        ActiveProducts: activeProducts,
        TotalWeeklySale: data.FinanceData?.Total_Sales || 0,
        TotalSales: data.TotalSales || [],
        reimbustment: data.Reimburstment || { totalReimbursement: 0 },
        productWiseError: productWiseError,
        rankingProductWiseErrors: rankingProductWiseErrors,
        conversionProductWiseErrors: conversionProductWiseErrors,
        inventoryProductWiseErrors: inventoryProductWiseErrors,
        InventoryAnalysis: activeInventoryAnalysis,
        AccountErrors: data.AccountData?.accountHealth || {},
        startDate: data.startDate || new Date().toISOString().split('T')[0],
        endDate: data.endDate || new Date().toISOString().split('T')[0],
        profitibilityData: profitibilityData,
        sponsoredAdsMetrics: sponsoredAdsMetrics,
        negativeKeywordsMetrics: negativeKeywordsMetrics,
        ProductWiseSponsoredAdsGraphData: data.ProductWiseSponsoredAdsGraphData || [],
        totalProfitabilityErrors: profitabilityErrorsData.totalErrors,
        totalSponsoredAdsErrors: sponsoredAdsErrorsData.totalErrors,
        ProductWiseSponsoredAds: activeProductWiseSponsoredAds,
        profitabilityErrorDetails: profitabilityErrorsData.errorDetails,
        sponsoredAdsErrorDetails: sponsoredAdsErrorsData.errorDetails,
        keywords: data.keywords || [],
        searchTerms: data.searchTerms || [],
        campaignData: data.campaignData || [],
        adsKeywordsPerformanceData: data.adsKeywordsPerformanceData || [],
        GetOrderData: data.GetOrderData || [],
        dateWiseTotalCosts: dateWiseTotalCosts,
        campaignWiseTotalSalesAndCost: campaignWiseTotalSalesAndCost,
        negetiveKeywords: data.negetiveKeywords || [],
        AdsGroupData: data.AdsGroupData || [],
        keywordTrackingData: data.keywordTrackingData || {},
        isEmptyData: false,
        dataAvailabilityStatus: 'DATA_AVAILABLE',
        DifferenceData: data.DifferenceData || 0
    };

    logger.info(`Dashboard data processed successfully with ${activeProducts.length} active products`);
    
    // Call CreateTask service if userId is provided
    if (userId) {
        try {
            logger.info(`Creating tasks for user: ${userId}`);
            await CreateTaskService.createTasksFromCalculateServiceData(userId, {
                rankingProductWiseErrors: rankingProductWiseErrors,
                conversionProductWiseErrors: conversionProductWiseErrors,
                inventoryProductWiseErrors: inventoryProductWiseErrors,
                profitabilityErrorDetails: profitabilityErrorsData.errorDetails,
                sponsoredAdsErrorDetails: sponsoredAdsErrorsData.errorDetails
            });
            logger.info(`Tasks created successfully for user: ${userId}`);
        } catch (error) {
            logger.error("Error creating tasks:", {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            // Don't throw error to avoid affecting the main functionality
        }
    }
    
    logger.info("=== DashboardCalculation: Returning dashboard data ===");
    return { dashboardData };
};

module.exports = {
    analyseData,
    calculateDateWiseTotalCosts,
    calculateCampaignWiseTotalSalesAndCost,
    calculateProfitabilityErrors,
    calculateSponsoredAdsErrors
};


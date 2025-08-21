/*import Profitiblity from "./Profitiblity";
import calculateSponsoredAdsMetrics from "./sponserdAds";
import {calculateNegativeKeywordsMetrics} from "./sponserdAds";
import { createDefaultDashboardData, mergeWithDefaults } from "../utils/defaultDataStructure";

// Function to calculate date-wise total costs from PPC spend data
const calculateDateWiseTotalCosts = (dateWisePPCData) => {
    if (!Array.isArray(dateWisePPCData)) {
        return [];
    }
    
    const dateWiseCosts = {};
    
    dateWisePPCData.forEach(item => {
        if (item && item.date && typeof item.cost === 'number') {
            const dateStr = item.date.split('T')[0]; // Extract just the date part (YYYY-MM-DD)
            
            if (!dateWiseCosts[dateStr]) {
                dateWiseCosts[dateStr] = 0;
            }
            
            dateWiseCosts[dateStr] += item.cost;
        }
    });
    
    // Convert to array format and sort by date
    return Object.entries(dateWiseCosts).map(([date, totalCost]) => ({
        date,
        totalCost: Math.round(totalCost * 100) / 100 // Round to 2 decimal places
    })).sort((a, b) => new Date(a.date) - new Date(b.date));
};

// Function to calculate profitability errors
const calculateProfitabilityErrors = (profitibilityData) => {
    let totalErrors = 0;
    const errorDetails = [];
    
    profitibilityData.forEach(item => {
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

// Function to calculate sponsored ads errors
const calculateSponsoredAdsErrors = (productWiseSponsoredAds, negativeKeywordsMetrics) => {
    let totalErrors = 0;
    const errorDetails = [];
    
    // Count products with high ACOS or no sales but high spend
    if (Array.isArray(productWiseSponsoredAds)) {
        productWiseSponsoredAds.forEach(product => {
            const spend = parseFloat(product.spend) || 0;
            const sales = parseFloat(product.salesIn30Days) || 0;
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
                    campaignName: product.campaignName,
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
        negativeKeywordsMetrics.forEach(keyword => {
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

const analyseData = (data) => {
    console.log("=== analyseData: Processing data ===");
    console.log("Input data:", data);

    // Check if we have any meaningful data
    const hasValidData = data && (
        (Array.isArray(data.TotalProducts) && data.TotalProducts.length > 0) ||
        (data.SalesByProducts && Array.isArray(data.SalesByProducts) && data.SalesByProducts.length > 0) ||
        (data.ProductWiseSponsoredAds && Array.isArray(data.ProductWiseSponsoredAds) && data.ProductWiseSponsoredAds.length > 0) ||
        (data.FinanceData && Object.keys(data.FinanceData).length > 0)
    );

    console.log("=== Data availability check ===");
    console.log("Has valid data:", hasValidData);
    console.log("TotalProducts length:", data?.TotalProducts?.length || 0);
    console.log("SalesByProducts length:", data?.SalesByProducts?.length || 0);
    console.log("ProductWiseSponsoredAds length:", data?.ProductWiseSponsoredAds?.length || 0);
    console.log("FinanceData keys:", data?.FinanceData ? Object.keys(data.FinanceData).length : 0);

    // If no meaningful data is available, return default empty data structure
    if (!hasValidData) {
        console.log("⚠️ No valid data found, returning default empty data structure");
        const defaultData = createDefaultDashboardData();
        // Preserve any available country or date information
        if (data?.Country) defaultData.Country = data.Country;
        if (data?.createdAccountDate) defaultData.createdAccountDate = data.createdAccountDate;
        if (data?.startDate) defaultData.startDate = data.startDate;
        if (data?.endDate) defaultData.endDate = data.endDate;
        
        return { dashboardData: defaultData };
    }

    console.log("✅ Valid data found, proceeding with analysis");
    console.log("data: ",data.GetDateWisePPCspendData)
    
    // Calculate and log date-wise total costs
    const dateWiseTotalCosts = calculateDateWiseTotalCosts(data.GetDateWisePPCspendData);
    console.log("dateWiseTotalCosts: ", dateWiseTotalCosts);
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
        TotalProducts.forEach(elm => {
            if (elm && elm.asin && elm.status === "Active") {
                activeProducts.push(elm.asin);
                activeProductSet.add(elm.asin);
            }
        });
    }

    // Filter all input data to only include active products with better error handling
    const activeSalesByProducts = Array.isArray(data.SalesByProducts) ? 
        data.SalesByProducts.filter(product => product && product.asin && activeProductSet.has(product.asin)) : [];
    const activeProductWiseSponsoredAds = Array.isArray(data.ProductWiseSponsoredAds) ? 
        data.ProductWiseSponsoredAds.filter(product => product && product.asin && activeProductSet.has(product.asin)) : [];
    const activeProductWiseFBAData = Array.isArray(data.ProductWiseFBAData) ? 
        data.ProductWiseFBAData.filter(product => product && product.asin && activeProductSet.has(product.asin)) : [];
    const activeFBAFeesData = Array.isArray(data.FBAFeesData) ? 
        data.FBAFeesData.filter(product => product && product.asin && activeProductSet.has(product.asin)) : [];

    // Only calculate profitability for active products with error handling
    let profitibilityData = [];
    let sponsoredAdsMetrics = [];
    let negativeKeywordsMetrics = [];
    
    try {
        profitibilityData = Profitiblity(activeSalesByProducts, activeProductWiseSponsoredAds, activeProductWiseFBAData, activeFBAFeesData);
    } catch (error) {
        console.error("❌ Error calculating profitability data:", error);
        profitibilityData = [];
    }
    
    try {
        sponsoredAdsMetrics = calculateSponsoredAdsMetrics(activeProductWiseSponsoredAds);
    } catch (error) {
        console.error("❌ Error calculating sponsored ads metrics:", error);
        sponsoredAdsMetrics = [];
    }
    
    try {
        negativeKeywordsMetrics = calculateNegativeKeywordsMetrics(data.negetiveKeywords || [], data.adsKeywordsPerformanceData || []);
    } catch (error) {
        console.error("❌ Error calculating negative keywords metrics:", error);
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
        inventoryPlanning: inventoryAnalysis.inventoryPlanning ? inventoryAnalysis.inventoryPlanning.filter(item => item && item.asin && activeProductSet.has(item.asin)) : [],
        strandedInventory: inventoryAnalysis.strandedInventory ? inventoryAnalysis.strandedInventory.filter(item => item && item.asin && activeProductSet.has(item.asin)) : [],
        inboundNonCompliance: inventoryAnalysis.inboundNonCompliance ? inventoryAnalysis.inboundNonCompliance.filter(item => item && item.asin && activeProductSet.has(item.asin)) : [],
        replenishment: inventoryAnalysis.replenishment ? inventoryAnalysis.replenishment.filter(item => item && item.asin && activeProductSet.has(item.asin)) : []
    };
    
    console.log("Frontend received InventoryAnalysis: ", {
        planning: activeInventoryAnalysis.inventoryPlanning?.length || 0,
        stranded: activeInventoryAnalysis.strandedInventory?.length || 0,
        compliance: activeInventoryAnalysis.inboundNonCompliance?.length || 0,
        replenishment: activeInventoryAnalysis.replenishment?.length || 0,
        totalInventoryErrors: (activeInventoryAnalysis.inventoryPlanning?.length || 0) + 
                            (activeInventoryAnalysis.strandedInventory?.length || 0) + 
                            (activeInventoryAnalysis.inboundNonCompliance?.length || 0) +
                            (activeInventoryAnalysis.replenishment?.filter(item => item.status === "Error").length || 0)
    });
    
    // Calculate total inventory errors (only for active products)
    const totalInventoryErrors = (activeInventoryAnalysis.inventoryPlanning?.length || 0) + 
                               (activeInventoryAnalysis.strandedInventory?.length || 0) + 
                               (activeInventoryAnalysis.inboundNonCompliance?.length || 0) +
                               (activeInventoryAnalysis.replenishment?.filter(item => item && item.status === "Error").length || 0);

    console.log("negativeKeywordsMetrics: ",negativeKeywordsMetrics)

    console.log("sponsoredAdsMetrics: ",sponsoredAdsMetrics)

    const productWiseError = [];
    const rankingProductWiseErrors = [];
    const conversionProductWiseErrors = [];
    const inventoryProductWiseErrors = [];

    const seenAsins = new Set();

    // Conversion error arrays (filter for active products only) with safe data access
    const aplusError = Array.isArray(data.ConversionData?.aPlusResult) ? 
        data.ConversionData.aPlusResult.filter(p => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const imageResultError = Array.isArray(data.ConversionData?.imageResult) ? 
        data.ConversionData.imageResult.filter(p => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const videoResultError = Array.isArray(data.ConversionData?.videoResult) ? 
        data.ConversionData.videoResult.filter(p => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const productReviewResultError = Array.isArray(data.ConversionData?.productReviewResult) ? 
        data.ConversionData.productReviewResult.filter(p => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];
    const productStarRatingResultError = Array.isArray(data.ConversionData?.productStarRatingResult) ? 
        data.ConversionData.productStarRatingResult.filter(p => p && p.data && p.data.status === "Error" && p.asin && activeProductSet.has(p.asin)) : [];

    // FIXED: wrap each product without buybox error with a `.data` property to match the structure (filter for active products)
    const productsWithOutBuyboxError = Array.isArray(data.ConversionData?.ProductWithOutBuybox) ? 
        data.ConversionData.ProductWithOutBuybox
            .filter(p => p && p.status === "Error" && p.asin && activeProductSet.has(p.asin))
            .map(p => ({ asin: p.asin, data: p })) : [];

    const totalErrorInConversion =
        aplusError.length +
        imageResultError.length +
        videoResultError.length +
        productReviewResultError.length +
        productStarRatingResultError.length +
        productsWithOutBuyboxError.length;

        //THis is for getting conversion error for each product
    const getConversionErrors = (asin) => {
        let errorCount = 0;
        const data = { asin };

        const sources = [
            { key: 'aplusErrorData', list: aplusError },
            { key: 'imageResultErrorData', list: imageResultError },
            { key: 'videoResultErrorData', list: videoResultError },
            { key: 'productReviewResultErrorData', list: productReviewResultError },
            { key: 'productStarRatingResultErrorData', list: productStarRatingResultError },
            { key: 'productsWithOutBuyboxErrorData', list: productsWithOutBuyboxError },
        ];

        sources.forEach(source => {
            const found = source.list.find(p => p.asin === asin);
            if (found) {
                data[source.key] = found.data;
                errorCount++;
            }
        });

        return { data, errorCount };
    };

    // This is for getting inventory errors for each product (using filtered active inventory data)
    const getInventoryErrors = (asin) => {
        let errorCount = 0;
        const data = { asin };

        // Check inventory planning errors
        const planningError = activeInventoryAnalysis.inventoryPlanning?.find(item => item.asin === asin);
        if (planningError) {
            data.inventoryPlanningErrorData = planningError;
            // Count individual errors within planning data
            if (planningError.longTermStorageFees?.status === "Error") errorCount++;
            if (planningError.unfulfillable?.status === "Error") errorCount++;
        }

        // Check stranded inventory errors
        const strandedError = activeInventoryAnalysis.strandedInventory?.find(item => item.asin === asin);
        if (strandedError) {
            data.strandedInventoryErrorData = strandedError;
            errorCount++;
        }

        // Check inbound non-compliance errors
        const complianceError = activeInventoryAnalysis.inboundNonCompliance?.find(item => item.asin === asin);
        if (complianceError) {
            data.inboundNonComplianceErrorData = complianceError;
            errorCount++;
        }

        // Check replenishment/restock errors
        const replenishmentError = activeInventoryAnalysis.replenishment?.find(item => item && item.asin === asin && item.status === "Error");
        if (replenishmentError) {
            data.replenishmentErrorData = replenishmentError;
            errorCount++;
        }

        return { data, errorCount };
    };

    let TotalRankingerrors = 0;
    let index=0;

    // Process ranking data only for active products with safe data access
    const rankingResultArray = data.RankingsData?.RankingResultArray || [];
    if (Array.isArray(rankingResultArray)) {
        rankingResultArray.forEach(elm => {
            if (!elm || !elm.asin) return;
            
            const asin = elm.asin;
            
            // Skip if product is not active
            if (!activeProductSet.has(asin)) {
                return;
            }
            
            if (seenAsins.has(asin)) return;
            seenAsins.add(asin);

            const title = elm.data?.Title?.substring(0, 50) || "N/A";
            const productDetails = activeSalesByProducts.find(p => p.asin === asin);
            const sales = productDetails?.amount || 0;
            const quantity = productDetails?.quantity || 0;

            const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);
            const { data: inventoryData, errorCount: inventoryErrors } = getInventoryErrors(asin);

            // Find the product in TotalProducts by ASIN
            const totalProduct = TotalProducts.find(p => p.asin === asin);

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

            console.log(index)
            
            productWiseError.push({
                asin,
                sku: totalProduct?.sku || "N/A",
                name: title,
                price: totalProduct?.price || 0,
                MainImage: data.ConversionData?.imageResult?.find(item=>item.asin===elm.asin)?.data?.MainImage || null,
                errors: productwiseTotalError,
                rankingErrors: elmTotalErrors > 0 ? elm : undefined,
                conversionErrors: conversionData,
                inventoryErrors: inventoryData,
                sales,
                quantity
            });
            index++;
        });
    }

    // Backend keyword errors (only for active products) with safe data access
    const backendKeywordResultArray = data.RankingsData?.BackendKeywordResultArray || [];
    if (Array.isArray(backendKeywordResultArray)) {
        backendKeywordResultArray.forEach(elm => {
            if (!elm || !elm.asin || !elm.data) return;
            
            const asin = elm.asin;
            
            // Skip if product is not active
            if (!activeProductSet.has(asin)) {
                return;
            }
            
            const numberOfErrors = elm.data.NumberOfErrors || 0;
            if (numberOfErrors > 0) {
                TotalRankingerrors += numberOfErrors;

                const productWiseErrorElm = productWiseError.find(p => p.asin === asin);
                if (productWiseErrorElm) {
                    productWiseErrorElm.errors += numberOfErrors;
                } else {
                    // If product doesn't exist in productWiseError array yet, create it
                    const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);
                    const { data: inventoryData, errorCount: inventoryErrors } = getInventoryErrors(asin);
                    const totalProduct = TotalProducts.find(p => p.asin === asin);
                    const title = totalProduct?.itemName || totalProduct?.title?.substring(0, 50) || "N/A";
                    
                    productWiseError.push({
                        asin,
                        sku: totalProduct?.sku || "N/A",
                        name: title,
                        price: totalProduct?.price || 0,
                        MainImage: data.ConversionData?.imageResult?.find(item=>item.asin===asin)?.data?.MainImage || null,
                        errors: numberOfErrors + conversionErrors + inventoryErrors,
                        rankingErrors: undefined,
                        conversionErrors: conversionData,
                        inventoryErrors: inventoryData,
                        sales: 0,
                        quantity: 0
                    });
                }

                let rankingErrors = rankingProductWiseErrors.find(p => p.asin === asin);
                if (!rankingErrors) {
                    const fallbackTitle =
                        TotalProducts.find(p => p.asin === asin)?.itemName?.substring(0, 50) ||
                        TotalProducts.find(p => p.asin === asin)?.title?.substring(0, 50) ||
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



    const getTopErrorProduct = (data, index) =>
        data[index]
            ? {
                asin: data[index].asin,
                name: data[index].name?.substring(0, 50) || "N/A",
                errors: data[index].errors,
            }
            : null;

    const first = getTopErrorProduct(UniqueProductWisError, 0);
    const second = getTopErrorProduct(UniqueProductWisError, 1);
    const third = getTopErrorProduct(UniqueProductWisError, 2);
    const fourth = getTopErrorProduct(UniqueProductWisError, 3);

    // Add backend keyword errors to top 4 if applicable (only for active products) with safe data access
    const uniqueBackendKeywordData = Array.isArray(backendKeywordResultArray) ? 
        Array.from(
            new Map(backendKeywordResultArray.filter(obj => obj && obj.asin && activeProductSet.has(obj.asin)).map(obj => [obj.asin, obj])).values()
        ) : [];

    uniqueBackendKeywordData.forEach(elm => {
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
        console.error("❌ Error calculating profitability errors:", error);
    }
    
    try {
        sponsoredAdsErrorsData = calculateSponsoredAdsErrors(activeProductWiseSponsoredAds, negativeKeywordsMetrics);
    } catch (error) {
        console.error("❌ Error calculating sponsored ads errors:", error);
    }

    
console.log("ProductWiseSponsoredAdsGraphData: ", data.ProductWiseSponsoredAdsGraphData)
    const dashboardData = {
        Country: data.Country || "US",
        createdAccountDate: data.createdAccountDate || null,
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
        negetiveKeywords: data.negetiveKeywords || [],
        AdsGroupData: data.AdsGroupData || [],
        // Data availability flags
        isEmptyData: false,
        dataAvailabilityStatus: 'DATA_AVAILABLE'
    };

    console.log("✅ Dashboard data processed successfully with", activeProducts.length, "active products");
    return { dashboardData };
};

export default analyseData;*/

import axios from "axios";

const analyseData = async (data) => {
    console.log("data: ",data)
    const response = await axios.post(`${import.meta.env.VITE_CALCULATION_API_URI}/calculation-api/calculate`, data, {withCredentials: true})
    console.log("response in analyseData: ",response)
    return response.data.data;
}

export default analyseData;
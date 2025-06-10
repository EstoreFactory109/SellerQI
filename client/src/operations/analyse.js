import Profitiblity from "./Profitiblity";
import calculateSponsoredAdsMetrics from "./sponserdAds";
import {calculateNegativeKeywordsMetrics} from "./sponserdAds";

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
    console.log(data)
    const TotalProducts = data.TotalProducts;
    const accountHealthPercentage = data.AccountData.getAccountHealthPercentge;
    const accountFinance = data.FinanceData;
    const totalErrorInAccount = data.AccountData.accountHealth.TotalErrors;
    const replenishmentQty = data.replenishmentQty;
    const amazonReadyProducts = data.ConversionData.AmazonReadyproducts;
    const profitibilityData = Profitiblity(data.SalesByProducts, data.ProductWiseSponsoredAds, data.ProductWiseFBAData);
    const sponsoredAdsMetrics = calculateSponsoredAdsMetrics(data.ProductWiseSponsoredAds);
    const negativeKeywordsMetrics = calculateNegativeKeywordsMetrics(data.negetiveKeywords, data.ProductWiseSponsoredAds);

    console.log("negativeKeywordsMetrics: ",negativeKeywordsMetrics)

    console.log("sponsoredAdsMetrics: ",sponsoredAdsMetrics)

    const activeProducts = [];
    const productWiseError = [];
    const rankingProductWiseErrors = [];
    const conversionProductWiseErrors = [];

    const seenAsins = new Set();

    // Active products
    TotalProducts.forEach(elm => {
        if (elm.status === "Active") activeProducts.push(elm.asin);
    });


    // Conversion error arrays
    const aplusError = data.ConversionData.aPlusResult.filter(p => p.data.status === "Error");
    const imageResultError = data.ConversionData.imageResult.filter(p => p.data.status === "Error");
    const videoResultError = data.ConversionData.videoResult.filter(p => p.data.status === "Error");
    const productReviewResultError = data.ConversionData.productReviewResult.filter(p => p.data.status === "Error");
    const productStarRatingResultError = data.ConversionData.productStarRatingResult.filter(p => p.data.status === "Error");

   

    // FIXED: wrap each product without buybox error with a `.data` property to match the structure
    const productsWithOutBuyboxError = data.ConversionData.ProductWithOutBuybox
        .filter(p => p.status === "Error")
        .map(p => ({ asin: p.asin, data: p }));

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

    let TotalRankingerrors = 0;
    let index=0;

    

    data.RankingsData.RankingResultArray.forEach(elm => {
        const asin = elm.asin;
        if (seenAsins.has(asin)) return;
        seenAsins.add(asin);

        const title = elm.data.Title?.substring(0, 50) || "N/A";
        const productDetails = data.SalesByProducts.find(p => p.asin === asin);
        const sales = productDetails?.amount || 0;
        const quantity = productDetails?.quantity || 0;

        const { data: conversionData, errorCount: conversionErrors } = getConversionErrors(asin);

        // Find the product in TotalProducts by ASIN
        const totalProduct = TotalProducts.find(p => p.asin === asin);

        let productwiseTotalError = elm.data.TotalErrors + conversionErrors;
        if (elm.data.TotalErrors > 0) {
            TotalRankingerrors += elm.data.TotalErrors;
        }

        conversionProductWiseErrors.push(conversionData);
        conversionProductWiseErrors[conversionProductWiseErrors.length - 1].Title = elm.data.Title;

        rankingProductWiseErrors.push(
            elm.data.TotalErrors > 0
                ? elm
                : { asin, data: { Title: title } }
        );

        console.log(index)
        
        productWiseError.push({
            asin,
            sku: totalProduct?.sku || "N/A",
            name: title,
            price: totalProduct?.price || 0,
            MainImage: data.ConversionData.imageResult.find(item=>item.asin===elm.asin)?.data?.MainImage || null,
            errors: productwiseTotalError,
            rankingErrors: elm.data.TotalErrors > 0 ? elm : undefined,
            conversionErrors: conversionData,
            sales,
            quantity
        });
        index++;
    });



    // Backend keyword errors
   data.RankingsData.BackendKeywordResultArray.forEach(elm => {
        const asin = elm.asin;
        if (elm.data.NumberOfErrors > 0) {
            TotalRankingerrors += elm.data.NumberOfErrors;

            const productWiseErrorElm = productWiseError.find(p => p.asin === asin);
            if (productWiseErrorElm) {
                productWiseErrorElm.errors += elm.data.NumberOfErrors;
            }

            let rankingErrors = rankingProductWiseErrors.find(p => p.asin === asin);
            if (!rankingErrors) {
                const fallbackTitle =
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

    // Add backend keyword errors to top 4 if applicable
    const uniqueBackendKeywordData = Array.from(
        new Map(data.RankingsData.BackendKeywordResultArray.map(obj => [obj.asin, obj])).values()
    );

    uniqueBackendKeywordData.forEach(elm => {
        if (elm.data.NumberOfErrors === 1) {
            [first, second, third, fourth].forEach(slot => {
                if (slot && slot.asin === elm.asin) {
                    slot.errors++;
                }
            });
        }
    });

    // Calculate profitability and sponsored ads errors
    const profitabilityErrorsData = calculateProfitabilityErrors(profitibilityData);
    const sponsoredAdsErrorsData = calculateSponsoredAdsErrors(data.ProductWiseSponsoredAds, negativeKeywordsMetrics);

    const dashboardData = {
        Country:data.Country,
        accountHealthPercentage,
        accountFinance,
        totalErrorInAccount,
        totalErrorInConversion,
        TotalRankingerrors,
        first,
        second,
        third,
        fourth,
        productsWithOutBuyboxError: productsWithOutBuyboxError.length,
        replenishmentQty,
        amazonReadyProducts,
        TotalProduct: TotalProducts,
        ActiveProducts: activeProducts,
        TotalWeeklySale: data.FinanceData.Total_Sales,
        TotalSales: data.TotalSales,
        reimbustment: data.Reimburstment,
        productWiseError: productWiseError,
        rankingProductWiseErrors: rankingProductWiseErrors,
        conversionProductWiseErrors: conversionProductWiseErrors,
        AccountErrors: data.AccountData.accountHealth,
        startDate:data.startDate,
        endDate:data.endDate,
        profitibilityData: profitibilityData,
        sponsoredAdsMetrics: sponsoredAdsMetrics,
        negativeKeywordsMetrics: negativeKeywordsMetrics,
        ProductWiseSponsoredAdsGraphData: data.ProductWiseSponsoredAdsGraphData,
        totalProfitabilityErrors: profitabilityErrorsData.totalErrors,
        totalSponsoredAdsErrors: sponsoredAdsErrorsData.totalErrors,
        ProductWiseSponsoredAds: data.ProductWiseSponsoredAds,
        profitabilityErrorDetails: profitabilityErrorsData.errorDetails,
        sponsoredAdsErrorDetails: sponsoredAdsErrorsData.errorDetails,
        keywords: data.keywords || []
    };

    return { dashboardData };
};

export default analyseData;

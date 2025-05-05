const analyseData = (data) => {
    const TotalProducts = data.TotalProducts;
    const accountHealthPercentage = data.AccountData.getAccountHealthPercentge;
    const accountFinance = data.FinanceData;
    const totalErrorInAccount = data.AccountData.accountHealth.TotalErrors;
    const replenishmentQty = data.replenishmentQty;
    const amazonReadyProducts = data.ConversionData.AmazonReadyproducts;

    const activeProducts = [];
    const productWiseError = [];
    const rankingProductWiseErrors = [];
    const conversionProductWiseErrors = [];

    const seenAsins = new Set();

    // Active products
    TotalProducts.forEach(elm => {
        if (elm.status === "Active") activeProducts.push(elm.asin);
    });

    // Total weekly sale
    let totalWeeklySale = 0;
    data.TotalSales.forEach(elm => totalWeeklySale += elm.TotalAmount);

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

        
        productWiseError.push({
            asin,
            sku:data.TotalProducts[index].sku,
            name: title,
            price:data.TotalProducts[index].price,
            MainImage:data.ConversionData.imageResult.find(item=>item.asin===elm.asin).data.MainImage,
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
        TotalWeeklySale: totalWeeklySale,
        TotalSales: data.TotalSales,
        reimbustment: data.Reimburstment,
        productWiseError: productWiseError,
        rankingProductWiseErrors: rankingProductWiseErrors,
        conversionProductWiseErrors: conversionProductWiseErrors,
        AccountErrors: data.AccountData.accountHealth,
        startDate:data.startDate,
        endDate:data.endDate
    };

    return { dashboardData };
};

export default analyseData;

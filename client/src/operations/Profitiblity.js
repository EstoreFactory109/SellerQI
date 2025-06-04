const Profitiblity = (totalSales, productWiseSponsoredAds, productWiseFBAData) => {
    // Create a map to aggregate data by ASIN
    const profitabilityMap = new Map();

    // Process totalSales data
    if (Array.isArray(totalSales)) {
        totalSales.forEach(item => {
            const { asin, quantity, amount } = item;
            
            if (!profitabilityMap.has(asin)) {
                profitabilityMap.set(asin, {
                    asin: asin,
                    quantity: 0,
                    sales: 0,
                    ads: 0,
                    amzFee: 0
                });
            }
            
            const existing = profitabilityMap.get(asin);
            existing.quantity += quantity || 0;
            existing.sales += amount || 0;
        });
    }

    // Process productWiseSponsoredAds data
    if (Array.isArray(productWiseSponsoredAds)) {
        productWiseSponsoredAds.forEach(item => {
            const { asin, spend } = item;
            
            if (!profitabilityMap.has(asin)) {
                profitabilityMap.set(asin, {
                    asin: asin,
                    quantity: 0,
                    sales: 0,
                    ads: 0,
                    amzFee: 0
                });
            }
            
            const existing = profitabilityMap.get(asin);
            existing.ads += spend || 0;
        });
    }

    // Process productWiseFBAData
    if (Array.isArray(productWiseFBAData)) {
        productWiseFBAData.forEach(item => {
            const { asin, totalFba, totalAmzFee } = item;
            
            if (!profitabilityMap.has(asin)) {
                profitabilityMap.set(asin, {
                    asin: asin,
                    quantity: 0,
                    sales: 0,
                    ads: 0,
                    amzFee: 0
                });
            }
            
            const existing = profitabilityMap.get(asin);
            // Convert string values to numbers
            const fbaAmount = parseFloat(totalFba) || 0;
            const amzFeeAmount = parseFloat(totalAmzFee) || 0;
            
            // Add FBA amount to amzFee (assuming totalFba should be included in fees)
            existing.amzFee += fbaAmount + amzFeeAmount;
        });
    }

    // Convert map to array
    const profitibilityData = Array.from(profitabilityMap.values());

    console.log("profitibilityData: ",profitibilityData)
    
    return profitibilityData;
}

export default Profitiblity;
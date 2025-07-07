const Profitiblity = (totalSales, productWiseSponsoredAds, productWiseFBAData, FBAFeesData) => {
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

    // Process productWiseFBAData (legacy format)
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

    // Process FBAFeesData (new format with structure {asin: asin, fees: amazon_fees})
    // Note: Amazon fees are NOT compulsory - if data is missing for any ASIN, it defaults to 0
    if (Array.isArray(FBAFeesData) && FBAFeesData.length > 0) {
        FBAFeesData.forEach(item => {
            // Skip if item is invalid or missing ASIN
            if (!item || !item.asin) {
                return;
            }
            
            const { asin, fees } = item;
            
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
            // Convert fees to number - fees could be a number or object with amount
            // Default to 0 if fees data is missing or invalid
            let feeAmount = 0;
            
            if (fees !== null && fees !== undefined) {
                if (typeof fees === 'number' && !isNaN(fees)) {
                    feeAmount = fees;
                } else if (fees && typeof fees === 'object' && fees.amount !== null && fees.amount !== undefined) {
                    feeAmount = parseFloat(fees.amount) || 0;
                } else if (typeof fees === 'string' && fees.trim() !== '') {
                    feeAmount = parseFloat(fees) || 0;
                }
            }
            
            // Add fee amount to amzFee (will be 0 if no valid fee data found)
            existing.amzFee += feeAmount;
        });
    }
    
    // Ensure all entries have valid amzFee values (default to 0 if somehow undefined)
    profitabilityMap.forEach((value, key) => {
        if (value.amzFee === null || value.amzFee === undefined || isNaN(value.amzFee)) {
            value.amzFee = 0;
        }
    });

    // Convert map to array
    const profitibilityData = Array.from(profitabilityMap.values());

    console.log("profitibilityData: ",profitibilityData)
    
    return profitibilityData;
}

export default Profitiblity;
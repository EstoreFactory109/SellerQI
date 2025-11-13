const calculateTotalReimbursement = (data, products, fbaData = null) => {
    // Validate input parameters
    if (!data || !Array.isArray(data)) {
        console.error('Invalid data parameter: expected an array');
        return {
            productWiseReimburstment: [],
            totalReimbursement: 0
        };
    }

    if (!products || !Array.isArray(products)) {
        console.error('Invalid products parameter: expected an array');
        return {
            productWiseReimburstment: [],
            totalReimbursement: 0
        };
    }

    // Create a map of FBA data by ASIN for quick lookup
    const fbaDataMap = new Map();
    if (fbaData && Array.isArray(fbaData)) {
        fbaData.forEach(item => {
            if (item && item.asin) {
                fbaDataMap.set(item.asin, item);
            }
        });
    }

    let reimburstmentArr = [];
    let totalReimbursement = 0;
    
    data.forEach((items) => {
        // Validate items and shipmentName
        if (!items || !items.shipmentName) {
            console.error('Invalid item: missing shipmentName');
            return;
        }

        const shipmentName = items.shipmentName;
        const match = shipmentName.match(/\((\d{2}\/\d{2}\/\d{4})/);
        
        if (match) {
            const dateStr = match[1]; // "01/18/2024"
            
            // Step 2: Convert to Date object
            const shipmentDate = new Date(dateStr);
          
            // Step 3: Get today's date
            const today = new Date();
          
            // Step 4: Add 3 months to the shipment date
            const threeMonthsLater = new Date(shipmentDate);
            threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
          
            // Step 5: Compare dates
            const hasThreeMonthsPassed = today >= threeMonthsLater;

            if (!hasThreeMonthsPassed) {
                // Validate itemDetails exists and is an array
                if (!items.itemDetails || !Array.isArray(items.itemDetails)) {
                    console.error('Invalid item: missing or invalid itemDetails');
                    return;
                }

                items.itemDetails.forEach(elm => {
                    // Validate elm and SellerSKU
                    if (!elm || !elm.SellerSKU) {
                        console.error('Invalid item detail: missing SellerSKU');
                        return;
                    }

                    const product = products.find(product => product && product.sku === elm.SellerSKU);
                    
                    if (!product) {
                        console.error(`Product not found for SKU: ${elm.SellerSKU}`);
                        return;
                    }

                    // Validate product properties
                    if (!product.price || !product.asin) {
                        console.error(`Invalid product data for SKU: ${elm.SellerSKU}`);
                        return;
                    }

                    // Validate quantity properties
                    const quantityShipped = elm.QuantityShipped || 0;
                    const quantityReceived = elm.QuantityReceived || 0;
                    const discrepancy = quantityShipped - quantityReceived;

                    if (discrepancy <= 0) {
                        return; // Skip if no discrepancy
                    }

                    const asin = product.asin;
                    const price = product.price || 0;
                    
                    // Calculate Reimbursement Per Unit = (Sales Price – Fees)
                    // Try to get from FBA data first, otherwise use product price
                    let reimbursementPerUnit = price;
                    let salesPrice = price;
                    let fees = 0;
                    
                    const fbaItem = fbaDataMap.get(asin);
                    if (fbaItem) {
                        // Use pre-calculated reimbursementPerUnit if available
                        if (fbaItem.reimbursementPerUnit !== undefined && fbaItem.reimbursementPerUnit !== null) {
                            reimbursementPerUnit = parseFloat(fbaItem.reimbursementPerUnit) || 0;
                        } else {
                            // Calculate on the fly: (Sales Price – Fees)
                            salesPrice = parseFloat(fbaItem.salesPrice) || price;
                            fees = parseFloat(fbaItem.totalAmzFee) || 0;
                            reimbursementPerUnit = salesPrice - fees;
                        }
                    }
                    
                    // Calculate reimbursement amount using the formula: (Sales Price – Fees) × Discrepancy Units
                    const reimbustment = reimbursementPerUnit * discrepancy;
                    
                    totalReimbursement += reimbustment;
                    reimburstmentArr.push({
                        asin: asin,
                        amount: reimbustment,
                        sku: elm.SellerSKU,
                        reimbursementPerUnit: reimbursementPerUnit,
                        salesPrice: salesPrice,
                        fees: fees,
                        discrepancy: discrepancy
                    });
                });
            }
        } 
    });

    return {
        productWiseReimburstment: reimburstmentArr,
        totalReimbursement: totalReimbursement
    };
};

module.exports = calculateTotalReimbursement;
/**
 * Map currency code to country code
 */
const currencyToCountry = {
    'USD': 'US',
    'CAD': 'CA',
    'MXN': 'MX',
    'GBP': 'UK',
    'EUR': 'EU',
    'JPY': 'JP',
    'AUD': 'AU',
    'INR': 'IN',
    'BRL': 'BR',
    'SGD': 'SG',
    'AED': 'AE',
    'SAR': 'SA',
    'PLN': 'PL',
    'SEK': 'SE',
    'TRY': 'TR',
    'EGP': 'EG'
};

/**
 * Evaluate replenishment status for products based on Amazon's recommended replenishment quantity and alert status.
 * 
 * Logic (priority order):
 * 1. If alert is "out_of_stock" → Critical Error (highest priority)
 * 2. If Amazon recommends >30 units → Error (low inventory, urgent)
 * 3. If Amazon recommends 11-30 units → Warning (monitor closely)
 * 4. If Amazon recommends 0-10 units → Success (healthy inventory)
 * 
 * Note: Same ASIN can appear multiple times (different SKUs). Each is processed separately.
 * 
 * @param {Array} productArr - Array of products with replenishment data
 * @returns {Array} - Array of products with status, message, and how to solve
 */
const replenishmentQty = (productArr) => {
    let replenishmentArr = [];
    
    productArr.forEach(elm => {
        const asin = elm.asin;
        if (!asin) return;
        
        // Handle both old field name (RecommendedReplenishmentQty) and new field name (recommendedReplenishmentQty)
        const qty = Number(elm.RecommendedReplenishmentQty || elm.recommendedReplenishmentQty) || 0;
        
        // Get alert field - stored as "out_of_stock" or ""
        const alert = elm.alert || elm.Alert || "";
        
        // Get available quantity from the product data
        const available = Number(elm.available || elm.Available || 0);
        
        // Get SKU for identification when same ASIN has multiple entries
        const sku = elm.merchantSku || elm.MerchantSku || elm.sku || "";
        
        // Get currency code and derive country code
        const currencyCode = elm.currencyCode || elm.CurrencyCode || "";
        const countryCode = currencyToCountry[currencyCode.toUpperCase()] || "";
        
        // Helper to format ASIN with country code
        const asinDisplay = countryCode ? `${asin} (${countryCode})` : asin;
        
        // PRIORITY 1: Check for out_of_stock alert (Critical)
        if (alert === "out_of_stock") {
            replenishmentArr.push({
                asin: asin,
                sku: sku,
                countryCode: countryCode,
                data: qty,
                recommendedReplenishmentQty: qty,
                alert: alert,
                available: available,
                status: "Error",
                Message: `CRITICAL: ${asinDisplay} (SKU: ${sku || 'N/A'}) is OUT OF STOCK! Currently ${available} units available. You are losing sales and your ranking/Buy Box eligibility is being damaged. Immediate action required.`,
                HowToSolve: `Urgently create an FBA shipment to replenish this product with ${qty > 0 ? qty : 'recommended'} units. If you have inventory available, consider using Amazon's partnered carrier for faster inbound. Contact your supplier immediately if you need to reorder. In the meantime, pause advertising spend for this product to avoid wasted ad costs.`
            });
        }
        // PRIORITY 2: High replenishment qty (>30)
        else if (qty > 30) {
            replenishmentArr.push({
                asin: asin,
                sku: sku,
                countryCode: countryCode,
                data: qty,
                recommendedReplenishmentQty: qty,
                alert: alert,
                available: available,
                status: "Error",
                Message: `Urgent: ${asinDisplay} (SKU: ${sku || 'N/A'}) - Only ${available} units available. Amazon recommends replenishing ${qty} units. Risk of stockout is high.`,
                HowToSolve: "Act quickly to replenish your inventory. Create an FBA shipment immediately with the recommended quantity. Analyze your sales data to forecast demand more accurately. Consider setting up automatic restocking alerts in Amazon Seller Central. Evaluate your supply chain for bottlenecks and improve efficiency in manufacturing lead times and shipping."
            });
        }
        // PRIORITY 3: Moderate replenishment qty (11-30)
        else if (qty > 10) {
            replenishmentArr.push({
                asin: asin,
                sku: sku,
                countryCode: countryCode,
                data: qty,
                recommendedReplenishmentQty: qty,
                alert: alert,
                available: available,
                status: "Warning",
                Message: `${asinDisplay} (SKU: ${sku || 'N/A'}) - ${available} units available. Amazon recommends replenishing ${qty} units. Monitor inventory levels to avoid potential stockouts.`,
                HowToSolve: "Plan your next replenishment shipment soon. Review your sales trends and lead times to ensure timely restocking. Consider creating an FBA shipment within the next 1-2 weeks."
            });
        }
        // PRIORITY 4: Low/zero replenishment qty (0-10) - Healthy
        else {
            replenishmentArr.push({
                asin: asin,
                sku: sku,
                countryCode: countryCode,
                data: qty,
                recommendedReplenishmentQty: qty,
                alert: alert,
                available: available,
                status: "Success",
                Message: `Great job! ${asinDisplay} (SKU: ${sku || 'N/A'}) - ${available} units available. Your stock is sufficient to meet customer demand.`,
                HowToSolve: ""
            });
        }
    });
    
    return replenishmentArr;
}

const inventoryPlanningData=(data)=>{
    let longTermStorageFees={};
    const Total=Number(data.quantity_to_be_charged_ais_181_210_days)+Number(data.quantity_to_be_charged_ais_211_240_days)+Number(data.quantity_to_be_charged_ais_241_270_days)+Number(data.quantity_to_be_charged_ais_271_300_days)+Number(data.quantity_to_be_charged_ais_301_330_days)+Number(data.quantity_to_be_charged_ais_331_365_days)+Number(data.quantity_to_be_charged_ais_365_plus_days);

    if(Total!==0){
        longTermStorageFees.status="Error";
        longTermStorageFees.Message="Your inventory has been stored in FBA for a long period, making it eligible for Long-Term Storage Fees (LTSF). These fees can significantly increase your operating costs, reducing profit margins.";
        longTermStorageFees.HowToSolve="Review your inventory levels and sales velocity to identify slow-moving or stagnant stock. Consider running promotions or lowering prices to increase sales and reduce inventory levels. Alternatively, remove excess inventory from FBA to avoid additional LTSF. Strategically plan your inventory replenishment based on demand forecasts to prevent future stock from becoming eligible for LTSF.";
    }else{
        longTermStorageFees.status="Success";
        longTermStorageFees.Message="Great job managing your FBA inventory efficiently! Keeping your inventory levels optimized helps avoid Long-Term Storage Fees and maximizes your profitability." ;
        longTermStorageFees.HowToSolve="";
    }
    
    let unfulfillable={}

    if(Number(data.unfulfillable_quantity)>0){
        unfulfillable.status="Error";
        unfulfillable.Message=`You have unfulfillable inventory in FBA, which can tie up resources and increase operational costs due to items that cannot be sold in their current condition. Unfulfillable Quantity: ${data.unfulfillable_quantity} units`;
        unfulfillable.HowToSolve="Review the details of your unfulfillable inventory through your Amazon Seller Central account to understand the reasons for its status (such as damaged, customer returns, etc.). Decide whether to have the inventory returned to you for assessment, refurbishing, or disposal. If the items are repairable or repackageable, consider doing so to move them back to fulfillable status. Implement strategies to reduce future occurrences, such as improving packaging or quality control processes.";
    }else{
        unfulfillable.status="Success";
        unfulfillable.Message="Excellent! Your FBA inventory is fully fulfillable, which maximizes your sales potential and operational efficiency. Continue to maintain high quality and packaging standards to keep your inventory in sellable condition." ;
        unfulfillable.HowToSolve="";
    }
    
    return {
        asin: data.asin,
        longTermStorageFees,
        unfulfillable
    }

}

const inventoryStrandedData=(data)=>{
    
    return {
        asin:data.asin,
        status:"Error",
        Message:"Some of your inventory is stranded, meaning it is in Amazon’s fulfillment centers but not actively listed for sale. Stranded inventory can lead to unnecessary storage fees and lost sales opportunities.",
        HowToSolve:`Check the Stranded Inventory Report in Seller Central > Inventory > Manage Inventory to identify affected SKUs. Determine the reason for the issue, such as listing errors, pricing rules, or account suspensions. Resolve it by relisting the product, adjusting pricing, or creating a removal order if needed. Regularly monitor stranded inventory to prevent accumulation and reduce unnecessary FBA storage fees.
        Reason: ${data.stranded_reason}`
    }

}

const inboundNonComplianceData=(data)=>{
    return {
        asin:data.asin,
        status:"Error",
        Message:"There is an issue with a product in your incoming shipment. This may cause delays in receiving inventory at Amazon’s fulfillment center, potentially leading to stockouts and missed sales.",
        HowToSolve:`Check the Shipment Status in Seller Central > Inventory > Manage FBA Shipments to identify the issue. Common problems include incorrect labeling, quantity discrepancies, or carrier delays. Resolve any flagged issues by contacting your supplier, ensuring correct packaging and labeling, and providing accurate shipment details. If needed, contact Amazon Seller Support for assistance.
        Problem: ${data.problemType}`
    }
}


module.exports={replenishmentQty,inventoryPlanningData,inventoryStrandedData,inboundNonComplianceData}
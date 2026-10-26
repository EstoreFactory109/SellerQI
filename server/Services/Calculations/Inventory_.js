const { computeInventoryUnfulfillableAmount, computeInventoryStrandedAmount } = require('./RecoverableAmountUtils.js');

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

// tasks-logics.xlsx "Aged inventory surcharge": estimate over $25 ($25 internal), or
// 91-180-day units not selling within AGED_SELL_THROUGH_DAYS (see inventoryPlanningData).
const AGED_SURCHARGE_MIN_USD = 25;
const AGED_SELL_THROUGH_DAYS = 45;

// tasks-logics.xlsx "Unfulfillable inventory": 5+ units or $50+ in value.
const UNFULFILLABLE_MIN_UNITS = 5;
const UNFULFILLABLE_MIN_VALUE = 50;

// tasks-logics.xlsx "Products to Replenish": flag when days of supply
// (available + inbound) is under the lead time + 14 days, or Amazon's alert
// says reorder now / out of stock. Default lead time 45 days until the seller
// gives one. Only SKUs selling 1+ unit a day over 30 days are judged.
const REPLENISH_DEFAULT_LEAD_TIME_DAYS = 45;
const REPLENISH_BUFFER_DAYS = 14;
const REPLENISH_MIN_UNITS_30D = 30;

const normaliseRestockAlert = (alert) => String(alert || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
// Amazon's report sends 'out_of_stock' and 'low_stock' (its "reorder now" signal);
// 'reorder_now' is kept in case the header text changes.
const URGENT_RESTOCK_ALERTS = new Set(['out_of_stock', 'low_stock', 'reorder_now']);

/**
 * Evaluate replenishment per restock row (same ASIN can appear once per SKU).
 *
 * @param {Array} productArr - restock report rows
 * @param {Object} [options]
 * @param {number} [options.leadTimeDays] - seller's lead time, default 45
 * @returns {Array} rows with status Error (task) or Success
 */
const replenishmentQty = (productArr, { leadTimeDays = REPLENISH_DEFAULT_LEAD_TIME_DAYS } = {}) => {
    const thresholdDays = leadTimeDays + REPLENISH_BUFFER_DAYS;
    let replenishmentArr = [];

    productArr.forEach(elm => {
        const asin = elm.asin;
        if (!asin) return;

        // Handle both old field name (RecommendedReplenishmentQty) and new field name (recommendedReplenishmentQty)
        const qty = Number(elm.RecommendedReplenishmentQty || elm.recommendedReplenishmentQty) || 0;
        const alert = elm.alert || elm.Alert || "";
        const available = Number(elm.available || elm.Available || 0);
        const inbound = Number(elm.inbound || elm.Inbound || 0) || 0;
        const unitsSold30 = Number(elm.unitsSoldLast30Days) || 0;
        const sku = elm.merchantSku || elm.MerchantSku || elm.sku || "";
        const currencyCode = elm.currencyCode || elm.CurrencyCode || "";
        const countryCode = currencyToCountry[currencyCode.toUpperCase()] || "";

        const dailyUnits = unitsSold30 / 30;
        const daysOfSupply = dailyUnits > 0 ? Math.floor((available + inbound) / dailyUnits) : null;
        const judged = unitsSold30 >= REPLENISH_MIN_UNITS_30D;
        const flagged = judged && (
            (daysOfSupply !== null && daysOfSupply < thresholdDays)
            || URGENT_RESTOCK_ALERTS.has(normaliseRestockAlert(alert))
        );

        const row = {
            asin,
            sku,
            countryCode,
            data: qty,
            recommendedReplenishmentQty: qty,
            alert,
            available,
            inbound,
            unitsSoldLast30Days: unitsSold30,
            daysOfSupply
        };

        if (flagged) {
            const qtyHint = qty > 0 ? ` Amazon recommends ${qty} units.` : '';
            replenishmentArr.push({
                ...row,
                status: "Error",
                Message: `These products will run out in about ${daysOfSupply ?? 0} days at the current sales rate (${available} available, ${inbound} inbound, ${unitsSold30} sold in the last 30 days).${qtyHint}`,
                HowToSolve: "Place a purchase order or send inventory now, using Amazon's recommended quantity as a guide."
            });
        } else {
            replenishmentArr.push({
                ...row,
                status: "Success",
                Message: "Stock levels cover expected sales until the next shipment arrives.",
                HowToSolve: ""
            });
        }
    });

    return replenishmentArr;
}

/**
 * @param {Object} data - raw inventory planning row for one ASIN
 * @param {Object} costMap - {[asin]: per-unit COGS}, default {} when unknown
 * @param {Object} ltsfAmountMap - {[asin]: real long-term storage fee $ from the LTSF sync}, default {} when not yet synced
 * @param {Object} priceMap - {[asin]: selling price}, values unfulfillable units when COGS is unknown
 */
const inventoryPlanningData=(data, costMap = {}, ltsfAmountMap = {}, priceMap = {})=>{
    let longTermStorageFees={};
    const Total=Number(data.quantity_to_be_charged_ais_181_210_days)+Number(data.quantity_to_be_charged_ais_211_240_days)+Number(data.quantity_to_be_charged_ais_241_270_days)+Number(data.quantity_to_be_charged_ais_271_300_days)+Number(data.quantity_to_be_charged_ais_301_330_days)+Number(data.quantity_to_be_charged_ais_331_365_days)+Number(data.quantity_to_be_charged_ais_365_plus_days);

    // tasks-logics.xlsx "Aged inventory surcharge": Amazon's estimated surcharge over
    // $25, or units aged 91-180 days that will not sell before day 181 at the current
    // rate. Units in that band reach 181 days in 1 to 90 days, 45 on average, so
    // they are judged against 45 days of sales (internal). Reports without the
    // estimate columns keep the old rule (any unit in a surcharge bucket).
    const estimate = data.estimated_ais_total === null || data.estimated_ais_total === undefined
        ? null : Number(data.estimated_ais_total);
    const aged91 = Number(data.inv_age_91_to_180_days);
    const sold90 = Number(data.units_shipped_t90);
    const agingUnsold = Number.isFinite(aged91) && Number.isFinite(sold90) && aged91 > 0
        ? Math.max(0, Math.round(aged91 - (sold90 / 90) * AGED_SELL_THROUGH_DAYS)) : 0;
    const surchargeDue = estimate !== null && Number.isFinite(estimate)
        ? estimate > AGED_SURCHARGE_MIN_USD
        : Total > 0;
    const fee = Number(ltsfAmountMap[data.asin]) || (Number.isFinite(estimate) ? estimate : 0) || 0;

    if(surchargeDue || agingUnsold > 0){
        longTermStorageFees.status="Error";
        longTermStorageFees.Message = surchargeDue
            ? `${Total} units have been in Amazon's warehouse long enough to attract an aged inventory surcharge${fee > 0 ? ` of about $${fee.toFixed(2)} a month` : ''}.`
            : `About ${agingUnsold} units aged 91-180 days will not sell before they reach 181 days at the current sales rate, when Amazon starts charging an aged inventory surcharge.`;
        longTermStorageFees.HowToSolve="Clear this stock with a price drop, coupon or deal, or create a removal or liquidation order before the next charge on the 15th.";
        longTermStorageFees.units = Total;
        longTermStorageFees.agingUnsoldUnits = agingUnsold;
        // Real $ from the LTSF sync when it runs, else Amazon's estimate from this report.
        longTermStorageFees.amount = fee;
    }else{
        longTermStorageFees.status="Success";
        longTermStorageFees.Message="None of your stock is old enough to be charged an aged inventory surcharge.";
        longTermStorageFees.HowToSolve="";
        longTermStorageFees.amount = 0;
    }

    let unfulfillable={}

    const unfulfillableUnits = Number(data.unfulfillable_quantity) || 0;
    // Valued at cost when the seller entered COGS, otherwise at selling price.
    const unitValue = Number(costMap[data.asin]) || Number(priceMap[data.asin]) || 0;
    const unfulfillableValue = unfulfillableUnits * unitValue;

    if(unfulfillableUnits >= UNFULFILLABLE_MIN_UNITS || (unfulfillableUnits > 0 && unfulfillableValue >= UNFULFILLABLE_MIN_VALUE)){
        unfulfillable.status="Error";
        unfulfillable.units = unfulfillableUnits;
        unfulfillable.Message=`${unfulfillableUnits} units of this product are unsellable and still taking up paid storage.`;
        unfulfillable.HowToSolve="Create a removal order to get them back, or a disposal order if they are not worth recovering.";
        // CAPITAL, not profit — stock value that cannot be sold. Kept out of `amount`
        // so it never enters a profit total; see RecoverableAmountUtils for why.
        unfulfillable.capitalAmount = computeInventoryUnfulfillableAmount({ costPerUnit: costMap[data.asin], quantity: Number(data.unfulfillable_quantity) });
        unfulfillable.amount = 0;
    }else{
        unfulfillable.status="Success";
        unfulfillable.Message="Excellent! Your FBA inventory is fully fulfillable, which maximizes your sales potential and operational efficiency. Continue to maintain high quality and packaging standards to keep your inventory in sellable condition." ;
        unfulfillable.HowToSolve="";
        unfulfillable.amount = 0;
        unfulfillable.capitalAmount = 0;
    }

    return {
        asin: data.asin,
        longTermStorageFees,
        unfulfillable
    }

}

/**
 * @param {Object} data - raw stranded-inventory row for one ASIN
 * @param {Object} costMap - {[asin]: per-unit COGS}, default {} when unknown
 * @param {Object} qtyMap - {[asin]: total FBA quantity}, used as a proxy for
 *   stranded units since Amazon's Stranded Inventory report has no quantity field.
 */
const inventoryStrandedData=(data, costMap = {}, qtyMap = {})=>{

    return {
        asin:data.asin,
        status:"Error",
        Message:"Some of your inventory is stranded, meaning it is in Amazon’s fulfillment centers but not actively listed for sale. Stranded inventory can lead to unnecessary storage fees and lost sales opportunities.",
        HowToSolve:`Check the Stranded Inventory Report in Seller Central > Inventory > Manage Inventory to identify affected SKUs. Determine the reason for the issue, such as listing errors, pricing rules, or account suspensions. Resolve it by relisting the product, adjusting pricing, or creating a removal order if needed. Regularly monitor stranded inventory to prevent accumulation and reduce unnecessary FBA storage fees.
        Reason: ${data.stranded_reason}`,
        // CAPITAL, not profit — see unfulfillable above.
        capitalAmount: computeInventoryStrandedAmount({ costPerUnit: costMap[data.asin], quantity: qtyMap[data.asin] }),
        amount: 0,
        amountIsEstimated: true
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


module.exports={UNFULFILLABLE_MIN_UNITS,UNFULFILLABLE_MIN_VALUE,REPLENISH_DEFAULT_LEAD_TIME_DAYS,REPLENISH_BUFFER_DAYS,REPLENISH_MIN_UNITS_30D,replenishmentQty,inventoryPlanningData,inventoryStrandedData,inboundNonComplianceData}
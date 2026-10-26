/**
 * tasks-logics.xlsx "Fees at Risk" dashboard tile, partly: the two fees the newest FBA
 * inventory planning report carries. Aged inventory surcharge: Amazon's own estimate
 * (estimated-ais-* columns, summed per product). Low-inventory-level fee: products
 * Amazon charges this week that are not exempt; the report gives no per-unit amount,
 * so it is a count. Storage utilization and returns processing have no data source.
 */
const NOT_INCLUDED = ['storage utilization surcharge', 'returns processing fee'];
const FRESH_DAYS = 3;
const yes = (v) => ['yes', 'y', 'true', '1'].includes(String(v ?? '').trim().toLowerCase());

/**
 * @param {Object|null} doc - newest planning report ({ createdAt, data: [...] })
 * @param {Date} [now]
 */
function feesAtRiskFromPlanning(doc, now = new Date()) {
    if (!doc) return { available: false, reason: 'no_report', notIncluded: NOT_INCLUDED };
    if (now.getTime() - new Date(doc.createdAt).getTime() > FRESH_DAYS * 24 * 60 * 60 * 1000) {
        return { available: false, reason: 'stale', notIncluded: NOT_INCLUDED };
    }
    let agedAmount = 0;
    let agedKnown = false;
    const agedAsins = new Set();
    const lowFeeAsins = new Set();
    let lowFeeKnown = false;
    for (const row of doc.data || []) {
        if (row?.estimated_ais_total !== null && row?.estimated_ais_total !== undefined) {
            agedKnown = true;
            const amount = Number(row.estimated_ais_total) || 0;
            if (amount > 0) { agedAmount += amount; agedAsins.add(row.asin); }
        }
        if (row?.low_inventory_level_fee_applied !== null && row?.low_inventory_level_fee_applied !== undefined) {
            lowFeeKnown = true;
            if (yes(row.low_inventory_level_fee_applied) && !yes(row.low_inventory_level_fee_exempt)) lowFeeAsins.add(row.asin);
        }
    }
    const available = agedKnown || lowFeeKnown;
    return {
        available,
        reason: available ? null : 'columns_missing',
        reportDate: doc.createdAt,
        agedSurcharge: agedKnown ? { amount: Math.round(agedAmount * 100) / 100, products: agedAsins.size } : null,
        lowInventoryFee: lowFeeKnown ? { products: lowFeeAsins.size } : null,
        notIncluded: NOT_INCLUDED
    };
}

module.exports = { feesAtRiskFromPlanning };

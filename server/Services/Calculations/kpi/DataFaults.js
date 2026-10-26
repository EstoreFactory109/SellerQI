/**
 * Data fault guard (tasks-logics.xlsx "Data integrity: Data fault guard").
 *
 * Spreadsheet: internal alert when a source returns 0 rows, a key column is null on
 * every row, or two marketplaces show identical figures; client tasks from that
 * source are held. Holding works the way it does for a missing input: the faulty
 * source is treated as not arrived for this run, so its detectors make no verdict
 * (no new tasks, nothing resolved). Never a client task, only the alert.
 *
 * Each check is one a real account cannot produce: no stock rows at all are already
 * "not arrived" (buildStock returns null), so only states that look like data but
 * cannot be true are judged here.
 */

/**
 * @param {Object} inputs - KpiInputs
 * @returns {Array<{source: string, fault: string}>}
 */
const MIN_PRODUCTS_FOR_EMPTY_FAULT = 20;

function dataFaults(inputs) {
    if (!inputs) return [];
    const out = [];

    const traffic = inputs.traffic;
    const trafficRows = Object.values(traffic?.byAsin || {});
    // A dead listing can have no visits; units sold without a single visit, or a
    // whole catalogue of 20+ products with none, cannot be real.
    const noSessions = trafficRows.length > 0 && trafficRows.every(t => !(Number(t.rs) > 0) && !(Number(t.bs) > 0) && !(Number(t.s30) > 0));
    const anyUnits = trafficRows.some(t => [t.ru, t.bu, t.u7, t.u28, t.u30].some(v => Number(v) > 0));
    if (noSessions && (anyUnits || trafficRows.length >= MIN_PRODUCTS_FOR_EMPTY_FAULT)) {
        out.push({ source: 'traffic', fault: `sessions are 0 on all ${trafficRows.length} products` });
    }
    if (traffic?.sameAsMarketplace) {
        out.push({ source: 'traffic', fault: `identical to ${traffic.sameAsMarketplace} on ${traffic.newestDate}` });
    }

    const restockRows = inputs.restock?.rows || [];
    if (restockRows.length > 0 && restockRows.every(r => !(Number(r.price) > 0))) {
        out.push({ source: 'restock', fault: `price is empty on all ${restockRows.length} rows` });
    }
    // FBA stock but an empty restock report: Amazon lists every FBA SKU there.
    const fbaAsins = Object.values(inputs.stock?.byAsin || {}).filter(s => (Number(s.total) || 0) > 0).length;
    if (inputs.restock && restockRows.length === 0 && fbaAsins > 0) {
        out.push({ source: 'restock', fault: `0 rows while ${fbaAsins} products hold FBA stock` });
    }

    const returnLines = inputs.returns?.lines || [];
    if (returnLines.length > 0 && returnLines.every(l => !String(l.reason || '').trim())) {
        out.push({ source: 'returns', fault: `reason is empty on all ${returnLines.length} returns` });
    }

    return out;
}

/**
 * Inputs with every faulty source removed (null = not arrived), so the detectors
 * hold their tasks. The original inputs are not changed.
 */
function withoutFaultySources(inputs, faults) {
    if (!inputs || faults.length === 0) return inputs;
    const held = { ...inputs };
    for (const { source } of faults) held[source] = null;
    return held;
}

module.exports = { dataFaults, withoutFaultySources };

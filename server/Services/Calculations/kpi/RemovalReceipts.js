/**
 * Which removal order lines a seller is asked to confirm, shared by the task
 * detector (Wave1Detectors) and the confirmation API (RemovalReceiptService) so
 * the task and the form can never disagree about what is outstanding.
 *
 * A line qualifies when stock was actually sent back to the seller: a Return
 * order (Disposal and Liquidation never come back), finished on Amazon's side
 * (Completed or Delivered), with units shipped, inside the claim window.
 */

const { REMOVAL_CLAIM_WINDOW_DAYS, DAY_MS } = require('./KpiRules.js');

const receiptKey = (orderId, sku) => `${String(orderId || '').trim()}\u0000${String(sku || '').trim()}`;

/**
 * @param {Object} line - a KpiInputs removal line
 * @param {Date} now
 */
function isReturnShippedLine(line, now) {
    if (!line || !line.orderId) return false;
    if (!/return/i.test(String(line.orderType || ''))) return false;
    if (!/^(completed|delivered)$/i.test(String(line.orderStatus || '').trim())) return false;
    if (!(Number(line.shippedQuantity) > 0)) return false;
    const updated = Date.parse(line.lastUpdatedDate || line.requestDate || '');
    return Number.isFinite(updated) && updated >= now.getTime() - REMOVAL_CLAIM_WINDOW_DAYS * DAY_MS;
}

/**
 * @param {Array} receipts - RemovalReceipt documents (lean)
 * @returns {Map<string, Object>} receiptKey -> receipt
 */
function receiptsByKey(receipts = []) {
    const out = new Map();
    for (const r of receipts || []) if (r?.orderId) out.set(receiptKey(r.orderId, r.sku), r);
    return out;
}

/**
 * Lines still waiting for the seller's answer, oldest request first.
 * @param {Array} lines
 * @param {Map<string, Object>} confirmed - receiptsByKey result
 * @param {Date} now
 */
function linesAwaitingConfirmation(lines = [], confirmed = new Map(), now = new Date()) {
    return (lines || [])
        .filter(line => isReturnShippedLine(line, now) && !confirmed.has(receiptKey(line.orderId, line.sku)))
        .sort((a, b) => String(a.requestDate).localeCompare(String(b.requestDate)));
}

module.exports = { receiptKey, isReturnShippedLine, receiptsByKey, linesAwaitingConfirmation };

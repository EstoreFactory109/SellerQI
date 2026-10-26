/**
 * The seller's side of FBA removal orders: which shipped-back order lines still
 * need "how many actually arrived?", and saving the answers.
 *
 * Which lines qualify is decided by kpi/RemovalReceipts.js, the same rule the
 * removal_confirm_receipt task uses, so the form lists exactly what the task
 * counted. Answers are checked against Amazon's report: a line must still be
 * awaiting confirmation-eligible, and the received count must be a whole number
 * between 0 and what Amazon says it shipped.
 */

const mongoose = require('mongoose');
const RemovalOrders = require('../../models/inventory/RemovalOrdersModel.js');
const RemovalReceipt = require('../../models/inventory/RemovalReceiptModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { buildRemovals } = require('../Calculations/kpi/KpiInputs.js');
const { receiptKey, isReturnShippedLine, receiptsByKey, linesAwaitingConfirmation } = require('../Calculations/kpi/RemovalReceipts.js');

const toObjectId = (id) => (typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id);

async function loadLines(userId, country, region) {
    const doc = await RemovalOrders.findOne({ User: toObjectId(userId), country, region })
        .sort({ createdAt: -1 })
        .lean();
    return buildRemovals(doc)?.lines || [];
}

/** SKU -> { asin, productName } from the marketplace's catalogue. */
async function catalogueBySku(userId, country, region) {
    const seller = await Seller.findOne({ User: toObjectId(userId) }).select('sellerAccount').lean();
    const account = (seller?.sellerAccount || []).find(a => a.country === country && a.region === region);
    const out = new Map();
    for (const p of account?.products || []) {
        if (p?.sku) out.set(p.sku, { asin: p.asin || null, productName: p.itemName || null });
    }
    return out;
}

/**
 * Order lines waiting for the seller's answer.
 * @returns {Promise<Array<{orderId, sku, asin, productName, requestDate, shippedQuantity}>>}
 */
async function getPendingReceipts(userId, country, region, now = new Date()) {
    const [lines, receipts, catalogue] = await Promise.all([
        loadLines(userId, country, region),
        RemovalReceipt.find({ User: toObjectId(userId), country, region }).lean(),
        catalogueBySku(userId, country, region)
    ]);
    return linesAwaitingConfirmation(lines, receiptsByKey(receipts), now).map(line => ({
        orderId: line.orderId,
        sku: line.sku,
        asin: catalogue.get(line.sku)?.asin || null,
        productName: catalogue.get(line.sku)?.productName || null,
        requestDate: line.requestDate,
        lastUpdatedDate: line.lastUpdatedDate,
        shippedQuantity: line.shippedQuantity
    }));
}

/**
 * Save the seller's answers. Each entry must name a line that qualifies today;
 * anything else is returned in `rejected` with the reason, never silently dropped.
 * Re-answering a line overwrites the earlier answer.
 *
 * @param {Array<{orderId, sku, receivedQuantity}>} entries
 * @returns {Promise<{saved: number, rejected: Array<{orderId, sku, reason}>}>}
 */
async function saveReceipts(userId, country, region, entries, now = new Date()) {
    const lines = await loadLines(userId, country, region);
    const eligible = new Map();
    for (const line of lines) {
        if (isReturnShippedLine(line, now)) eligible.set(receiptKey(line.orderId, line.sku), line);
    }

    const rejected = [];
    const ops = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        const orderId = String(entry?.orderId || '').trim();
        const sku = String(entry?.sku || '').trim();
        const received = Number(entry?.receivedQuantity);
        const line = eligible.get(receiptKey(orderId, sku));
        if (!line) {
            rejected.push({ orderId, sku, reason: 'Not a returned removal order line from the last 60 days' });
            continue;
        }
        if (!Number.isInteger(received) || received < 0 || received > line.shippedQuantity) {
            rejected.push({ orderId, sku, reason: `Received must be a whole number from 0 to ${line.shippedQuantity}` });
            continue;
        }
        ops.push({
            updateOne: {
                filter: { User: toObjectId(userId), country, region, orderId, sku },
                update: {
                    $set: { shippedQuantity: line.shippedQuantity, receivedQuantity: received, confirmedAt: now }
                },
                upsert: true
            }
        });
    }

    if (ops.length > 0) await RemovalReceipt.bulkWrite(ops, { ordered: false });
    return { saved: ops.length, rejected };
}

module.exports = { getPendingReceipts, saveReceipts };

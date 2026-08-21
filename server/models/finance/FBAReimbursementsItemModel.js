/**
 * FBAReimbursementsItemModel.js
 *
 * One document per FBA-reimbursement row, replacing the embedded `data[]` array on
 * FBAReimbursementsModel.
 *
 * WHY. The parent held an entire reimbursements report in one document, the same shape that broke
 * ledger detail. It has more headroom — measured 2026-08-21 the collection was 209MB with a largest
 * document of 3.63MB / 5,337 rows and no account over 4MB — but the stored maximum understates the
 * truth, because a write that exceeds the 16MB ceiling never lands and so never appears in the
 * statistics. It failed for the largest account on 2026-08-15, and being a SATURDAY_FUNCTIONS
 * service it fails once a week rather than daily.
 *
 * `product_name` is the fat column driving document size.
 *
 * Shared keys, indexes and statics come from batchedItemModel; see LedgerSummaryViewItem for the
 * migration this copies.
 */

const mongoose = require('mongoose');
const { buildBatchedItemSchema } = require('./batchedItemModel.js');

const fbaReimbursementsItemSchema = buildBatchedItemSchema({
    approval_date: { type: String, required: false, index: true },
    reimbursement_id: { type: String, required: false, index: true },
    case_id: { type: String, required: false },
    amazon_order_id: { type: String, required: false },
    reason: { type: String, required: false, index: true },
    sku: { type: String, required: false },
    fnsku: { type: String, required: false, index: true },
    asin: { type: String, required: false, index: true },
    product_name: { type: String, required: false },
    condition: { type: String, required: false },
    currency_unit: { type: String, required: false },
    amount_per_unit: { type: String, required: false, default: '0' },
    amount_total: { type: String, required: false, default: '0' },
    quantity_reimbursed_cash: { type: String, required: false, default: '0' },
    quantity_reimbursed_inventory: { type: String, required: false, default: '0' },
    quantity_reimbursed_total: { type: String, required: false, default: '0' },
    original_reimbursement_id: { type: String, required: false },
    original_reimbursement_type: { type: String, required: false },
    store: { type: String, required: false, default: '' },
});

module.exports = mongoose.model('FBAReimbursementsItem', fbaReimbursementsItemSchema);

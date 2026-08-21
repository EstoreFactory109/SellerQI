/**
 * LedgerDetailViewItemModel.js
 *
 * One document per ledger-detail row, replacing the embedded `data[]` array on
 * LedgerDetailViewModel.
 *
 * WHY. The parent held an entire 9-month ledger-detail report in one document. Measured
 * 2026-08-21 that collection was 2,975MB with a largest document of 14.91MB / 32,175 rows, and
 * 3 of 157 accounts were within ~1MB of MongoDB's hard 16MB ceiling — at which point the write
 * fails with a driver-level `ERR_OUT_OF_RANGE` that names nothing useful. The report feeds the
 * damaged- and disposed-inventory reimbursement calculators, and those treat an empty read as
 * "fall back to the summary report", so the failure degraded the seller's recoverable-money
 * figures silently.
 *
 * Same shape as LedgerSummaryViewItem, which migrated its sibling report; the shared keys,
 * indexes and statics come from batchedItemModel.
 *
 * THE ONE TRAP HERE. The report has its own `country` column — the marketplace of the
 * transaction — which collides with the account-scope `country` used as a key. Flattening the row
 * naively would silently overwrite one with the other. The row value is stored as
 * `rowCountry` and mapped back to `country` by the reader, so callers see the shape they always
 * saw. The summary sibling avoided this only because its rows happen to have no `country` column.
 */

const mongoose = require('mongoose');
const { buildBatchedItemSchema } = require('./batchedItemModel.js');

const ledgerDetailViewItemSchema = buildBatchedItemSchema({
    date_and_time: { type: String, required: false },
    reference_id: { type: String, required: false, index: true },
    fnsku: { type: String, required: false, index: true },
    asin: { type: String, required: false, index: true },
    msku: { type: String, required: false },
    title: { type: String, required: false },
    event_type: { type: String, required: false },
    fulfillment_center: { type: String, required: false },
    quantity: { type: String, required: false, default: '0' },
    unreconciled_quantity: { type: String, required: false, default: '0' },
    reason: { type: String, required: false, index: true },
    disposition: { type: String, required: false, index: true },
    // The TRANSACTION's marketplace, from the report — NOT the account scope. Renamed to avoid
    // colliding with the top-level `country` key; the reader maps it back to `country`.
    rowCountry: { type: String, required: false },
    reconciled: { type: String, required: false },
    store: { type: String, required: false, default: '' },
});

module.exports = mongoose.model('LedgerDetailViewItem', ledgerDetailViewItemSchema);

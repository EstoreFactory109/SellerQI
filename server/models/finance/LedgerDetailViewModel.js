const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * LedgerDetailView Model
 * 
 * Stores data from Amazon's GET_LEDGER_DETAIL_VIEW_DATA report
 * Used for calculating damaged and disposed inventory reimbursements
 * 
 * Key differences from LedgerSummaryView:
 * - Contains detailed transaction-level data with Reference IDs
 * - Includes Reason codes for filtering (6, 7, E, H, K, U for damaged; D for disposed)
 * - Has Unreconciled Quantity field (used for damaged inventory)
 * - Has Disposition field (used for disposed inventory filtering)
 */

// Subschema for ledger detail data array items
const ledgerDetailDataItemSchema = new Schema({
    date_and_time: {
        type: String,
        required: false
    },
    reference_id: {
        type: String,
        required: false,
        index: true
    },
    fnsku: {
        type: String,
        required: false,
        index: true
    },
    asin: {
        type: String,
        required: false,
        index: true
    },
    msku: {
        type: String,
        required: false
    },
    title: {
        type: String,
        required: false
    },
    event_type: {
        type: String,
        required: false
    },
    fulfillment_center: {
        type: String,
        required: false
    },
    quantity: {
        type: String,
        required: false,
        default: "0"
    },
    unreconciled_quantity: {
        type: String,
        required: false,
        default: "0"
    },
    reason: {
        type: String,
        required: false,
        index: true
    },
    disposition: {
        type: String,
        required: false,
        index: true
    },
    country: {
        type: String,
        required: false
    },
    reconciled: {
        type: String,
        required: false
    },
    store: {
        type: String,
        required: false,
        default: ""
    }
}, { _id: false });

// Main schema
const ledgerDetailViewSchema = new Schema({
    User: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    country: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    region: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    data: {
        type: [ledgerDetailDataItemSchema],
        default: []
    }
}, {
    timestamps: true
});

// Add compound indexes for better query performance
ledgerDetailViewSchema.index({ User: 1, country: 1, region: 1 });
ledgerDetailViewSchema.index({ User: 1, 'data.date_and_time': 1 });
ledgerDetailViewSchema.index({ User: 1, 'data.asin': 1 });
ledgerDetailViewSchema.index({ User: 1, 'data.reason': 1 });
ledgerDetailViewSchema.index({ User: 1, 'data.disposition': 1 });
ledgerDetailViewSchema.index({ User: 1, 'data.reference_id': 1 });

// Create and export the model
const LedgerDetailView = mongoose.model('LedgerDetailView', ledgerDetailViewSchema);

module.exports = LedgerDetailView;


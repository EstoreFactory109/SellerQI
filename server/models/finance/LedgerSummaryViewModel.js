const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Subschema for ledger data array items
const ledgerDataItemSchema = new Schema({
    date: {
        type: String,
        required: false
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
    disposition: {
        type: String,
        required: false,
        index: true
    },
    starting_warehouse_balance: {
        type: String,
        required: false,
        default: "0"
    },
    in_transit_between_warehouses: {
        type: String,
        required: false,
        default: "0"
    },
    receipts: {
        type: String,
        required: false,
        default: "0"
    },
    customer_shipments: {
        type: String,
        required: false,
        default: "0"
    },
    customer_returns: {
        type: String,
        required: false,
        default: "0"
    },
    vendor_returns: {
        type: String,
        required: false,
        default: "0"
    },
    warehouse_transfer_in_out: {
        type: String,
        required: false,
        default: "0"
    },
    found: {
        type: String,
        required: false,
        default: "0"
    },
    lost: {
        type: String,
        required: false,
        default: "0"
    },
    damaged: {
        type: String,
        required: false,
        default: "0"
    },
    disposed: {
        type: String,
        required: false,
        default: "0"
    },
    other_events: {
        type: String,
        required: false,
        default: "0"
    },
    ending_warehouse_balance: {
        type: String,
        required: false,
        default: "0"
    },
    unknown_events: {
        type: String,
        required: false,
        default: "0"
    },
    location: {
        type: String,
        required: false
    },
    store: {
        type: String,
        required: false,
        default: ""
    }
}, { _id: false }); // _id: false to avoid creating separate ids for subdocuments

// Main schema
const ledgerSummaryViewSchema = new Schema({
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
        type: [ledgerDataItemSchema],
        default: []
    }
}, {
    timestamps: true // CreatedAt & UpdatedAt automatically managed
});

// Add compound indexes for better query performance
ledgerSummaryViewSchema.index({ User: 1, country: 1, region: 1 });
ledgerSummaryViewSchema.index({ User: 1, 'data.date': 1 });
ledgerSummaryViewSchema.index({ User: 1, 'data.asin': 1 });
ledgerSummaryViewSchema.index({ User: 1, 'data.disposition': 1 });

// Create and export the model
const LedgerSummaryView = mongoose.model('LedgerSummaryView', ledgerSummaryViewSchema);

module.exports = LedgerSummaryView;


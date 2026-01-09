const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * FBAReimbursements Model
 * 
 * Stores data from Amazon's GET_FBA_REIMBURSEMENTS_DATA report
 * Used for calculating lost inventory reimbursements
 * 
 * This model tracks units that Amazon has already reimbursed
 * For lost inventory calculation:
 *   DiscrepancyUnits = LostUnits - FoundUnits - ReimbursedUnits
 * 
 * Key fields:
 * - reason: "lost_warehouse" for lost inventory reimbursements
 * - quantity_reimbursed_total: Total units reimbursed for this ASIN
 */

// Subschema for FBA reimbursements data array items
const fbaReimbursementItemSchema = new Schema({
    approval_date: {
        type: String,
        required: false
    },
    reimbursement_id: {
        type: String,
        required: false,
        index: true
    },
    case_id: {
        type: String,
        required: false
    },
    amazon_order_id: {
        type: String,
        required: false
    },
    reason: {
        type: String,
        required: false,
        index: true
    },
    sku: {
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
    product_name: {
        type: String,
        required: false
    },
    condition: {
        type: String,
        required: false
    },
    currency_unit: {
        type: String,
        required: false
    },
    amount_per_unit: {
        type: String,
        required: false,
        default: "0"
    },
    amount_total: {
        type: String,
        required: false,
        default: "0"
    },
    quantity_reimbursed_cash: {
        type: String,
        required: false,
        default: "0"
    },
    quantity_reimbursed_inventory: {
        type: String,
        required: false,
        default: "0"
    },
    quantity_reimbursed_total: {
        type: String,
        required: false,
        default: "0"
    },
    original_reimbursement_id: {
        type: String,
        required: false
    },
    original_reimbursement_type: {
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
const fbaReimbursementsSchema = new Schema({
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
        type: [fbaReimbursementItemSchema],
        default: []
    }
}, {
    timestamps: true
});

// Add compound indexes for better query performance
fbaReimbursementsSchema.index({ User: 1, country: 1, region: 1 });
fbaReimbursementsSchema.index({ User: 1, 'data.approval_date': 1 });
fbaReimbursementsSchema.index({ User: 1, 'data.asin': 1 });
fbaReimbursementsSchema.index({ User: 1, 'data.reason': 1 });
fbaReimbursementsSchema.index({ User: 1, 'data.fnsku': 1 });

// Create and export the model
const FBAReimbursements = mongoose.model('FBAReimbursements', fbaReimbursementsSchema);

module.exports = FBAReimbursements;


const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Subschema for lost inventory items
const lostInventoryItemSchema = new Schema({
    asin: {
        type: String,
        required: true,
        index: true
    },
    sku: {
        type: String,
        required: false,
        index: true
    },
    fnsku: {
        type: String,
        required: false
    },
    // Quantities from Ledger Summary View
    lostUnits: {
        type: Number,
        required: true,
        default: 0
    },
    foundUnits: {
        type: Number,
        required: true,
        default: 0
    },
    // Reimbursed units from GET_FBA_REIMBURSEMENTS_DATA where reason is "Lost_warehouse"
    reimbursedUnits: {
        type: Number,
        required: true,
        default: 0
    },
    // Calculated: Discrepancy Units = Lost Units – Found Units – Reimbursed Units
    discrepancyUnits: {
        type: Number,
        required: true,
        default: 0
    },
    // From ProductWiseFBAData
    salesPrice: {
        type: Number,
        required: false,
        default: 0
    },
    fees: {
        type: Number,
        required: false,
        default: 0
    },
    reimbursementPerUnit: {
        type: Number,
        required: false,
        default: 0,
        comment: 'Calculated as (Sales Price – Fees)'
    },
    // Calculated: Expected Amount = Discrepancy Units × (Sales Price – Fees)
    expectedAmount: {
        type: Number,
        required: true,
        default: 0
    },
    currency: {
        type: String,
        required: false,
        default: 'USD'
    },
    // Flag to indicate if this is an underpaid item
    isUnderpaid: {
        type: Boolean,
        required: false,
        default: false
    },
    // Amount per unit from reimbursement report (if available)
    amountPerUnit: {
        type: Number,
        required: false,
        default: 0
    },
    // Underpaid expected amount: ((Sales Price – Fees) - Amount per Unit) × quantity
    underpaidExpectedAmount: {
        type: Number,
        required: false,
        default: 0
    }
}, { _id: false });

// Main schema
const backendLostInventorySchema = new Schema({
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
    items: {
        type: [lostInventoryItemSchema],
        default: []
    },
    // Summary statistics
    summary: {
        totalDiscrepancyUnits: {
            type: Number,
            default: 0
        },
        totalExpectedAmount: {
            type: Number,
            default: 0
        },
        totalUnderpaidItems: {
            type: Number,
            default: 0
        },
        totalUnderpaidExpectedAmount: {
            type: Number,
            default: 0
        },
        totalLostUnits: {
            type: Number,
            default: 0
        },
        totalFoundUnits: {
            type: Number,
            default: 0
        },
        totalReimbursedUnits: {
            type: Number,
            default: 0
        }
    }
}, {
    timestamps: true
});

// Method to calculate summary statistics
backendLostInventorySchema.methods.calculateSummary = function() {
    const summary = {
        totalDiscrepancyUnits: 0,
        totalExpectedAmount: 0,
        totalUnderpaidItems: 0,
        totalUnderpaidExpectedAmount: 0,
        totalLostUnits: 0,
        totalFoundUnits: 0,
        totalReimbursedUnits: 0
    };

    this.items.forEach(item => {
        summary.totalLostUnits += item.lostUnits || 0;
        summary.totalFoundUnits += item.foundUnits || 0;
        summary.totalReimbursedUnits += item.reimbursedUnits || 0;
        summary.totalDiscrepancyUnits += item.discrepancyUnits || 0;
        summary.totalExpectedAmount += item.expectedAmount || 0;
        
        if (item.isUnderpaid) {
            summary.totalUnderpaidItems += 1;
            summary.totalUnderpaidExpectedAmount += item.underpaidExpectedAmount || 0;
        }
    });

    this.summary = summary;
};

// Add compound indexes
backendLostInventorySchema.index({ User: 1, country: 1, region: 1 });
backendLostInventorySchema.index({ User: 1, 'items.asin': 1 });
backendLostInventorySchema.index({ User: 1, 'items.isUnderpaid': 1 });

// Create and export the model
const BackendLostInventory = mongoose.model('BackendLostInventory', backendLostInventorySchema);

module.exports = BackendLostInventory;


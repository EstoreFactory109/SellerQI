/**
 * LedgerSummaryViewItemModel.js
 * 
 * Model for storing individual ledger summary items in a separate collection.
 * This approach prevents the 16MB MongoDB document size limit for users with many ledger entries.
 * 
 * Each document stores one ledger entry, linked to the user.
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ledgerSummaryViewItemSchema = new Schema({
    // Reference fields
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
    // Batch identifier - groups items from the same fetch
    batchId: {
        type: Schema.Types.ObjectId,
        index: true
    },
    // Ledger data fields
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
}, {
    timestamps: true
});

// Compound indexes for efficient queries
ledgerSummaryViewItemSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });
ledgerSummaryViewItemSchema.index({ User: 1, country: 1, region: 1, batchId: 1 });
ledgerSummaryViewItemSchema.index({ batchId: 1, createdAt: -1 });

// Static method to find items by user/country/region (latest batch)
ledgerSummaryViewItemSchema.statics.findLatestByUserCountryRegion = async function(userId, country, region) {
    // First find the latest batchId for this user/country/region
    const latestItem = await this.findOne({ User: userId, country, region })
        .sort({ createdAt: -1 })
        .select('batchId createdAt')
        .lean();
    
    if (!latestItem || !latestItem.batchId) {
        return { items: [], createdAt: null, batchId: null };
    }
    
    // Then fetch all items with that batchId
    const items = await this.find({ batchId: latestItem.batchId }).lean();
    return { 
        items, 
        createdAt: latestItem.createdAt, 
        batchId: latestItem.batchId 
    };
};

// Static method to find items by batchId
ledgerSummaryViewItemSchema.statics.findByBatchId = function(batchId) {
    return this.find({ batchId }).lean();
};

// Static method to delete items by batchId
ledgerSummaryViewItemSchema.statics.deleteByBatchId = function(batchId) {
    return this.deleteMany({ batchId });
};

// Static method to delete old batches (keep only latest N batches per user/country/region)
ledgerSummaryViewItemSchema.statics.deleteOldBatches = async function(userId, country, region, keepCount = 3) {
    // Find all unique batchIds for this user/country/region, sorted by creation date
    const batches = await this.aggregate([
        { $match: { User: new mongoose.Types.ObjectId(userId), country, region } },
        { $group: { _id: '$batchId', createdAt: { $max: '$createdAt' } } },
        { $sort: { createdAt: -1 } },
        { $skip: keepCount },
        { $project: { _id: 1 } }
    ]);
    
    if (batches.length === 0) {
        return { deletedCount: 0 };
    }
    
    const batchIdsToDelete = batches.map(b => b._id);
    return this.deleteMany({ batchId: { $in: batchIdsToDelete } });
};

// Create and export the model
const LedgerSummaryViewItem = mongoose.model('LedgerSummaryViewItem', ledgerSummaryViewItemSchema);

module.exports = LedgerSummaryViewItem;

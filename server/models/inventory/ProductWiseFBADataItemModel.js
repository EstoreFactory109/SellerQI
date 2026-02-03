/**
 * ProductWiseFBADataItemModel.js
 * 
 * Model for storing individual FBA data items in a separate collection.
 * This approach prevents the 16MB MongoDB document size limit for users with many products.
 * 
 * Each document stores one product's FBA data, linked to the user.
 * This replaces the embedded fbaData[] array in ProductWiseFBADataModel for new data.
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Schema for individual FBA data item - using exact field names from the report
const productWiseFBADataItemSchema = new Schema({
    // Reference fields
    userId: {
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
    // FBA product data fields
    asin: {
        type: String,
        required: false,
        default: "",
        index: true
    },
    sku: {
        type: String,
        required: false,
        default: ""
    },
    fnsku: {
        type: String,
        required: false,
        default: "",
        index: true
    },
    "amazon-store": {
        type: String,
        required: false,
        default: ""
    },
    "product-name": {
        type: String,
        required: false,
        default: ""
    },
    "product-group": {
        type: String,
        required: false,
        default: ""
    },
    brand: {
        type: String,
        required: false,
        default: ""
    },
    "fulfilled-by": {
        type: String,
        required: false,
        default: ""
    },
    "your-price": {
        type: String,
        required: false,
        default: "0.00"
    },
    "sales-price": {
        type: String,
        required: false,
        default: "0.00"
    },
    "longest-side": {
        type: String,
        required: false,
        default: ""
    },
    "median-side": {
        type: String,
        required: false,
        default: ""
    },
    "shortest-side": {
        type: String,
        required: false,
        default: ""
    },
    "length-and-girth": {
        type: String,
        required: false,
        default: ""
    },
    "unit-of-dimension": {
        type: String,
        required: false,
        default: ""
    },
    "item-package-weight": {
        type: String,
        required: false,
        default: ""
    },
    "unit-of-weight": {
        type: String,
        required: false,
        default: ""
    },
    "product-size-tier": {
        type: String,
        required: false,
        default: ""
    },
    currency: {
        type: String,
        required: false,
        default: ""
    },
    "estimated-fee-total": {
        type: String,
        required: false,
        default: "0.00"
    },
    "estimated-referral-fee-per-unit": {
        type: String,
        required: false,
        default: "0.00"
    },
    "estimated-variable-closing-fee": {
        type: String,
        required: false,
        default: "0.00"
    },
    "estimated-pick-pack-fee-per-unit": {
        type: String,
        required: false,
        default: "0.00"
    },
    "estimated-weight-handling-fee-per-unit": {
        type: String,
        required: false,
        default: "--"
    }
}, { 
    timestamps: true,
    strict: false // Allow additional fields that might be in the report
});

// Compound indexes for efficient queries
productWiseFBADataItemSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
productWiseFBADataItemSchema.index({ userId: 1, country: 1, region: 1, batchId: 1 });
productWiseFBADataItemSchema.index({ batchId: 1, createdAt: -1 });

// Static method to find items by user/country/region (latest batch)
productWiseFBADataItemSchema.statics.findLatestByUserCountryRegion = async function(userId, country, region) {
    // First find the latest batchId for this user/country/region
    const latestItem = await this.findOne({ userId, country, region })
        .sort({ createdAt: -1 })
        .select('batchId')
        .lean();
    
    if (!latestItem || !latestItem.batchId) {
        return [];
    }
    
    // Then fetch all items with that batchId
    return this.find({ batchId: latestItem.batchId }).lean();
};

// Static method to find items by batchId
productWiseFBADataItemSchema.statics.findByBatchId = function(batchId) {
    return this.find({ batchId }).lean();
};

// Static method to delete items by batchId
productWiseFBADataItemSchema.statics.deleteByBatchId = function(batchId) {
    return this.deleteMany({ batchId });
};

// Static method to delete old batches (keep only latest N batches per user/country/region)
productWiseFBADataItemSchema.statics.deleteOldBatches = async function(userId, country, region, keepCount = 3) {
    // Find all unique batchIds for this user/country/region, sorted by creation date
    const batches = await this.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId), country, region } },
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
const ProductWiseFBADataItem = mongoose.model('ProductWiseFBADataItem', productWiseFBADataItemSchema);

module.exports = ProductWiseFBADataItem;

/**
 * ProductWiseSponsoredAdsItemModel.js
 * 
 * Model for storing individual Product-wise Sponsored Ads items in a separate collection.
 * This approach prevents the 16MB MongoDB document size limit for users with many products.
 * 
 * Each document stores one ad entry, linked to the user.
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const productWiseSponsoredAdsItemSchema = new Schema({
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
        index: true
    },
    region: {
        type: String,
        required: true,
        index: true
    },
    // Batch identifier - groups items from the same fetch
    batchId: {
        type: Schema.Types.ObjectId,
        index: true
    },
    // Sponsored ads item data
    date: {
        type: String,
        required: true
    },
    asin: {
        type: String,
        required: true,
        index: true
    },
    spend: {
        type: Number,
        required: true,
        default: 0
    },
    salesIn7Days: {
        type: Number,
        required: true,
        default: 0
    },
    salesIn14Days: {
        type: Number,
        required: true,
        default: 0
    },
    salesIn30Days: {
        type: Number,
        required: true,
        default: 0
    },
    campaignId: {
        type: String,
        required: true
    },
    campaignName: {
        type: String,
        required: true
    },
    impressions: {
        type: Number,
        required: true,
        default: 0
    },
    adGroupId: {
        type: String,
        required: true
    },
    clicks: {
        type: Number,
        required: true,
        default: 0
    },
    purchasedIn7Days: {
        type: Number,
        required: true,
        default: 0
    },
    purchasedIn14Days: {
        type: Number,
        required: true,
        default: 0
    },
    purchasedIn30Days: {
        type: Number,
        required: true,
        default: 0
    }
}, {
    timestamps: true
});

// Compound indexes for efficient queries
productWiseSponsoredAdsItemSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
productWiseSponsoredAdsItemSchema.index({ userId: 1, country: 1, region: 1, batchId: 1 });
productWiseSponsoredAdsItemSchema.index({ batchId: 1, createdAt: -1 });

// Static method to find items by user/country/region (latest batch)
productWiseSponsoredAdsItemSchema.statics.findLatestByUserCountryRegion = async function(userId, country, region) {
    // First find the latest batchId for this user/country/region
    const latestItem = await this.findOne({ userId, country, region })
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
productWiseSponsoredAdsItemSchema.statics.findByBatchId = function(batchId) {
    return this.find({ batchId }).lean();
};

// Static method to delete items by batchId
productWiseSponsoredAdsItemSchema.statics.deleteByBatchId = function(batchId) {
    return this.deleteMany({ batchId });
};

// Static method to delete old batches (keep only latest N batches per user/country/region)
productWiseSponsoredAdsItemSchema.statics.deleteOldBatches = async function(userId, country, region, keepCount = 3) {
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
const ProductWiseSponsoredAdsItem = mongoose.model('ProductWiseSponsoredAdsItem', productWiseSponsoredAdsItemSchema);

module.exports = ProductWiseSponsoredAdsItem;

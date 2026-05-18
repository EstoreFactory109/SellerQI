/**
 * ProductWiseSponsoredAdsItemModel.js
 *
 * Model for storing individual Product-wise Sponsored Ads items in a separate collection.
 * This approach prevents the 16MB MongoDB document size limit for users with many products.
 *
 * Each document stores one ad entry, linked to the user.
 *
 * Covers all three ad types:
 *   - SP (Sponsored Products)  — 7-day attribution default
 *   - SB (Sponsored Brands)    — 14-day attribution default
 *   - SD (Sponsored Display)   — 14-day attribution default
 *
 * TIMEZONE NOTE:
 *   The `date` field comes directly from Amazon's v3 reporting API, which
 *   returns dates in the marketplace's local timezone (Pacific for NA/US).
 *   No conversion is needed — stored as-is.
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const productWiseSponsoredAdsItemSchema = new Schema({
    // ===== Reference fields =====
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
    // Batch identifier — groups items from the same fetch
    batchId: {
        type: Schema.Types.ObjectId,
        index: true
    },

    // ===== Ad type =====
    // SP = Sponsored Products, SD = Sponsored Display
    // SB (Sponsored Brands) excluded — no ASIN-level report available;
    // SB spend tracked at campaign level in GetPPCMetrics.js
    adType: {
        type: String,
        required: true,
        enum: ['SP', 'SD'],
        index: true
    },

    // ===== Dimensions =====
    date: {
        type: String,
        required: true
    },
    asin: {
        type: String,
        required: true,
        index: true
    },
    sku: {
        type: String,
        default: ''
    },
    campaignId: {
        type: String,
        required: true
    },
    campaignName: {
        type: String,
        required: true
    },
    adGroupId: {
        type: String,
        default: ''
    },
    adGroupName: {
        type: String,
        default: ''
    },

    // ===== Traffic metrics =====
    impressions: {
        type: Number,
        default: 0
    },
    clicks: {
        type: Number,
        default: 0
    },
    spend: {
        type: Number,
        default: 0
    },

    // ===== Conversion metrics (SC default attribution per ad type) =====
    // SP: 7-day click attribution (from sales7d)
    // SD: 14-day click attribution (from sales — SD's only window)
    // Both mapped to the same field — the mapper picks the correct source column.
    sales: {
        type: Number,
        default: 0
    },
    purchases: {
        type: Number,
        default: 0
    },
    unitsSoldClicks: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// ===== Compound indexes for efficient queries =====
productWiseSponsoredAdsItemSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
productWiseSponsoredAdsItemSchema.index({ userId: 1, country: 1, region: 1, batchId: 1 });
productWiseSponsoredAdsItemSchema.index({ userId: 1, country: 1, region: 1, date: 1, adType: 1 });
productWiseSponsoredAdsItemSchema.index({ batchId: 1, createdAt: -1 });

// ===== Static methods =====

// Find latest batch for a user/country/region
productWiseSponsoredAdsItemSchema.statics.findLatestByUserCountryRegion = async function(userId, country, region) {
    const latestItem = await this.findOne({ userId, country, region })
        .sort({ createdAt: -1 })
        .select('batchId createdAt')
        .lean();

    if (!latestItem || !latestItem.batchId) {
        return { items: [], createdAt: null, batchId: null };
    }

    const items = await this.find({ batchId: latestItem.batchId }).lean();
    return {
        items,
        createdAt: latestItem.createdAt,
        batchId: latestItem.batchId
    };
};

// Find items by batchId
productWiseSponsoredAdsItemSchema.statics.findByBatchId = function(batchId) {
    return this.find({ batchId }).lean();
};

// Delete items by batchId
productWiseSponsoredAdsItemSchema.statics.deleteByBatchId = function(batchId) {
    return this.deleteMany({ batchId });
};

// Delete old batches (keep only latest N batches per user/country/region)
productWiseSponsoredAdsItemSchema.statics.deleteOldBatches = async function(userId, country, region, keepCount = 3) {
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

/**
 * Aggregate spend by ASIN across all ad types for a date range.
 * Used by the profitability table.
 *
 * Returns: { adsSpendByAsin: Map<asin, { total, SP, SD }>, batchId, createdAt }
 */
productWiseSponsoredAdsItemSchema.statics.aggregateSpendByAsin = async function(userId, country, region) {
    const uid = userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);

    const now = new Date();
    const endD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const startD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1 - 30));
    const fmt = (d) => d.toISOString().split('T')[0];
    const endStr = fmt(endD);
    const startStr = fmt(startD);

    const aggregationResult = await this.aggregate([
        {
            $match: {
                userId: uid,
                country,
                region,
                date: { $gte: startStr, $lte: endStr }
            }
        },
        {
            $group: {
                _id: { asin: '$asin', adType: '$adType' },
                totalSpend: { $sum: '$spend' }
            }
        }
    ]);

    const latestItem = await this.findOne({ userId: uid, country, region })
        .sort({ createdAt: -1 })
        .select('batchId createdAt')
        .lean();

    let rows = aggregationResult;
    if ((!rows || rows.length === 0) && latestItem?.batchId) {
        rows = await this.aggregate([
            { $match: { batchId: latestItem.batchId } },
            {
                $group: {
                    _id: { asin: '$asin', adType: '$adType' },
                    totalSpend: { $sum: '$spend' }
                }
            }
        ]);
    }

    // Build a map: asin → { total, SP, SD }
    const adsSpendByAsin = new Map();
    for (const item of rows || []) {
        if (item._id?.asin) {
            const asin = item._id.asin;
            const adType = item._id.adType || 'SP';
            if (!adsSpendByAsin.has(asin)) {
                adsSpendByAsin.set(asin, { total: 0, SP: 0, SD: 0 });
            }
            const entry = adsSpendByAsin.get(asin);
            entry[adType] = (entry[adType] || 0) + item.totalSpend;
            entry.total += item.totalSpend;
        }
    }

    return {
        adsSpendByAsin,
        batchId: latestItem?.batchId || null,
        createdAt: latestItem?.createdAt || null
    };
};

/**
 * Aggregate spend + sales (and traffic) by ASIN and calendar date for a date range.
 * Merges SP + SD and all campaigns into one row per { date, asin }.
 *
 * Returns array of:
 *   { date, asin, totalSpend, totalSales, totalClicks, totalImpressions, totalPurchases, totalUnitsSold }
 */
productWiseSponsoredAdsItemSchema.statics.aggregateByAsinAndDate = async function(userId, country, region, startDate, endDate) {
    const uid = userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);

    return this.aggregate([
        {
            $match: {
                userId: uid,
                country,
                region,
                date: { $gte: startDate, $lte: endDate },
            },
        },
        {
            $group: {
                _id: { date: '$date', asin: '$asin' },
                totalSpend: { $sum: { $ifNull: ['$spend', 0] } },
                totalSales: { $sum: { $ifNull: ['$sales', 0] } },
                totalClicks: { $sum: { $ifNull: ['$clicks', 0] } },
                totalImpressions: { $sum: { $ifNull: ['$impressions', 0] } },
                totalPurchases: { $sum: { $ifNull: ['$purchases', 0] } },
                totalUnitsSold: { $sum: { $ifNull: ['$unitsSoldClicks', 0] } },
            },
        },
        { $sort: { '_id.date': 1, '_id.asin': 1 } },
        {
            $project: {
                _id: 0,
                date: '$_id.date',
                asin: '$_id.asin',
                totalSpend: 1,
                totalSales: 1,
                totalClicks: 1,
                totalImpressions: 1,
                totalPurchases: 1,
                totalUnitsSold: 1,
            },
        },
    ]);
};

/**
 * Aggregate sales + spend by ASIN and ad type for a date range.
 * Used by the PPC product-wise dashboard table.
 *
 * Returns array of: { asin, adType, spend, sales, impressions, clicks, purchases, unitsSoldClicks }
 */
productWiseSponsoredAdsItemSchema.statics.aggregateByAsinAndAdType = async function(userId, country, region, startDate, endDate) {
    const uid = userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);

    return this.aggregate([
        {
            $match: {
                userId: uid,
                country,
                region,
                date: { $gte: startDate, $lte: endDate }
            }
        },
        {
            $group: {
                _id: { asin: '$asin', adType: '$adType' },
                spend: { $sum: '$spend' },
                impressions: { $sum: '$impressions' },
                clicks: { $sum: '$clicks' },
                sales: { $sum: '$sales' },
                purchases: { $sum: '$purchases' },
                unitsSoldClicks: { $sum: '$unitsSoldClicks' },
            }
        },
        {
            $project: {
                _id: 0,
                asin: '$_id.asin',
                adType: '$_id.adType',
                spend: 1,
                impressions: 1,
                clicks: 1,
                sales: 1,
                purchases: 1,
                unitsSoldClicks: 1,
            }
        }
    ]);
};

const ProductWiseSponsoredAdsItem = mongoose.model('ProductWiseSponsoredAdsItem', productWiseSponsoredAdsItemSchema);

module.exports = ProductWiseSponsoredAdsItem;
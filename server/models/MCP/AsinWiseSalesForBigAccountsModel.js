/**
 * AsinWiseSalesForBigAccountsModel.js
 * 
 * Model for storing ASIN-wise sales data for big accounts (totalSales > 5000)
 * Each document stores ASIN sales data for a single date, linked to the main EconomicsMetrics document.
 * This approach prevents the 16MB MongoDB document size limit for users with many ASINs.
 */

const mongoose = require('mongoose');

// Schema for individual ASIN sales data (same as in EconomicsMetricsModel)
const asinSalesItemSchema = new mongoose.Schema({
    asin: {
        type: String,
        required: true
    },
    parentAsin: {
        type: String,
        required: false,
        default: null
    },
    sales: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    grossProfit: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    unitsSold: {
        type: Number,
        required: true,
        default: 0
    },
    refunds: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    ppcSpent: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    fbaFees: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    storageFees: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    totalFees: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    amazonFees: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    feeBreakdown: [{
        feeType: {
            type: String,
            required: true
        },
        amount: {
            type: Number,
            required: true,
            default: 0
        }
    }]
}, { _id: false });

// Main schema for ASIN-wise sales per date
const asinWiseSalesForBigAccountsSchema = new mongoose.Schema({
    // Reference to the main EconomicsMetrics document
    metricsId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EconomicsMetrics',
        required: true,
        index: true
    },
    User: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    region: {
        type: String,
        required: true,
        enum: ['NA', 'EU', 'FE'],
        index: true
    },
    country: {
        type: String,
        required: true,
        index: true
    },
    // The specific date this document covers
    date: {
        type: String,
        required: true,
        index: true
    },
    // All ASIN sales data for this specific date
    asinSales: {
        type: [asinSalesItemSchema],
        default: []
    }
}, {
    timestamps: true
});

// Compound indexes for efficient queries
asinWiseSalesForBigAccountsSchema.index({ metricsId: 1, date: 1 }, { unique: true });
asinWiseSalesForBigAccountsSchema.index({ User: 1, region: 1, country: 1, date: 1 });
asinWiseSalesForBigAccountsSchema.index({ User: 1, region: 1, country: 1, createdAt: -1 });

// Static method to find all ASIN sales for a metrics document
asinWiseSalesForBigAccountsSchema.statics.findByMetricsId = function(metricsId) {
    return this.find({ metricsId: metricsId }).sort({ date: 1 });
};

// Static method to find ASIN sales by date range
asinWiseSalesForBigAccountsSchema.statics.findByDateRange = function(userId, region, country, startDate, endDate) {
    return this.find({
        User: userId,
        region: region,
        country: country,
        date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });
};

// Static method to find latest ASIN sales for a user
asinWiseSalesForBigAccountsSchema.statics.findLatestForUser = function(userId, region, country) {
    return this.find({
        User: userId,
        region: region,
        country: country
    }).sort({ createdAt: -1 });
};

// Static method to delete all ASIN sales for a metrics document
asinWiseSalesForBigAccountsSchema.statics.deleteByMetricsId = function(metricsId) {
    return this.deleteMany({ metricsId: metricsId });
};

/**
 * OPTIMIZED: Get top ASINs by total sales for a metrics document
 * Uses MongoDB aggregation pipeline to:
 * 1. Match documents by metricsId
 * 2. Unwind asinSales array
 * 3. Group by ASIN and sum sales
 * 4. Sort by total sales descending
 * 5. Limit to specified count
 * 
 * This is much faster than fetching all data and processing in Node.js
 * @param {ObjectId} metricsId - The EconomicsMetrics document ID
 * @param {number} limit - Maximum number of ASINs to return (default 100)
 * @returns {Promise<Array>} Array of { asin, totalSales, unitsSold } sorted by totalSales desc
 */
asinWiseSalesForBigAccountsSchema.statics.getTopAsinsBySales = async function(metricsId, limit = 100) {
    return this.aggregate([
        { $match: { metricsId: metricsId } },
        { $unwind: '$asinSales' },
        { 
            $group: {
                _id: '$asinSales.asin',
                totalSales: { $sum: '$asinSales.sales.amount' },
                unitsSold: { $sum: '$asinSales.unitsSold' },
                parentAsin: { $first: '$asinSales.parentAsin' }
            }
        },
        { $sort: { totalSales: -1 } },
        { $limit: limit },
        { 
            $project: {
                _id: 0,
                asin: '$_id',
                totalSales: 1,
                unitsSold: 1,
                parentAsin: 1
            }
        }
    ]);
};

/**
 * OPTIMIZED: Get all ASIN sales totals for a metrics document
 * Uses MongoDB aggregation to sum sales across all dates per ASIN
 * Returns a Map for O(1) lookup
 * @param {ObjectId} metricsId - The EconomicsMetrics document ID
 * @returns {Promise<Map>} Map of asin -> { totalSales, unitsSold }
 */
asinWiseSalesForBigAccountsSchema.statics.getAsinSalesMap = async function(metricsId) {
    const results = await this.aggregate([
        { $match: { metricsId: metricsId } },
        { $unwind: '$asinSales' },
        { 
            $group: {
                _id: '$asinSales.asin',
                totalSales: { $sum: '$asinSales.sales.amount' },
                unitsSold: { $sum: '$asinSales.unitsSold' }
            }
        },
        { 
            $project: {
                _id: 0,
                asin: '$_id',
                totalSales: 1,
                unitsSold: 1
            }
        }
    ]);
    
    return new Map(results.map(r => [r.asin, { totalSales: r.totalSales, unitsSold: r.unitsSold }]));
};

/**
 * OPTIMIZED: Get full profitability data per ASIN for a metrics document
 * Uses MongoDB aggregation to sum all profitability fields across all dates per ASIN
 * Returns a Map for O(1) lookup - includes all fields needed for recommendations
 * 
 * This is much faster than findByMetricsId + JS aggregation because:
 * 1. Aggregation happens in MongoDB (no data transfer of all date docs)
 * 2. Returns only one aggregated row per ASIN instead of many date rows
 * 
 * @param {ObjectId} metricsId - The EconomicsMetrics document ID
 * @returns {Promise<Map>} Map of asin -> { sales, grossProfit, ads, amzFee, fbaFees, storageFees, totalFees, unitsSold, refunds }
 */
asinWiseSalesForBigAccountsSchema.statics.getProfitabilityMapByMetricsId = async function(metricsId) {
    const results = await this.aggregate([
        { $match: { metricsId: metricsId } },
        { $unwind: '$asinSales' },
        { 
            $group: {
                _id: '$asinSales.asin',
                sales: { $sum: '$asinSales.sales.amount' },
                grossProfit: { $sum: '$asinSales.grossProfit.amount' },
                ads: { $sum: '$asinSales.ppcSpent.amount' },
                amzFee: { $sum: '$asinSales.amazonFees.amount' },
                fbaFees: { $sum: '$asinSales.fbaFees.amount' },
                storageFees: { $sum: '$asinSales.storageFees.amount' },
                totalFees: { $sum: '$asinSales.totalFees.amount' },
                unitsSold: { $sum: '$asinSales.unitsSold' },
                refunds: { $sum: '$asinSales.refunds.amount' }
            }
        },
        { 
            $project: {
                _id: 0,
                asin: '$_id',
                sales: 1,
                grossProfit: 1,
                ads: 1,
                amzFee: 1,
                fbaFees: 1,
                storageFees: 1,
                totalFees: 1,
                unitsSold: 1,
                refunds: 1
            }
        }
    ]);
    
    const map = new Map();
    results.forEach(r => {
        map.set(r.asin, {
            asin: r.asin,
            sales: r.sales || 0,
            grossProfit: r.grossProfit || 0,
            ads: r.ads || 0,
            amzFee: r.amzFee || 0,
            fbaFees: r.fbaFees || 0,
            storageFees: r.storageFees || 0,
            totalFees: r.totalFees || 0,
            unitsSold: r.unitsSold || 0,
            refunds: r.refunds || 0
        });
    });
    return map;
};

const AsinWiseSalesForBigAccounts = mongoose.model('AsinWiseSalesForBigAccounts', asinWiseSalesForBigAccountsSchema);

module.exports = AsinWiseSalesForBigAccounts;

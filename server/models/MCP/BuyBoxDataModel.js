const mongoose = require('mongoose');
const { marketplaceConfig } = require('../../controllers/config/config.js');
const { latestCapturePerBuyBoxDay } = require('../../Services/Calculations/RecoverableAmountUtils.js');

/**
 * Countries this model accepts, derived from the SP-API marketplace table rather than
 * hand-listed — see the same constant in DataFetchTrackingModel for the full rationale.
 *
 * This is the enum that PROVED the drift: production logs carry 63
 * `BuyBoxData validation failed: country: 'BR' is not a valid enum value for path
 * 'country'` errors, each one a fetched-but-discarded day of BuyBox data for a Brazilian
 * seller. `marketplaceConfig` lists 23 countries; this literal listed 15.
 */
const SUPPORTED_COUNTRIES = Object.keys(marketplaceConfig);

// findRecentDays reads this many docs per wanted day before deduping, because a
// day can have more than one capture (re-runs save a new doc, not an upsert).
const RECENT_DAYS_CAPTURE_HEADROOM = 3;

// Schema for ASIN-wise buybox data
const asinBuyBoxSchema = new mongoose.Schema({
    parentAsin: {
        type: String,
        required: false
    },
    childAsin: {
        type: String,
        required: true
    },
    buyBoxPercentage: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: 100
    },
    pageViews: {
        type: Number,
        required: true,
        default: 0
    },
    sessions: {
        type: Number,
        required: true,
        default: 0
    },
    unitSessionPercentage: {
        type: Number,
        required: true,
        default: 0
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
    unitsOrdered: {
        type: Number,
        required: true,
        default: 0
    },
    totalOrderItems: {
        type: Number,
        required: true,
        default: 0
    }
}, {
    _id: false
});

// Main schema for buybox data
const buyBoxDataSchema = new mongoose.Schema({
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
        enum: SUPPORTED_COUNTRIES,
        index: true
    },
    dateRange: {
        startDate: {
            type: String,
            required: true
        },
        endDate: {
            type: String,
            required: true
        }
    },
    // Explicit day this dataset represents (for daily fetches)
    date: {
        type: String,
        required: false,
        index: true
    },
    // Summary metrics
    totalProducts: {
        type: Number,
        required: true,
        default: 0
    },
    productsWithBuyBox: {
        type: Number,
        required: true,
        default: 0
    },
    productsWithoutBuyBox: {
        type: Number,
        required: true,
        default: 0
    },
    productsWithLowBuyBox: {
        type: Number,
        required: true,
        default: 0
    },
    // ASIN-wise breakdown
    asinBuyBoxData: {
        type: [asinBuyBoxSchema],
        default: []
    },
    // Query metadata
    queryId: {
        type: String,
        required: false,
        index: true
    },
    documentId: {
        type: String,
        required: false
    },
    // Additional metadata
    processedAt: {
        type: Date,
        default: Date.now
    },
    dataSource: {
        type: String,
        enum: ['DataKiosk', 'SP-API'],
        default: 'DataKiosk'
    }
}, {
    timestamps: true
});

// Compound index for efficient queries
buyBoxDataSchema.index({ User: 1, region: 1, 'dateRange.startDate': 1, 'dateRange.endDate': 1 });
buyBoxDataSchema.index({ User: 1, region: 1, country: 1, createdAt: -1 });
buyBoxDataSchema.index({ User: 1, region: 1, country: 1, date: 1 });

// Method to get summary
buyBoxDataSchema.methods.getSummary = function() {
    return {
        totalProducts: this.totalProducts,
        productsWithBuyBox: this.productsWithBuyBox,
        productsWithoutBuyBox: this.productsWithoutBuyBox,
        productsWithLowBuyBox: this.productsWithLowBuyBox,
        date: this.date,
        dateRange: this.dateRange,
        country: this.country
    };
};

// Static method to find by date range
buyBoxDataSchema.statics.findByDateRange = function(userId, region, startDate, endDate) {
    return this.find({
        User: userId,
        region: region,
        'dateRange.startDate': startDate,
        'dateRange.endDate': endDate
    }).sort({ createdAt: -1 });
};

// Static method to find latest buybox data
// Sorted by the DATA day first: a late re-capture of an older day must not
// outrank the newest day just because it was written later. createdAt breaks
// ties between several captures of the same day. Lean because every caller
// only reads it (Analyse.js already assumed it was lean).
buyBoxDataSchema.statics.findLatest = function(userId, region, country = 'US') {
    return this.findOne({
        User: userId,
        region: region,
        country: country
    }).sort({ date: -1, createdAt: -1 }).lean();
};

/**
 * The newest `n` distinct DATA DAYS of Buy Box data, newest first, lean.
 *
 * WHY NOT findLatest
 * Buy Box issues used to be judged from the single newest document. In the 14
 * days to 2026-10-15, 539 of 3,279 buyboxdatas docs had totalProducts 0 (an
 * empty Data Kiosk day), and each one wiped every Buy Box issue for that run;
 * 2,463 ASINs flipped between 0% and >0% from one day to the next. Callers that
 * decide "this ASIN lost the Buy Box" need several days, which is what this
 * returns (see classifyBuyBoxLoss in RecoverableAmountUtils).
 *
 * - Empty days (totalProducts 0) are skipped: they mean "no data", not "no Buy Box".
 * - Several captures of one day are possible (BuyBoxService saves without an
 *   upsert), so only the latest capture of each day is kept.
 * - The day is `date`, falling back to dateRange.endDate on old docs that
 *   predate the `date` field.
 *
 * @param {ObjectId|string} userId
 * @param {string} region
 * @param {string} country
 * @param {number} [n=7] - distinct days wanted
 * @param {string|Object} [select] - optional projection (summary callers do not
 *   need sales/pageViews for every ASIN on every day)
 * @returns {Promise<Array>} up to n lean docs, one per day, newest first
 */
buyBoxDataSchema.statics.findRecentDays = async function(userId, region, country, n = 7, select) {
    let query = this.find({
        User: userId,
        region: region,
        country: country,
        totalProducts: { $gt: 0 }
    })
        .sort({ date: -1, createdAt: -1 })
        // Headroom for duplicate captures of the same day; dedupe happens below.
        .limit(n * RECENT_DAYS_CAPTURE_HEADROOM);
    if (select) query = query.select(select);
    const docs = await query.lean();
    return latestCapturePerBuyBoxDay(docs, n);
};

// Static method to find by user, region, and country
buyBoxDataSchema.statics.findByUserRegionCountry = function(userId, region, country) {
    const query = {
        User: userId,
        region: region
    };
    if (country) {
        query.country = country;
    }
    return this.find(query).sort({ createdAt: -1 });
};

// Create and export the model
const BuyBoxData = mongoose.model('BuyBoxData', buyBoxDataSchema);

module.exports = BuyBoxData;


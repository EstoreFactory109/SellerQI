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

const AsinWiseSalesForBigAccounts = mongoose.model('AsinWiseSalesForBigAccounts', asinWiseSalesForBigAccountsSchema);

module.exports = AsinWiseSalesForBigAccounts;

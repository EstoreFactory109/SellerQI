const mongoose = require('mongoose');

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
        enum: ['US', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'AU'],
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

// Method to get summary
buyBoxDataSchema.methods.getSummary = function() {
    return {
        totalProducts: this.totalProducts,
        productsWithBuyBox: this.productsWithBuyBox,
        productsWithoutBuyBox: this.productsWithoutBuyBox,
        productsWithLowBuyBox: this.productsWithLowBuyBox,
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
buyBoxDataSchema.statics.findLatest = function(userId, region, country = 'US') {
    return this.findOne({
        User: userId,
        region: region,
        country: country
    }).sort({ createdAt: -1 });
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


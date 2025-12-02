const mongoose = require('mongoose');

// Schema for datewise sales and gross profit
const datewiseSalesSchema = new mongoose.Schema({
    date: {
        type: String,
        required: true
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
    }
}, {
    _id: false
});

// Schema for datewise gross profit
const datewiseGrossProfitSchema = new mongoose.Schema({
    date: {
        type: String,
        required: true
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
    }
}, {
    _id: false
});

// Schema for ASIN-wise sales data
const asinWiseSalesSchema = new mongoose.Schema({
    asin: {
        type: String,
        required: true
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
    }
}, {
    _id: false
});

// Schema for monetary amounts
const monetaryAmountSchema = new mongoose.Schema({
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
}, {
    _id: false
});

// Main schema for economics metrics
const economicsMetricsSchema = new mongoose.Schema({
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
    totalSales: {
        type: monetaryAmountSchema,
        required: true
    },
    grossProfit: {
        type: monetaryAmountSchema,
        required: true
    },
    ppcSpent: {
        type: monetaryAmountSchema,
        required: true
    },
    fbaFees: {
        type: monetaryAmountSchema,
        required: true
    },
    storageFees: {
        type: monetaryAmountSchema,
        required: true
    },
    refunds: {
        type: monetaryAmountSchema,
        required: true
    },
    // Datewise breakdowns
    datewiseSales: {
        type: [datewiseSalesSchema],
        default: []
    },
    datewiseGrossProfit: {
        type: [datewiseGrossProfitSchema],
        default: []
    },
    // ASIN-wise breakdown
    asinWiseSales: {
        type: [asinWiseSalesSchema],
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
economicsMetricsSchema.index({ User: 1, region: 1, 'dateRange.startDate': 1, 'dateRange.endDate': 1 });
economicsMetricsSchema.index({ User: 1, region: 1, country: 1, createdAt: -1 });

// Method to get summary
economicsMetricsSchema.methods.getSummary = function() {
    return {
        totalSales: this.totalSales,
        grossProfit: this.grossProfit,
        ppcSpent: this.ppcSpent,
        fbaFees: this.fbaFees,
        storageFees: this.storageFees,
        refunds: this.refunds,
        dateRange: this.dateRange,
        country: this.country // country = marketplace (US, UK, DE, etc.)
    };
};

// Static method to find by date range
economicsMetricsSchema.statics.findByDateRange = function(userId, region, startDate, endDate) {
    return this.find({
        User: userId,
        region: region,
        'dateRange.startDate': startDate,
        'dateRange.endDate': endDate
    }).sort({ createdAt: -1 });
};

// Static method to find latest metrics
economicsMetricsSchema.statics.findLatest = function(userId, region, country = 'US') {
    return this.findOne({
        User: userId,
        region: region,
        country: country
    }).sort({ createdAt: -1 });
};

// Static method to find by user, region, and country
economicsMetricsSchema.statics.findByUserRegionCountry = function(userId, region, country) {
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
const EconomicsMetrics = mongoose.model('EconomicsMetrics', economicsMetricsSchema);

module.exports = EconomicsMetrics;


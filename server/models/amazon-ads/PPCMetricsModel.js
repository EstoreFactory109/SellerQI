const mongoose = require("mongoose");

// Schema for campaign type breakdown (SP, SB, SD)
const campaignTypeMetricsSchema = new mongoose.Schema({
    sales: {
        type: Number,
        default: 0
    },
    spend: {
        type: Number,
        default: 0
    },
    impressions: {
        type: Number,
        default: 0
    },
    clicks: {
        type: Number,
        default: 0
    },
    acos: {
        type: Number,
        default: 0
    }
}, { _id: false });

// Schema for date-wise metrics
const dateWiseMetricsSchema = new mongoose.Schema({
    date: {
        type: String,
        required: true
    },
    sales: {
        type: Number,
        default: 0
    },
    spend: {
        type: Number,
        default: 0
    },
    impressions: {
        type: Number,
        default: 0
    },
    clicks: {
        type: Number,
        default: 0
    },
    acos: {
        type: Number,
        default: 0
    },
    roas: {
        type: Number,
        default: 0
    },
    ctr: {
        type: Number,
        default: 0
    },
    cpc: {
        type: Number,
        default: 0
    }
}, { _id: false });

// Main PPC Metrics schema
const ppcMetricsSchema = new mongoose.Schema({
    userId: {
        type: String,
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
        enum: ["NA", "EU", "FE"],
        index: true
    },
    profileId: {
        type: String,
        required: false
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
    summary: {
        totalSales: {
            type: Number,
            default: 0
        },
        totalSpend: {
            type: Number,
            default: 0
        },
        totalImpressions: {
            type: Number,
            default: 0
        },
        totalClicks: {
            type: Number,
            default: 0
        },
        overallAcos: {
            type: Number,
            default: 0
        },
        overallRoas: {
            type: Number,
            default: 0
        },
        ctr: {
            type: Number,
            default: 0
        },
        cpc: {
            type: Number,
            default: 0
        }
    },
    campaignTypeBreakdown: {
        sponsoredProducts: {
            type: campaignTypeMetricsSchema,
            default: () => ({})
        },
        sponsoredBrands: {
            type: campaignTypeMetricsSchema,
            default: () => ({})
        },
        sponsoredDisplay: {
            type: campaignTypeMetricsSchema,
            default: () => ({})
        }
    },
    dateWiseMetrics: {
        type: [dateWiseMetricsSchema],
        default: []
    },
    processedCampaignTypes: {
        type: [String],
        default: []
    }
}, { timestamps: true });

// Compound index for efficient queries
ppcMetricsSchema.index({ userId: 1, country: 1, region: 1, 'dateRange.startDate': 1, 'dateRange.endDate': 1 });

// Index for finding latest record for a user/country/region
ppcMetricsSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });

// Static method to find latest metrics for a user
ppcMetricsSchema.statics.findLatestForUser = async function(userId, country, region) {
    return this.findOne({ userId, country, region })
        .sort({ createdAt: -1 })
        .lean();
};

// Static method to find metrics by date range
ppcMetricsSchema.statics.findByDateRange = async function(userId, country, region, startDate, endDate) {
    return this.findOne({
        userId,
        country,
        region,
        'dateRange.startDate': startDate,
        'dateRange.endDate': endDate
    }).lean();
};

// Static method to upsert metrics (update if exists, create if not)
ppcMetricsSchema.statics.upsertMetrics = async function(userId, country, region, startDate, endDate, metricsData) {
    return this.findOneAndUpdate(
        {
            userId,
            country,
            region,
            'dateRange.startDate': startDate,
            'dateRange.endDate': endDate
        },
        {
            $set: {
                userId,
                country,
                region,
                ...metricsData
            }
        },
        {
            upsert: true,
            new: true,
            runValidators: true
        }
    );
};

const PPCMetrics = mongoose.model("PPCMetrics", ppcMetricsSchema);

module.exports = PPCMetrics;


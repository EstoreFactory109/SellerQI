const mongoose = require('mongoose');

// Schema for individual search term data
const searchTermSchema = new mongoose.Schema({
    date: {
        type: Date,
        required: true
    },
    searchTerm: {
        type: String,
        required: true,
        index: true
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
        required: true
    },
    adGroupName: {
        type: String,
        required: true
    },
    advertisedAsin: {
        type: String,
        required: true
    },
    advertisedSku: {
        type: String
    },
    impressions: {
        type: Number,
        default: 0
    },
    clicks: {
        type: Number,
        default: 0
    },
    cost: {
        type: Number,
        default: 0
    },
    purchasesIn1Day: {
        type: Number,
        default: 0
    },
    purchasesIn7Days: {
        type: Number,
        default: 0
    },
    purchasesIn14Days: {
        type: Number,
        default: 0
    },
    purchasesIn30Days: {
        type: Number,
        default: 0
    },
    salesIn1Day: {
        type: Number,
        default: 0
    },
    salesIn7Days: {
        type: Number,
        default: 0
    },
    salesIn14Days: {
        type: Number,
        default: 0
    },
    salesIn30Days: {
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
    conversionRate: {
        type: Number,
        default: 0
    },
    cpc: {
        type: Number,
        default: 0
    }
}, { _id: false });

// Main schema for auto campaign search terms
const autoCampaignSearchTermsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
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
        enum: ['NA', 'EU', 'FE']
    },
    reportDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    totalSearchTerms: {
        type: Number,
        required: true
    },
    highPerformingTerms: {
        type: Number,
        required: true
    },
    searchTerms: [searchTermSchema]
}, {
    timestamps: true
});

// Compound index for efficient queries
autoCampaignSearchTermsSchema.index({ userId: 1, country: 1, reportDate: -1 });

// Virtual for calculating overall metrics
autoCampaignSearchTermsSchema.virtual('overallMetrics').get(function() {
    if (!this.searchTerms || this.searchTerms.length === 0) {
        return {
            totalSpend: 0,
            totalSales7d: 0,
            totalClicks: 0,
            totalImpressions: 0,
            averageAcos: 0,
            averageRoas: 0,
            averageCpc: 0
        };
    }

    const totalSpend = this.searchTerms.reduce((sum, term) => sum + term.cost, 0);
    const totalSales7d = this.searchTerms.reduce((sum, term) => sum + term.salesIn7Days, 0);
    const totalClicks = this.searchTerms.reduce((sum, term) => sum + term.clicks, 0);
    const totalImpressions = this.searchTerms.reduce((sum, term) => sum + term.impressions, 0);
    
    const validAcosTerms = this.searchTerms.filter(term => term.acos > 0);
    const averageAcos = validAcosTerms.length > 0 
        ? validAcosTerms.reduce((sum, term) => sum + term.acos, 0) / validAcosTerms.length 
        : 0;
    
    const validRoasTerms = this.searchTerms.filter(term => term.roas > 0);
    const averageRoas = validRoasTerms.length > 0 
        ? validRoasTerms.reduce((sum, term) => sum + term.roas, 0) / validRoasTerms.length 
        : 0;

    return {
        totalSpend: totalSpend.toFixed(2),
        totalSales7d: totalSales7d.toFixed(2),
        totalClicks,
        totalImpressions,
        averageAcos: averageAcos.toFixed(2),
        averageRoas: averageRoas.toFixed(2),
        averageCpc: totalClicks > 0 ? (totalSpend / totalClicks).toFixed(2) : 0
    };
});

// Method to get top performing search terms
autoCampaignSearchTermsSchema.methods.getTopPerformingTerms = function(limit = 10) {
    return this.searchTerms
        .sort((a, b) => b.salesIn7Days - a.salesIn7Days)
        .slice(0, limit);
};

// Method to get search terms with high ACOS
autoCampaignSearchTermsSchema.methods.getHighAcosTerms = function(threshold = 50) {
    return this.searchTerms.filter(term => term.acos > threshold);
};

// Static method to find latest report for a user and country
autoCampaignSearchTermsSchema.statics.findLatestReport = function(userId, country) {
    return this.findOne({ userId, country })
        .sort({ reportDate: -1 })
        .exec();
};

const AutoCampaignSearchTermsModel = mongoose.model('AutoCampaignSearchTerms', autoCampaignSearchTermsSchema);

module.exports = AutoCampaignSearchTermsModel;

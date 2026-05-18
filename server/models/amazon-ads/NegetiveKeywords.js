const mongoose = require('mongoose');

const negativeKeywordsSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    region: { type: String, required: true },
    country: { type: String, required: true },
    metricDate: { type: String, required: false, index: true },
    negativeKeywordsData: [
        {
            campaignId: { type: String, required: true },
            adGroupId: { type: String, required: true },
            keywordId: { type: String, required: true },
            keywordText: { type: String, required: true },
            state: { type: String, default: "enabled" },
        }
    ]
}, {timestamps: true});

// Compound index for efficient queries
negativeKeywordsSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
negativeKeywordsSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1 },
    {
        unique: true,
        partialFilterExpression: { metricDate: { $exists: true, $type: 'string' } }
    }
);

const NegativeKeywords = mongoose.model('NegativeKeywords', negativeKeywordsSchema);

module.exports = NegativeKeywords;
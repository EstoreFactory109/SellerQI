const mongoose = require('mongoose');

const negativeKeywordsSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    region: { type: String, required: true },
    country: { type: String, required: true },
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

const NegativeKeywords = mongoose.model('NegativeKeywords', negativeKeywordsSchema);

module.exports = NegativeKeywords;
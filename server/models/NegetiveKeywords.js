const mongoose = require('mongoose');

const negetiveKeywordsSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    region: { type: String, required: true },
    country: { type: String, required: true },
    negetiveKeywordsData: [
        {
            campaignId: { type: String, required: true },
            adGroupId: { type: String, required: true },
            keywordId: { type: String, required: true },
            keywordText: { type: String, default: Date.now },
            state: { type: String, default: "enabled" },
        }
    ]
});

const NegetiveKeywords = mongoose.model('NegetiveKeywords', negetiveKeywordsSchema);

module.exports = NegetiveKeywords;
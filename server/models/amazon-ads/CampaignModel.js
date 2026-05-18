const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
   userId: {
    type: String,
    required: true
   },
   country: {
    type: String,
    required: true
   },
   region: {
    type: String,
    required: true
   },
   /** YYYY-MM-DD snapshot day (UTC yesterday when synced). */
   metricDate: {
    type: String,
    required: false,
    index: true
   },
   campaignData: [
    {
        campaignId: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        // Amazon SP v3 (`/sp/campaigns/list`) no longer returns the legacy
        // v2 fields `campaignType`, `premiumBidAdjustment`, or `dailyBudget`.
        // Keep them on the schema so legacy docs still hydrate, but don't
        // require them — the mapper in GetCampaigns.js projects what it can.
        campaignType: {
            type: String,
            required: false
        },
        targetingType: {
            type: String,
            required: true
        },
        premiumBidAdjustment: {
            type: String,
            required: false
        },
        dailyBudget: {
            type: Number,
            required: false
        },
        startDate: {
            type: String,
            required: true
        },
        state: {
            type: String,
            required: true
        },
    },
   ]
},{
    timestamps: true
});

// Compound index for efficient queries
campaignSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
campaignSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1 },
    {
        unique: true,
        partialFilterExpression: { metricDate: { $exists: true, $type: 'string' } }
    }
);

const Campaign = mongoose.model('Campaign', campaignSchema);

module.exports = Campaign;
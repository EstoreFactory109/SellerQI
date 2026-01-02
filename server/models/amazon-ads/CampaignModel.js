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
        campaignType:{
            type: String,
            required: true
        },
        targetingType:{
            type: String,
            required: true
        },
        premiumBidAdjustment:{
            type: String,
            required: true
        },
        dailyBudget:{
            type: Number,
            required: true
        },
        startDate:{
            type: String,
            required: true
        },
        state:{
            type: String,
            required: true
        },
        
    }
   ]
},{
    timestamps: true
});

// Compound index for efficient queries
campaignSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });

const Campaign = mongoose.model('Campaign', campaignSchema);

module.exports = Campaign;
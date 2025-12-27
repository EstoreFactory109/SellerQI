const mongoose = require('mongoose');

const adsKeywordsPerformanceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    region: {
        type: String,
        required: true
    },
    country: {
        type: String,
        required: true
    },
    keywordsData: [{
        date: {
            type: String,
            required: false,
            default: null
        },
        keywordId: {
            type:Number,
            required:true
        },
        attributedSales30d:{
            type:Number,
            required:true
        },
        cost: {
            type:Number,
            required:true
        },
        adGroupName: {
            type:String,
            required:true
        },
        matchType: {
            type:String,
            required:true
        },
        campaignId: {
            type:Number,
            required:true
        },
        clicks: {
            type:Number,
            required:true
        },
        impressions: {
            type:Number,
            required:true
        },
        keyword: {
            type:String,
            required:true
        },
        campaignName: {
            type:String,
            required:true
        },
        adGroupId: {
            type:Number,
            required:true
        }
    }]
}, { timestamps: true });

const adsKeywordsPerformanceModel = mongoose.model('adsKeywordsPerformance', adsKeywordsPerformanceSchema);

module.exports = adsKeywordsPerformanceModel;
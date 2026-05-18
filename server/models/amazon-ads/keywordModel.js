const mongoose = require('mongoose');

const keywordSchema = new mongoose.Schema({
    userId:{
        type:String,
        required:true
    },
    country:{
        type:String,
        required:true
    },
    region:{
        type:String,
    },
    /** YYYY-MM-DD snapshot day (UTC yesterday when synced). */
    metricDate: {
        type: String,
        required: false,
        index: true
    },
    keywordData:[
        {
            keywordId:{
                type:String,
                required:true
            },
            adGroupId:{
                type:String,
                required:true
            },
            campaignId:{
                type:String,
                required:true
            },
            keywordText:{
                type:String,
                required:true
            },
            matchType:{
                type:String,
                required:true
            },
            bid:{
                type:Number,
            },
            state:{
                type:String,
                required:true
            }
        }
    ]
}, {timestamps: true});

// Compound index for efficient queries
keywordSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
keywordSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1 },
    {
        unique: true,
        partialFilterExpression: { metricDate: { $exists: true, $type: 'string' } }
    }
);

module.exports = mongoose.model('Keyword', keywordSchema);
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
})

module.exports = mongoose.model('Keyword', keywordSchema);
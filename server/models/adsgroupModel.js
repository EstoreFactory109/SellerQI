const mongoose = require('mongoose');

const adsgroupSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    country: {
        type: String,
        required: true
    },
    region:{
        type: String,
        required: true
    },
    adsGroupData:[{
        adGroupId: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        campaignId: {
            type: String,
            required: true
        },
        defaultBid: {
            type: Number,
            required: true
        },
        state: {
            type: String,
            required: true
        }
    }]
},{timestamps:true})

const AdsGroup = mongoose.model('AdsGroup', adsgroupSchema);

module.exports = AdsGroup;
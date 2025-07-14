const mongoose = require("mongoose");

const getDateWiseSpendsKeywordsSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
    country: {
        type: String,
        required: true,
    },
    region: {
        type: String,
        required: true,
    },
    dateWisePPCSpends:[{
        date: {
            type: Date,
            required: true,
        },
        cost: {
            type: Number,
            required: true,
        },
        campaignId:{
            type: String,
            required: true,
        },
        campaignName:{
            type: String,
            required: true,
        },
        clicks:{
            type: Number,
            required: true,
        },
        impressions:{
            type: Number,
            required: true,
        }
    }]
},{timestamps:true});

const GetDateWiseSpendsKeywords = mongoose.model("GetDateWiseSpendsKeywords", getDateWiseSpendsKeywordsSchema);
module.exports = GetDateWiseSpendsKeywords;
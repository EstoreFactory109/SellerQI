const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FBAFeesSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    country: {
        type: String,
    },
    region: {
        type: String,
    },
    storageData:[{
        asin:{
            type: String,
            required: true,
        },
        ProductName:{
            type: String,
            required: true,
        },
        weight:{
            type: Number,
            required: true,
        },
        weightUnit:{
            type: String,
            required: true,
        },
        itemVolume:{
            type: Number,
            required: true,
        },
        itemVolumeUnit:{
            type: String,
            required: true,
        },
        averageQuantityInHand:{
            type: Number,
            required: true,
        },
        averageQuantityPendingRemoval:{
            type: Number,
            required: true,
        },
        estimatedTotatItemVolume:{
            type: Number,
            required: true,
        },
        storageUtilization:{
            type: Number,
            required: true,
        },
        storageUtilizationUnit:{
            type: String,
            required: true,
        },
        averageQuantityForSus:{
            type: Number,
            required: true,
        },
        EstBaseMsf:{
            type: Number,
            required: true,
        },
        EstSus:{
            type: Number,
            required: true,
        },
        estimatedMonthlyStorageFee:{
            type: Number,
            required: true,
        },
        monthOfFees:{
            type: String,
            required: true,
        },
       totalInsentiveFeeAmt:{
        type: Number,
        required: true,
       },
       breakdownInsentiveFeeAMt:{
        type: Number,
        required: true,
       },
       
       
    }]
})
const mongoose = require('mongoose');

const IPTrackingSchema = new mongoose.Schema({
    ip: {
        type: String,
        required: true,
    },
    searchesLeft:{
        type: Number,
        default: 3,
    },
    renewalDate:{
        type: Date,
        default:() => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
},{timestamps:true})

const IPTrackingModel = mongoose.model('IPTracking', IPTrackingSchema);

module.exports = IPTrackingModel;
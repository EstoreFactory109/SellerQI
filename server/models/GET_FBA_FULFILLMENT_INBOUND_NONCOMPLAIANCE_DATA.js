const mongoose = require('mongoose');

const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Schema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    country: { type: String, required: true },
    region:{type:String,required:true},
    ErrorData:[{
        issueReportedDate: { type: String, required: true },
        shipmentCreationDate: { type: String, required: true },
        asin: { type: String, required: true },
        problemType: { type: String, required: true },
    }]
}, { timestamps: true });

module.exports = mongoose.model('GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA', GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Schema);
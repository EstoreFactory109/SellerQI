const mongoose = require('mongoose');

// Subschema for product-wise data
const productWiseDataSchema = new mongoose.Schema({
    asin: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true
    },
    FBAFees: {
        type: Number,
        default: 0
    },
    Refunds: {
        type: Number,
        default: 0
    },
    ProductsAdsPayments: {
        type: Number,
        default: 0
    },
    Shipment: {
        type: Number,
        default: 0
    },
    Adjustment: {
        type: Number,
        default: 0
    },
    AmazonFees: {
        type: Number,
        default: 0
    },
    DebtRecovery: {
        type: Number,
        default: 0
    },
    Storage: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Main schema
const productWiseFinancialSchema = new mongoose.Schema({
    userid: {
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
    financialData: [{
        type: productWiseDataSchema
    }]
}, {
    timestamps: true
});

// Create and export the model
const ProductWiseFinancial = mongoose.model('ProductWiseFinancial', productWiseFinancialSchema);

module.exports = ProductWiseFinancial;

const mongoose = require('mongoose');

const OrderAndRevenueSchema = new mongoose.Schema({
    User: {
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
    RevenueData: [{
        amazonOrderId: {
            type: String,
            required: true
        },
        orderDate: {
            type: Date,
            required: true
        },
        orderStatus: {
            type: String,
            required: true
        },
        productName: {
            type: String,
            required: true
        },
        asin: {
            type: String,
            required: true
        },
        sku: {
            type: String,
            required: true
        },
        itemPrice: {
            type: Number,
            required: true
        },
        quantity: {
            type: Number,
            required: true
        },
        itemTax: {
            type: Number,
            required: false
        },
        shippingPrice: {
            type: Number,
            required: false
        },
        shippingTax: {
            type: Number,
            required: false
        },
        giftWrapPrice: {
            type: Number,
            required: false
        },
        giftWrapTax: {
            type: Number,
            required: false
        },
        itemPromotionDiscount: {
            type: Number,
            required: false
        },
        shippingPromotionDiscount: {
            type: Number,
            required: false
        },
    }]


}, { timestamps: true })

module.exports = mongoose.model('OrderAndRevenue', OrderAndRevenueSchema);
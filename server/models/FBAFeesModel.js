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
    fbaData:[{
        asin:{
            type: String,
            required: true,
        },
        ShipmentDate:{
            type: String,
            required: true,
        },
        quantity:{
            type: Number,
            required: true,
        },
        itemPricePerUnit:{
            type: Number,
            required: true,
        },
        shippingPrice:{
            
        }
    }]
})
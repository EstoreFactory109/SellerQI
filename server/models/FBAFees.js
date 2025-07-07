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
    FbaData:[{
        asin:{
            type: String,
            required: true,
        },
        fees:{
            type: Object,
            required: true,
        },
       
    }]
})

const FBAFeesModel = mongoose.model('FBAFees', FBAFeesSchema);

module.exports = FBAFeesModel;

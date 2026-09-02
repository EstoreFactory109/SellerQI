const mongoose = require("mongoose");

const dataSchema = new mongoose.Schema({
    asin: {
        type: String,
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    snapShotDate: {
        type: String,
        required: true
    },
    quantity: {
        type: String,
        required: true
    },
    amount: {
        type: String,
        required: true
    },
    volume: {
        type: String,
        required: true
    },
    surCharge:{
        type: String,
        required: true
    },
    rate_surCharge:{
        type: String,
        required: true
    }
},{timestamps:true})

// Define the schema
const LongTermStorageFeesSchema = new mongoose.Schema(
    {
        User: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            require: true
        },
        region: {
            type: String,
            require: true
        },
        country: {
            type: String,
            require: true
        },
        data:[dataSchema]
    },
    { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// Create the model
const LongTermStorageFees = mongoose.model("LONG_TERM_STORAGE_FEE_CHARGES_DATA", LongTermStorageFeesSchema);

module.exports = LongTermStorageFees;

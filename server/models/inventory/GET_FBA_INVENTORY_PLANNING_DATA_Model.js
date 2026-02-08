const mongoose = require("mongoose");

const dataSchema = new mongoose.Schema({
    asin: {
        type: String,
        required: true
    },
    quantity_to_be_charged_ais_181_210_days: {
        type: String,
        required: true
    },
    quantity_to_be_charged_ais_211_240_days: {
        type: String,
        required: true
    },
    quantity_to_be_charged_ais_241_270_days: {
        type: String,
        required: true
    },
    quantity_to_be_charged_ais_271_300_days: {
        type: String,
        required: true
    },
    quantity_to_be_charged_ais_301_330_days: {
        type: String,
        required: true
    },
    quantity_to_be_charged_ais_331_365_days: {
        type: String,
        required: true
    },
    quantity_to_be_charged_ais_365_plus_days: {
        type: String,
        required: true
    },
    unfulfillable_quantity: {
        type: String,
        required: true
    }
},{timestamps:true})

// Define the schema
const GET_FBA_INVENTORY_PLANNING_DATA_Schema = new mongoose.Schema(
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

// Compound index for efficient queries by User, country, region and sorted by createdAt
GET_FBA_INVENTORY_PLANNING_DATA_Schema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

// Create the model
const Seller = mongoose.model("GET_FBA_INVENTORY_PLANNING_DATA", GET_FBA_INVENTORY_PLANNING_DATA_Schema);

module.exports = Seller;

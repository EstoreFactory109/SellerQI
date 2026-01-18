const mongoose = require("mongoose");

const TotalProductsBasedOnDate = new mongoose.Schema({
    NumberOfProducts: {
        type: Number,
        required: true
    }
}, { timestamps: true });

const Products = new mongoose.Schema({
    asin: {
        type: String,
        required: true,
    },
    sku: {
        type: String,
        required: true
    },
    price: {
        type: String,
        required: true
    },
    status: {
        type: String,
        required: true
    },
    issues: {
        type: [String],
        required: false,
        default: undefined
    }
}, { timestamps: true });

const agencyCentral = new mongoose.Schema({
    clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    selling_partner_id: {
        type: String,
        unique: true,
    },
    brand: {
        type: String,
        required: false
    },
    spiRefreshToken: {
        type: String,
        required: false,
    },
    adsRefreshToken: {
        type: String,
        required: false,
    },
    ProfileId: {
        type: String,
        required: false,
    },
    country: {
        type: String,
        required: false,
    },
    region: {
        type: String,
        required: false,
        enum: ["NA", "EU", "FE"], // North America, Europe, Far East
    },
    products: [Products],
    TotalProducts: [TotalProductsBasedOnDate]
}, { timestamps: true });

// Define the schema
const AgencySellerSchema = new mongoose.Schema(
    {
        User: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        agencyAccount: [agencyCentral]
    },
    { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

// **🛡️ Hash Refresh Token Before Storing**

// Create the model
const AgencySeller = mongoose.model("AgencySeller", AgencySellerSchema);

module.exports = AgencySeller;

const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
    // Core identifiers
    asin: {
        type: String,
        required: true,
      },
    fnsku: {
        type: String,
        default: ""
    },
    merchantSku: {
        type: String,
        default: ""
    },
    
    // Product info
    productName: {
        type: String,
        default: ""
    },
    condition: {
        type: String,
        default: ""
    },
    
    // Supplier info
    supplier: {
        type: String,
        default: ""
    },
    supplierPartNo: {
        type: String,
        default: ""
    },
    
    // Pricing
    currencyCode: {
        type: String,
        default: ""
    },
    price: {
        type: String,
        default: "0"
    },
    
    // Sales metrics
    salesLast30Days: {
        type: String,
        default: "0"
    },
    unitsSoldLast30Days: {
        type: String,
        default: "0"
    },
    
    // Inventory quantities
    totalUnits: {
        type: String,
        default: "0"
    },
    inbound: {
        type: String,
        default: "0"
    },
    available: {
        type: String,
        default: "0"
    },
    fcTransfer: {
        type: String,
        default: "0"
    },
    fcProcessing: {
        type: String,
        default: "0"
    },
    customerOrder: {
        type: String,
        default: "0"
    },
    unfulfillable: {
        type: String,
        default: "0"
    },
    working: {
        type: String,
        default: "0"
    },
    shipped: {
        type: String,
        default: "0"
    },
    receiving: {
        type: String,
        default: "0"
    },
    
    // Fulfillment
    fulfilledBy: {
        type: String,
        default: ""
    },
    
    // Days of supply
    totalDaysOfSupply: {
        type: String,
        default: ""
    },
    daysOfSupplyAtAmazon: {
        type: String,
        default: ""
    },
    
    // Alerts and recommendations
    alert: {
        type: String,
        default: ""
    },
    recommendedReplenishmentQty: {
        type: String,
        default: "0"
    },
    recommendedShipDate: {
        type: String,
        default: ""
    },
    
    // Storage
    unitStorageSize: {
        type: String,
        default: ""
      }
});

// Define the schema
const RestockInventoryRecommendationsSchema = new mongoose.Schema(
  {
        User: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
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
        Products: [productSchema]
  },
  { timestamps: true } // CreatedAt & UpdatedAt automatically managed
);

module.exports = mongoose.model("RestockInventoryRecommendations", RestockInventoryRecommendationsSchema);

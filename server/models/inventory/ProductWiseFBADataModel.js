const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Subschema for FBA data array items - using exact field names from the report
const fbaDataProductWiseSchema = new Schema({
  asin: {
    type: String,
    required: false,
    default: ""
  },
  sku: {
    type: String,
    required: false,
    default: ""
  },
  fnsku: {
    type: String,
    required: false,
    default: ""
  },
  "amazon-store": {
    type: String,
    required: false,
    default: ""
  },
  "product-name": {
    type: String,
    required: false,
    default: ""
  },
  "product-group": {
    type: String,
    required: false,
    default: ""
  },
  brand: {
    type: String,
    required: false,
    default: ""
  },
  "fulfilled-by": {
    type: String,
    required: false,
    default: ""
  },
  "your-price": {
    type: String,
    required: false,
    default: "0.00"
  },
  "sales-price": {
    type: String,
    required: false,
    default: "0.00"
  },
  "longest-side": {
    type: String,
    required: false,
    default: ""
  },
  "median-side": {
    type: String,
    required: false,
    default: ""
  },
  "shortest-side": {
    type: String,
    required: false,
    default: ""
  },
  "length-and-girth": {
    type: String,
    required: false,
    default: ""
  },
  "unit-of-dimension": {
    type: String,
    required: false,
    default: ""
  },
  "item-package-weight": {
    type: String,
    required: false,
    default: ""
  },
  "unit-of-weight": {
    type: String,
    required: false,
    default: ""
  },
  "product-size-tier": {
    type: String,
    required: false,
    default: ""
  },
  currency: {
    type: String,
    required: false,
    default: ""
  },
  "estimated-fee-total": {
    type: String,
    required: false,
    default: "0.00"
  },
  "estimated-referral-fee-per-unit": {
    type: String,
    required: false,
    default: "0.00"
  },
  "estimated-variable-closing-fee": {
    type: String,
    required: false,
    default: "0.00"
  },
  "estimated-pick-pack-fee-per-unit": {
    type: String,
    required: false,
    default: "0.00"
  },
  "estimated-weight-handling-fee-per-unit": {
    type: String,
    required: false,
    default: "--"
  }
}, { 
  _id: false, // _id: false to avoid creating separate ids for subdocuments
  strict: false // Allow additional fields that might be in the report
}); // This allows any additional fields from the report to be stored

// Main schema
const productWiseFBADataSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  country: {
    type: String,
    required: true,
    trim: true
  },
  region: {
    type: String,
    required: true,
    trim: true
  },
  fbaData: {
    type: [fbaDataProductWiseSchema],
    default: []
  }
}, {
  timestamps: true
});

// Add indexes for better query performance

// Create and export the model
const ProductWiseFBAData = mongoose.model('ProductWiseFBAData', productWiseFBADataSchema);

module.exports = ProductWiseFBAData;

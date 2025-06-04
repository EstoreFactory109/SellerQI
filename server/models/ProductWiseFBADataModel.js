const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Subschema for FBA data array items
const fbaDataProductWiseSchema = new Schema({
  asin: {
    type: String,
    required: true,
  },
  totalFba: {
    type: String,
    required: true,
    default: "0"
  },
  totalAmzFee: {
    type: String,
    required: true,
    default: "0"
  }
}, { _id: false }); // _id: false to avoid creating separate ids for subdocuments

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

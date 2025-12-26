const mongoose = require("mongoose");

// Sub-schema for individual COGS entries
const CogsEntrySchema = new mongoose.Schema({
  asin: {
    type: String,
    required: true,
  },
  sku: {
    type: String,
    required: false,
  },
  cogs: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

// Main COGS schema
const CogsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    country: {
      type: String,
      required: false,
    },
    countryCode: {
      type: String,
      required: false,
      default: "US",
    },
    region: {
      type: String,
      required: false,
      // Allow any region or null
    },
    cogsEntries: [CogsEntrySchema],
  },
  {
    timestamps: true,
  }
);

// Create compound index for userId + countryCode to ensure unique per user per marketplace
// Use sparse option to allow null values
CogsSchema.index({ userId: 1, countryCode: 1 }, { unique: true, sparse: true });

// Create index on cogsEntries.asin for faster lookups
CogsSchema.index({ "cogsEntries.asin": 1 });

const Cogs = mongoose.model("Cogs", CogsSchema);

module.exports = Cogs;

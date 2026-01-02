const mongoose = require('mongoose');

// Subschema for Product-wise Sponsored Ads
const ProductWiseSponsoredAdsSchema = new mongoose.Schema({
  date: {
    type: String,
    required: true
  },
  asin: {
    type: String,
    required: true
  },
  spend: {
    type: Number,
    required: true,
    default: 0
  },
  salesIn7Days: {
    type: Number,
    required: true,
    default: 0
  },
  salesIn14Days: {
    type: Number,
    required: true,
    default: 0
  },
  salesIn30Days: {
    type: Number,
    required: true,
    default: 0
  },
  campaignId: {
    type: String,
    required: true
  },
  campaignName: {
    type: String,
    required: true
  },
  impressions: {
    type: Number,
    required: true,
    default: 0
  },
  adGroupId: {
    type: String,
    required: true
  },
  clicks: {
    type: Number,
    required: true,
    default: 0
  },
  purchasedIn7Days: {
    type: Number,
    required: true,
    default: 0
  },
  purchasedIn14Days: {
    type: Number,
    required: true,
    default: 0
  },
  purchasedIn30Days: {
    type: Number,
    required: true,
    default: 0
  }
}, {
  timestamps: true
});

// Main schema for Product-wise Sponsored Ads Data
const ProductWiseSponsoredAdsDataSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  country: {
    type: String,
    required: true
  },
  region: {
    type: String,
    required: true
  },
  sponsoredAds: [ProductWiseSponsoredAdsSchema]
}, {
  timestamps: true
});

// Compound index for efficient queries with userId, country, region, and createdAt
// This significantly speeds up the common query pattern used in Analyse.js
ProductWiseSponsoredAdsDataSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });

// Create and export the model
const ProductWiseSponsoredAdsData = mongoose.model('ProductWiseSponsoredAdsData', ProductWiseSponsoredAdsDataSchema);

module.exports = ProductWiseSponsoredAdsData; 
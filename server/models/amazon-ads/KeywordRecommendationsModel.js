const mongoose = require('mongoose');

// Sub-schema for suggested bid range
const suggestedBidSchema = new mongoose.Schema({
  rangeStart: {
    type: Number
  },
  rangeMedian: {
    type: Number
  },
  rangeEnd: {
    type: Number
  }
}, { _id: false });

// Sub-schema for bid info
const bidInfoSchema = new mongoose.Schema({
  matchType: {
    type: String,
    enum: ['BROAD', 'PHRASE', 'EXACT']
  },
  theme: {
    type: String
  },
  rank: {
    type: Number
  },
  bid: {
    type: Number
  },
  suggestedBid: {
    type: suggestedBidSchema
  }
}, { _id: false });

// Sub-schema for keyword target
const keywordTargetSchema = new mongoose.Schema({
  keyword: {
    type: String,
    required: true
  },
  bidInfo: {
    type: [bidInfoSchema],
    default: []
  },
  translation: {
    type: String
  },
  userSelectedKeyword: {
    type: Boolean,
    default: false
  },
  searchTermImpressionRank: {
    type: Number
  },
  searchTermImpressionShare: {
    type: Number
  },
  recId: {
    type: String
  }
}, { _id: false });

// NEW: ASIN-wise keyword recommendations schema
const asinKeywordRecommendationsSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  country: {
    type: String,
    required: true,
    index: true
  },
  region: {
    type: String,
    required: true,
    index: true
  },
  asin: {
    type: String,
    required: true,
    index: true
  },
  keywordTargetList: {
    type: [keywordTargetSchema],
    default: []
  },
  totalKeywords: {
    type: Number,
    default: 0
  },
  fetchedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
asinKeywordRecommendationsSchema.index({ userId: 1, country: 1, region: 1, asin: 1 }, { unique: true });

// Static method to find by ASIN
asinKeywordRecommendationsSchema.statics.findByAsin = function(userId, country, region, asin) {
  return this.findOne({ userId, country, region, asin });
};

// Static method to find all ASINs for a user
asinKeywordRecommendationsSchema.statics.findAllForUser = function(userId, country, region) {
  return this.find({ userId, country, region }).sort({ createdAt: -1 });
};

// Static method to upsert (update or insert) ASIN keyword data
asinKeywordRecommendationsSchema.statics.upsertAsinKeywords = async function(userId, country, region, asin, keywordTargetList) {
  return this.findOneAndUpdate(
    { userId, country, region, asin },
    { 
      userId,
      country,
      region,
      asin,
      keywordTargetList,
      totalKeywords: keywordTargetList.length,
      fetchedAt: new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const AsinKeywordRecommendations = mongoose.model('AsinKeywordRecommendations', asinKeywordRecommendationsSchema);

// ============ LEGACY MODEL (keep for backward compatibility) ============

// Main schema (legacy - keeps all keywords together)
const keywordRecommendationsSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  country: {
    type: String,
    required: true
  },
  region: {
    type: String,
    required: true
  },
  keywordRecommendationData: {
    keywordTargetList: {
      type: [keywordTargetSchema],
      default: []
    }
  }
}, {
  timestamps: true
});

const KeywordRecommendations = mongoose.model('KeywordRecommendations', keywordRecommendationsSchema);

module.exports = {
  KeywordRecommendations,
  AsinKeywordRecommendations
};

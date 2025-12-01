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

// Main schema
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

module.exports = KeywordRecommendations;


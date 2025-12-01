const mongoose = require('mongoose');

const searchTermsSchema = new mongoose.Schema({
  userId: {
    type: String,
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
  searchTermData:[{
    campaignId: {
      type: String,
      required: true
    },
    campaignName: {
      type: String,
      required: true
    },
    searchTerm: {
      type: String,
      required: true
    },
    keyword: {
      type: String,
      required: true
    },
    clicks:{
        type: Number,
        required: true
    },
    sales:{
        type: Number,
        required: true
    },
    spend:{
        type: Number,
        required: true
    }
  }]
},{timestamps: true});

const SearchTerms = mongoose.model('SearchTerms', searchTermsSchema);

module.exports = SearchTerms;
const mongoose = require('mongoose');
const { toYyyyMmDd } = require('../../utils/metricDateKey.js');

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
  /** YYYY-MM-DD when this document holds one day of search term rows. */
  metricDate: {
    type: String,
    required: false,
    index: true
  },
  searchTermData:[{
    date: {
      type: String,
      required: false,
      default: null
    },
    campaignId: {
      type: String,
      required: true
    },
    campaignName: {
      type: String,
      required: true
    },
    adGroupId: {
      type: String,
      required: false
    },
    adGroupName: {
      type: String,
      required: false
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
    },
    impressions: {
      type: Number,
      required: false,
      default: 0
    }
  }]
},{timestamps: true});

searchTermsSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
searchTermsSchema.index(
  { userId: 1, country: 1, region: 1, metricDate: 1 },
  {
    unique: true,
    partialFilterExpression: { metricDate: { $exists: true, $type: 'string' } }
  }
);

searchTermsSchema.statics.findMergedSearchTermData = async function(userId, country, region, options = {}) {
  const userIdStr = userId?.toString?.() || String(userId);
  const { startDate, endDate } = options;
  const startStr = toYyyyMmDd(startDate);
  const endStr = toYyyyMmDd(endDate);

  const dailyQuery = {
    userId: userIdStr,
    country,
    region,
    metricDate: { $exists: true, $type: 'string', $ne: null }
  };
  if (startStr && endStr) {
    dailyQuery.metricDate = { $gte: startStr, $lte: endStr };
  }

  const dailyDocs = await this.find(dailyQuery).sort({ metricDate: 1 }).lean();
  if (dailyDocs.length > 0) {
    return dailyDocs.flatMap((d) => d.searchTermData || []);
  }

  const legacy = await this.findOne({
    userId: userIdStr,
    country,
    region,
    $or: [{ metricDate: { $exists: false } }, { metricDate: null }]
  })
    .sort({ createdAt: -1 })
    .lean();

  return legacy?.searchTermData || [];
};

searchTermsSchema.statics.upsertSearchTermsForDate = async function(userId, country, region, metricDate, searchTermData) {
  const userIdStr = userId?.toString?.() || String(userId);
  return this.findOneAndUpdate(
    { userId: userIdStr, country, region, metricDate },
    {
      $set: {
        userId: userIdStr,
        country,
        region,
        metricDate,
        searchTermData: searchTermData || []
      }
    },
    { upsert: true, new: true, runValidators: true }
  );
};

const SearchTerms = mongoose.model('SearchTerms', searchTermsSchema);

module.exports = SearchTerms;

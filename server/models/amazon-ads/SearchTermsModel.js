const mongoose = require('mongoose');
const { toYyyyMmDd, shiftMetricDateKey } = require('../../utils/metricDateKey.js');

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

/**
 * Merge per-day documents for an optional window.
 *
 * See findMergedKeywordsData in adsKeywordsPerformanceModel.js for the full rationale behind
 * `lookbackDays` — this collection has the identical shape (one doc per account per day, no TTL)
 * and the identical unbounded-growth problem when callers pass `{}`.
 *
 * Precedence: explicit startDate+endDate > lookbackDays > unbounded (legacy behaviour).
 */
searchTermsSchema.statics.findMergedSearchTermData = async function(userId, country, region, options = {}) {
  const userIdStr = userId?.toString?.() || String(userId);
  const { startDate, endDate, lookbackDays } = options;
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
  } else if (Number.isFinite(lookbackDays) && lookbackDays > 0) {
    // Anchored to the newest day this account HAS, not to today — the pipeline lags, and a
    // today-anchored window would blank the dashboard for any account a few days behind.
    const newest = await this.findOne(dailyQuery)
      .sort({ metricDate: -1 })
      .select('metricDate')
      .lean();
    const anchor = toYyyyMmDd(newest?.metricDate);
    // No anchor => no per-day rows; stay unbounded so the legacy fallback below is reached.
    if (anchor) {
      const windowStart = shiftMetricDateKey(anchor, -(lookbackDays - 1));
      if (windowStart) {
        dailyQuery.metricDate = { $gte: windowStart, $lte: anchor };
      }
    }
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

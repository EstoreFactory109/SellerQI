const mongoose = require('mongoose');

/**
 * SalesOnlyMetricsModel
 *
 * Stores ONE document per day per user/country/region.
 * No pre-calculated totals - all aggregations happen at query time in the database.
 *
 * This design allows fast date-range queries via indexed aggregation.
 */

const monetaryAmountSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, default: 0 },
    currencyCode: { type: String, required: true, default: 'USD' },
  },
  { _id: false }
);

const salesOnlyMetricsSchema = new mongoose.Schema(
  {
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    region: {
      type: String,
      required: true,
      enum: ['NA', 'EU', 'FE'],
      index: true,
    },
    country: {
      type: String,
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      index: true,
    },

    sales: { type: monetaryAmountSchema, required: true },
    grossProfit: {
      type: monetaryAmountSchema,
      required: true,
      default: { amount: 0, currencyCode: 'USD' },
    },
    unitsSold: { type: Number, required: false, default: 0 },

    dataSource: { type: String, enum: ['DataKiosk'], default: 'DataKiosk' },
  },
  { timestamps: true }
);

salesOnlyMetricsSchema.index(
  { User: 1, country: 1, region: 1, date: 1 },
  { unique: true }
);
salesOnlyMetricsSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

/**
 * Find all daily docs for a user/country/region within a date range.
 * Returns array sorted by date ascending.
 */
salesOnlyMetricsSchema.statics.findByDateRange = function (
  userId,
  region,
  country,
  startDate,
  endDate
) {
  return this.find({
    User: userId,
    region,
    country,
    date: { $gte: startDate, $lte: endDate },
  }).sort({ date: 1 });
};

/**
 * Get total sales for a date range using database aggregation.
 * All calculations happen in MongoDB, not JavaScript.
 * Returns { totalSales, currencyCode, datewiseSales[], dateRange }
 */
salesOnlyMetricsSchema.statics.getSalesForDateRange = async function (
  userId,
  region,
  country,
  startDate,
  endDate
) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const result = await this.aggregate([
    {
      $match: {
        User: userObjectId,
        region,
        country,
        date: { $gte: startDate, $lte: endDate },
      },
    },
    { $sort: { date: 1 } },
    {
      $group: {
        _id: null,
        totalSales: { $sum: '$sales.amount' },
        currencyCode: { $first: '$sales.currencyCode' },
        count: { $sum: 1 },
        datewiseSales: {
          $push: {
            date: '$date',
            sales: '$sales',
            grossProfit: '$grossProfit',
            unitsSold: '$unitsSold',
          },
        },
        minDate: { $min: '$date' },
        maxDate: { $max: '$date' },
      },
    },
  ]);

  if (!result || result.length === 0) {
    return {
      totalSales: { amount: 0, currencyCode: 'USD' },
      datewiseSales: [],
      dateRange: { startDate, endDate },
    };
  }

  const r = result[0];
  return {
    totalSales: { amount: r.totalSales, currencyCode: r.currencyCode || 'USD' },
    datewiseSales: r.datewiseSales,
    dateRange: { startDate: r.minDate, endDate: r.maxDate },
  };
};

/**
 * Get recent data for a user/country/region using database aggregation.
 * First finds the most recent date, then aggregates data for the last N days.
 * All calculations happen in MongoDB.
 */
salesOnlyMetricsSchema.statics.getRecentDays = async function (
  userId,
  region,
  country,
  days = 31
) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const result = await this.aggregate([
    {
      $match: {
        User: userObjectId,
        region,
        country,
      },
    },
    { $sort: { date: -1 } },
    { $limit: days },
    { $sort: { date: 1 } },
    {
      $group: {
        _id: null,
        totalSales: { $sum: '$sales.amount' },
        currencyCode: { $first: '$sales.currencyCode' },
        count: { $sum: 1 },
        datewiseSales: {
          $push: {
            date: '$date',
            sales: '$sales',
            grossProfit: '$grossProfit',
            unitsSold: '$unitsSold',
          },
        },
        minDate: { $min: '$date' },
        maxDate: { $max: '$date' },
      },
    },
  ]);

  if (!result || result.length === 0) {
    return {
      totalSales: { amount: 0, currencyCode: 'USD' },
      datewiseSales: [],
      dateRange: { startDate: null, endDate: null },
    };
  }

  const r = result[0];
  return {
    totalSales: { amount: r.totalSales, currencyCode: r.currencyCode || 'USD' },
    datewiseSales: r.datewiseSales,
    dateRange: { startDate: r.minDate, endDate: r.maxDate },
  };
};

/**
 * Backward-compatible findLatest that returns data in the old format.
 * Uses database aggregation for recent 31 days.
 */
salesOnlyMetricsSchema.statics.findLatest = async function (
  userId,
  region,
  country = 'US'
) {
  const data = await this.getRecentDays(userId, region, country, 31);

  return {
    User: userId,
    region,
    country,
    dateRange: data.dateRange,
    totalSales: data.totalSales,
    datewiseSales: data.datewiseSales,
    last7Days: null,
    last14Days: null,
  };
};

/**
 * Find by user + region (+ optional country) using database aggregation.
 * All calculations happen in MongoDB.
 */
salesOnlyMetricsSchema.statics.findByUserRegionCountry = async function (
  userId,
  region,
  country
) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const matchQuery = { User: userObjectId, region };
  if (country) matchQuery.country = country;

  const result = await this.aggregate([
    { $match: matchQuery },
    { $sort: { date: -1 } },
    { $limit: 31 },
    { $sort: { date: 1 } },
    {
      $group: {
        _id: { country: '$country' },
        totalSales: { $sum: '$sales.amount' },
        currencyCode: { $first: '$sales.currencyCode' },
        datewiseSales: {
          $push: {
            date: '$date',
            sales: '$sales',
            grossProfit: '$grossProfit',
            unitsSold: '$unitsSold',
          },
        },
        minDate: { $min: '$date' },
        maxDate: { $max: '$date' },
      },
    },
  ]);

  if (!result || result.length === 0) return [];

  return result.map((r) => ({
    User: userId,
    region,
    country: r._id.country,
    dateRange: {
      startDate: r.minDate,
      endDate: r.maxDate,
    },
    totalSales: { amount: r.totalSales, currencyCode: r.currencyCode || 'USD' },
    datewiseSales: r.datewiseSales,
  }));
};

module.exports = mongoose.model('SalesOnlyMetrics', salesOnlyMetricsSchema);

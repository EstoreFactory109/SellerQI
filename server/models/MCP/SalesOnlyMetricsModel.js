const mongoose = require('mongoose');

/**
 * SalesOnlyMetricsModel
 *
 * Stores only sales totals + daily (date-wise) sales for a user/country/region range.
 *
 * This intentionally mirrors the shape of `EconomicsMetrics.datewiseSales` entries
 * enough for existing chart readers to keep working (grossProfit is always 0).
 */

const monetaryAmountSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, default: 0 },
    currencyCode: { type: String, required: true, default: 'USD' },
  },
  { _id: false }
);

const datewiseSalesSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD
    sales: { type: monetaryAmountSchema, required: true },
    // Kept for compatibility with existing mapping code.
    grossProfit: { type: monetaryAmountSchema, required: true, default: { amount: 0, currencyCode: 'USD' } },
    // Optional: some readers reference unitsSold; MCP Sales/Traffic does not provide unitsSold.
    unitsSold: { type: Number, required: false, default: 0 },
  },
  { _id: false }
);

const periodSummarySchema = new mongoose.Schema(
  {
    totalSales: { type: monetaryAmountSchema, required: true },
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String, required: true }, // YYYY-MM-DD
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
      // Country/marketplace code (US, UK, DE, AU, etc.)
      type: String,
      required: true,
      index: true,
    },
    dateRange: {
      startDate: { type: String, required: true }, // YYYY-MM-DD
      endDate: { type: String, required: true }, // YYYY-MM-DD
    },

    // Totals for the entire dateRange
    totalSales: { type: monetaryAmountSchema, required: true },

    // Daily series for the dateRange
    datewiseSales: { type: [datewiseSalesSchema], default: [] },

    // Precomputed fixed periods to avoid recomputation in readers
    last7Days: { type: periodSummarySchema, required: false },
    last14Days: { type: periodSummarySchema, required: false },

    // Bookkeeping
    queryId: { type: String, required: false, index: true },
    documentId: { type: String, required: false },
    processedAt: { type: Date, default: Date.now },
    dataSource: { type: String, enum: ['DataKiosk'], default: 'DataKiosk' },
  },
  { timestamps: true }
);

salesOnlyMetricsSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });
salesOnlyMetricsSchema.index({ User: 1, region: 1, country: 1, 'dateRange.startDate': 1, 'dateRange.endDate': 1 });

// Static method to find by date range
salesOnlyMetricsSchema.statics.findByDateRange = function (userId, region, startDate, endDate) {
  return this.find({
    User: userId,
    region: region,
    'dateRange.startDate': startDate,
    'dateRange.endDate': endDate,
  }).sort({ createdAt: -1 });
};

// Static method to find latest metrics
salesOnlyMetricsSchema.statics.findLatest = function (userId, region, country = 'US') {
  return this.findOne({
    User: userId,
    region: region,
    country: country,
  }).sort({ createdAt: -1 });
};

// Static method to find by user + region (+ optional country)
salesOnlyMetricsSchema.statics.findByUserRegionCountry = function (userId, region, country) {
  const query = {
    User: userId,
    region: region,
  };
  if (country) query.country = country;
  return this.find(query).sort({ createdAt: -1 });
};

module.exports = mongoose.model('SalesOnlyMetrics', salesOnlyMetricsSchema);


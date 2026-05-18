const mongoose = require('mongoose');

/**
 * FinanceSyncLogModel
 *
 * Tracks which dates have been successfully fetched and stored for each
 * user+country+region combination.
 *
 * Architecture:
 *   - One document per (User, country, region, date)
 *   - First fetch: creates 30 entries (one per day)
 *   - Daily fetch: creates 1 entry
 *   - To check if a date has been fetched: query this collection
 *   - To find the last fetched date: sort by date desc, limit 1
 *
 * Replaces:
 *   - ExpenseReportRunModel (run metadata)
 *   - AsinWiseSalesRunModel (sales run metadata)
 *
 * Usage in service:
 *   1. Check: what's the latest synced date?
 *   2. If no records → backfill last 30 days
 *   3. If latest date < yesterday → fetch each missing day
 *   4. After successful save → create a sync log entry
 */

const FinanceSyncLogSchema = new mongoose.Schema(
  {
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    country: {
      type: String,
      required: true,
      index: true,
    },
    region: {
      type: String,
      required: true,
      enum: ['NA', 'EU', 'FE'],
      index: true,
    },
    marketplaceId: {
      type: String,
      required: true,
      index: true,
    },

    // The date that was fetched (YYYY-MM-DD)
    date: {
      type: String,
      required: true,
      index: true,
    },

    // When this date was fetched
    fetchedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },

    status: {
      type: String,
      required: true,
      enum: ['success', 'failed', 'partial'],
      default: 'success',
    },

    // Stats for this day's fetch
    transactionCount: { type: Number, default: 0 },
    expenseRowCount: { type: Number, default: 0 },
    revenueRowCount: { type: Number, default: 0 },
    skuCount: { type: Number, default: 0 },

    // The actual postedAfter/postedBefore used for this fetch
    postedAfter: { type: String, default: '' },
    postedBefore: { type: String, default: '' },

    // Error message if status is 'failed'
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

// Primary: find latest synced date for a user
FinanceSyncLogSchema.index({ User: 1, country: 1, region: 1, date: -1 });

// Prevent duplicate: one sync log per user+country+date
FinanceSyncLogSchema.index(
  { User: 1, country: 1, region: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model('FinanceSyncLog', FinanceSyncLogSchema);
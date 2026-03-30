const mongoose = require('mongoose');

/**
 * ExpenseReportRunModel
 *
 * Stores ONLY metadata and small summary totals for one expense-report generation run.
 * Large arrays (category lists, sku lists, sku+date lists) are stored in separate collections
 * to avoid MongoDB's 16MB document limit.
 */

const ExpenseReportRunSchema = new mongoose.Schema(
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
      // Matches the rest of this codebase: NA | EU | FE
      type: String,
      required: true,
      enum: ['NA', 'EU', 'FE'],
      index: true,
    },

    // Internal region naming used by `Expences.js` metadata:
    // na | eu | apac
    regionInternal: {
      type: String,
      required: true,
      index: true,
    },

    // Useful for debugging / traceability
    marketplaceId: {
      type: String,
      required: true,
      index: true,
    },
    daysBack: {
      type: Number,
      required: true,
      default: 30,
      min: 1,
      max: 3650,
    },

    // Mirror `Expences.js` metadata
    totalRowsProcessed: {
      type: Number,
      required: true,
      default: 0,
    },
    totalExpenseRows: {
      type: Number,
      required: true,
      default: 0,
    },
    reportsProcessed: {
      type: Number,
      required: true,
      default: 0,
    },

    dateRangeEarliest: {
      type: Date,
      default: null,
      index: true,
    },
    dateRangeLatest: {
      type: Date,
      default: null,
      index: true,
    },
    generatedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
      index: true,
    },

    // Totals for each "section" (small numeric fields only)
    totals: {
      allTime: {
        type: Number,
        required: true,
        default: 0,
      },
      last7Days: {
        type: Number,
        required: true,
        default: 0,
      },
      last14Days: {
        type: Number,
        required: true,
        default: 0,
      },
    },
  },
  { timestamps: true }
);

// Common query patterns
ExpenseReportRunSchema.index({ User: 1, country: 1, region: 1, generatedAt: -1 });
ExpenseReportRunSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model('ExpenseReportRun', ExpenseReportRunSchema);


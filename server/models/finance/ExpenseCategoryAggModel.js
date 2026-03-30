const mongoose = require('mongoose');

/**
 * ExpenseCategoryAggModel
 *
 * Stores category-level totals for a given expense report run.
 * One document per (runId, period, category) to keep documents small and queryable.
 */

const PERIODS = ['all', 'last7', 'last14'];

const ExpenseCategoryAggSchema = new mongoose.Schema(
  {
    runId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExpenseReportRun',
      required: true,
      index: true,
    },
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

    period: {
      type: String,
      required: true,
      enum: PERIODS,
      index: true,
    },
    category: {
      type: String,
      required: true,
      index: true,
    },

    totalAmount: {
      // Negative values indicate expense (as produced by Expences.js)
      type: Number,
      required: true,
      default: 0,
    },
    count: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true }
);

// Prevent duplicates within a run
ExpenseCategoryAggSchema.index(
  { runId: 1, period: 1, category: 1 },
  { unique: true }
);

// Common queries: latest run by user/country/region, then filter by period
ExpenseCategoryAggSchema.index({ User: 1, country: 1, region: 1, period: 1, totalAmount: 1 });
ExpenseCategoryAggSchema.index({ runId: 1, period: 1, totalAmount: 1, category: 1 });
ExpenseCategoryAggSchema.index({ User: 1, country: 1, region: 1, period: 1, createdAt: -1 });

module.exports = mongoose.model('ExpenseCategoryAgg', ExpenseCategoryAggSchema);


const mongoose = require('mongoose');

/**
 * ExpenseAmazonFeeCategoryAggModel
 *
 * Stores Amazon-fee-only category totals for a given run and period.
 * Mirrors:
 * - totalAmazonFees
 * - totalAmazonFeesLast7Days
 * - totalAmazonFeesLast14Days
 */

const PERIODS = ['all', 'last7', 'last14'];

const ExpenseAmazonFeeCategoryAggSchema = new mongoose.Schema(
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

ExpenseAmazonFeeCategoryAggSchema.index(
  { runId: 1, period: 1, category: 1 },
  { unique: true }
);
ExpenseAmazonFeeCategoryAggSchema.index({ runId: 1, period: 1, totalAmount: 1 });
ExpenseAmazonFeeCategoryAggSchema.index({ User: 1, country: 1, region: 1, period: 1, createdAt: -1 });

module.exports = mongoose.model('ExpenseAmazonFeeCategoryAgg', ExpenseAmazonFeeCategoryAggSchema);


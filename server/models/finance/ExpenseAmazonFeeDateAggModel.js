const mongoose = require('mongoose');

/**
 * ExpenseAmazonFeeDateAggModel
 *
 * Stores Amazon-fee-only date-wise totals (+ category breakdown) for one run.
 * Mirrors `dateWiseAmazonFees`.
 */

const breakdownItemSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const ExpenseAmazonFeeDateAggSchema = new mongoose.Schema(
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
    dateKey: {
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
    breakdown: {
      type: [breakdownItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

ExpenseAmazonFeeDateAggSchema.index({ runId: 1, dateKey: 1 }, { unique: true });
ExpenseAmazonFeeDateAggSchema.index({ runId: 1, dateKey: -1 });
ExpenseAmazonFeeDateAggSchema.index({ User: 1, country: 1, region: 1, dateKey: 1, createdAt: -1 });

module.exports = mongoose.model('ExpenseAmazonFeeDateAgg', ExpenseAmazonFeeDateAggSchema);


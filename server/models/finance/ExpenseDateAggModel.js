const mongoose = require('mongoose');

/**
 * ExpenseDateAggModel
 *
 * Stores date-wise total expenses (+ category breakdown) for one run.
 * One document per (runId, dateKey).
 * Mirrors `dateWiseExpenses` section from Expences.js.
 */

const breakdownItemSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const ExpenseDateAggSchema = new mongoose.Schema(
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

    // Date string from report (posted-date / "Unknown")
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

ExpenseDateAggSchema.index({ runId: 1, dateKey: 1 }, { unique: true });
ExpenseDateAggSchema.index({ runId: 1, dateKey: -1 });
ExpenseDateAggSchema.index({ User: 1, country: 1, region: 1, dateKey: 1, createdAt: -1 });

module.exports = mongoose.model('ExpenseDateAgg', ExpenseDateAggSchema);

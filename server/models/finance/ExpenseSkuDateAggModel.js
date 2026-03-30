const mongoose = require('mongoose');

/**
 * ExpenseSkuDateAggModel
 *
 * Stores SKU + date level expense aggregation for a given report run.
 * One document per (runId, sku, dateKey). This mirrors `skuDateWiseExpenses`.
 *
 * NOTE: `dateKey` matches Expences.js output: `postedDateStr` or "Unknown"
 * (it can be non-ISO / marketplace-specific formatting).
 */

const breakdownItemSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const ExpenseSkuDateAggSchema = new mongoose.Schema(
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

    sku: {
      type: String,
      required: true,
      index: true,
    },

    // Date string from report (not necessarily ISO)
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

ExpenseSkuDateAggSchema.index({ runId: 1, sku: 1, dateKey: 1 }, { unique: true });
ExpenseSkuDateAggSchema.index({ runId: 1, dateKey: -1, sku: 1 });
ExpenseSkuDateAggSchema.index({ User: 1, country: 1, region: 1, sku: 1, createdAt: -1 });
ExpenseSkuDateAggSchema.index({ User: 1, country: 1, region: 1, dateKey: 1, createdAt: -1 });

module.exports = mongoose.model('ExpenseSkuDateAgg', ExpenseSkuDateAggSchema);


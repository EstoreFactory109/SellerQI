const mongoose = require('mongoose');

/**
 * ExpenseSkuAggModel
 *
 * Stores SKU-wise expense aggregation for a given run and period.
 * One document per SKU (per run/period). Breakdown is per-category totals for that SKU.
 * This mirrors `skuWiseExpenses` sections returned by Expences.js while staying 16MB-safe.
 */

const PERIODS = ['all', 'last7', 'last14'];

const breakdownItemSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const ExpenseSkuAggSchema = new mongoose.Schema(
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

    sku: {
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

    // Small per-SKU breakdown array (category -> amount)
    breakdown: {
      type: [breakdownItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

ExpenseSkuAggSchema.index({ runId: 1, period: 1, sku: 1 }, { unique: true });
ExpenseSkuAggSchema.index({ runId: 1, period: 1, totalAmount: 1 });
ExpenseSkuAggSchema.index({ User: 1, country: 1, region: 1, period: 1, totalAmount: 1 });
ExpenseSkuAggSchema.index({ User: 1, country: 1, region: 1, period: 1, createdAt: -1 });

module.exports = mongoose.model('ExpenseSkuAgg', ExpenseSkuAggSchema);


const mongoose = require('mongoose');

/**
 * ExpenseRawRowModel
 *
 * Stores individual parsed expense rows from settlement reports.
 * One document per expense row — safe from 16MB limit.
 *
 * These rows are the source of truth for recalculating
 * merged 7/14/30 day totals across old + new reports.
 */

const ExpenseRawRowSchema = new mongoose.Schema(
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
    reportId: {
      type: String,
      required: true,
      index: true,
    },

    amount: { type: Number, required: true, default: 0 },
    absoluteAmount: { type: Number, required: true, default: 0 },
    category: { type: String, required: true, default: '' },
    isAmazonFee: { type: Boolean, required: true, default: false },
    amountType: { type: String, default: '' },
    amountDescription: { type: String, default: '' },
    sku: { type: String, default: 'N/A' },
    asin: { type: String, default: '', index: true },
    orderId: { type: String, default: '' },
    transactionType: { type: String, default: '' },
    postedDate: { type: Date, default: null },
    postedDateStr: { type: String, default: '' },
    dedupKey: { type: String, default: '' },
  },
  { timestamps: true }
);

ExpenseRawRowSchema.index({ User: 1, country: 1, region: 1 });
ExpenseRawRowSchema.index({ User: 1, country: 1, region: 1, postedDate: -1 });
ExpenseRawRowSchema.index({ User: 1, country: 1, region: 1, asin: 1, postedDate: -1 });
ExpenseRawRowSchema.index({ reportId: 1, User: 1 });
ExpenseRawRowSchema.index({ User: 1, country: 1, region: 1, dedupKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ExpenseRawRow', ExpenseRawRowSchema);
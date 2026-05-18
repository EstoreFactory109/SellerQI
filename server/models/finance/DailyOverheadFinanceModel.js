const mongoose = require('mongoose');

/**
 * DailyOverheadFinanceModel
 *
 * One document per (User, country, region, category, date).
 * Stores business-level expenses and revenue that are NOT tied to any
 * specific SKU/ASIN.
 *
 * These include:
 *   Expenses:
 *     - "FBA Storage Fee"                  — monthly storage charges
 *     - "FBA Inbound Transportation Fee"   — shipping inventory to Amazon
 *     - "FBA Removal Fee"                  — removing inventory from FBA
 *     - "TaxWithholding"                   — generic tax withholding
 *
 *   Revenue:
 *     - "Disbursement"                     — payouts to seller's bank
 *     - "Seller Reward"                    — Amazon promotional credits
 *     - "SAFE-T Reimbursement"             — seller claims
 *     - "SERRAC Reimbursement"             — SERRAC program payouts
 *     - "Reimbursement"                    — generic reimbursements
 *
 * Frontend: Display these in a separate "Business Overhead" section,
 * not mixed into per-SKU P&L.
 */

const DailyOverheadFinanceSchema = new mongoose.Schema(
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

    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      index: true,
    },

    // Total amount for this category on this date
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
    // Number of individual transactions that make up this amount
    count: {
      type: Number,
      required: true,
      default: 0,
    },

    // Whether this is a revenue item (Disbursement, Reimbursement) or expense
    isRevenue: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { timestamps: true }
);

// Primary query: user's overhead for a date range
DailyOverheadFinanceSchema.index({ User: 1, country: 1, region: 1, date: 1 });

// One doc per user+country+region+category+date (unique index also serves category+date lookups)
DailyOverheadFinanceSchema.index(
  { User: 1, country: 1, region: 1, category: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model('DailyOverheadFinance', DailyOverheadFinanceSchema);
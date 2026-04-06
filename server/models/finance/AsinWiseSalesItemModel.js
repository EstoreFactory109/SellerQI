const mongoose = require('mongoose');

/**
 * AsinWiseSalesItemModel
 *
 * One document per ASIN for a given run.
 * Keeps per-ASIN period totals. Date-wise rows are stored separately to avoid growth.
 */

const periodTotalsSchema = new mongoose.Schema(
  {
    totalUnits: { type: Number, required: true, default: 0 },
    totalRevenue: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const AsinWiseSalesItemSchema = new mongoose.Schema(
  {
    runId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AsinWiseSalesRun',
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

    asin: {
      type: String,
      required: true,
      index: true,
    },
    sku: {
      type: String,
      required: false,
      default: '',
      index: true,
    },
    productName: {
      type: String,
      required: false,
      default: '',
    },
    currency: {
      type: String,
      required: false,
      default: '',
    },

    last7Days: { type: periodTotalsSchema, default: () => ({}) },
    last14Days: { type: periodTotalsSchema, default: () => ({}) },
    last30Days: { type: periodTotalsSchema, default: () => ({}) },
  },
  { timestamps: true }
);

AsinWiseSalesItemSchema.index({ runId: 1, asin: 1 }, { unique: true });
AsinWiseSalesItemSchema.index({ runId: 1, 'last30Days.totalRevenue': -1 });
AsinWiseSalesItemSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model('AsinWiseSalesItem', AsinWiseSalesItemSchema);


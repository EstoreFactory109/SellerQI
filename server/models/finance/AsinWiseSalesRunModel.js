const mongoose = require('mongoose');

/**
 * AsinWiseSalesRunModel
 *
 * One lightweight document per fetch/calculation run.
 * Stores request/summary metadata only (no large arrays) to stay far from BSON size limits.
 */

const periodSummarySchema = new mongoose.Schema(
  {
    totalUnits: { type: Number, required: true, default: 0 },
    totalRevenue: { type: Number, required: true, default: 0 },
    startDate: { type: String, required: false, default: '' }, // YYYY-MM-DD
    endDate: { type: String, required: false, default: '' },   // YYYY-MM-DD
  },
  { _id: false }
);

const AsinWiseSalesRunSchema = new mongoose.Schema(
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
    regionInternal: {
      type: String, // na | eu | apac
      required: true,
      index: true,
    },
    marketplaceId: {
      type: String,
      required: true,
      index: true,
    },
    dataSource: {
      type: String,
      required: true,
      enum: ['report', 'api', 'both'],
      index: true,
    },
    days: {
      type: Number,
      required: true,
      default: 30,
      min: 1,
      max: 3650,
    },

    generatedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
      index: true,
    },
    totalAsins: {
      type: Number,
      required: true,
      default: 0,
    },

    summary: {
      last7Days: { type: periodSummarySchema, default: () => ({}) },
      last14Days: { type: periodSummarySchema, default: () => ({}) },
      last30Days: { type: periodSummarySchema, default: () => ({}) },
    },
  },
  { timestamps: true }
);

AsinWiseSalesRunSchema.index({ User: 1, country: 1, region: 1, generatedAt: -1 });
AsinWiseSalesRunSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model('AsinWiseSalesRun', AsinWiseSalesRunSchema);


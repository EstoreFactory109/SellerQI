const mongoose = require('mongoose');

/**
 * AsinWiseSalesDateItemModel
 *
 * One document per ASIN/date row for a given run.
 * Normalized storage prevents large embedded arrays and avoids BSON size issues.
 */

const AsinWiseSalesDateItemSchema = new mongoose.Schema(
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
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    units: {
      type: Number,
      required: true,
      default: 0,
    },
    revenue: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true }
);

AsinWiseSalesDateItemSchema.index({ runId: 1, asin: 1, date: 1 }, { unique: true });
AsinWiseSalesDateItemSchema.index({ runId: 1, date: 1, asin: 1 });
AsinWiseSalesDateItemSchema.index({ User: 1, country: 1, region: 1, date: 1, createdAt: -1 });

module.exports = mongoose.model('AsinWiseSalesDateItem', AsinWiseSalesDateItemSchema);


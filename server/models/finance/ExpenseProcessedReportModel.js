const mongoose = require('mongoose');

/**
 * ExpenseProcessedReportModel
 *
 * Tracks which Amazon settlement report IDs have already been processed
 * for a user/country/region. Used to avoid duplicate processing in
 * Expences.js (`processedReportIds` flow).
 */

const ExpenseProcessedReportSchema = new mongoose.Schema(
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
      required: false,
      index: true,
    },

    reportId: {
      type: String,
      required: true,
      index: true,
    },

    // Optional link to the run that processed this report
    runId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExpenseReportRun',
      required: false,
      index: true,
    },

    processedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
      index: true,
    },
  },
  { timestamps: true }
);

// Ensure no duplicate report processing for same user/country/region
ExpenseProcessedReportSchema.index(
  { User: 1, country: 1, region: 1, reportId: 1 },
  { unique: true }
);

ExpenseProcessedReportSchema.index({ User: 1, country: 1, region: 1, processedAt: -1 });

module.exports = mongoose.model('ExpenseProcessedReport', ExpenseProcessedReportSchema);


const mongoose = require('mongoose');

/**
 * SolicitationLog
 *
 * Tracks per-order "Request a review" attempts so we do not send
 * duplicate solicitations for the same seller + order.
 */

const solicitationLogSchema = new mongoose.Schema(
  {
    sellerId: {
      type: String,
      required: true,
      index: true,
    },
    orderId: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['sent', 'failed', 'skipped'],
      required: true,
    },
    skipReason: {
      type: String,
      required: false,
    },
    httpStatus: {
      type: Number,
      required: false,
    },
    sentAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'solicitation_logs',
  }
);

// Prevent duplicate logs for the same seller + order
solicitationLogSchema.index({ sellerId: 1, orderId: 1 }, { unique: true });

const SolicitationLog = mongoose.model('SolicitationLog', solicitationLogSchema);

module.exports = {
  SolicitationLog,
};


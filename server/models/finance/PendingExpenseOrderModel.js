const mongoose = require('mongoose');

/**
 * PendingExpenseOrderModel
 *
 * Tracks orders from the Sales Report that don't yet have matching
 * expenses from the Finance API (fees not yet settled by Amazon).
 *
 * On each weekly sync:
 *   1. New sales orders without expenses → added here
 *   2. Finance API re-fetched for all pending orders
 *   3. Orders whose expenses are now found → removed from here,
 *      DailySkuFinance updated with the expenses
 *
 * Typical lifecycle:
 *   US seller: order pending 1-3 days, resolved on next sync
 *   India seller: order pending 7-25 days, resolved in 2-4 syncs
 */

const PendingExpenseOrderSchema = new mongoose.Schema(
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

    // The order ID from the Sales Report
    orderId: {
      type: String,
      required: true,
      index: true,
    },

    // The Pacific Time purchase date — this is the date key in DailySkuFinance
    // that needs to be updated when expenses are found
    purchasePacificDate: {
      type: String, // YYYY-MM-DD
      required: true,
    },

    asin: { type: String, default: '' },
    sku: { type: String, default: '' },
    salesAmount: { type: Number, default: 0 },
    units: { type: Number, default: 0 },

    // How many sync attempts have tried to resolve this order
    attempts: {
      type: Number,
      default: 0,
    },

    // When this order was first marked as pending
    firstSeenAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  { timestamps: true }
);

// One pending entry per (order, SKU) — multi-SKU orders can have several line items
PendingExpenseOrderSchema.index(
  { User: 1, country: 1, region: 1, orderId: 1, sku: 1 },
  { unique: true }
);

// Find all pending orders for a user (for backfill)
PendingExpenseOrderSchema.index({ User: 1, country: 1, region: 1 });

// Find oldest pending (for cleanup — orders older than 60 days can be dropped)
PendingExpenseOrderSchema.index({ User: 1, country: 1, region: 1, firstSeenAt: 1 });

module.exports = mongoose.model('PendingExpenseOrder', PendingExpenseOrderSchema);
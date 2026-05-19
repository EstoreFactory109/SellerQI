const mongoose = require('mongoose');

/**
 * SalesOrderIdModel
 *
 * Stores the set of amazon-order-ids from each sales report run.
 * Used by the expense system to determine whether an expense's order
 * belongs to the current sales period (matched) or a prior period (unmatched).
 *
 * Why a separate collection?
 *   - Order IDs are lost during ASIN/date aggregation in calculateSales()
 *   - Storing them on AsinWiseSalesRun as an array risks hitting the 16MB
 *     BSON limit for high-volume sellers (1000+ orders/month)
 *   - A flat collection with a compound index gives O(1) lookup per order ID
 *
 * Usage (Fix 2 — expense matching):
 *   const salesOrderIds = await SalesOrderId
 *     .find({ User, country, region, runId })
 *     .distinct('orderId');
 *   const salesOrderSet = new Set(salesOrderIds);
 *   const isMatched = salesOrderSet.has(expense.orderId);
 */

const SalesOrderIdSchema = new mongoose.Schema(
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
    orderId: {
      type: String,
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Primary lookup: get all order IDs for a given run
SalesOrderIdSchema.index({ runId: 1, orderId: 1 }, { unique: true });

// Expense matching: check if an order ID exists for a user/country/region
SalesOrderIdSchema.index({ User: 1, country: 1, region: 1, orderId: 1 });

// Cleanup: find all order IDs for a user/country/region (to delete old runs)
SalesOrderIdSchema.index({ User: 1, country: 1, region: 1, runId: 1 });

module.exports = mongoose.model('SalesOrderId', SalesOrderIdSchema);
const mongoose = require("mongoose");

/**
 * ReviewOrderItem
 *
 * Stores item-level details for a reviewable order.
 * Separate collection prevents large embedded arrays on ReviewOrder documents
 * and keeps us well clear of the 16MB document limit.
 */

const ReviewOrderItemSchema = new mongoose.Schema(
  {
    // Link back to ReviewOrder document
    reviewOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReviewOrder",
      required: true,
      index: true,
    },

    // Duplicate lightweight keys to simplify queries without $lookup
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    marketplaceId: {
      type: String,
      required: true,
      index: true,
    },
    amazonOrderId: {
      type: String,
      required: true,
      index: true,
    },

    // Product identity
    asin: {
      type: String,
      index: true,
    },
    sellerSKU: {
      type: String,
      index: true,
    },
    title: {
      type: String,
    },

    // Quantities & pricing
    quantityOrdered: {
      type: Number,
      default: 0,
    },
    quantityShipped: {
      type: Number,
      default: 0,
    },
    itemPrice: {
      type: mongoose.Schema.Types.Mixed,
    },
    itemTax: {
      type: mongoose.Schema.Types.Mixed,
    },
    promotionDiscount: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Condition / gift flags
    condition: {
      type: String,
    },
    conditionSubtype: {
      type: String,
    },
    isGift: {
      type: Boolean,
      default: false,
    },
    serialNumbers: {
      type: [String],
      default: [],
    },

    // Raw SP-API order item payload (optionally trimmed by caller)
    rawItem: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for common queries by user + order
ReviewOrderItemSchema.index(
  {
    User: 1,
    amazonOrderId: 1,
    asin: 1,
  },
  { name: "user_order_asin_idx" }
);

module.exports = mongoose.model("ReviewOrderItem", ReviewOrderItemSchema);


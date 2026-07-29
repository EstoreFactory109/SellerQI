const mongoose = require("mongoose");

/**
 * ReviewOrder
 *
 * Stores a single Amazon order for review-related workflows.
 * Designed to:
 * - Keep each document small (well below MongoDB 16MB limit)
 * - Push per-item detail into ReviewOrderItemModel
 * - Support efficient querying via compound indexes
 */

const ReviewOrderSchema = new mongoose.Schema(
  {
    // Owning user in our system
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Location / marketplace context
    country: {
      type: String,
      required: true,
      index: true,
    },
    region: {
      type: String,
      required: true,
      index: true,
    },
    marketplaceId: {
      type: String,
      required: true,
      index: true,
    },

    // Order identity
    amazonOrderId: {
      type: String,
      required: true,
    },

    // Basic order attributes (only key fields to avoid large docs)
    purchaseDate: {
      type: Date,
      index: true,
    },
    orderStatus: {
      type: String,
    },
    buyerEmail: {
      type: String,
    },
    buyerName: {
      type: String,
    },
    orderTotalAmount: {
      type: Number,
    },
    orderTotalCurrencyCode: {
      type: String,
    },

    // Summary counts to avoid $lookup when possible
    itemCount: {
      type: Number,
      default: 0,
    },

    // When per-item detail was last pulled into ReviewOrderItem for this order.
    // null/absent = items not fetched yet.
    //
    // Item fetching costs one SP-API call plus a rate-limit sleep PER ORDER, so for a
    // high-volume account it can never be exhaustive (~120k orders would take days). It is
    // therefore a capped, best-effort backfill prioritising orders inside the 5-30 day
    // solicitation window. That is acceptable because ReviewOrderItem has exactly one
    // consumer: the on-demand drill-down GET /api/review/order-items/:amazonOrderId.
    itemsFetchedAt: {
      type: Date,
      default: null,
    },

    // Raw SP-API order payload (optionally trimmed by caller)
    rawOrder: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Review eligibility data (raw response from solicitations check API)
    eligibilityLastCheckedAt: {
      type: Date,
      index: true,
    },
    eligibilityResponse: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Derived flag: whether a review request CAN be sent (based on eligibilityResponse)
    canRequestReview: {
      type: Boolean,
      index: true,
    },

    // Review request state
    reviewRequestStatus: {
      type: String,
      enum: ["not_requested", "queued", "sent", "failed"],
      default: "not_requested",
      index: true,
    },
    reviewRequestLastSentAt: {
      type: Date,
    },
    reviewRequestError: {
      type: String,
    },

    // Tracks which fetch run stored/updated this order
    fetchBatchId: {
      type: String,
      index: true,
    },

    // Scheduler: when to next check eligibility (backoff-aware)
    nextEligibilityCheckAt: {
      type: Date,
      index: true,
    },

    // Retry / attempt tracking
    sendAttemptCount: {
      type: Number,
      default: 0,
    },
    eligibilityCheckCount: {
      type: Number,
      default: 0,
    },

    // Processing flags for jobs
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// Ensure 16MB safety:
// - No large arrays on this schema
// - Large per-item details live in ReviewOrderItemModel

// Unique constraint per marketplace / order to prevent duplicate storage
// (an Amazon order ID is unique within a marketplace and tied to a single seller)
ReviewOrderSchema.index(
  { marketplaceId: 1, amazonOrderId: 1 },
  { unique: true }
);

// Common query patterns
ReviewOrderSchema.index({
  User: 1,
  country: 1,
  region: 1,
  purchaseDate: -1,
});

ReviewOrderSchema.index({
  User: 1,
  reviewRequestStatus: 1,
  eligibilityLastCheckedAt: -1,
});

// Scheduled worker query: unsent orders within eligibility window
ReviewOrderSchema.index({
  User: 1,
  reviewRequestStatus: 1,
  purchaseDate: -1,
  nextEligibilityCheckAt: 1,
});

// Items backfill pass: "orders in the solicitation window whose items are not fetched yet",
// oldest first. purchaseDate ascending because the oldest orders leave the 30-day window
// first and so are the most urgent to enrich.
ReviewOrderSchema.index({
  User: 1,
  itemsFetchedAt: 1,
  purchaseDate: 1,
});

module.exports = mongoose.model("ReviewOrder", ReviewOrderSchema);


const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // One subscription per user
    },
    stripeCustomerId: {
      type: String,
      required: false,
    },
    stripeSubscriptionId: {
      type: String,
      required: false,
    },
    stripeSessionId: {
      type: String,
      required: false,
    },
    planType: {
      type: String,
      enum: ["LITE", "PRO", "AGENCY"],
      required: true,
    },
    stripePriceId: {
      type: String,
      required: false, // Not required for LITE plan
    },
    status: {
      type: String,
      enum: ["active", "inactive", "cancelled", "past_due", "incomplete", "trialing"],
      default: "active",
    },
    currentPeriodStart: {
      type: Date,
      required: false,
    },
    currentPeriodEnd: {
      type: Date,
      required: false,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    paymentStatus: {
      type: String,
      enum: ["paid", "unpaid", "no_payment_required", "pending"],
      default: "no_payment_required", // For LITE plan
    },
    amount: {
      type: Number,
      required: false, // Not required for LITE plan
    },
    currency: {
      type: String,
      default: "usd",
    },
    lastPaymentDate: {
      type: Date,
      required: false,
    },
    nextBillingDate: {
      type: Date,
      required: false,
    },
    paymentHistory: [
      {
        sessionId: String,
        amount: Number,
        currency: String,
        status: String,
        paymentDate: {
          type: Date,
          default: Date.now,
        },
        stripePaymentIntentId: String,
      }
    ],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
// Note: userId index is automatically created by unique: true in schema
subscriptionSchema.index({ stripeCustomerId: 1 });
subscriptionSchema.index({ stripeSubscriptionId: 1 });

const Subscription = mongoose.model("Subscription", subscriptionSchema);
module.exports = Subscription; 
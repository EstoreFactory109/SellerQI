const mongoose = require("mongoose");

/**
 * SUBSCRIPTION MODEL
 * 
 * Stores subscription information for users including Stripe and Razorpay subscriptions.
 * 
 * IMPORTANT: Abandoned Subscription Cleanup (TODO - Requires Cron Job)
 * =====================================================================
 * Subscriptions with status='incomplete' that are older than 24 hours should be cleaned up.
 * These are created when a user starts checkout but doesn't complete it.
 * 
 * A background job should be scheduled to:
 * 1. Find subscriptions with status='incomplete' and updatedAt < (now - 24 hours)
 * 2. Cancel any corresponding Stripe/Razorpay subscriptions if they exist
 * 3. Delete or mark these subscription records as 'abandoned'
 * 
 * Example cron job query:
 * const abandonedThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
 * const abandoned = await Subscription.find({
 *   status: 'incomplete',
 *   updatedAt: { $lt: abandonedThreshold }
 * });
 * 
 * This cleanup prevents:
 * - Database bloat from incomplete checkouts
 * - Confusion about subscription status
 * - Potential billing issues with orphaned subscriptions in payment gateways
 */

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // One subscription per user
    },
    // Payment gateway type (stripe or razorpay)
    paymentGateway: {
      type: String,
      enum: ["stripe", "razorpay"],
      default: "stripe",
    },
    // Stripe fields
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
    stripePriceId: {
      type: String,
      required: false, // Not required for LITE plan
    },
    // Razorpay fields
    razorpayOrderId: {
      type: String,
      required: false,
    },
    razorpayPaymentId: {
      type: String,
      required: false,
    },
    razorpaySubscriptionId: {
      type: String,
      required: false,
    },
    razorpaySignature: {
      type: String,
      required: false,
    },
    // Trial info - stored when subscription is created with trial
    // Used as fallback when Razorpay API fetch fails during verification
    hasTrial: {
      type: Boolean,
      default: false,
    },
    trialEndsAt: {
      type: Date,
      required: false,
    },
    // Flag to track if checkout was completed (used to prevent trial activation on cancelled checkouts)
    // This is set to true only when checkout.session.completed fires (Stripe) or payment is verified (Razorpay)
    checkoutCompleted: {
      type: Boolean,
      default: false,
    },
    // Common fields
    planType: {
      type: String,
      enum: ["LITE", "PRO", "AGENCY"],
      required: true,
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
        orderId: String, // For Razorpay
        paymentId: String, // For Razorpay
        amount: {
          type: Number,
          min: 0
        },
        currency: String,
        status: {
          type: String,
          enum: ["paid", "unpaid", "pending", "refunded", "failed"],
          default: "paid"
        },
        paymentDate: {
          type: Date,
          default: Date.now,
        },
        stripePaymentIntentId: String,
        stripeInvoiceId: String, // For Stripe invoices
        razorpayPaymentId: String,
        // Invoice-related fields
        invoiceUrl: String,
        invoicePdf: String,
        invoiceNumber: String,
        paymentGateway: {
          type: String,
          enum: ["stripe", "razorpay"],
        },
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
subscriptionSchema.index({ razorpayOrderId: 1 });
subscriptionSchema.index({ razorpayPaymentId: 1 });
// Add missing razorpaySubscriptionId index - frequently queried in webhook handlers
subscriptionSchema.index({ razorpaySubscriptionId: 1 });
// Add status index for filtering subscriptions by status
subscriptionSchema.index({ status: 1 });
// Add compound index for common queries
subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ userId: 1, paymentGateway: 1 });

const Subscription = mongoose.model("Subscription", subscriptionSchema);
module.exports = Subscription; 
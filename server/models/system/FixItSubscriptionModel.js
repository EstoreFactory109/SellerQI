/**
 * A seller's monthly "Fix it" subscription (Standard / Accelerated), mirrored from Stripe.
 *
 * Deliberately separate from Subscription (the SellerQI plan): Stripe sends both kinds through
 * the same webhooks, and a Fix it subscription ending must never touch the seller's plan.
 * Kept current by the customer.subscription.* webhooks (FixItSubscriptionService); each paid
 * month is a FixItPurchase.
 */
const mongoose = require('mongoose');

const fixItSubscriptionSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        stripeSubscriptionId: { type: String, required: true, unique: true },
        stripeCustomerId: { type: String, default: null },
        packageId: { type: String, enum: ['standard', 'accelerated'], required: true },
        packageName: { type: String, required: true },
        tasks: { type: Number, required: true },
        priceUsd: { type: Number, required: true },
        // Stripe's own vocabulary: active | past_due | unpaid | canceled | incomplete | incomplete_expired | trialing | paused
        status: { type: String, default: 'incomplete', index: true },
        cancelAtPeriodEnd: { type: Boolean, default: false },
        currentPeriodEnd: { type: Date, default: null },
        startedAt: { type: Date, default: null },
        canceledAt: { type: Date, default: null },
        endedAt: { type: Date, default: null },
        // Support is told once per cancellation, whichever path (our button, Stripe's portal) set it.
        cancelNotifiedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

/** Statuses in which the seller has a live subscription (a second one is refused). */
fixItSubscriptionSchema.statics.LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

module.exports = mongoose.model('FixItSubscription', fixItSubscriptionSchema);

/**
 * One "Fix it" package purchase (one-time Stripe Checkout payment).
 *
 * Written `pending` when checkout starts, `paid` when Stripe says so (webhook or the success
 * page, whichever comes first), `refunded` on a full refund, `expired` if checkout was
 * abandoned. Kept apart from Subscription on purpose: a seller's plan must never change
 * because they bought a one-off package.
 */
const mongoose = require('mongoose');

const fixItPurchaseSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        packageId: { type: String, enum: ['trial', 'standard', 'accelerated'], required: true },
        packageName: { type: String, required: true },
        tasks: { type: Number, required: true },
        amount: { type: Number, default: null }, // what was actually paid (after any promo code), in `currency`
        currency: { type: String, default: 'USD' },
        status: { type: String, enum: ['pending', 'paid', 'refunded', 'expired'], default: 'pending', index: true },
        stripeSessionId: { type: String, required: true, unique: true },
        stripePaymentIntentId: { type: String, default: null, index: true },
        stripeCustomerId: { type: String, default: null },
        paidAt: { type: Date, default: null },
        refundedAt: { type: Date, default: null },
        amountRefunded: { type: Number, default: 0 },
        // What the seller was looking at when they bought — context for the team.
        openTasks: { type: Number, default: null },
        monthlyRecoverable: { type: Number, default: null },
        atStakeCurrency: { type: String, default: null, maxlength: 5 }, // symbol of the marketplace currency, e.g. 'A$'
        // Set when the support email has gone out (claimed atomically so it is sent once).
        supportNotifiedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('FixItPurchase', fixItPurchaseSchema);

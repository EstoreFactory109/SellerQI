/**
 * One PAID PERIOD of a "Fix it" package: the one-time Trial, or one month of a Standard /
 * Accelerated subscription (each renewal invoice is its own row, with its own Zoho task and
 * support email). Renewal rows use `inv:<invoiceId>` as their stripeSessionId, so the
 * existing unique index on it keeps one row per invoice.
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
        // Subscription packages: which subscription, which invoice, which month (1 = first).
        billing: { type: String, enum: ['one_time', 'monthly'], default: 'one_time' },
        stripeSubscriptionId: { type: String, default: null, index: true },
        stripeInvoiceId: { type: String, default: null },
        period: { type: Number, default: null },
        periodEnd: { type: Date, default: null },
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
        // ESF clients: the Zoho task for this purchase (FixItZohoService). Claimed atomically
        // ('running') so the webhook and the success page never create it twice.
        zohoStatus: { type: String, enum: [null, 'running', 'done', 'skipped', 'failed'], default: null },
        zohoClaimedAt: { type: Date, default: null },
        zohoError: { type: String, default: null },
        zohoProjectId: { type: String, default: null },
        zohoProjectName: { type: String, default: null },
        zohoProjectSource: { type: String, enum: [null, 'linked', 'matched', 'created'], default: null },
        zohoTaskId: { type: String, default: null },
        zohoTaskName: { type: String, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('FixItPurchase', fixItPurchaseSchema);

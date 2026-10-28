/**
 * Monthly "Fix it" subscriptions (Standard / Accelerated) after the first payment.
 *
 *   syncFromStripe / upsertFromStripe — mirror a Stripe subscription into FixItSubscription
 *       (customer.subscription.* webhooks, and the first payment). Tells support once when
 *       it is cancelled, from our button or Stripe's portal alike.
 *   recordRenewal — each paid renewal invoice becomes a FixItPurchase (month 2, 3, ...), which
 *       runs the same after-payment work as the first month: a Zoho task for ESF clients, then
 *       the support email.
 *   cancel / resume / getForUser / portalUrl — what the seller does from the Tasks page.
 *
 * Stripe sends these subscriptions through the same webhooks as the SellerQI plan; the
 * webhook service routes anything with metadata.purchaseType 'fixit' here, BEFORE the plan
 * handlers — which would otherwise downgrade the seller to LITE when a Fix it subscription
 * ends, or book a Fix it renewal as a plan payment.
 */
const StripeService = require('./StripeService.js');
const FixItSubscription = require('../../models/system/FixItSubscriptionModel.js');
const FixItPurchase = require('../../models/system/FixItPurchaseModel.js');
const PaymentLogs = require('../../models/system/PaymentLogsModel.js');
const { getFixItPackage } = require('./fixItPackages.js');
const { sendFixItCancellationEmail } = require('../Email/SendFixItPurchaseEmail.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');

const PURCHASE_TYPE = 'fixit';
const stripe = () => StripeService.stripe;
const Checkout = () => require('./FixItCheckoutService.js');
const idOf = (v) => (typeof v === 'string' ? v : v?.id || null);
const fromUnix = (s) => (typeof s === 'number' ? new Date(s * 1000) : null);

const isFixIt = (subscription) => subscription?.metadata?.purchaseType === PURCHASE_TYPE;

/** current_period_end moved onto the items in API 2025-03-31.basil (see StripeService.getSubscriptionPeriod). */
const periodEndOf = (sub) => {
    const { end } = StripeService.getSubscriptionPeriod(sub);
    return fromUnix(end);
};

/** The payment intent behind an invoice — needed to match a later refund to its month. */
const paymentIntentOfInvoice = async (invoiceId) => {
    try {
        const invoice = await stripe().invoices.retrieve(invoiceId, { expand: ['payments'] });
        const paid = (invoice?.payments?.data || []).find((p) => p?.status === 'paid') || invoice?.payments?.data?.[0];
        return idOf(paid?.payment?.payment_intent) || idOf(invoice?.payment_intent) || null;
    } catch (error) {
        logger.warn(`[FixItSubscription] could not read invoice ${invoiceId}: ${error.message}`);
        return null;
    }
};

/** Tell support once per cancellation (the claim is released if the email fails). */
const notifyCancellationOnce = async (doc) => {
    const claimed = await FixItSubscription.findOneAndUpdate(
        { _id: doc._id, cancelNotifiedAt: null },
        { $set: { cancelNotifiedAt: new Date() } },
        { new: true }
    ).lean();
    if (!claimed) return;
    const sent = await sendFixItCancellationEmail(claimed);
    if (!sent) await FixItSubscription.updateOne({ _id: doc._id }, { $set: { cancelNotifiedAt: null } });
};

/**
 * Mirror one Stripe subscription. Returns the stored record, or null for one that is not ours.
 */
const upsertFromStripe = async (sub) => {
    if (!isFixIt(sub)) return null;
    const pkg = getFixItPackage(sub.metadata.packageId);
    if (!pkg) {
        logger.warn(`[FixItSubscription] ${sub.id} names unknown package ${sub.metadata.packageId}`);
        return null;
    }
    const cancelling = Boolean(sub.cancel_at_period_end) || sub.status === 'canceled';
    const doc = await FixItSubscription.findOneAndUpdate(
        { stripeSubscriptionId: sub.id },
        {
            $set: {
                status: sub.status,
                cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
                currentPeriodEnd: periodEndOf(sub),
                canceledAt: fromUnix(sub.canceled_at),
                endedAt: fromUnix(sub.ended_at),
                stripeCustomerId: idOf(sub.customer),
                // A seller who resumes, then cancels again, is a new cancellation to report.
                ...(cancelling ? {} : { cancelNotifiedAt: null }),
            },
            $setOnInsert: {
                userId: sub.metadata.userId,
                packageId: pkg.id,
                packageName: pkg.name,
                tasks: pkg.tasks,
                priceUsd: pkg.priceUsd,
                startedAt: fromUnix(sub.start_date) || new Date(),
            },
        },
        { upsert: true, new: true }
    ).lean();
    if (cancelling) await notifyCancellationOnce(doc);
    // Cancelled: no new subtasks after this month; ended: the work order winds down.
    await Promise.resolve()
        .then(() => require('./FixItZohoService.js').onSubscriptionChanged(doc))
        .catch((error) => logger.warn(`[FixItSubscription] work order not updated for ${sub.id}: ${error.message}`));
    return doc;
};

const syncFromStripe = async (subscriptionId) => upsertFromStripe(await stripe().subscriptions.retrieve(subscriptionId));

/** customer.subscription.created / updated / deleted / trial_will_end for a Fix it subscription. */
const handleSubscriptionEvent = async (sub, webhookEventId = null) => {
    const doc = await upsertFromStripe(sub);
    if (doc && webhookEventId) {
        await PaymentLogs.logWebhookEvent({
            userId: doc.userId,
            eventType: 'STRIPE_SUBSCRIPTION_UPDATED',
            paymentGateway: 'STRIPE',
            status: 'SUCCESS',
            subscriptionId: sub.id,
            message: `Fix it ${doc.packageName} subscription is ${sub.status}${sub.cancel_at_period_end ? ' (cancels at period end)' : ''}`,
            source: 'WEBHOOK',
            webhookEventId,
            metadata: { purchaseType: PURCHASE_TYPE, packageId: doc.packageId },
        });
    }
    return doc;
};

/**
 * invoice.payment_succeeded for a Fix it subscription. The first invoice
 * (billing_reason 'subscription_create') is the checkout's own payment, recorded by
 * completeFixItPurchase; every later one is a new paid month.
 */
const recordRenewal = async (invoice, sub, webhookEventId = null) => {
    if (!isFixIt(sub)) return null;
    const subscription = await upsertFromStripe(sub);
    if (invoice.billing_reason === 'subscription_create') return null;
    if (!subscription) return null;

    const paidMonths = await FixItPurchase.countDocuments({ stripeSubscriptionId: sub.id, status: { $in: ['paid', 'refunded'] } });
    const line = invoice.lines?.data?.[0];
    const purchase = await FixItPurchase.findOneAndUpdate(
        { stripeSessionId: `inv:${invoice.id}` },
        {
            $setOnInsert: {
                userId: subscription.userId,
                packageId: subscription.packageId,
                packageName: subscription.packageName,
                tasks: subscription.tasks,
                amount: typeof invoice.amount_paid === 'number' ? invoice.amount_paid / 100 : subscription.priceUsd,
                currency: String(invoice.currency || 'usd').toUpperCase(),
                status: 'paid',
                paidAt: fromUnix(invoice.status_transitions?.paid_at) || new Date(),
                stripeSessionId: `inv:${invoice.id}`,
                stripeInvoiceId: invoice.id,
                stripeSubscriptionId: sub.id,
                stripeCustomerId: idOf(invoice.customer),
                stripePaymentIntentId: await paymentIntentOfInvoice(invoice.id),
                billing: 'monthly',
                period: paidMonths + 1,
                periodEnd: fromUnix(line?.period?.end),
            },
        },
        { upsert: true, new: true }
    ).lean();

    if (webhookEventId) {
        await PaymentLogs.logWebhookEvent({
            userId: subscription.userId,
            eventType: 'STRIPE_INVOICE_PAID',
            paymentGateway: 'STRIPE',
            status: 'SUCCESS',
            amount: purchase.amount,
            currency: purchase.currency,
            subscriptionId: sub.id,
            paymentId: invoice.id,
            message: `Fix it ${subscription.packageName} renewed (month ${purchase.period})`,
            source: 'WEBHOOK',
            webhookEventId,
            metadata: { purchaseType: PURCHASE_TYPE, packageId: subscription.packageId, period: purchase.period },
        });
    }
    logger.info(`[FixItSubscription] ${sub.id} month ${purchase.period} paid for ${subscription.userId}`);
    Checkout().runInBackground(purchase._id);
    return purchase;
};

const liveFor = (userId) => FixItSubscription.findOne({ userId, status: { $in: FixItSubscription.LIVE_STATUSES } }).sort({ createdAt: -1 });

/** What the Tasks page shows: the live subscription, else the latest one (so "ended on ..." can show). */
const getForUser = async (userId) => {
    const sub = (await liveFor(userId).lean()) || (await FixItSubscription.findOne({ userId }).sort({ createdAt: -1 }).lean());
    if (!sub) return null;
    const lastPaid = await FixItPurchase.findOne({ stripeSubscriptionId: sub.stripeSubscriptionId, status: 'paid' })
        .sort({ period: -1 }).select('period paidAt').lean();
    return {
        packageId: sub.packageId,
        packageName: sub.packageName,
        tasks: sub.tasks,
        priceUsd: sub.priceUsd,
        status: sub.status,
        live: FixItSubscription.LIVE_STATUSES.includes(sub.status),
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        currentPeriodEnd: sub.currentPeriodEnd,
        endedAt: sub.endedAt,
        monthsPaid: lastPaid?.period || 0,
    };
};

const setCancelAtPeriodEnd = async (userId, value) => {
    const sub = await liveFor(userId).lean();
    if (!sub) throw new ApiError(404, 'You have no active Fix it subscription');
    const updated = await stripe().subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: value });
    await upsertFromStripe(updated);
    logger.info(`[FixItSubscription] ${userId} ${value ? 'cancelled' : 'resumed'} ${sub.stripeSubscriptionId}`);
    return getForUser(userId);
};

/** Cancel at the end of the paid month: the team keeps working until then; no refund, no proration. */
const cancel = (userId) => setCancelAtPeriodEnd(userId, true);
/** Undo a cancellation before the month ends. */
const resume = (userId) => setCancelAtPeriodEnd(userId, false);

/** Stripe's customer portal, for updating the card (needs the portal configured in Stripe). */
const portalUrl = async (userId) => {
    const sub = (await liveFor(userId).lean()) || (await FixItSubscription.findOne({ userId }).sort({ createdAt: -1 }).lean());
    if (!sub?.stripeCustomerId) throw new ApiError(404, 'You have no Fix it subscription');
    try {
        const session = await stripe().billingPortal.sessions.create({
            customer: sub.stripeCustomerId,
            return_url: `${Checkout().frontendBase()}/seller-central-checker/tasks`,
        });
        return session.url;
    } catch (error) {
        logger.error(`[FixItSubscription] billing portal unavailable: ${error.message}`);
        throw new ApiError(503, 'Updating your card online is not available right now. Please contact support.');
    }
};

module.exports = {
    isFixIt,
    upsertFromStripe,
    syncFromStripe,
    handleSubscriptionEvent,
    recordRenewal,
    paymentIntentOfInvoice,
    getForUser,
    cancel,
    resume,
    portalUrl,
};

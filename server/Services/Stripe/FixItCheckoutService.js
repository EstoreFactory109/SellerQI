/**
 * Buying a "Fix it" package: a one-time Stripe Checkout payment.
 *
 *   start   — createFixItCheckout: the server picks the price (by lookup_key); the client only
 *             names the package. Never touches the seller's Subscription.
 *   finish  — completeFixItPurchase: called by BOTH the webhook (checkout.session.completed) and
 *             the success page (/fix-it/confirm). Either may arrive first or alone, so it is
 *             idempotent, and the support email is claimed atomically so it goes out once.
 *   refund  — handleFixItRefund: a refunded package charge marks the purchase, and must never
 *             reach the subscription refund logic (same Stripe customer for PRO sellers).
 */
const StripeService = require('./StripeService.js');
const FixItPurchase = require('../../models/system/FixItPurchaseModel.js');
const User = require('../../models/user-auth/userModel.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const PaymentLogs = require('../../models/system/PaymentLogsModel.js');
const { getFixItPackage, productName } = require('./fixItPackages.js');
const { sendFixItPurchaseEmail } = require('../Email/SendFixItPurchaseEmail.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');

const PURCHASE_TYPE = 'fixit';
const stripe = () => StripeService.stripe;

const frontendBase = () => {
    const base = process.env.FRONTEND_URL || 'http://localhost:3000';
    return (/^https?:\/\//.test(base) ? base : `https://${base}`).replace(/\/+$/, '');
};

const priceCache = new Map();
/**
 * The Stripe Price for a package, by lookup_key. Refuses one whose amount or currency differs
 * from the server's list — better no sale than charging a price nobody agreed to.
 */
const resolvePrice = async (pkg) => {
    if (priceCache.has(pkg.id)) return priceCache.get(pkg.id);
    const { data } = await stripe().prices.list({ lookup_keys: [pkg.lookupKey], active: true, limit: 1 });
    const price = data?.[0];
    if (!price) {
        logger.error(`[FixIt] no active Stripe price with lookup_key ${pkg.lookupKey} — run server/scripts/createFixItStripePrices.js`);
        throw new ApiError(503, 'Fix it packages cannot be bought right now. Please contact support.');
    }
    if (price.currency !== 'usd' || price.unit_amount !== pkg.priceUsd * 100 || price.type !== 'one_time') {
        logger.error(`[FixIt] Stripe price ${price.id} (${price.unit_amount} ${price.currency}, ${price.type}) does not match ${pkg.id} $${pkg.priceUsd}`);
        throw new ApiError(503, 'Fix it packages cannot be bought right now. Please contact support.');
    }
    priceCache.set(pkg.id, price.id);
    return price.id;
};

/**
 * Reuse the seller's Stripe customer: their subscription's (createOrGetCustomer), else the one
 * from an earlier package — so a LITE seller buying twice does not get two customers.
 */
const customerFor = async (user) => {
    const hasSubscriptionCustomer = await Subscription.exists({ userId: user._id, stripeCustomerId: { $nin: [null, ''] } });
    if (!hasSubscriptionCustomer) {
        const earlier = await FixItPurchase.findOne({ userId: user._id, stripeCustomerId: { $ne: null } })
            .sort({ createdAt: -1 }).select('stripeCustomerId').lean();
        if (earlier?.stripeCustomerId) {
            try {
                const customer = await stripe().customers.retrieve(earlier.stripeCustomerId);
                if (customer && !customer.deleted) return customer;
            } catch (_) { /* gone: make a new one below */ }
        }
    }
    return StripeService.createOrGetCustomer(user._id, user.email, `${user.firstName || ''} ${user.lastName || ''}`.trim());
};

const finiteOrNull = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null);

/**
 * @returns {Promise<{ url: string, sessionId: string }>}
 */
const createFixItCheckout = async (userId, { packageId, openTasks, monthlyRecoverable, atStakeCurrency } = {}) => {
    const pkg = getFixItPackage(packageId);
    if (!pkg) throw new ApiError(400, 'Unknown Fix it package');
    if (!process.env.STRIPE_SECRET_KEY) throw new ApiError(503, 'Payments are not configured');

    const user = await User.findById(userId).select('firstName lastName email').lean();
    if (!user) throw new ApiError(404, 'User not found');

    const priceId = await resolvePrice(pkg);
    const customer = await customerFor(user);
    const metadata = { userId: String(user._id), purchaseType: PURCHASE_TYPE, packageId: pkg.id };
    const base = frontendBase();

    const session = await stripe().checkout.sessions.create({
        mode: 'payment',
        customer: customer.id,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata,
        // receipt_email makes Stripe send the seller a receipt whatever the dashboard setting.
        payment_intent_data: { metadata, description: productName(pkg), ...(user.email ? { receipt_email: user.email } : {}) },
        allow_promotion_codes: true,
        success_url: `${base}/fix-it/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/seller-central-checker/tasks?fixit=cancelled`,
    });

    await FixItPurchase.create({
        userId: user._id,
        packageId: pkg.id,
        packageName: pkg.name,
        tasks: pkg.tasks,
        amount: pkg.priceUsd,
        currency: 'USD',
        stripeSessionId: session.id,
        stripeCustomerId: customer.id,
        openTasks: finiteOrNull(openTasks),
        monthlyRecoverable: finiteOrNull(monthlyRecoverable),
        atStakeCurrency: typeof atStakeCurrency === 'string' ? atStakeCurrency.slice(0, 5) : null,
    });
    await PaymentLogs.logEvent({
        userId: user._id,
        eventType: 'STRIPE_CHECKOUT_CREATED',
        paymentGateway: 'STRIPE',
        status: 'PENDING',
        amount: pkg.priceUsd,
        currency: 'USD',
        orderId: session.id,
        message: `Fix it checkout started: ${pkg.name} ($${pkg.priceUsd})`,
        source: 'API',
        metadata: { purchaseType: PURCHASE_TYPE, packageId: pkg.id },
    });
    logger.info(`[FixIt] checkout ${session.id} started for ${user._id}: ${pkg.id}`);
    return { url: session.url, sessionId: session.id };
};

/** Send the support email once; release the claim if it fails so the other path retries. */
const notifySupportOnce = async (purchase) => {
    const claimed = await FixItPurchase.findOneAndUpdate(
        { _id: purchase._id, supportNotifiedAt: null },
        { $set: { supportNotifiedAt: new Date() } },
        { new: true }
    ).lean();
    if (!claimed) return false;
    const sent = await sendFixItPurchaseEmail(claimed);
    if (!sent) {
        await FixItPurchase.updateOne({ _id: purchase._id }, { $set: { supportNotifiedAt: null } });
        return false;
    }
    return true;
};

/**
 * Record a paid Checkout session and tell support. Safe to call any number of times.
 * @param {object} session  a Stripe Checkout Session with metadata.purchaseType === 'fixit'
 * @param {{ source: 'WEBHOOK'|'API', webhookEventId?: string }} opts
 * @returns {Promise<object|null>} the purchase, or null while the payment is not complete
 */
const completeFixItPurchase = async (session, { source = 'API', webhookEventId = null } = {}) => {
    if (session?.metadata?.purchaseType !== PURCHASE_TYPE) return null;
    if (session.payment_status !== 'paid') {
        logger.info(`[FixIt] session ${session.id} is ${session.payment_status}, not recording yet`);
        return null;
    }
    const pkg = getFixItPackage(session.metadata.packageId);
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
    const amount = typeof session.amount_total === 'number' ? session.amount_total / 100 : null;

    let purchase = await FixItPurchase.findOne({ stripeSessionId: session.id });
    if (!purchase) {
        // The row written at checkout is missing (it should not be) — rebuild it from Stripe.
        purchase = await FixItPurchase.findOneAndUpdate(
            { stripeSessionId: session.id },
            { $setOnInsert: {
                userId: session.metadata.userId,
                packageId: pkg?.id || session.metadata.packageId,
                packageName: pkg?.name || session.metadata.packageId,
                tasks: pkg?.tasks || 0,
                stripeSessionId: session.id,
            } },
            { upsert: true, new: true }
        );
    }
    if (purchase.status === 'refunded') return purchase.toObject();

    const transitioned = await FixItPurchase.findOneAndUpdate(
        { _id: purchase._id, status: { $in: ['pending', 'expired'] } },
        { $set: {
            status: 'paid',
            paidAt: new Date(),
            amount,
            currency: (session.currency || 'usd').toUpperCase(),
            stripePaymentIntentId: paymentIntentId,
            stripeCustomerId: customerId || purchase.stripeCustomerId,
        } },
        { new: true }
    );
    const current = transitioned || await FixItPurchase.findById(purchase._id);

    if (transitioned || webhookEventId) {
        const log = {
            userId: current.userId,
            eventType: 'STRIPE_PAYMENT_SUCCESS',
            paymentGateway: 'STRIPE',
            status: 'SUCCESS',
            amount: current.amount ?? undefined,
            currency: current.currency,
            paymentId: paymentIntentId,
            orderId: session.id,
            message: `Fix it package paid: ${current.packageName} (${current.tasks} tasks)`,
            source,
            metadata: { purchaseType: PURCHASE_TYPE, packageId: current.packageId },
        };
        if (webhookEventId) await PaymentLogs.logWebhookEvent({ ...log, webhookEventId });
        else await PaymentLogs.logEvent(log);
    }
    if (transitioned) logger.info(`[FixIt] purchase ${current._id} paid (${source}): ${current.packageId} for ${current.userId}`);

    await notifySupportOnce(current);
    return current.toObject();
};

/**
 * Success page: check the session is this seller's and record it if paid.
 * @returns {Promise<{ status: 'paid'|'processing', purchase?: object }>}
 */
const confirmFixItPurchase = async (sessionId, userId) => {
    if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(String(sessionId))) throw new ApiError(400, 'Session ID is required');
    let session;
    try {
        session = await stripe().checkout.sessions.retrieve(sessionId);
    } catch (err) {
        throw new ApiError(404, 'Checkout session not found');
    }
    if (session?.metadata?.purchaseType !== PURCHASE_TYPE || session.metadata.userId !== String(userId)) {
        throw new ApiError(403, 'Session does not belong to this user');
    }
    const purchase = await completeFixItPurchase(session, { source: 'API' });
    if (!purchase || purchase.status !== 'paid') return { status: 'processing' };
    return {
        status: 'paid',
        purchase: {
            packageId: purchase.packageId,
            packageName: purchase.packageName,
            tasks: purchase.tasks,
            amount: purchase.amount,
            currency: purchase.currency,
            paidAt: purchase.paidAt,
        },
    };
};

/** An abandoned checkout: mark the pending row so it is not mistaken for an open order. */
const expireFixItCheckout = async (session) => {
    if (session?.metadata?.purchaseType !== PURCHASE_TYPE) return false;
    await FixItPurchase.updateOne({ stripeSessionId: session.id, status: 'pending' }, { $set: { status: 'expired' } });
    return true;
};

/**
 * A refunded charge. Returns true when it belonged to a Fix it package (handled here, and the
 * caller must stop), false when it is someone else's business (subscriptions).
 */
const handleFixItRefund = async (charge, webhookEventId = null) => {
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    const purchase = paymentIntentId ? await FixItPurchase.findOne({ stripePaymentIntentId: paymentIntentId }) : null;
    if (!purchase && charge.metadata?.purchaseType !== PURCHASE_TYPE) return false;

    const isFullRefund = charge.amount_refunded >= charge.amount;
    if (purchase) {
        await FixItPurchase.updateOne({ _id: purchase._id }, { $set: {
            amountRefunded: charge.amount_refunded / 100,
            ...(isFullRefund ? { status: 'refunded', refundedAt: new Date() } : {}),
        } });
    }
    await PaymentLogs.logWebhookEvent({
        userId: purchase?.userId || charge.metadata?.userId,
        eventType: 'STRIPE_CHARGE_REFUNDED',
        paymentGateway: 'STRIPE',
        status: 'SUCCESS',
        paymentId: charge.id,
        amount: charge.amount_refunded / 100,
        currency: (charge.currency || 'usd').toUpperCase(),
        message: `Fix it package ${isFullRefund ? 'fully' : 'partly'} refunded`,
        source: 'WEBHOOK',
        webhookEventId,
        metadata: { purchaseType: PURCHASE_TYPE, packageId: purchase?.packageId || charge.metadata?.packageId },
    });
    logger.info(`[FixIt] refund on ${charge.id} recorded (${isFullRefund ? 'full' : 'partial'}); subscription untouched`);
    return true;
};

module.exports = {
    PURCHASE_TYPE,
    createFixItCheckout,
    completeFixItPurchase,
    confirmFixItPurchase,
    expireFixItCheckout,
    handleFixItRefund,
    _priceCache: priceCache,
};

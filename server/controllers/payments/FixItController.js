/**
 * "Fix it" package purchases (Tasks page).
 *   POST /app/stripe/fix-it/checkout  { packageId, openTasks?, monthlyRecoverable?, atStakeCurrency? }  → { url }
 *   GET  /app/stripe/fix-it/confirm?session_id=cs_…                                  → { status, purchase? }
 *   GET  /app/stripe/fix-it/subscription                → the seller's Fix it subscription, or null
 *   POST /app/stripe/fix-it/subscription/cancel         → cancels at the end of the paid month
 *   POST /app/stripe/fix-it/subscription/resume         → undoes that, before the month ends
 *   POST /app/stripe/fix-it/subscription/portal         → { url } of Stripe's portal (update card)
 * The rules live in Services/Stripe/FixItCheckoutService.js and FixItSubscriptionService.js.
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const FixItCheckoutService = require('../../Services/Stripe/FixItCheckoutService.js');
const FixItSubscriptionService = require('../../Services/Stripe/FixItSubscriptionService.js');

const fail = (res, error, fallback) => {
    if (error instanceof ApiError) {
        if (error.statusCode >= 500) logger.error(error);
        return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    }
    logger.error(`[FixIt] ${fallback}: ${error?.message}`);
    return res.status(500).json(new ApiResponse(500, null, fallback));
};

const createFixItCheckout = asyncHandler(async (req, res) => {
    try {
        const { packageId, openTasks, monthlyRecoverable, atStakeCurrency } = req.body || {};
        const data = await FixItCheckoutService.createFixItCheckout(req.userId, { packageId, openTasks, monthlyRecoverable, atStakeCurrency });
        return res.status(200).json(new ApiResponse(200, data, 'Checkout session created'));
    } catch (error) {
        return fail(res, error, 'Could not start checkout. Please try again.');
    }
});

const confirmFixItPurchase = asyncHandler(async (req, res) => {
    try {
        const data = await FixItCheckoutService.confirmFixItPurchase(req.query.session_id, req.userId);
        return res.status(200).json(new ApiResponse(200, data, 'OK'));
    } catch (error) {
        return fail(res, error, 'Could not confirm the payment');
    }
});

const handle = (fn, fallback) => asyncHandler(async (req, res) => {
    try {
        return res.status(200).json(new ApiResponse(200, await fn(req), 'OK'));
    } catch (error) {
        return fail(res, error, fallback);
    }
});

const getFixItSubscription = handle((req) => FixItSubscriptionService.getForUser(req.userId), 'Could not load your Fix it subscription');
const cancelFixItSubscription = handle((req) => FixItSubscriptionService.cancel(req.userId), 'Could not cancel your Fix it subscription. Please try again.');
const resumeFixItSubscription = handle((req) => FixItSubscriptionService.resume(req.userId), 'Could not resume your Fix it subscription. Please try again.');
const fixItBillingPortal = handle(async (req) => ({ url: await FixItSubscriptionService.portalUrl(req.userId) }), 'Could not open billing');

module.exports = {
    createFixItCheckout,
    confirmFixItPurchase,
    getFixItSubscription,
    cancelFixItSubscription,
    resumeFixItSubscription,
    fixItBillingPortal,
};

/**
 * "Fix it" package purchases (Tasks page).
 *   POST /app/stripe/fix-it/checkout  { packageId, openTasks?, monthlyRecoverable?, atStakeCurrency? }  → { url }
 *   GET  /app/stripe/fix-it/confirm?session_id=cs_…                                  → { status, purchase? }
 * The rules live in Services/Stripe/FixItCheckoutService.js.
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const FixItCheckoutService = require('../../Services/Stripe/FixItCheckoutService.js');

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

module.exports = { createFixItCheckout, confirmFixItPurchase };

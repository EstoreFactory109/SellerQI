const { body, validationResult } = require("express-validator");

/**
 * Validate Razorpay order creation
 * Only PRO plan is available for Razorpay (India)
 */
const validateRazorpayOrder = [
    body("planType")
        .trim()
        .notEmpty().withMessage("Plan type is required")
        .equals('PRO').withMessage("Only PRO plan is available for Razorpay"),

    body("trialPeriodDays")
        .optional()
        .isInt({ min: 0, max: 365 }).withMessage("Trial period must be between 0 and 365 days"),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                statusCode: 400,
                message: "Validation failed",
                errors: errors.array() 
            });
        }
        next();
    }
];

/**
 * Validate Razorpay payment verification
 */
const validateRazorpayPayment = [
    body("razorpay_subscription_id")
        .trim()
        .notEmpty().withMessage("Razorpay subscription ID is required")
        .isLength({ min: 10 }).withMessage("Invalid subscription ID format"),

    body("razorpay_payment_id")
        .trim()
        .notEmpty().withMessage("Razorpay payment ID is required")
        .isLength({ min: 10 }).withMessage("Invalid payment ID format"),

    body("razorpay_signature")
        .trim()
        .notEmpty().withMessage("Razorpay signature is required")
        .isLength({ min: 10 }).withMessage("Invalid signature format"),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                statusCode: 400,
                message: "Validation failed",
                errors: errors.array() 
            });
        }
        next();
    }
];

module.exports = {
    validateRazorpayOrder,
    validateRazorpayPayment
};

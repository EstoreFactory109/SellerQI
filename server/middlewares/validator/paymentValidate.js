const { body, validationResult } = require("express-validator");

/**
 * Validate Stripe checkout session creation
 */
const validateCheckoutSession = [
    body("planType")
        .trim()
        .notEmpty().withMessage("Plan type is required")
        .isIn(['PRO', 'AGENCY']).withMessage("Plan type must be either PRO or AGENCY"),

    body("couponCode")
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 }).withMessage("Coupon code must be between 1 and 50 characters"),

    body("trialPeriodDays")
        .optional()
        .isInt({ min: 0, max: 365 }).withMessage("Trial period must be between 0 and 365 days")
        .custom((value, { req }) => {
            // Trial period is only allowed for PRO plan
            if (value !== undefined && value !== null && req.body.planType !== 'PRO') {
                throw new Error('Trial period is only available for PRO plan');
            }
            return true;
        }),

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
    validateCheckoutSession
};

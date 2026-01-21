const { body, validationResult } = require("express-validator");

/**
 * Validate subscription plan update
 */
const validateUpdateSubscriptionPlan = [
    body("planType")
        .trim()
        .notEmpty().withMessage("Plan type is required")
        .isIn(['LITE', 'PRO', 'AGENCY']).withMessage("Plan type must be LITE, PRO, or AGENCY"),

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
    validateUpdateSubscriptionPlan
};

const { body, validationResult } = require("express-validator");

/**
 * Validate OTP resend request
 */
const validateOtpResend = [
    body("email")
        .trim()
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email format")
        .normalizeEmail(),

    // Phone is optional (commented out in controller)
    body("phone")
        .optional()
        .trim()
        .isNumeric().withMessage("Phone number must contain only numbers")
        .isLength({ min: 10, max: 10 }).withMessage("Phone number must be exactly 10 digits"),

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
    validateOtpResend
};

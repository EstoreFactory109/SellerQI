const { body, validationResult } = require("express-validator");

/**
 * Validate email for password reset request
 */
const validatePasswordResetEmail = [
    body("email")
        .trim()
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email format")
        .normalizeEmail(),

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
 * Validate reset password code
 */
const validateResetPasswordCode = [
    body("code")
        .trim()
        .notEmpty().withMessage("Reset code is required")
        .isLength({ min: 10 }).withMessage("Invalid reset code format"),

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
 * Validate new password for reset
 */
const validateNewPassword = [
    body("code")
        .trim()
        .notEmpty().withMessage("Reset code is required")
        .isLength({ min: 10 }).withMessage("Invalid reset code format"),

    body("newPassword")
        .trim()
        .notEmpty().withMessage("New password is required")
        .isLength({ min: 8 }).withMessage("Password must be at least 8 characters long")
        .matches(/[A-Z]/).withMessage("Password must contain at least one uppercase letter")
        .matches(/[a-z]/).withMessage("Password must contain at least one lowercase letter")
        .matches(/[0-9]/).withMessage("Password must contain at least one number")
        .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage("Password must contain at least one special character"),

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
    validatePasswordResetEmail,
    validateResetPasswordCode,
    validateNewPassword
};

const { body, validationResult } = require("express-validator");

/**
 * Validate admin login credentials
 */
const validateAdminLogin = [
    body("email")
        .trim()
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email format")
        .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false, outlookdotcom_remove_subaddress: false, yahoo_remove_subaddress: false, icloud_remove_subaddress: false }),

    body("password")
        .trim()
        .notEmpty().withMessage("Password is required"),

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
    validateAdminLogin
};

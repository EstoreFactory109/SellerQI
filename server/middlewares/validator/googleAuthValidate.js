const { body, validationResult } = require("express-validator");

/**
 * Validate Google OAuth ID token
 */
const validateGoogleIdToken = [
    body("idToken")
        .trim()
        .notEmpty().withMessage("Google ID token is required")
        .isLength({ min: 100 }).withMessage("Invalid Google ID token format"),

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
    validateGoogleIdToken
};

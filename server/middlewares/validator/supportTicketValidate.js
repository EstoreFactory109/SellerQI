const { body, validationResult } = require("express-validator");

/**
 * Validate support ticket creation
 */
const validateSupportTicket = [
    body("email")
        .trim()
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email format")
        .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false, outlookdotcom_remove_subaddress: false, yahoo_remove_subaddress: false, icloud_remove_subaddress: false }),

    body("name")
        .trim()
        .notEmpty().withMessage("Name is required")
        .isLength({ min: 2, max: 100 }).withMessage("Name must be between 2 and 100 characters"),

    body("subject")
        .trim()
        .notEmpty().withMessage("Subject is required")
        .isLength({ min: 5, max: 200 }).withMessage("Subject must be between 5 and 200 characters"),

    body("message")
        .trim()
        .notEmpty().withMessage("Message is required")
        .isLength({ min: 10, max: 5000 }).withMessage("Message must be between 10 and 5000 characters"),

    body("topic")
        .trim()
        .notEmpty().withMessage("Topic is required")
        .isLength({ min: 2, max: 50 }).withMessage("Topic must be between 2 and 50 characters"),

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
    validateSupportTicket
};

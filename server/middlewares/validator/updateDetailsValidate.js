const { body, validationResult } = require("express-validator");

/**
 * Validate user details update
 * All fields are optional - user can update any combination of fields
 */
const validateUpdateDetails = [
    body("firstname")
        .optional()
        .trim()
        .isAlpha().withMessage("First name must contain only letters")
        .isLength({ min: 2, max: 50 }).withMessage("First name must be between 2 to 50 characters"),

    body("lastname")
        .optional()
        .trim()
        .isAlpha().withMessage("Last name must contain only letters")
        .isLength({ min: 2, max: 50 }).withMessage("Last name must be between 2 to 50 characters"),

    body("phone")
        .optional()
        .trim()
        .isNumeric().withMessage("Phone number must contain only numbers")
        .isLength({ min: 10, max: 10 }).withMessage("Phone number must be exactly 10 digits"),

    body("whatsapp")
        .optional()
        .trim()
        .isNumeric().withMessage("WhatsApp number must contain only numbers")
        .isLength({ min: 10, max: 10 }).withMessage("WhatsApp number must be exactly 10 digits"),

    body("email")
        .optional()
        .trim()
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

module.exports = {
    validateUpdateDetails
};

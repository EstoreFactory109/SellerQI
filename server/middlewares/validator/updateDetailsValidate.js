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

    // Same rules as registerValidate.js. These used to require exactly 10 bare
    // digits, which rejected every number stored with its country code - so a
    // user with "+919876543210" could not save their profile at all.
    body("phone")
        .optional()
        .trim()
        .custom((value) => {
            const cleaned = value.replace(/[\s\-\(\)]/g, '');
            const digitsOnly = cleaned.replace(/^\+/, '');
            if (!/^\d+$/.test(digitsOnly)) {
                throw new Error('Phone number must contain only numbers');
            }
            if (digitsOnly.length < 10 || digitsOnly.length > 15) {
                throw new Error('Phone number must be between 10 and 15 digits');
            }
            return true;
        })
        .customSanitizer((value) => value.replace(/[\s\-\(\)]/g, '')),

    body("whatsapp")
        .optional()
        .trim()
        .custom((value) => {
            const cleaned = value.replace(/[\s\-\(\)]/g, '');
            const digitsOnly = cleaned.replace(/^\+/, '');
            if (!/^\d+$/.test(digitsOnly)) {
                throw new Error('WhatsApp number must contain only numbers');
            }
            if (digitsOnly.length < 10 || digitsOnly.length > 15) {
                throw new Error('WhatsApp number must be between 10 and 15 digits');
            }
            return true;
        })
        .customSanitizer((value) => value.replace(/[\s\-\(\)]/g, '')),

    body("email")
        .optional()
        .trim()
        .isEmail().withMessage("Invalid email format")
        .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false, outlookdotcom_remove_subaddress: false, yahoo_remove_subaddress: false, icloud_remove_subaddress: false }),

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

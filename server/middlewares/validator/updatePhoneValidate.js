const { body, validationResult } = require("express-validator");

/**
 * Validate the phone number submitted from the phone-collection modal.
 *
 * Deliberately mirrors the phone rules in registerValidate.js: the leading "+"
 * (country code) is preserved, only formatting characters are stripped. Do not
 * copy updateDetailsValidate.js here - that one still forces exactly 10 bare
 * digits and would silently drop the country code we are trying to collect.
 */
const validateUpdatePhone = [
    body("phone")
        .trim()
        .notEmpty().withMessage("Phone number is required")
        .custom((value) => {
            // Strip spaces, dashes, and parentheses, but keep a leading "+" (country code)
            const cleaned = value.replace(/[\s\-\(\)]/g, '');
            const digitsOnly = cleaned.replace(/^\+/, '');
            if (!/^\d+$/.test(digitsOnly)) {
                throw new Error('Phone number must contain only numbers');
            }
            if (!cleaned.startsWith('+')) {
                throw new Error('Country code is required');
            }
            // 10 digits minimum (a bare local number), 15 max (E.164 with country code)
            if (digitsOnly.length < 10 || digitsOnly.length > 15) {
                throw new Error('Phone number must be between 10 and 15 digits');
            }
            return true;
        })
        .customSanitizer((value) => value.replace(/[\s\-\(\)]/g, '')),

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                statusCode: 400,
                message: errors.array()[0]?.msg || "Validation failed",
                errors: errors.array()
            });
        }
        next();
    }
];

module.exports = { validateUpdatePhone };

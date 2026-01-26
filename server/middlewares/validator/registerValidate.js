const { body, validationResult } = require("express-validator");

const validateSignup = [
    body("firstname")
        .trim()
        .notEmpty().withMessage("First name is required")
        .isAlpha().withMessage("First name must contain only letters")
        .isLength({ min: 2, max: 50 }).withMessage("First name must be between 2 to 50 characters"),
        
    body("lastname")
        .trim()
        .notEmpty().withMessage("Last name is required")
        .isAlpha().withMessage("Last name must contain only letters")
        .isLength({ min: 2, max: 50 }).withMessage("Last name must be between 2 to 50 characters"),
        
    body("phone")
        .trim()
        .notEmpty().withMessage("Phone number is required")
        .custom((value) => {
            // Remove country code, spaces, dashes, and parentheses
            const cleaned = value.replace(/[\s\-\(\)\+]/g, '');
            // Check if it's numeric and has at least 10 digits
            if (!/^\d+$/.test(cleaned)) {
                throw new Error('Phone number must contain only numbers');
            }
            // Extract last 10 digits (in case country code is included)
            const last10Digits = cleaned.slice(-10);
            if (last10Digits.length !== 10) {
                throw new Error('Phone number must contain at least 10 digits');
            }
            return true;
        })
        .customSanitizer((value) => {
            // Extract last 10 digits and store in req.body for controller use
            const cleaned = value.replace(/[\s\-\(\)\+]/g, '');
            return cleaned.slice(-10);
        }),
        
    body("whatsapp")
        .optional() // WhatsApp is optional - controller uses phone as whatsapp if not provided
        .trim()
        .isNumeric().withMessage("WhatsApp number must contain only numbers")
        .isLength({ min: 10, max: 10 }).withMessage("WhatsApp number must be exactly 10 digits"),
        
    body("email")
        .trim()
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email format")
        .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false, outlookdotcom_remove_subaddress: false, yahoo_remove_subaddress: false, icloud_remove_subaddress: false }),
        
    body("password")
        .trim()
        .notEmpty().withMessage("Password is required")
        .isLength({ min: 8 }).withMessage("Password must be at least 8 characters long")
        .matches(/[A-Z]/).withMessage("Password must contain at least one uppercase letter")
        .matches(/[a-z]/).withMessage("Password must contain at least one lowercase letter")
        .matches(/[0-9]/).withMessage("Password must contain at least one number")
        .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage("Password must contain at least one special character"),
        
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

module.exports = validateSignup;

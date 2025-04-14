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
        .isNumeric().withMessage("Phone number must contain only numbers")
        .isLength({ min: 10, max: 10 }).withMessage("Phone number must be exactly 10 digits"),
        
    body("whatsapp")
        .trim()
        .notEmpty().withMessage("WhatsApp number is required")
        .isNumeric().withMessage("WhatsApp number must contain only numbers")
        .isLength({ min: 10, max: 10 }).withMessage("WhatsApp number must be exactly 10 digits"),
        
    body("email")
        .trim()
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Invalid email format")
        .normalizeEmail(),
        
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

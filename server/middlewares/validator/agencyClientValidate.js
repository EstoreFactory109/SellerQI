const { body, validationResult } = require("express-validator");

/**
 * Validate agency client registration
 * Similar to regular registration but for agency clients
 */
const validateAgencyClientRegistration = [
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

    body("allTermsAndConditionsAgreed")
        .optional()
        .isBoolean().withMessage("Terms agreement must be a boolean")
        .custom((value) => {
            if (value !== undefined && value !== true) {
                throw new Error('You must agree to the Terms of Use and Privacy Policy');
            }
            return true;
        }),
        
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
    validateAgencyClientRegistration
};

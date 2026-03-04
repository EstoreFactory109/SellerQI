const { body, validationResult } = require('express-validator');

/**
 * Validate agency admin profile update (all fields optional; email is not allowed to be updated).
 */
const validateAgencyAdminProfile = [
    body('firstName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 }).withMessage('First name must be between 1 and 50 characters'),
    body('lastName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 }).withMessage('Last name must be between 1 and 50 characters'),
    body('phone')
        .optional()
        .trim()
        .isLength({ min: 1, max: 20 }).withMessage('Phone must be between 1 and 20 characters'),
    body('whatsapp')
        .optional()
        .trim()
        .isLength({ min: 1, max: 20 }).withMessage('WhatsApp must be between 1 and 20 characters'),
    body('agencyName')
        .optional()
        .trim()
        .isLength({ max: 100 }).withMessage('Agency name must not exceed 100 characters'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                statusCode: 400,
                message: errors.array()[0]?.msg || 'Validation failed',
                errors: errors.array()
            });
        }
        next();
    }
];

module.exports = { validateAgencyAdminProfile };

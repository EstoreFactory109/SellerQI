const { query } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** GET /app/getUserDetails/user - query: email (optional), phone (optional); at least one required */
const validateGetUserQuery = [
    query('email')
        .optional()
        .trim(),
    query('phone')
        .optional()
        .trim(),
    (req, res, next) => {
        const email = (req.query.email || '').trim();
        const phone = (req.query.phone || '').trim();
        if (!email && !phone) {
            return res.status(400).json({
                success: false,
                message: 'Either email or phone parameter is required',
                errors: []
            });
        }
        next();
    }
];

module.exports = {
    validateGetUserQuery
};

const { query } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/**
 * GET /api/total-sales/filter
 * Query: periodType (optional, default last30), startDate, endDate (required when periodType=custom)
 * Controller already defaults periodType to last30 when missing/undefined.
 */
const validateTotalSalesFilterQuery = [
    query('periodType')
        .optional()
        .trim()
        .isIn(['last30', 'last7', 'custom']).withMessage('periodType must be last30, last7, or custom'),
    query('startDate')
        .optional()
        .trim()
        .isISO8601().withMessage('startDate must be a valid ISO date (YYYY-MM-DD)'),
    query('endDate')
        .optional()
        .trim()
        .isISO8601().withMessage('endDate must be a valid ISO date (YYYY-MM-DD)'),
    handleValidationResult,
    (req, res, next) => {
        const periodType = (req.query.periodType || '').trim() || 'last30';
        if (periodType === 'custom' && (!req.query.startDate || !req.query.endDate)) {
            return res.status(400).json({
                success: false,
                message: 'startDate and endDate are required for custom range',
                errors: []
            });
        }
        next();
    }
];

module.exports = {
    validateTotalSalesFilterQuery
};

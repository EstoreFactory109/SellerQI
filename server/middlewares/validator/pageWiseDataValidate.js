const { param, body } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** GET /api/pagewise/product-history/:asin - ASIN typically 10 chars, allow 1-15 for safety */
const validateAsinParam = [
    param('asin')
        .trim()
        .notEmpty().withMessage('ASIN is required')
        .isLength({ min: 1, max: 15 }).withMessage('ASIN must be between 1 and 15 characters'),
    handleValidationResult
];

/** PUT /api/pagewise/tasks/status - body: taskId, status (both required in controller) */
const validateTaskStatusBody = [
    body('taskId')
        .notEmpty().withMessage('taskId is required'),
    body('status')
        .notEmpty().withMessage('status is required'),
    handleValidationResult
];

module.exports = {
    validateAsinParam,
    validateTaskStatusBody
};

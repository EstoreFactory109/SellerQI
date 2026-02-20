const { param, body } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** GET /api/integration/status/:jobId - jobId must be non-empty */
const validateJobIdParam = [
    param('jobId')
        .trim()
        .notEmpty().withMessage('Job ID is required')
        .isLength({ max: 256 }).withMessage('Job ID is too long'),
    handleValidationResult
];

/** POST /api/integration/admin/trigger - body: userId, country, region (from controller) */
const validateAdminTriggerBody = [
    body('userId')
        .trim()
        .notEmpty().withMessage('User ID is required'),
    body('country')
        .trim()
        .notEmpty().withMessage('Country is required'),
    body('region')
        .trim()
        .notEmpty().withMessage('Region is required'),
    handleValidationResult
];

module.exports = {
    validateJobIdParam,
    validateAdminTriggerBody
};

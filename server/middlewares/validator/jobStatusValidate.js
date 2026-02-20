const { param } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** GET /app/job-status/status/user/:userId */
const validateUserIdParam = [
    param('userId')
        .trim()
        .notEmpty().withMessage('User ID is required'),
    handleValidationResult
];

/** GET /app/job-status/status/job/:jobId */
const validateJobIdParam = [
    param('jobId')
        .trim()
        .notEmpty().withMessage('Job ID is required'),
    handleValidationResult
];

module.exports = {
    validateUserIdParam,
    validateJobIdParam
};

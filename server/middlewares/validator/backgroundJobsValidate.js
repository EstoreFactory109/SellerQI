const { param } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** POST /app/jobs/admin/trigger/:jobName */
const validateJobNameParam = [
    param('jobName')
        .trim()
        .notEmpty().withMessage('Job name is required'),
    handleValidationResult
];

/** POST /app/jobs/admin/initialize-user/:userId */
const validateUserIdParam = [
    param('userId')
        .trim()
        .notEmpty().withMessage('User ID is required')
        .isMongoId().withMessage('Invalid user ID'),
    handleValidationResult
];

module.exports = {
    validateJobNameParam,
    validateUserIdParam
};

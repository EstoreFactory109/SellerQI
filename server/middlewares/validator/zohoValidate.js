const { param, body, query } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** POST /api/zoho/projects - name is the only field Zoho requires */
const validateCreateProject = [
    body('name')
        .trim()
        .notEmpty().withMessage('Project name is required')
        .isLength({ max: 255 }).withMessage('Project name must be 255 characters or fewer'),
    body('description')
        .optional()
        .isLength({ max: 5000 }).withMessage('Description must be 5000 characters or fewer'),
    body('startDate')
        .optional()
        .isISO8601().withMessage('startDate must be an ISO 8601 date'),
    body('endDate')
        .optional()
        .isISO8601().withMessage('endDate must be an ISO 8601 date'),
    body('ownerId')
        .optional()
        .trim()
        .notEmpty().withMessage('ownerId cannot be empty when provided'),
    handleValidationResult
];

/** GET /api/zoho/projects/:projectId/updates */
const validateProjectIdParam = [
    param('projectId')
        .trim()
        .notEmpty().withMessage('Project ID is required')
        .isLength({ max: 64 }).withMessage('Project ID is too long'),
    query('maxTasks')
        .optional()
        .isInt({ min: 1, max: 1000 }).withMessage('maxTasks must be between 1 and 1000'),
    handleValidationResult
];

/**
 * GET /api/zoho/auth/callback
 *
 * `code` is only required on the success path — when the user denies consent, Zoho
 * redirects with `error` and no code, and the controller reports that denial. Requiring
 * code unconditionally would turn a clear "you denied access" into a validation error.
 */
const validateCallbackQuery = [
    query('code')
        .if(query('error').not().exists())
        .trim()
        .notEmpty().withMessage('Authorization code is missing from the Zoho callback'),
    query('state')
        .trim()
        .notEmpty().withMessage('State parameter is missing from the Zoho callback'),
    handleValidationResult
];

module.exports = {
    validateCreateProject,
    validateProjectIdParam,
    validateCallbackQuery
};

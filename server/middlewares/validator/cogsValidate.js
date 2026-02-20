const { body, param } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** POST /api/cogs - body: asin (required), cogs (required number), sku (optional) */
const validateSaveCogs = [
    body('asin')
        .trim()
        .notEmpty().withMessage('ASIN is required'),
    body('cogs')
        .custom((value) => {
            if (value === undefined || value === null || value === '') throw new Error('Valid COGS value is required');
            const n = parseFloat(value);
            if (isNaN(n)) throw new Error('COGS must be a number');
            if (n < 0) throw new Error('COGS cannot be negative');
            return true;
        }),
    body('sku')
        .optional()
        .trim(),
    handleValidationResult
];

/** POST /api/cogs/bulk - body: cogsValues (required object) */
const validateBulkSaveCogs = [
    body('cogsValues')
        .notEmpty().withMessage('COGS values object is required')
        .isObject().withMessage('cogsValues must be an object'),
    handleValidationResult
];

/** DELETE /api/cogs/:asin */
const validateAsinParam = [
    param('asin')
        .trim()
        .notEmpty().withMessage('ASIN is required'),
    handleValidationResult
];

module.exports = {
    validateSaveCogs,
    validateBulkSaveCogs,
    validateAsinParam
};

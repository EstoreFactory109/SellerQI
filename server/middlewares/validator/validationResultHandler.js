/**
 * Shared handler for express-validator validationResult.
 * Returns 400 with message + errors array so frontends that use
 * response.data.message or response.data.errors continue to work.
 */
const { validationResult } = require('express-validator');

function handleValidationResult(req, res, next) {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
        return next();
    }
    const firstError = errors.array({ onlyFirstError: true })[0];
    const message = firstError?.msg || 'Validation failed';
    return res.status(400).json({
        success: false,
        message,
        errors: errors.array()
    });
}

module.exports = { handleValidationResult };

/**
 * Global error handler for Express.
 * Catches errors passed to next(err) (e.g. from asyncHandler) and returns
 * a consistent JSON response. Does not change behavior of routes that
 * send their own response.
 */
const logger = require('../utils/Logger.js');

function globalErrorHandler(err, req, res, next) {
    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || 'Internal server error';
    const isProduction = process.env.NODE_ENV === 'production';

    if (statusCode >= 500) {
        logger.error('[GlobalErrorHandler]', { statusCode, message, stack: err.stack, path: req.path });
    } else {
        logger.warn('[GlobalErrorHandler]', { statusCode, message, path: req.path });
    }

    const body = {
        success: false,
        message
    };
    if (err.errors && Array.isArray(err.errors) && err.errors.length > 0) {
        body.errors = err.errors;
    }
    if (!isProduction && err.stack) {
        body.stack = err.stack;
    }

    res.status(statusCode).json(body);
}

module.exports = { globalErrorHandler };

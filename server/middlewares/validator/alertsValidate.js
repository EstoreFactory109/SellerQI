const { body } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** POST /api/alerts/unsubscribe - body: email (required) */
const validateUnsubscribeEmail = [
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Please enter a valid email address'),
    handleValidationResult
];

module.exports = {
    validateUnsubscribeEmail
};

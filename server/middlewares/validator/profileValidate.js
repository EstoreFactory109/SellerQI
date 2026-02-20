const { body } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** POST /app/profile/saveProfileId - body: profileId, currencyCode (both required in controller) */
const validateSaveProfileId = [
    body('profileId')
        .notEmpty().withMessage('Profile ID is required'),
    body('currencyCode')
        .trim()
        .notEmpty().withMessage('Currency code is required'),
    handleValidationResult
];

module.exports = {
    validateSaveProfileId
};

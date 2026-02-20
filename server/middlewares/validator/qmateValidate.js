const { body, param } = require('express-validator');
const { handleValidationResult } = require('./validationResultHandler.js');

/** POST /api/qmate/chat - body: message (required), messages (optional array) */
const validateChatBody = [
    body('message')
        .trim()
        .notEmpty().withMessage('A non-empty message is required'),
    body('messages')
        .optional()
        .isArray().withMessage('messages must be an array'),
    handleValidationResult
];

/** POST /api/qmate/chats - body: title (optional) */
const validateCreateChatBody = [
    body('title')
        .optional()
        .trim()
        .isString().withMessage('title must be a string'),
    handleValidationResult
];

/** GET/PATCH/DELETE /api/qmate/chats/:chatId - chatId must be MongoDB ObjectId */
const validateChatIdParam = [
    param('chatId')
        .trim()
        .notEmpty().withMessage('Chat ID is required')
        .isMongoId().withMessage('Invalid chat ID'),
    handleValidationResult
];

module.exports = {
    validateChatBody,
    validateCreateChatBody,
    validateChatIdParam
};

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const { validateChatBody, validateCreateChatBody, validateChatIdParam } = require('../middlewares/validator/qmateValidate.js');
const {
    handleChat,
    listChats,
    createChat,
    getChat,
    updateChat,
    deleteChat,
} = require('../controllers/ai/QMateController.js');
const {
    generateSuggestion,
    applyFix,
    batchSuggestions,
    lookupSku,
    pauseKeywordAction,
    addToNegativeAction,
    pauseAndAddToNegativeAction,
    bulkPauseAction,
    bulkPauseAndAddToNegativeAction
} = require('../controllers/ai/QMateActionController.js');

// QMate AI chat endpoint (requires location for analytics context)
router.post('/chat', auth, getLocation, validateChatBody, handleChat);

// QMate Fix It action endpoints (same capabilities as the Fix It button)
// Generate AI content suggestions for title, bullet points, description, backend keywords
router.post('/generate-suggestion', auth, getLocation, generateSuggestion);
// Apply a content fix to Amazon listing
router.post('/apply-fix', auth, getLocation, applyFix);
// Generate suggestions for multiple attributes at once
router.post('/batch-suggestions', auth, getLocation, batchSuggestions);
// Look up SKU for an ASIN (used when content_actions has null SKU)
router.get('/lookup-sku/:asin', auth, getLocation, lookupSku);

// PPC Keyword Actions (for QMate wasted spend keyword management)
// Single keyword actions
router.post('/ppc/pause-keyword', auth, getLocation, pauseKeywordAction);
router.post('/ppc/add-to-negative', auth, getLocation, addToNegativeAction);
router.post('/ppc/pause-and-add-to-negative', auth, getLocation, pauseAndAddToNegativeAction);
// Bulk actions (max 10 keywords)
router.post('/ppc/bulk-pause', auth, getLocation, bulkPauseAction);
router.post('/ppc/bulk-pause-and-add-to-negative', auth, getLocation, bulkPauseAndAddToNegativeAction);

// Chat history CRUD (auth only)
router.get('/chats', auth, listChats);
router.post('/chats', auth, validateCreateChatBody, createChat);
router.get('/chats/:chatId', auth, validateChatIdParam, getChat);
router.patch('/chats/:chatId', auth, validateChatIdParam, updateChat);
router.delete('/chats/:chatId', auth, validateChatIdParam, deleteChat);

module.exports = router;


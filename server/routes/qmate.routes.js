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

// QMate AI chat endpoint (requires location for analytics context)
router.post('/chat', auth, getLocation, validateChatBody, handleChat);

// Chat history CRUD (auth only)
router.get('/chats', auth, listChats);
router.post('/chats', auth, validateCreateChatBody, createChat);
router.get('/chats/:chatId', auth, validateChatIdParam, getChat);
router.patch('/chats/:chatId', auth, validateChatIdParam, updateChat);
router.delete('/chats/:chatId', auth, validateChatIdParam, deleteChat);

module.exports = router;


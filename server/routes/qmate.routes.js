const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const {
    handleChat,
    listChats,
    createChat,
    getChat,
    updateChat,
    deleteChat,
} = require('../controllers/ai/QMateController.js');

// QMate AI chat endpoint (requires location for analytics context)
router.post('/chat', auth, getLocation, handleChat);

// Chat history CRUD (auth only)
router.get('/chats', auth, listChats);
router.post('/chats', auth, createChat);
router.get('/chats/:chatId', auth, getChat);
router.patch('/chats/:chatId', auth, updateChat);
router.delete('/chats/:chatId', auth, deleteChat);

module.exports = router;


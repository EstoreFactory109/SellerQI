const mongoose = require('mongoose');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { QMateService } = require('../../Services/AI/QMateService.js');
const QMateChat = require('../../models/ai/QMateChatModel.js');

/**
 * POST /api/qmate/chat
 * Body: { message: string, messages?: [{ role: 'user'|'assistant', content: string }], dateRange?: { startDate, endDate, calendarMode } }
 */
const handleChat = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { message, messages: chatHistory, dateRange } = req.body || {};

    if (!userId) {
        return res
            .status(400)
            .json(new ApiError(400, 'User ID is required for QMate.'));
    }

    if (!country || !region) {
        return res
            .status(400)
            .json(new ApiError(400, 'Country and region are required for QMate.'));
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
        return res
            .status(400)
            .json(new ApiError(400, 'A non-empty message is required.'));
    }

    // Extract date range if provided (from dashboard calendar filter)
    const startDate = dateRange?.startDate || null;
    const endDate = dateRange?.endDate || null;
    const calendarMode = dateRange?.calendarMode || 'default';

    logger.info('[QMate] Incoming chat request', {
        userId,
        country,
        region,
        hasHistory: Array.isArray(chatHistory),
        hasDateRange: !!(startDate && endDate),
        calendarMode
    });

    // Use optimized method by default (reads from pre-computed data)
    // Falls back to legacy method internally if pre-computed data unavailable
    const result = await QMateService.generateResponseOptimized({
        userId,
        country,
        region,
        question: message.trim(),
        chatHistory: Array.isArray(chatHistory) ? chatHistory : [],
        startDate,
        endDate,
        calendarMode
    });

    if (!result || result.status !== 200) {
        const statusCode = result?.status || 500;
        const errorMessage =
            result?.error ||
            'QMate was unable to generate a response. Please try again.';

        logger.error('[QMate] Error generating response', {
            statusCode,
            errorMessage,
        });

        return res.status(statusCode).json(new ApiError(statusCode, errorMessage));
    }

    const {
        answer_markdown,
        chart_suggestions,
        follow_up_questions,
        needs_clarification,
        clarifying_questions,
        load_more_available,
        content_actions,
        suggested_title,
        suggested_bullet_points,
        suggested_description,
        suggested_backend_keywords,
        wasted_keywords,
        wasted_keywords_total,
        wasted_keywords_offset,
    } = result;

    const payload = {
        message: {
            role: 'assistant',
            content: answer_markdown || '',
            charts: chart_suggestions || [],
            follow_up_questions: follow_up_questions || [],
            needs_clarification: Boolean(needs_clarification),
            clarifying_questions: Array.isArray(clarifying_questions) ? clarifying_questions : [],
            // Pagination for large data lists
            load_more_available: load_more_available || null,
            // Fix It functionality fields
            content_actions: content_actions || [],
            suggested_title: suggested_title || null,
            suggested_bullet_points: suggested_bullet_points || null,
            suggested_description: suggested_description || null,
            suggested_backend_keywords: suggested_backend_keywords || null,
            // PPC Actions - wasted keywords for pause/add-to-negative
            wasted_keywords: wasted_keywords || null,
            wasted_keywords_total: wasted_keywords_total || null,
            wasted_keywords_offset: wasted_keywords_offset || null,
        },
    };

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                payload,
                'QMate response generated successfully'
            )
        );
});

/**
 * GET /api/qmate/chats
 * Returns list of current user's chats (id, title, updatedAt) sorted by updatedAt desc.
 */
const listChats = asyncHandler(async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required.'));
    }
    const chats = await QMateChat.find({ User: userId })
        .sort({ updatedAt: -1 })
        .select('_id title updatedAt')
        .lean();
    const list = chats.map((c) => ({
        id: c._id.toString(),
        title: c.title,
        date: c.updatedAt,
    }));
    return res.status(200).json(new ApiResponse(200, { chats: list }, 'Chats listed successfully'));
});

/**
 * POST /api/qmate/chats
 * Body: { title?: string }
 * Creates a new chat for the user.
 */
const createChat = asyncHandler(async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required.'));
    }
    const title = (req.body?.title && String(req.body.title).trim()) || 'New Chat';
    const chat = await QMateChat.create({
        User: userId,
        title: title.slice(0, 100),
        messages: [],
    });
    return res.status(201).json(
        new ApiResponse(201, { chat: { id: chat._id.toString(), title: chat.title, date: chat.updatedAt } }, 'Chat created successfully')
    );
});

/**
 * GET /api/qmate/chats/:chatId
 * Returns a single chat with messages (for loading into the conversation view).
 */
const getChat = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { chatId } = req.params;
    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required.'));
    }
    if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json(new ApiError(400, 'Invalid chat ID.'));
    }
    const chat = await QMateChat.findOne({ _id: chatId, User: userId }).lean();
    if (!chat) {
        return res.status(404).json(new ApiError(404, 'Chat not found.'));
    }
    const messages = (chat.messages || []).map((m, i) => ({
        id: (m._id && m._id.toString()) || `msg-${i}`,
        role: m.role,
        content: m.content || '',
        timestamp: chat.updatedAt ? new Date(chat.updatedAt) : new Date(),
        charts: m.charts || [],
        followUps: m.followUps || [],
    }));
    return res.status(200).json(
        new ApiResponse(200, { chat: { id: chat._id.toString(), title: chat.title, date: chat.updatedAt, messages } }, 'Chat retrieved successfully')
    );
});

/**
 * PATCH /api/qmate/chats/:chatId
 * Body: { title?: string, messages?: Array<{ role, content, charts?, followUps? }> }
 * Updates chat title and/or messages.
 */
const updateChat = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { chatId } = req.params;
    const { title, messages: rawMessages } = req.body || {};
    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required.'));
    }
    if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json(new ApiError(400, 'Invalid chat ID.'));
    }
    const chat = await QMateChat.findOne({ _id: chatId, User: userId });
    if (!chat) {
        return res.status(404).json(new ApiError(404, 'Chat not found.'));
    }
    if (typeof title === 'string' && title.trim()) {
        chat.title = title.trim().slice(0, 100);
    }
    if (Array.isArray(rawMessages)) {
        chat.messages = rawMessages.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: typeof m.content === 'string' ? m.content : '',
            charts: Array.isArray(m.charts) ? m.charts : [],
            followUps: Array.isArray(m.followUps) ? m.followUps : [],
        }));
    }
    await chat.save();
    return res.status(200).json(
        new ApiResponse(200, { chat: { id: chat._id.toString(), title: chat.title, date: chat.updatedAt } }, 'Chat updated successfully')
    );
});

/**
 * DELETE /api/qmate/chats/:chatId
 */
const deleteChat = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { chatId } = req.params;
    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required.'));
    }
    if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json(new ApiError(400, 'Invalid chat ID.'));
    }
    const result = await QMateChat.deleteOne({ _id: chatId, User: userId });
    if (result.deletedCount === 0) {
        return res.status(404).json(new ApiError(404, 'Chat not found.'));
    }
    return res.status(200).json(new ApiResponse(200, null, 'Chat deleted successfully'));
});

module.exports = {
    handleChat,
    listChats,
    createChat,
    getChat,
    updateChat,
    deleteChat,
};


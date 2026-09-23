/**
 * EsfClientMessagesController.js — the CLIENT's own Messages page.
 *
 * The mirror of controllers/esf/esfMessages.js, with the audiences swapped: this one is
 * scoped hard to `req.user._id` and shows the client their own conversations, labelled
 * by subject rather than by anything identifying the agency staff who replied.
 *
 * ── SCOPING IS THE SECURITY PROPERTY HERE ──
 * Every query filters on `userId: req.user._id`. Unlike the staff controller, where
 * "every ESF staff member sees every ESF client" is the documented model, a client must
 * never reach another client's thread — so the id comes from the authenticated session
 * and never from a parameter. A thread id in the URL is used only to narrow within that
 * scope, never to select across it.
 *
 * ── AND THE CLIENT DOES NOT SEE INDIVIDUAL STAFF ──
 * Outbound messages are attributed to "eStore Factory", never a person. That is the same
 * rule the Status page already applies through redactNames in ZohoTaskSummaryService,
 * pointed in the other direction.
 *
 * NOT cached. Every sibling ESF route uses analyseDataCache with a 300s TTL; on a chat
 * surface that makes a reply appear to vanish for five minutes.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { EmailThread, EmailMessage } = require('../../models/system/EmailThreadModels.js');
const { toClientThread, toClientMessage, PROJECTION } = require('../../Services/Email/messagePresenter.js');

const THREADS_PER_PAGE = 50;

/**
 * GET /api/pagewise/esf/messages
 *
 * Every thread this client has, newest activity first.
 */
const getEsfMessages = asyncHandler(async (req, res) => {
    try {
        const userId = req.user._id;

        const threads = await EmailThread.find({ userId })
            .select(PROJECTION.thread)
            .sort({ lastMessageAt: -1 })
            .limit(THREADS_PER_PAGE)
            .lean();

        return res.status(200).json(new ApiResponse(200, {
            threads: threads.map(toClientThread),
            unreadCount: threads.filter((thread) => thread.clientUnreadCount > 0).length,
            // So the page can distinguish "no conversations yet" from "email us to
            // start one" — the client cannot open a thread from the portal in v1.
            inboxAddress: process.env.GMAIL_INBOX_ADDRESS || null,
        }, 'Messages fetched'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfClientMessages] list failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not load your messages'));
    }
});

/**
 * GET /api/pagewise/esf/messages/:threadId
 *
 * One conversation. Opening it clears the CLIENT's unread counter and not the staff
 * one — the two exist separately precisely so neither side marks the other's as read.
 */
const getEsfMessageThread = asyncHandler(async (req, res) => {
    try {
        const userId = req.user._id;

        // Scoped by userId in the same query as the id, not checked afterwards: a
        // find-then-compare invites the version of this code where the compare is
        // dropped in a refactor and nothing visibly changes.
        const thread = await EmailThread.findOne({ _id: req.params.threadId, userId })
            .select(PROJECTION.thread)
            .lean();

        if (!thread) {
            return res.status(404).json(new ApiResponse(404, '', 'Conversation not found'));
        }

        const messages = await EmailMessage.find({ threadId: thread._id, userId })
            .select(PROJECTION.message)
            .sort({ sentAt: 1 })
            .lean();

        await EmailThread.updateOne(
            { _id: thread._id },
            { $set: { clientUnreadCount: 0, lastClientReadAt: new Date() } }
        );

        return res.status(200).json(new ApiResponse(200, {
            thread: toClientThread(thread),
            messages: messages.map((message) => toClientMessage(message, {
                staffReadAt: thread.lastStaffReadAt,
            })),
        }, 'Conversation fetched'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfClientMessages] thread failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not load that conversation'));
    }
});

module.exports = { getEsfMessages, getEsfMessageThread };

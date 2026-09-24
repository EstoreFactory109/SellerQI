/**
 * EsfClientMessagesController.js — the CLIENT's own Messages page.
 *
 * The mirror of controllers/esf/esfMessages.js, with the audiences swapped: this one is
 * scoped hard to `req.userId` and shows the client their own conversations, labelled
 * by subject rather than by anything identifying the agency staff who replied.
 *
 * ── SCOPING IS THE SECURITY PROPERTY HERE ──
 * Every query filters on `userId: req.userId`. Unlike the staff controller, where
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
const UserModel = require('../../models/user-auth/userModel.js');
const { EmailThread, EmailMessage } = require('../../models/system/EmailThreadModels.js');
const { toClientThread, toClientMessage, PROJECTION } = require('../../Services/Email/messagePresenter.js');

const THREADS_PER_PAGE = 50;

/**
 * `auth` attaches only `req.userId` — there is no `req.user` on this stack, and
 * `esfClientOnly` loads the account purely to check `isEsfClient` without exposing it.
 *
 * Sending needs the whole identity, because the redaction bundle is built from it: the
 * client's own name, addresses and numbers are exactly what gets stripped out of what
 * they wrote before staff can read it. A reply redacted against an empty bundle would
 * pass straight through with their details intact.
 */
const CLIENT_IDENTITY_FIELDS = 'firstName lastName email additionalEmails phone whatsapp';

const loadClient = async (userId) => {
    const user = await UserModel.findById(userId).select(CLIENT_IDENTITY_FIELDS).lean();
    if (!user) throw new ApiError(401, 'Your account could not be found');
    return user;
};

/**
 * GET /api/pagewise/esf/messages
 *
 * Every thread this client has, newest activity first.
 */
const getEsfMessages = asyncHandler(async (req, res) => {
    try {
        const userId = req.userId;

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
        const userId = req.userId;

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

/**
 * POST /api/pagewise/esf/messages/:threadId/reply
 *
 * The client's reply is INSERTED into the Gmail thread, not sent. Gmail stays the
 * complete record of the conversation and nothing leaves the building — see the header
 * of Services/Gmail/GmailSendService.js for why sending here would be wrong.
 */
const postEsfMessageReply = asyncHandler(async (req, res) => {
    try {
        const { insertClientReply } = require('../../Services/Gmail/GmailSendService.js');

        const result = await insertClientReply({
            threadId: req.params.threadId,
            body: req.body?.body,
            user: await loadClient(req.userId),
            files: req.files || [],
        });

        return res.status(201).json(new ApiResponse(201, result, 'Reply sent'));
    } catch (error) {
        if (error.statusCode && error.statusCode < 500) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, '', error.message));
        }
        logger.error(new ApiError(500, `[EsfClientMessages] reply failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not send that reply'));
    }
});

/**
 * POST /api/pagewise/esf/messages
 *
 * Raise a ticket — the only way a client can START a conversation from the portal.
 *
 * Inserted into Gmail rather than emailed, exactly like a reply, so the admin sees it
 * arrive in the shared inbox as though the client had written in directly, and Gmail
 * holds the whole conversation from its first message onward.
 */
const postEsfNewTicket = asyncHandler(async (req, res) => {
    try {
        const { startClientTicket } = require('../../Services/Gmail/GmailSendService.js');

        const result = await startClientTicket({
            subject: req.body?.subject,
            body: req.body?.body,
            user: await loadClient(req.userId),
            files: req.files || [],
        });

        return res.status(201).json(new ApiResponse(201, result, 'Ticket raised'));
    } catch (error) {
        // 4xx messages here describe our own rules ("too many open conversations",
        // "subject too long") and are safe to show. Anything else is generic.
        if (error.statusCode && error.statusCode < 500) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, '', error.message));
        }
        logger.error(new ApiError(500, `[EsfClientMessages] ticket failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not raise that ticket'));
    }
});

/**
 * GET /api/pagewise/esf/messages/:threadId/attachments/:messageId/:index
 *
 * Scoped to this client, so a message id from another account resolves to nothing.
 */
const downloadEsfAttachment = asyncHandler(async (req, res) => {
    try {
        const { fetchAttachment, sendAttachment } = require('../../Services/Gmail/GmailAttachmentService.js');

        const file = await fetchAttachment({
            messageId: req.params.messageId,
            threadId: req.params.threadId,
            index: req.params.index,
            userId: req.userId,
        });

        return sendAttachment(res, file);
    } catch (error) {
        if (error.statusCode && error.statusCode < 500) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, '', error.message));
        }
        logger.error(new ApiError(500, `[EsfClientMessages] attachment failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not download that file'));
    }
});

module.exports = {
    getEsfMessages, getEsfMessageThread, postEsfMessageReply, postEsfNewTicket, downloadEsfAttachment,
};

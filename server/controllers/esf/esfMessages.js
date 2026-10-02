/**
 * esfMessages.js — the ESF staff inbox.
 *
 * Staff read and answer client email here without learning who the client is. Threads
 * are labelled by Zoho project, brand, or a stored reference (Services/User/
 * esfClientLabel.js); message bodies arrive already redacted by the ingestion
 * pipeline, and nothing in this file un-redacts anything.
 *
 * Every route is behind esfAuth. There is no per-client scoping to apply — this repo
 * has none anywhere (ManagedClientService: "Every ESF staff member sees every ESF
 * client") — so the only access question is whether this staff member may open the
 * Messages page at all, which is the esfDeniedPages check below.
 *
 * WHY THE PAGE CHECK IS EXPLICIT HERE
 * esfPageGuard runs on /api/pagewise and only engages inside an impersonated client
 * session. It does nothing for /app/esf routes, so a staff member blocked from
 * Messages would still reach this controller. The guard has to be made by hand, and
 * forgetting it is exactly the hole that existed on the Billing API.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const SellerModel = require('../../models/user-auth/sellerCentralModel.js');
const { EmailThread, EmailMessage } = require('../../models/system/EmailThreadModels.js');
const { esfClientLabel } = require('../../Services/User/esfClientLabel.js');
const { isPageDeniedFor } = require('../../Services/User/esfPages.js');
const {
    toStaffThread, toStaffMessage, assertNoIdentityLeak, shouldMarkRead, PROJECTION,
} = require('../../Services/Email/messagePresenter.js');

const { allowedClientIds, canAccessClient } = require('../../Services/User/esfClientScope.js');

const PAGE_KEY = 'messages';
const THREADS_PER_PAGE = 50;

/** Blocked from the Messages page means blocked from its data, not just its nav item. */
const denied = (req) => isPageDeniedFor(req.esfUser, PAGE_KEY);

/**
 * Narrow a thread query to the clients this staff member is allocated.
 *
 * This file's header used to say "There is no per-client scoping to apply — this repo
 * has none anywhere." It has some now, and the inbox is the one place a member can
 * actually reach a client they were not given.
 */
const scopeThreads = (query, req) => {
    const ids = allowedClientIds(req.esfUser);
    // null means exempt (owner/admin). An empty array matches nothing, which is correct
    // for a member with no allocation and is the case that must not be optimised away.
    return ids === null ? query : { ...query, userId: { $in: ids } };
};

/**
 * May this staff member touch this thread?
 *
 * For handlers that hand the threadId straight to a service instead of querying the
 * thread themselves, so the scope cannot be folded into their own query.
 *
 * Exempt staff short-circuit without a round trip; only a restricted member pays for
 * the lookup.
 */
const threadAllowed = async (req, threadId) => {
    const ids = allowedClientIds(req.esfUser);
    if (ids === null) return true;
    if (!threadId) return false;

    const thread = await EmailThread.findById(threadId).select('userId').lean();
    return Boolean(thread) && canAccessClient(req.esfUser, thread.userId);
};

/**
 * 404, not 403, on a thread belonging to an unallocated client.
 *
 * A 403 would confirm the conversation exists, which is exactly what a member who was
 * not given that client should not be able to establish by probing ids.
 */
const notFound = (res) => res.status(404).json(new ApiResponse(404, '', 'Conversation not found'));

/**
 * Labels for a set of threads, in one pass.
 *
 * Two queries for the whole page rather than two per thread — the clients list is
 * rendered on every inbox load, and this is the query that would otherwise dominate it.
 */
const labelsForThreads = async (threads) => {
    const userIds = [...new Set(threads.map((t) => String(t.userId)))];

    const users = await UserModel.find({ _id: { $in: userIds } })
        // Deliberately NOT firstName/lastName/email: this controller has no legitimate
        // use for them, and not loading them is what stops them being serialised by
        // accident.
        .select('_id zohoProject.projectName esfClientRef sellerCentral')
        .lean();

    const sellerIds = users.map((u) => u.sellerCentral).filter(Boolean);
    const sellers = sellerIds.length
        ? await SellerModel.find({ _id: { $in: sellerIds } }).select('_id brand').lean()
        : [];
    const brandBySeller = new Map(sellers.map((s) => [String(s._id), s.brand]));

    return new Map(users.map((user) => [
        String(user._id),
        esfClientLabel(user, { brand: brandBySeller.get(String(user.sellerCentral)) }).label,
    ]));
};

/**
 * GET /app/esf/messages
 *
 * Threads needing a reply first, then newest activity. Resolved threads are excluded
 * unless asked for, so the default view is work rather than history.
 */
const listStaffThreads = asyncHandler(async (req, res) => {
    try {
        if (denied(req)) {
            return res.status(403).json(new ApiResponse(403, '', 'You do not have access to Messages'));
        }

        const includeResolved = req.query.resolved === 'true';

        const threads = await EmailThread
            .find(scopeThreads(includeResolved ? {} : { resolvedAt: null }, req))
            .select(PROJECTION.thread)
            .sort({ lastMessageAt: -1 })
            .limit(THREADS_PER_PAGE)
            .lean();

        const labels = await labelsForThreads(threads);

        const payload = {
            threads: threads
                .map((thread) => toStaffThread(thread, labels.get(String(thread.userId)) || 'Unknown client'))
                // Needs-a-reply first; the sort above already orders within each group.
                .sort((a, b) => Number(b.needsReply) - Number(a.needsReply)),
            // Scoped too. A global count would badge the inbox with threads the
            // member cannot open, which reads as messages going missing.
            unresolvedCount: await EmailThread.countDocuments(scopeThreads({ resolvedAt: null }, req)),
        };

        // Checked on its own line, before any part of the response is built. Inlining
        // it as an argument to .json() means res.status(200) has already run when it
        // throws, which works but reads as though a 200 were sent.
        assertNoIdentityLeak(payload, { logger });

        return res.status(200).json(new ApiResponse(200, payload, 'Threads fetched'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfMessages] list failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not load messages'));
    }
});

/**
 * GET /app/esf/messages/:threadId
 *
 * One conversation. Opening it marks it read for staff — the client's own unread
 * count is untouched, which is why the two counters exist separately.
 */
const getStaffThread = asyncHandler(async (req, res) => {
    try {
        if (denied(req)) {
            return res.status(403).json(new ApiResponse(403, '', 'You do not have access to Messages'));
        }

        // Scoped into the query itself, so an unallocated thread is indistinguishable
        // from one that does not exist.
        const thread = await EmailThread
            .findOne(scopeThreads({ _id: req.params.threadId }, req))
            .select(PROJECTION.thread)
            .lean();
        if (!thread) {
            return notFound(res);
        }

        const [messages, labels] = await Promise.all([
            EmailMessage.find({ threadId: thread._id })
                .select(PROJECTION.message)
                .sort({ sentAt: 1 })
                .lean(),
            labelsForThreads([thread]),
        ]);

        /*
         * Marking read is a deliberate act, not a side effect of fetching.
         *
         * This fired on EVERY call, and the page polls this endpoint every 15
         * seconds - so a reply arriving into the thread a staff member had open
         * was marked read before they could possibly have seen it, and the left
         * rail never showed a badge for it either. Between that and the pane
         * never scrolling, a new message arrived with no cue at all.
         */
        if (shouldMarkRead(req.query)) {
            await EmailThread.updateOne(
                { _id: thread._id },
                { $set: { staffUnreadCount: 0, lastStaffReadAt: new Date() } }
            );
        }

        const payload = {
            thread: toStaffThread(thread, labels.get(String(thread.userId)) || 'Unknown client'),
            // Read from the thread fetched BEFORE the updateOne below — that write
            // touches the staff side only, but reading after it would make the receipt
            // depend on statement order rather than on the client's behaviour.
            messages: messages.map((message) => toStaffMessage(message, {
                clientReadAt: thread.lastClientReadAt,
            })),
        };

        assertNoIdentityLeak(payload, { logger });

        return res.status(200).json(new ApiResponse(200, payload, 'Conversation fetched'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfMessages] thread failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not load that conversation'));
    }
});

/**
 * PATCH /app/esf/messages/:threadId/resolve
 *
 * Resolve or reopen. The only stored piece of thread state — everything else about a
 * thread's status is derived, so it cannot go stale.
 */
const setThreadResolved = asyncHandler(async (req, res) => {
    try {
        if (denied(req)) {
            return res.status(403).json(new ApiResponse(403, '', 'You do not have access to Messages'));
        }

        const resolved = req.body?.resolved !== false;

        const updated = await EmailThread.findOneAndUpdate(
            scopeThreads({ _id: req.params.threadId }, req),
            {
                $set: {
                    resolvedAt: resolved ? new Date() : null,
                    resolvedBy: resolved ? req.esfUserId : null,
                },
            },
            { new: true }
        ).select(PROJECTION.thread).lean();

        if (!updated) {
            return res.status(404).json(new ApiResponse(404, '', 'Conversation not found'));
        }

        const labels = await labelsForThreads([updated]);

        return res.status(200).json(new ApiResponse(
            200,
            toStaffThread(updated, labels.get(String(updated.userId)) || 'Unknown client'),
            resolved ? 'Conversation resolved' : 'Conversation reopened'
        ));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfMessages] resolve failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not update that conversation'));
    }
});

/**
 * POST /app/esf/messages/:threadId/reply
 *
 * The email is genuinely sent to the client, from the shared inbox under a single
 * agency identity — never under the individual staff member's name. Who sent it is
 * recorded on the message for our own audit and is never shown to the client.
 */
const postStaffReply = asyncHandler(async (req, res) => {
    try {
        if (denied(req)) {
            return res.status(403).json(new ApiResponse(403, '', 'You do not have access to Messages'));
        }

        // Before anything is sent. This one leaves the building — a reply on an
        // unallocated thread is a real email to a real client.
        if (!(await threadAllowed(req, req.params.threadId))) {
            return notFound(res);
        }

        const { sendStaffReply } = require('../../Services/Gmail/GmailSendService.js');

        const result = await sendStaffReply({
            threadId: req.params.threadId,
            body: req.body?.body,
            staffUserId: req.esfUserId,
            // multer puts them here; the service reads them off disk and unlinks them.
            files: req.files || [],
        });

        return res.status(201).json(new ApiResponse(201, result, 'Reply sent'));
    } catch (error) {
        // A validation failure is the sender's to fix and its message is safe — it
        // describes our own rules, never the client. Anything else is generic.
        if (error.statusCode && error.statusCode < 500) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, '', error.message));
        }
        logger.error(new ApiError(500, `[EsfMessages] reply failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not send that reply'));
    }
});

/**
 * GET /app/esf/messages/:threadId/attachments/:messageId/:index
 *
 * The filename served is the redacted one. The CONTENTS are not redactable and never
 * will be — a letterhead, EXIF owner data, a photographed business card. That exception
 * was accepted knowingly; this route is where it takes effect.
 */
const downloadStaffAttachment = asyncHandler(async (req, res) => {
    try {
        if (denied(req)) {
            return res.status(403).json(new ApiResponse(403, '', 'You do not have access to Messages'));
        }

        if (!(await threadAllowed(req, req.params.threadId))) {
            return notFound(res);
        }

        const { fetchAttachment, sendAttachment } = require('../../Services/Gmail/GmailAttachmentService.js');

        const file = await fetchAttachment({
            messageId: req.params.messageId,
            threadId: req.params.threadId,
            index: req.params.index,
        });

        return sendAttachment(res, file);
    } catch (error) {
        if (error.statusCode && error.statusCode < 500) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, '', error.message));
        }
        logger.error(new ApiError(500, `[EsfMessages] attachment failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not download that file'));
    }
});

module.exports = {
    listStaffThreads, getStaffThread, setThreadResolved, postStaffReply, downloadStaffAttachment,
};

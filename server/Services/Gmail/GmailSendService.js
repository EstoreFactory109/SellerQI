/**
 * GmailSendService.js — replies, from both sides.
 *
 * Two paths that look similar and are not:
 *
 *   STAFF reply  → users.messages.send    the email actually goes to the client
 *   CLIENT reply → users.messages.insert  files into the Gmail thread, transmits nothing
 *
 * ── WHY THE CLIENT'S REPLY IS INSERTED, NOT SENT ──
 * `send` would mail the ESF inbox from itself. The client's words would arrive looking
 * like ESF's own, the thread would read as the agency talking to itself, and we would
 * be generating real outbound mail — deliverability surface, SPF alignment, the lot —
 * for a message that never needs to leave the building. `insert` preserves
 * `From: <the client>` and stays put.
 *
 * ── BOTH WRITES COME BACK, AND BOTH GUARDS ARE REQUIRED ──
 * Anything we put into Gmail is reported by our own watch and re-ingested. The message
 * would then appear twice: once from this file, once from ingestion.
 *
 *   (a) X-SellerQI-Origin, skipped by inboundRouting
 *   (b) the Message-ID we generated, reconciled here before sending
 *
 * (b) alone loses a race — the push can arrive before our write lands. (a) alone fails
 * if a mail client strips unknown headers on a round trip. Neither is redundant.
 */

const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const { EmailThread, EmailMessage } = require('../../models/system/EmailThreadModels.js');
const GmailClient = require('./GmailClient.js');
const { buildMimeMessage, generateMessageId } = require('./mimeBuilder.js');
const { buildIdentityBundle, redactAll } = require('../Email/identityRedaction.js');
const { getCredentials, isMessagingEnabled, ORIGIN_HEADER } = require('./config.js');

/** The name the client sees on every reply. Never an individual. */
const AGENCY_DISPLAY_NAME = process.env.GMAIL_SENDER_NAME || 'eStore Factory';

const MAX_REPLY_CHARS = 10000;

/**
 * The thread, including the fields kept behind `select: false`.
 *
 * Sending is the one operation that legitimately needs them — a reply has to be
 * addressed somewhere, and Gmail rejects a threaded send whose subject does not match.
 * They are read here and nowhere else, and never returned to a caller.
 */
const loadThreadForSend = async (threadId, userId) => {
    const query = EmailThread.findOne({ _id: threadId, ...(userId ? { userId } : {}) })
        .select('+clientEmail +rawSubject +rfc822MessageIdOfLast +referencesTail');
    const thread = await query.lean();

    if (!thread) throw new ApiError(404, 'Conversation not found');
    if (!thread.gmailThreadId) throw new ApiError(409, 'That conversation is not linked to Gmail');
    return thread;
};

const assertSendable = (body) => {
    const text = String(body || '').trim();
    if (!text) throw new ApiError(400, 'A reply cannot be empty');
    if (text.length > MAX_REPLY_CHARS) {
        throw new ApiError(400, `A reply cannot be longer than ${MAX_REPLY_CHARS} characters`);
    }
    if (!isMessagingEnabled()) throw new ApiError(503, 'Messaging is not enabled');
    return text;
};

/**
 * Store our own copy immediately, before Gmail reports it back.
 *
 * Written with the Message-ID we generated, so when ingestion sees the echo the unique
 * index on gmailMessageId plus the origin header both resolve it to this row rather
 * than creating a second one.
 */
const recordSentMessage = async ({
    thread, userId, direction, origin, bodyRedacted, messageId, gmailMessageId, sentByUserId = null,
}) => {
    const sentAt = new Date();

    await EmailMessage.updateOne(
        { gmailMessageId },
        {
            $setOnInsert: {
                gmailMessageId,
                gmailThreadId: thread.gmailThreadId,
                threadId: thread._id,
                userId,
                direction,
                origin,
                rfc822MessageId: messageId,
                sentAt,
                bodyRedacted,
                bodyTruncated: false,
                quotedTrimmed: false,
                // Composed in the portal, so it never contained anything to redact —
                // as distinct from 'deterministic', which means detail was removed.
                redactedBy: 'portal',
                sentByUserId,
                syncedAt: sentAt,
            },
        },
        { upsert: true }
    );

    await EmailThread.updateOne({ _id: thread._id }, {
        $set: {
            lastMessageAt: sentAt,
            lastMessageDirection: direction,
            // The next reply threads off this one. Stale values here make the client's
            // mail app show the following message as a separate conversation.
            rfc822MessageIdOfLast: messageId,
            referencesTail: [...(thread.referencesTail || []), messageId].slice(-10),
            /**
             * Sending reopens a resolved thread. A staff member who resolves a
             * conversation and then replies to it plainly does not consider it closed,
             * and leaving it resolved hides their own reply from the default inbox view.
             */
            resolvedAt: null,
            resolvedBy: null,
        },
        $inc: {
            // The side that did NOT send now has something unread.
            ...(direction === 'outbound' ? { clientUnreadCount: 1 } : { staffUnreadCount: 1 }),
        },
    });

    return sentAt;
};

/**
 * A staff member replies. The email is genuinely sent to the client.
 *
 * @param {object} args
 * @param {string} args.threadId
 * @param {string} args.body
 * @param {string} [args.staffUserId]  recorded, never shown to the client
 */
const sendStaffReply = async ({ threadId, body, staffUserId = null }) => {
    const text = assertSendable(body);
    const { inboxAddress } = getCredentials();
    const thread = await loadThreadForSend(threadId);

    if (!thread.clientEmail) {
        throw new ApiError(409, 'That conversation has no reply address');
    }

    const messageId = generateMessageId(String(inboxAddress).split('@')[1]);

    const { raw } = buildMimeMessage({
        // A single fixed identity, always. The client is told which agency they are
        // dealing with, never which person — the same rule the Status page applies.
        from: { name: AGENCY_DISPLAY_NAME, email: inboxAddress },
        to: { email: thread.clientEmail },
        rawSubject: thread.rawSubject,
        bodyText: text,
        inReplyTo: thread.rfc822MessageIdOfLast,
        references: thread.referencesTail || [],
        messageId,
        origin: 'portal-staff',
    });

    const sent = await GmailClient.sendMessage({ raw, threadId: thread.gmailThreadId });

    await recordSentMessage({
        thread,
        userId: thread.userId,
        direction: 'outbound',
        origin: 'portal-staff',
        // Staff wrote it, so there is nothing of the client's to remove. It is stored
        // exactly as typed and shown to both sides identically.
        bodyRedacted: text,
        messageId,
        gmailMessageId: sent.id,
        sentByUserId: staffUserId,
    });

    logger.info(`[GmailSend] staff reply sent on thread ${thread._id}`);
    return { id: sent.id, sentAt: new Date() };
};

/**
 * A client replies from the portal. Inserted into the Gmail thread; nothing is mailed.
 *
 * @param {object} args
 * @param {string} args.threadId
 * @param {string} args.body
 * @param {object} args.user  the authenticated client
 */
const insertClientReply = async ({ threadId, body, user }) => {
    const text = assertSendable(body);
    const { inboxAddress } = getCredentials();

    // Scoped to this client. The thread id comes from a URL, so it narrows within the
    // session's own conversations and can never select across them.
    const thread = await loadThreadForSend(threadId, user._id);

    const fromAddress = thread.clientEmail || user.email;
    const messageId = generateMessageId(String(fromAddress).split('@')[1]);

    const { raw } = buildMimeMessage({
        // `From: <the client>`, preserved — which is the entire reason this is an insert.
        from: { email: fromAddress },
        to: { email: inboxAddress },
        rawSubject: thread.rawSubject,
        bodyText: text,
        inReplyTo: thread.rfc822MessageIdOfLast,
        references: thread.referencesTail || [],
        messageId,
        origin: 'portal-client',
    });

    const inserted = await GmailClient.insertMessage({ raw, threadId: thread.gmailThreadId });

    /**
     * Redacted like any other client message.
     *
     * The client typed their own name and number here as readily as they would in an
     * email, and this text is about to be read by staff on a page that must not show
     * it. The portal being the origin is not a reason to trust the content — it is the
     * same author, through a different door.
     */
    const bundle = buildIdentityBundle(user);
    const { text: bodyRedacted } = redactAll(text, bundle);

    await recordSentMessage({
        thread,
        userId: user._id,
        direction: 'inbound',
        origin: 'portal-client',
        bodyRedacted,
        messageId,
        gmailMessageId: inserted.id,
    });

    logger.info(`[GmailSend] client reply inserted on thread ${thread._id}`);
    return { id: inserted.id, sentAt: new Date() };
};

module.exports = {
    sendStaffReply,
    insertClientReply,
    MAX_REPLY_CHARS,
    AGENCY_DISPLAY_NAME,
    ORIGIN_HEADER,
};

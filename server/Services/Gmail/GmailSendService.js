/**
 * GmailSendService.js — replies, from both sides.
 *
 * Two paths:
 *
 *   STAFF reply             → send to the client
 *   CLIENT ticket or reply  → send to OUR OWN inbox, Reply-To the client
 *
 * ── WHY A CLIENT'S PORTAL MESSAGE IS MAILED TO OURSELVES ──
 * This used `users.messages.insert`, which files a message into the mailbox with
 * `From: <the client>` preserved and transmits nothing. Faithful as a record, and wrong
 * in practice: an inserted message is synthetic, so Gmail raises no new-mail
 * notification for it. The admin is never told. A client raises a ticket, it sits
 * silently in a mailbox nobody was alerted to, and the portal reports it delivered.
 *
 * So these are genuinely sent now, to our own inbox. Real delivery means the admin's
 * ordinary email life works — phone notification, desktop alert, filters, the lot.
 *
 * Gmail only lets us send AS an address we own, so `From` has to be the inbox rather
 * than the client. `Reply-To: <the client>` is what carries the identity and makes the
 * admin's Reply reach the person who actually wrote. Without it the reply would come
 * straight back to ourselves — a loop, with the client hearing nothing.
 *
 * Mailing ourselves from ourselves has no deliverability cost: same domain, our own
 * SPF and DKIM, no external hop.
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
const { toPlainLabel } = require('../Email/emailRichText.js');
const { getCredentials, isMessagingEnabled, ORIGIN_HEADER } = require('./config.js');

/** The name the client sees on every reply. Never an individual. */
const AGENCY_DISPLAY_NAME = process.env.GMAIL_SENDER_NAME || 'eStore Factory';

/** What the admin sees in their Gmail list for a message raised in the portal. */
const PORTAL_SENDER_NAME = process.env.GMAIL_PORTAL_SENDER_NAME || 'SellerQI Portal';

const MAX_REPLY_CHARS = 10000;

/** A subject line, not a paragraph — long ones are unreadable in a conversation list. */
const MAX_SUBJECT_CHARS = 150;

/** How many conversations one client may have open at once. See startClientTicket. */
const MAX_OPEN_TICKETS = 10;

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
 * The footer on a portal message, so the admin reading it in Gmail knows where it came
 * from and who they are actually replying to.
 *
 * The client's address appears here deliberately. The admin has full Gmail access and
 * needs to know who wrote in — this is outside the staff-portal boundary, not a breach
 * of it. Nothing in this footer ever reaches the portal: the portal stores its own
 * redacted copy, built separately from the raw text.
 */
const portalFooter = (fromAddress) => [
    '',
    '—',
    `Sent from the SellerQI client portal by ${fromAddress}`,
    'Reply to this email and your reply goes straight to them.',
].join('\n');

/**
 * Deliver a client's portal message into our own inbox.
 *
 * Shared by tickets and replies because the only difference between them is whether a
 * Gmail thread already exists.
 */
const deliverClientMessage = async ({
    text, rawSubject, fromAddress, gmailThreadId = null, inReplyTo = null, references = [],
    isNewThread = false,
}) => {
    const { inboxAddress } = getCredentials();
    const messageId = generateMessageId(String(inboxAddress).split('@')[1]);

    const { raw } = buildMimeMessage({
        // Our own address, because Gmail will not let us send as anyone else.
        from: { name: PORTAL_SENDER_NAME, email: inboxAddress },
        to: { email: inboxAddress },
        // The header that makes "Reply" in Gmail reach the client instead of looping
        // back to us.
        replyTo: { email: fromAddress },
        rawSubject,
        isNewThread,
        bodyText: `${text}\n${portalFooter(fromAddress)}`,
        inReplyTo,
        references,
        origin: 'portal-client',
        messageId,
    });

    const sent = await GmailClient.sendMessage({ raw, ...(gmailThreadId ? { threadId: gmailThreadId } : {}) });
    return { sent, messageId };
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

    const { sent, messageId } = await deliverClientMessage({
        text,
        rawSubject: thread.rawSubject,
        fromAddress,
        gmailThreadId: thread.gmailThreadId,
        inReplyTo: thread.rfc822MessageIdOfLast,
        references: thread.referencesTail || [],
    });

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
        gmailMessageId: sent.id,
    });

    logger.info(`[GmailSend] client reply delivered on thread ${thread._id}`);
    return { id: sent.id, sentAt: new Date() };
};

/**
 * A client raises a ticket — the only way to START a conversation from the portal.
 *
 * Same mechanism as a client reply (insert, not send), with one difference: there is no
 * thread yet, so it is sent without a threadId and Gmail opens one. The
 * id it returns becomes our `gmailThreadId`, and every later message on both sides
 * threads onto it exactly as if the client had emailed in.
 *
 * ── THE SUBJECT IS UNTRUSTED CLIENT TEXT, IN TWO DIFFERENT WAYS ──
 * It goes into an email header, so it is a header-injection vector (handled by
 * mimeBuilder's sanitizeHeader). And it is displayed to STAFF, so it is an identity
 * leak vector — "Nitesh Kumar - urgent" as a subject would put the client's name at the
 * top of the staff inbox, above a body that was carefully redacted. Both apply; neither
 * is optional.
 *
 * The raw subject is still stored, because Gmail rejects a threaded reply whose subject
 * does not match the thread's — but it is `select: false` and staff never receive it.
 */
const startClientTicket = async ({ subject, body, user }) => {
    const text = assertSendable(body);

    const rawSubject = String(subject || '').trim().replace(/\s+/g, ' ');
    if (!rawSubject) throw new ApiError(400, 'A ticket needs a subject');
    if (rawSubject.length > MAX_SUBJECT_CHARS) {
        throw new ApiError(400, `A subject cannot be longer than ${MAX_SUBJECT_CHARS} characters`);
    }

    /**
     * A cap on OPEN tickets, not on tickets per hour.
     *
     * The thing worth preventing is not speed, it is sprawl: twenty open threads about
     * the same problem is worse for the client than one, and it buries the staff inbox.
     * Hitting this means "reply to an existing ticket instead", which is the behaviour
     * we actually want.
     */
    const openTickets = await EmailThread.countDocuments({ userId: user._id, resolvedAt: null });
    if (openTickets >= MAX_OPEN_TICKETS) {
        throw new ApiError(
            409,
            `You already have ${openTickets} open conversations. Please continue one of those `
            + 'rather than starting another, or wait until some are resolved.'
        );
    }

    const fromAddress = user.email;

    // No threadId — Gmail opens the conversation, and the id it returns becomes ours.
    const { sent, messageId } = await deliverClientMessage({
        text,
        rawSubject,
        fromAddress,
        // No "Re:" — this opens the conversation rather than continuing one.
        isNewThread: true,
    });

    const bundle = buildIdentityBundle(user);
    const { text: bodyRedacted } = redactAll(text, bundle);
    const { text: subjectRedacted } = redactAll(rawSubject, bundle);

    const sentAt = new Date();

    const thread = await EmailThread.findOneAndUpdate(
        { gmailThreadId: sent.threadId },
        {
            $setOnInsert: {
                gmailThreadId: sent.threadId,
                userId: user._id,
                clientEmail: fromAddress,
                rawSubject,
                displaySubject: toPlainLabel(subjectRedacted) || '(no subject)',
                firstMessageAt: sentAt,
            },
            $set: {
                lastMessageAt: sentAt,
                // Inbound: the client spoke last, so staff owe a reply and the thread
                // opens as "Needs a reply" on their side.
                lastMessageDirection: 'inbound',
                messageCount: 1,
                staffUnreadCount: 1,
                clientUnreadCount: 0,
                rfc822MessageIdOfLast: messageId,
                referencesTail: [messageId],
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await EmailMessage.updateOne(
        { gmailMessageId: sent.id },
        {
            $setOnInsert: {
                gmailMessageId: sent.id,
                gmailThreadId: sent.threadId,
                threadId: thread._id,
                userId: user._id,
                direction: 'inbound',
                origin: 'portal-client',
                rfc822MessageId: messageId,
                fromEmail: fromAddress,
                sentAt,
                bodyRedacted,
                bodyTruncated: false,
                quotedTrimmed: false,
                redactedBy: 'portal',
                syncedAt: sentAt,
            },
        },
        { upsert: true }
    );

    logger.info(`[GmailSend] client opened ticket ${thread._id}`);
    return { threadId: String(thread._id), subject: thread.displaySubject, sentAt };
};

module.exports = {
    sendStaffReply,
    insertClientReply,
    startClientTicket,
    MAX_REPLY_CHARS,
    MAX_SUBJECT_CHARS,
    MAX_OPEN_TICKETS,
    AGENCY_DISPLAY_NAME,
    ORIGIN_HEADER,
};

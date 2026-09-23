/**
 * GmailIngestService.js — Gmail into the portal's conversation record.
 *
 * Two entry points: `runSync()` walks the history cursor, `ingestMessage()` handles one
 * message. Split that way because the message path is what a push notification, a poll
 * and a backfill all share, and it is the only path that writes client-visible data.
 *
 * ── THE CURSOR RULES, WHICH ARE NOT NEGOTIABLE ──
 *
 * 1. `historyId` is a **String**. It is a uint64; `Number` loses precision above 2^53,
 *    which does not throw — it silently starts skipping mail.
 *
 * 2. It is persisted only after a page has been FULLY ingested. `history.list` moves in
 *    one direction only, so a cursor advanced optimistically and then interrupted does
 *    not make the messages in between late — it makes them permanently absent from the
 *    portal while sitting perfectly intact in Gmail, where nobody will think to look.
 *
 * 3. It never moves backwards. Compared as BigInt.
 *
 * 4. A pushed historyId is a DOORBELL, not a cursor. Pub/Sub delivers out of order and
 *    at least once, so persisting the pushed value would regularly skip mail. Nothing
 *    here accepts one.
 *
 * Worker concurrency must be 1. Not for throughput — the cursor is a single serialised
 * value, and two runs advancing it concurrently is the same lost-mail bug by another
 * route.
 */

const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const UserModel = require('../../models/user-auth/userModel.js');
const GmailConnection = require('../../models/system/GmailConnectionModel.js');
const { EmailThread, EmailMessage } = require('../../models/system/EmailThreadModels.js');
const GmailClient = require('./GmailClient.js');
const { parseMessage } = require('./gmailMessageParser.js');
const { routeMessage } = require('./inboundRouting.js');
const { prepareBody, toPlainLabel } = require('../Email/emailRichText.js');
const { buildIdentityBundle } = require('../Email/identityRedaction.js');
const { redactBody } = require('../AI/EmailRedactionService.js');
const {
    getCredentials, isMessagingEnabled, HISTORY_PAGE_SIZE, MAX_HISTORY_PAGES_PER_RUN, MAX_BODY_CHARS,
} = require('./config.js');

const SINGLETON_KEY = GmailConnection.SINGLETON_KEY;

/** Cap on the retry backlog. Beyond this, something systemic is wrong. */
const MAX_PENDING_MESSAGES = 200;

/** Only what the redaction bundle and matching need. Names are loaded here and nowhere else. */
const CLIENT_FIELDS = 'firstName lastName email additionalEmails phone whatsapp isEsfClient';

/** BigInt comparison, because these are uint64 strings. */
const isNewer = (candidate, current) => {
    if (!current) return true;
    try {
        return BigInt(candidate) > BigInt(current);
    } catch (_) {
        return false;
    }
};

/**
 * Find the client a message belongs to, trying each strategy in order.
 *
 * The strategies come from inboundRouting, which has already decided direction — so an
 * outbound message looks up by thread and never has its sender (our own inbox) fed to
 * the matcher, where it would match nothing and be discarded.
 */
const resolveClient = async (lookup) => {
    for (const strategy of lookup) {
        if (strategy.by === 'thread') {
            // eslint-disable-next-line no-await-in-loop
            const thread = await EmailThread.findOne({ gmailThreadId: strategy.value })
                .select('userId gmailThreadId')
                .lean();
            if (thread?.userId) {
                // eslint-disable-next-line no-await-in-loop
                const user = await UserModel.findById(thread.userId).select(CLIENT_FIELDS).lean();
                if (user) return { user, thread };
            }
        }

        if (strategy.by === 'address') {
            /**
             * `isEsfClient` is required, not cosmetic. ESF staff are User documents
             * too, so without it a staff member emailing the inbox opens a thread
             * against themselves — which then renders on the staff Messages page as a
             * client conversation.
             */
            // eslint-disable-next-line no-await-in-loop
            const user = await UserModel.findOne({
                isEsfClient: true,
                $or: [
                    { email: strategy.value },
                    // Unverified additional addresses are excluded deliberately: until
                    // ownership is proven, an address must not attach mail to an account.
                    { additionalEmails: { $elemMatch: { email: strategy.value, isVerified: true } } },
                ],
            }).select(CLIENT_FIELDS).lean();
            if (user) return { user, thread: null };
        }
    }

    return null;
};

/**
 * Flatten, strip the quoted chain, and redact.
 *
 * Fails CLOSED on content and open on availability, inverting this repo's usual "never
 * hard-fail on the LLM" rule: the normal fallback is to show more raw text, and here
 * that would show precisely what must be hidden. If the deterministic pass throws,
 * nothing is stored.
 */
const redactMessage = async (parsed, user) => {
    const isHtml = Boolean(parsed.bodyHtml);
    const { text, quotedTrimmed } = prepareBody(parsed.bodyHtml || parsed.bodyText || '', { isHtml });

    const truncated = text.length > MAX_BODY_CHARS;
    const source = truncated ? text.slice(0, MAX_BODY_CHARS) : text;

    const bundle = buildIdentityBundle(user);
    const result = await redactBody(source, bundle);

    return {
        bodyRedacted: result.text,
        bodyTruncated: truncated,
        quotedTrimmed,
        redactedBy: result.generatedBy,
        redactionVersion: result.redactionVersion,
        redactionSourceHash: result.sourceHash,
    };
};

/** Attachment filenames leak too — "Nitesh Kumar CV.pdf" names the client in a label. */
const redactAttachments = (attachments, bundle) => (attachments || []).map((file) => ({
    attachmentId: file.attachmentId,
    filenameRedacted: toPlainLabel(redactFilename(file.filename, bundle)) || 'Attachment',
    mimeType: file.mimeType,
    size: file.size,
}));

const redactFilename = (filename, bundle) => {
    let out = String(filename || '');
    (bundle.names || []).forEach((name) => {
        out = out.split(name).join('[name]');
    });
    return out;
};

/**
 * Ingest one message. Idempotent — the unique index on gmailMessageId is what makes a
 * redelivery a no-op rather than a duplicate in the client's thread.
 *
 * @returns {{status: string, reason?: string}}
 */
const ingestMessage = async (gmailMessageId) => {
    const { inboxAddress } = getCredentials();

    // Cheapest possible exit for the common case: Pub/Sub delivers at least once, so
    // most redeliveries are messages we already hold.
    const existing = await EmailMessage.exists({ gmailMessageId });
    if (existing) return { status: 'duplicate' };

    const raw = await GmailClient.getMessage(gmailMessageId);
    const parsed = parseMessage(raw);

    const decision = routeMessage(parsed, { inboxAddress });
    if (decision.action === 'skip') {
        return { status: 'skipped', reason: decision.reason };
    }

    /**
     * The SECOND echo guard: a message we wrote, recognised by the Message-ID we
     * generated before sending it.
     *
     * The X-SellerQI-Origin header in routeMessage above is the first. Neither is
     * redundant — the header is lost if a mail client strips unknown headers on a
     * round trip, and the id alone cannot help while our own write has not landed yet.
     * Between them, a portal reply is never stored twice.
     */
    if (parsed.rfc822MessageId) {
        const alreadyOurs = await EmailMessage.exists({ rfc822MessageId: parsed.rfc822MessageId });
        if (alreadyOurs) return { status: 'duplicate' };
    }

    const match = await resolveClient(decision.lookup);
    if (!match) {
        /**
         * Counted and logged rather than silently dropped. A client mailing from an
         * address we do not know gets no reply and ESF never learns they wrote — which
         * is right as policy and bad as an experience, so at minimum it has to be
         * visible somewhere.
         *
         * The address itself is NOT logged: server/utils/Logger.js writes unrotated to
         * logs.txt, and that would put a client's address on disk forever.
         */
        logger.warn(`[GmailIngest] no client matched for message ${gmailMessageId} (${decision.direction})`);
        return { status: 'unmatched' };
    }

    const { user } = match;
    const bundle = buildIdentityBundle(user);
    const redacted = await redactMessage(parsed, user);

    const thread = await upsertThread(parsed, user, decision);
    await EmailMessage.updateOne(
        { gmailMessageId },
        {
            $setOnInsert: {
                gmailMessageId,
                gmailThreadId: parsed.gmailThreadId,
                threadId: thread._id,
                userId: user._id,
                direction: decision.direction,
                origin: decision.origin,
                rfc822MessageId: parsed.rfc822MessageId,
                fromEmail: parsed.fromEmail,
                sentAt: parsed.sentAt,
                ...redacted,
                attachments: redactAttachments(parsed.attachments, bundle),
                syncedAt: new Date(),
            },
        },
        { upsert: true }
    );

    await refreshThreadCounters(thread._id, parsed, decision);

    return { status: 'ingested', direction: decision.direction, threadId: String(thread._id) };
};

/** Create or update the thread this message belongs to. */
const upsertThread = async (parsed, user, decision) => {
    const isInbound = decision.direction === 'inbound';

    return EmailThread.findOneAndUpdate(
        { gmailThreadId: parsed.gmailThreadId },
        {
            $setOnInsert: {
                gmailThreadId: parsed.gmailThreadId,
                userId: user._id,
                firstMessageAt: parsed.sentAt,
                // The address a reply has to be delivered to. select:false on the model
                // — staff never receive it, and the client already knows it.
                clientEmail: isInbound ? parsed.fromEmail : (parsed.toEmails[0] || user.email),
            },
            $set: {
                rawSubject: parsed.rawSubject,
                displaySubject: toPlainLabel(parsed.displaySubject) || '(no subject)',
                /**
                 * Refreshed on EVERY message, including one the admin sent from Gmail.
                 * Miss that and the next reply sent from the portal threads off a stale
                 * Message-ID, so the client's mail app shows it as a separate
                 * conversation — a bug that surfaces looking like it is on their side.
                 */
                rfc822MessageIdOfLast: parsed.rfc822MessageId,
                // Hard-capped: some clients build an unbounded References chain, and
                // this is a per-thread array that must not grow with the conversation.
                referencesTail: [...parsed.references, parsed.rfc822MessageId].filter(Boolean).slice(-10),
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

/**
 * Recompute the denormalised thread fields from the messages actually stored.
 *
 * Deliberately a recount rather than an increment. Increments drift the moment anything
 * is ingested twice or out of order — and both happen here, because Pub/Sub redelivers
 * and a backfill walks old mail — leaving unread badges that never clear and a thread
 * whose status disagrees with its own last message.
 */
const refreshThreadCounters = async (threadId, parsed, decision) => {
    const [last] = await EmailMessage.find({ threadId })
        .select('direction sentAt')
        .sort({ sentAt: -1 })
        .limit(1)
        .lean();

    const thread = await EmailThread.findById(threadId).select('lastClientReadAt lastStaffReadAt').lean();

    const [messageCount, staffUnread, clientUnread] = await Promise.all([
        EmailMessage.countDocuments({ threadId }),
        // Unread for staff means inbound messages since staff last opened it.
        EmailMessage.countDocuments({
            threadId,
            direction: 'inbound',
            ...(thread?.lastStaffReadAt ? { sentAt: { $gt: thread.lastStaffReadAt } } : {}),
        }),
        EmailMessage.countDocuments({
            threadId,
            direction: 'outbound',
            ...(thread?.lastClientReadAt ? { sentAt: { $gt: thread.lastClientReadAt } } : {}),
        }),
    ]);

    await EmailThread.updateOne({ _id: threadId }, {
        $set: {
            lastMessageAt: last?.sentAt || parsed.sentAt,
            lastMessageDirection: last?.direction || decision.direction,
            messageCount,
            staffUnreadCount: staffUnread,
            clientUnreadCount: clientUnread,
        },
    });
};

/**
 * Walk history from the stored cursor and ingest everything new.
 *
 * @returns {object} a summary; never throws for a per-message failure, because one
 *   unparseable message must not stop the mailbox.
 */
const runSync = async ({ reason = 'poll' } = {}) => {
    if (!isMessagingEnabled()) return { skipped: 'disabled' };

    const connection = await GmailConnection.findOne({ key: SINGLETON_KEY }).lean();
    if (!connection?.historyId) {
        // No cursor means never connected, or connected and not yet baselined. Either
        // way, walking from zero would replay the entire mailbox.
        logger.warn('[GmailIngest] no history cursor — skipping sync');
        return { skipped: 'no-cursor' };
    }

    const summary = {
        reason, pages: 0, seen: 0, ingested: 0, duplicate: 0, skipped: 0, unmatched: 0, failed: 0, retried: 0,
    };

    let cursor = String(connection.historyId);
    let pageToken;

    /**
     * Messages that failed, carried forward rather than skipped.
     *
     * The cursor advancing past a failure would lose that message for good, but holding
     * the cursor at it would stop all client mail until someone noticed. Tracking
     * failures here lets the cursor move while nothing is dropped.
     */
    const pending = new Set(connection.pendingMessageIds || []);

    // Retry the backlog first, so a message that failed for a transient reason is
    // stored before anything newer is, and the conversation stays in order.
    for (const messageId of [...pending]) {
        summary.retried += 1;
        try {
            // eslint-disable-next-line no-await-in-loop
            await ingestMessage(messageId);
            pending.delete(messageId);
        } catch (error) {
            logger.warn(`[GmailIngest] retry of ${messageId} failed again: ${error.message}`);
        }
    }

    try {
        do {
            // eslint-disable-next-line no-await-in-loop
            const page = await GmailClient.listHistory({
                startHistoryId: cursor,
                pageToken,
                maxResults: HISTORY_PAGE_SIZE,
            });

            summary.pages += 1;

            const messageIds = [...new Set(
                (page.history || [])
                    .flatMap((entry) => entry.messagesAdded || [])
                    .map((added) => added.message?.id)
                    .filter(Boolean)
            )];

            // Sequential, not Promise.all: each ingest may call the AI, and a burst of
            // parallel redactions is how the OpenAI rate limit gets tripped.
            for (const messageId of messageIds) {
                summary.seen += 1;
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const result = await ingestMessage(messageId);
                    summary[result.status === 'ingested' ? 'ingested' : result.status] += 1;
                } catch (error) {
                    // One bad message must not stop the mailbox, and must not be lost
                    // either. Held in `pending` so the cursor can advance while this
                    // message is retried on every later run.
                    summary.failed += 1;
                    pending.add(messageId);
                    logger.error(new ApiError(500, `[GmailIngest] message ${messageId} failed: ${error.message}`));
                }
            }

            /**
             * Advance ONLY now, after every message on this page has been handled.
             * `page.historyId` is where Gmail's history stood when it answered.
             */
            if (page.historyId && isNewer(String(page.historyId), cursor)) {
                cursor = String(page.historyId);
            }

            pageToken = page.nextPageToken;
        } while (pageToken && summary.pages < MAX_HISTORY_PAGES_PER_RUN);
    } catch (error) {
        /**
         * 404 means the cursor is older than Gmail's history window (about a week). It
         * cannot be recovered by retrying, and leaving it in place means every
         * subsequent run 404s too — mail stops with no error anyone sees.
         */
        if (error.statusCode === 404) {
            logger.warn('[GmailIngest] history cursor expired — backfill required');
            await GmailConnection.updateOne({ key: SINGLETON_KEY }, {
                $set: { lastError: 'History cursor expired; a backfill is required', lastErrorAt: new Date() },
            });
            return { ...summary, expired: true };
        }

        await GmailConnection.updateOne({ key: SINGLETON_KEY }, {
            $set: { lastError: error.message, lastErrorAt: new Date() },
        });
        throw error;
    }

    /**
     * A backlog that keeps growing is a systemic failure, not bad luck, and must raise
     * an alarm rather than quietly expanding a document. The newest are kept: they are
     * the ones a client is currently waiting on.
     */
    const pendingIds = [...pending].slice(-MAX_PENDING_MESSAGES);
    const backlogWarning = pending.size > MAX_PENDING_MESSAGES
        ? `${pending.size} messages are failing to ingest; only the newest ${MAX_PENDING_MESSAGES} are still being retried`
        : null;

    // Persisted once, at the end, and only forward.
    await GmailConnection.updateOne({ key: SINGLETON_KEY }, {
        $set: {
            ...(isNewer(cursor, connection.historyId) ? { historyId: cursor } : {}),
            lastSyncAt: new Date(),
            pendingMessageIds: pendingIds,
            lastError: backlogWarning,
            lastErrorAt: backlogWarning ? new Date() : null,
        },
    });

    summary.pending = pendingIds.length;

    if (summary.seen > 0) {
        logger.info(`[GmailIngest] ${reason}: ${JSON.stringify(summary)}`);
    }

    return summary;
};

module.exports = {
    runSync,
    ingestMessage,
    resolveClient,
    refreshThreadCounters,
    isNewer,
};

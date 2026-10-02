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
const { prepareBody, toPlainText, toPlainLabel } = require('../Email/emailRichText.js');
const { splitEmail, buildBodyForModel } = require('../Email/quoteSplitter.js');
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

/** How many of our own earlier replies the inline-answer diff compares against. */
const PREVIOUS_MESSAGES_FOR_DIFF = 1;

/**
 * The most recent things WE sent on this thread, for quoteSplitter's diff.
 *
 * These are the redacted copies — the only ones that exist, since the models never hold a
 * raw body. quoteSplitter knows that and treats [name]/[email]/[phone]/[link] as
 * wildcards; without it the client's own name comes back as something they just typed.
 *
 * Fails open to []. A lookup failure should cost the diff, not the client's email: the
 * heuristic path still runs, and ingest carries on exactly as it did before this existed.
 */
const previousOutboundBodies = async (gmailThreadId) => {
    if (!gmailThreadId) return [];
    try {
        const rows = await EmailMessage
            .find({ gmailThreadId, direction: 'outbound' })
            .sort({ sentAt: -1 })
            .limit(PREVIOUS_MESSAGES_FOR_DIFF)
            .select('bodyRedacted')
            .lean();
        return rows.map((row) => row.bodyRedacted).filter(Boolean);
    } catch (error) {
        logger.warn(`[GmailIngest] previous-message lookup failed: ${error.message}`);
        return [];
    }
};

/**
 * Flatten, cut the quoted chain, and recover the answers typed INSIDE that chain.
 *
 * ── WHY THE CUT IS COMPUTED TWICE AND THE SHORTER ONE WINS ──
 * prepareBody and quoteSplitter cut at overlapping but not identical markers, and only
 * prepareBody strips HTML quote containers structurally, before the tags come off. Taking
 * whichever kept LESS guarantees the one property that matters here: this can only ever
 * store less of the quoted chain than it did yesterday, never more.
 *
 * The recovered answers are the sole addition, and they are composed into the body rather
 * than stored beside it — so they pass through the same redactBody and the same
 * assertNoIdentityLeak as everything else, with no new field and no new boundary.
 *
 * Inbound only. Recovery asks "what did the client type into our words", which is
 * meaningless for a message we sent.
 *
 * @returns {{ text: string, quotedTrimmed: boolean }}  prepareBody's shape, deliberately
 */
const composeBody = async (parsed, decision) => {
    const isHtml = Boolean(parsed.bodyHtml);
    const raw = parsed.bodyHtml || parsed.bodyText || '';
    const prepared = prepareBody(raw, { isHtml });

    if (decision.direction !== 'inbound') return prepared;

    try {
        const split = splitEmail(toPlainText(raw, { isHtml }), {
            previousMessages: await previousOutboundBodies(parsed.gmailThreadId),
        });
        const body = split.body.length < prepared.text.length ? split.body : prepared.text;

        return {
            text: buildBodyForModel(body, split.inlineReplies),
            quotedTrimmed: prepared.quotedTrimmed || split.quotedTrimmed,
        };
    } catch (error) {
        // Recovery is an enhancement; prepareBody alone is what shipped before it.
        logger.warn(`[GmailIngest] inline-reply recovery failed: ${error.message}`);
        return prepared;
    }
};

/**
 * Redact the composed body.
 *
 * Fails CLOSED on content and open on availability, inverting this repo's usual "never
 * hard-fail on the LLM" rule: the normal fallback is to show more raw text, and here
 * that would show precisely what must be hidden. If the deterministic pass throws,
 * nothing is stored.
 */
const redactMessage = async ({ text, quotedTrimmed }, user) => {
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

    /**
     * The SECOND echo guard, and it must run BEFORE the routing decision below.
     *
     * A message we send to our own inbox exists in Gmail twice — the sent copy and the
     * delivered copy — under two different message ids but ONE Message-ID header. The
     * id check above only catches the copy we recorded. Reaching the portal-echo branch
     * with the other copy would defer it, and keep deferring it forever, because its
     * gmailMessageId is never going to match the one we stored.
     *
     * Together with the X-SellerQI-Origin header this is why a portal message is never
     * stored twice: the header is lost if a client strips unknown headers on a round
     * trip, and the id alone cannot help while our own write has not landed yet.
     */
    if (parsed.rfc822MessageId) {
        const alreadyOurs = await EmailMessage.exists({ rfc822MessageId: parsed.rfc822MessageId });
        if (alreadyOurs) return { status: 'duplicate' };
    }

    const decision = routeMessage(parsed, { inboxAddress });
    if (decision.action === 'skip') {
        /**
         * "We wrote this ourselves" is a claim about a row that should already exist —
         * and the duplicate check above proved it does not.
         *
         * Two things reach here. Either the push beat our own write by milliseconds (a
         * race, and the row is about to appear), or that write FAILED and the message
         * now exists only in Gmail. Skipping unconditionally is right for the first and
         * loses the message permanently for the second, because nothing will ever look
         * at it again — not a later sync, not even a backfill, since the header keeps
         * saying "already handled".
         *
         * Deferring costs one retry in the common case and is the difference between
         * losing a client's message and not, in the rare one.
         */
        if (decision.reason === 'portal-echo') {
            return { status: 'deferred', reason: 'portal-echo-without-local-copy' };
        }
        return { status: 'skipped', reason: decision.reason };
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

    /**
     * Composed ONCE and used twice, which is the asymmetry to keep straight: the same
     * text goes to storage through redactMessage and to the intent model raw. This used
     * to be two identical prepareBody calls on the same input.
     *
     * The raw copy is held only for the duration of this call and is never written
     * anywhere — the models keep the redacted copy alone, and that is the property the
     * whole staff/client boundary rests on.
     */
    const prepared = await composeBody(parsed, decision);
    const redacted = await redactMessage(prepared, user);
    const rawBodyForIntent = prepared.text;

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

    // Re-read rather than trusting the upsert's return: on a redelivery the row already
    // existed, and the intent handler needs its real _id to link a request back to it.
    const stored = await EmailMessage.findOne({ gmailMessageId }).select('_id gmailMessageId').lean();

    await refreshThreadCounters(thread._id, parsed, decision);

    /**
     * Read the message for intent — a client asking for new work, or a staff reply
     * deciding on a request already waiting.
     *
     * Deliberately LAST, and after the message is already stored. Everything above is
     * the conversation record, which must survive regardless; losing a client's email
     * because an analysis failed would be exactly backwards. analyseMessage swallows its
     * own failures for the same reason, and this awaits it only so a sync's summary
     * reflects work that actually finished.
     *
     * Given the RAW text, not the redacted copy stored above. Redaction strips every
     * URL, and "please update amazon.com/dp/B08…" is precisely what makes a request
     * worth raising. Nothing read here is stored unredacted — the handler runs its own
     * redaction before writing anything.
     */
    const { analyseMessage } = require('../User/MessageIntentHandler.js');
    await analyseMessage({
        direction: decision.direction,
        origin: decision.origin,
        rawText: rawBodyForIntent,
        user,
        thread,
        message: stored,
    });

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

    /**
     * ── A REPLY IS PROOF OF READING ──
     *
     * The read receipt originally listened for one thing: the client opening the thread
     * in the portal. But this is an email conversation, and a client who lives in their
     * mail app never produces that signal at all — so every message we sent showed a
     * single tick forever, including ones they had demonstrably read, because they
     * answered them. The receipt was decoration, and a staff member reading it as "they
     * are ignoring me" was being actively misled.
     *
     * Someone replying at 11:57 has read what arrived at 11:56. That is not an
     * inference, it is what a reply means. Taking the newest inbound timestamp as a read
     * marker makes the tick reflect reality rather than portal habits, and fixes the
     * unread count in the same stroke — a client who answered by email had their reply
     * still counted as something they had not seen.
     *
     * Only ever moves FORWARD. Backfill walks old mail, so an ancient inbound message
     * ingested late must not drag the marker backwards and resurrect read messages as
     * unread.
     */
    const [newestInbound] = await EmailMessage.find({ threadId, direction: 'inbound' })
        .select('sentAt')
        .sort({ sentAt: -1 })
        .limit(1)
        .lean();

    const clientReadAt = [thread?.lastClientReadAt, newestInbound?.sentAt]
        .filter(Boolean)
        .map((value) => new Date(value))
        .sort((a, b) => b - a)[0] || null;

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
            ...(clientReadAt ? { sentAt: { $gt: clientReadAt } } : {}),
        }),
    ]);

    await EmailThread.updateOne({ _id: threadId }, {
        $set: {
            lastMessageAt: last?.sentAt || parsed.sentAt,
            lastMessageDirection: last?.direction || decision.direction,
            messageCount,
            staffUnreadCount: staffUnread,
            clientUnreadCount: clientUnread,
            ...(clientReadAt ? { lastClientReadAt: clientReadAt } : {}),
        },
    });
};

/**
 * Walk history from the stored cursor and ingest everything new.
 *
 * @returns {object} a summary; never throws for a per-message failure, because one
 *   unparseable message must not stop the mailbox.
 */
/**
 * Give up only when BOTH are exceeded. See the schema comment on pendingMessages.
 *
 * Tuned to a ten-minute poll: 25 attempts is roughly four hours, so the age bound is the
 * one that actually binds. Confirm GMAIL_POLL_MINUTES before changing either.
 */
const MAX_PENDING_ATTEMPTS = 25;
const MIN_PENDING_AGE_MS = 6 * 60 * 60 * 1000;

/** How many retired entries to keep. The newest are the ones worth looking at. */
const MAX_DEAD_LETTERS = 50;

/**
 * An error that will never succeed, however long we wait.
 *
 * Gmail answers 404 for a message deleted from the mailbox while history.list still
 * reports it as added. Every one of the 37 messages stuck in the live backlog was this.
 * Retrying it is not optimism, it is just cost: there is no message left to fetch.
 *
 * Narrow on purpose. Anything that is not a definite 404 keeps its place, because the
 * expensive mistake here is retiring a message that was only temporarily unreachable.
 */
const PERMANENT_FAILURE = (error) => error?.statusCode === 404;

/**
 * Read the backlog, adopting anything still in the legacy [String] field.
 *
 * Lazy rather than a migration script, because the backlog is a live, moving value: a
 * script would race the poll, while the singleton has exactly one writer (worker
 * concurrency is 1) so the next sync is a guaranteed serialised migration point.
 *
 * Adopted entries get firstSeenAt = now, NOT epoch. We do not know how long they have
 * been failing, and guessing "forever" would retire the whole existing backlog on the
 * first run after deploy - before anyone had seen what was in it. They get one full
 * bounded cycle from the moment this code starts running.
 */
const loadBacklog = (connection) => {
    const entries = new Map();
    for (const entry of connection.pendingMessages || []) {
        if (entry?.id) entries.set(entry.id, { ...entry });
    }
    const now = new Date();
    for (const id of connection.pendingMessageIds || []) {
        if (!id || entries.has(id)) continue;
        entries.set(id, { id, attempts: 0, firstSeenAt: now, lastAttemptAt: null, lastOutcome: 'throw', lastReason: null });
    }
    return entries;
};

/** Has this entry earned retirement? */
const shouldRetire = (entry, { permanent = false } = {}) => {
    if (permanent) return true;
    const ageMs = Date.now() - new Date(entry.firstSeenAt || Date.now()).getTime();
    return entry.attempts >= MAX_PENDING_ATTEMPTS && ageMs >= MIN_PENDING_AGE_MS;
};

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
        reason, pages: 0, seen: 0, ingested: 0, duplicate: 0, skipped: 0, unmatched: 0, failed: 0, retried: 0, deferred: 0,
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
    const pending = loadBacklog(connection);
    const retired = [...(connection.deadLetterMessages || [])];
    const retiredThisRun = [];

    /**
     * One attempt at one message, from the backlog or newly seen.
     *
     * ── THE TWO BUGS THIS SHAPE FIXES ──
     * The previous loop dropped an id on ANY non-throwing return, `deferred` included.
     * So a portal echo whose own write had genuinely failed - the exact case the
     * deferral was invented for - got one retry and was then forgotten permanently,
     * which is the loss the deferral exists to prevent. Meanwhile a throwing message
     * was kept forever with no counter, which is how 37 of them accumulated unseen.
     *
     * Deferral and throw are now the same thing: a bounded failure with a count on it.
     *
     * @returns {'cleared'|'retained'|'retired'}
     */
    const attemptOne = async (entry) => {
        let outcome = 'throw';
        let reason = null;
        let permanent = false;

        try {
            const result = await ingestMessage(entry.id);
            /*
             * ingested / duplicate / skipped / unmatched are terminal DECISIONS, not
             * failures. Clearing them on the first attempt is what drains most of a
             * backlog for free.
             */
            if (result.status !== 'deferred') return 'cleared';
            outcome = 'deferred';
            reason = result.reason || 'deferred';
        } catch (error) {
            permanent = PERMANENT_FAILURE(error);
            // The error text only - Gmail's messages carry no client content.
            reason = String(error?.message || 'unknown').slice(0, 300);
        }

        entry.attempts = (entry.attempts || 0) + 1;
        entry.lastAttemptAt = new Date();
        entry.lastOutcome = outcome;
        entry.lastReason = reason;

        if (!shouldRetire(entry, { permanent })) return 'retained';

        retired.push({
            id: entry.id,
            attempts: entry.attempts,
            firstSeenAt: entry.firstSeenAt || null,
            retiredAt: new Date(),
            lastOutcome: entry.lastOutcome,
            lastReason: entry.lastReason,
        });
        retiredThisRun.push(entry.id);
        // Once, at retirement - not on every one of the attempts that led here.
        logger.error(new ApiError(500, `[GmailIngest] giving up on ${entry.id} after ${entry.attempts} attempt(s): ${reason}`));
        return 'retired';
    };

    // Retry the backlog first, so a message that failed for a transient reason is
    // stored before anything newer is, and the conversation stays in order.
    for (const entry of [...pending.values()]) {
        summary.retried += 1;
        // eslint-disable-next-line no-await-in-loop
        const verdict = await attemptOne(entry);
        if (verdict !== 'retained') pending.delete(entry.id);
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
                /**
                 * Newly seen, so it enters the backlog the same way a retry stays in it:
                 * through attemptOne, which counts the failure and can retire it.
                 *
                 * A deferral - our own write has not landed yet, or never will - is held
                 * rather than skipped, so the message cannot be lost in the second case.
                 * A thrown error is held for the same reason: one bad message must not
                 * stop the mailbox, and must not disappear either.
                 */
                const entry = {
                    id: messageId,
                    attempts: 0,
                    firstSeenAt: new Date(),
                    lastAttemptAt: null,
                    lastOutcome: 'throw',
                    lastReason: null,
                };
                // eslint-disable-next-line no-await-in-loop
                const verdict = await attemptOne(entry);

                if (verdict === 'cleared') summary.ingested += 1;
                else if (verdict === 'retained') {
                    summary[entry.lastOutcome === 'deferred' ? 'deferred' : 'failed'] += 1;
                    pending.set(messageId, entry);
                } else summary.failed += 1;
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
    const pendingEntries = [...pending.values()].slice(-MAX_PENDING_MESSAGES);
    const deadLetters = retired.slice(-MAX_DEAD_LETTERS);

    /*
     * What `lastError` says, in priority order.
     *
     * It used to be set by exactly one condition - the backlog passing its 200-entry cap
     * - and a small inbox never reaches that, which is why 37 stuck messages reported as
     * a healthy connection for a week. AGE is the signal that matters, not size: one
     * message retrying for six days is a broken integration, two hundred that arrived in
     * the last ten minutes are a busy morning.
     */
    const oldestPendingMs = pendingEntries.length
        ? Math.min(...pendingEntries.map((e) => new Date(e.firstSeenAt || Date.now()).getTime()))
        : null;
    const stuckHours = oldestPendingMs ? (Date.now() - oldestPendingMs) / 3600000 : 0;

    const backlogWarning = retiredThisRun.length
        ? `${retiredThisRun.length} message(s) retired after repeated ingest failures; see /api/gmail/status`
        : pending.size > MAX_PENDING_MESSAGES
            ? `${pending.size} messages are failing to ingest; only the newest ${MAX_PENDING_MESSAGES} are still being retried`
            : stuckHours >= 2
                ? `a message has been failing to ingest for ${Math.floor(stuckHours)}h; see /api/gmail/status`
                : null;

    // Persisted once, at the end, and only forward.
    await GmailConnection.updateOne({ key: SINGLETON_KEY }, {
        $set: {
            ...(isNewer(cursor, connection.historyId) ? { historyId: cursor } : {}),
            lastSyncAt: new Date(),
            pendingMessages: pendingEntries,
            deadLetterMessages: deadLetters,
            // Adopted into pendingMessages above; cleared so the migration runs once.
            pendingMessageIds: [],
            lastError: backlogWarning,
            lastErrorAt: backlogWarning ? new Date() : null,
        },
    });

    summary.pending = pendingEntries.length;
    summary.retired = retiredThisRun.length;

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

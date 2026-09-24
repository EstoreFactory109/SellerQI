/**
 * messagePresenter.js — the only place a stored conversation becomes an API response.
 *
 * Four explicit serialisers, one per audience per shape. Controllers never spread a
 * Mongoose document into a response: ManagedClientService's `return { ...client }` is
 * the counter-pattern, and it is precisely how a field added to a model six months
 * from now ends up on the wire without anyone deciding it should.
 *
 * THIS IS THE SECOND OF THREE LAYERS, NOT THE ONLY ONE.
 *   1. `select: false` on the model — the raw address and subject do not load unless
 *      a query asks for them by name
 *   2. these serialisers — an allow-list of exactly what each audience gets
 *   3. assertNoIdentityLeak() below — a runtime scan of the finished payload
 *
 * One layer would be enough right up until the day it isn't. The third exists because
 * the first two are both things a future change can silently bypass.
 *
 * WHAT STAFF NEVER RECEIVE: the client's address, name, raw subject, the Gmail thread
 * or message ids (those are a live handle into the mailbox — pasting one into Gmail
 * search returns the original, un-redacted), or the RFC threading headers.
 */

const { deriveThreadStatus } = require('./threadStatus.js');

/** Anything that looks like contact detail, whatever field it arrived in. */
const EMAIL_SHAPE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const LONG_DIGITS = /(?<![\w.])\d[\d\s.\-()]{8,}\d(?![\w.])/;

/**
 * Whether the other side has opened a message, for the read receipt on each bubble.
 *
 * ── WHAT THIS CAN AND CANNOT KNOW, AND WHY THE UI MUST SAY SO ──
 * The only read signal that exists is someone opening the thread IN THE PORTAL. This
 * is an email-backed conversation: a client who reads the mail in Gmail and replies
 * from their phone never touches the portal, and this returns false for every message
 * they have in fact read. Open tracking (a pixel) is the usual answer and is not one
 * here — it is a third-party beacon on client mail, and it fails against every mail
 * client that blocks remote images anyway.
 *
 * So `false` means "not opened in the portal", NOT "unread". Only `true` is a claim.
 * The staff page therefore renders the two states as sent/opened rather than as
 * delivered/read — a staff member who read a single tick as "they are ignoring me"
 * would be acting on something this function cannot support.
 */
const seenBy = (message, readAt) => Boolean(
    readAt && message.sentAt && new Date(readAt) >= new Date(message.sentAt)
);

/**
 * Last-resort scan of a finished staff payload.
 *
 * Deterministic, cheap, and aimed at the failure the other two layers cannot catch:
 * someone adds a field to the model and to the serialiser without thinking about who
 * reads it. Throws outside production so a test or a developer sees it immediately;
 * logs in production, because a broken inbox is worse than a late warning — and the
 * redaction pipeline has already run by this point, so this firing means something
 * structural is wrong, not that one message slipped.
 */
const assertNoIdentityLeak = (payload, { logger = null } = {}) => {
    const serialised = JSON.stringify(payload ?? null);
    const found = [];

    if (EMAIL_SHAPE.test(serialised)) found.push('email address');
    if (LONG_DIGITS.test(serialised)) found.push('long digit run');

    if (found.length === 0) return payload;

    const message = `[messagePresenter] staff payload contains ${found.join(' and ')}`;
    if (process.env.NODE_ENV !== 'production') throw new Error(message);
    if (logger) logger.error(message);

    return payload;
};

/** One thread, as the CLIENT sees their own conversation. */
const toClientThread = (thread) => {
    const status = deriveThreadStatus(thread, { audience: 'client' });

    return {
        id: String(thread._id),
        subject: thread.displaySubject,
        status: status.label,
        state: status.state,
        needsYourReply: status.needsAttention,
        lastMessageAt: thread.lastMessageAt,
        messageCount: thread.messageCount,
        unread: thread.clientUnreadCount > 0,
        /**
         * How many are unread, not how many exist — the same rule as the staff side.
         * Badging messageCount would claim five new messages on a thread with one.
         */
        unreadCount: thread.clientUnreadCount || 0,
        /**
         * The receipt for the LAST message, so the list can tick a row the way the
         * conversation ticks a bubble. Null when the team spoke last — there is nothing
         * of the CLIENT'S awaiting our eyes, and a tick on our own message would be
         * telling them whether they themselves had read it.
         *
         * Mirrors lastSeenByClient on toStaffThread with the directions swapped:
         * inbound is the client's own message on this side of the boundary.
         */
        lastSeenByTeam: thread.lastMessageDirection === 'inbound'
            ? seenBy({ sentAt: thread.lastMessageAt }, thread.lastStaffReadAt)
            : null,
        resolved: Boolean(thread.resolvedAt),
    };
};

/**
 * One message, as the CLIENT sees it.
 *
 * The client sees the REDACTED body too, even though it is their own words. Storing
 * one body and serving it to both is what guarantees the two can never diverge — and
 * a second raw copy kept only for the client would be exactly the raw field this
 * design removed on purpose.
 */
const toClientMessage = (message, { staffReadAt = null } = {}) => ({
    id: String(message._id),
    direction: message.direction,
    // "You" vs the agency. No individual is named in either direction.
    author: message.direction === 'inbound' ? 'You' : 'eStore Factory',
    body: message.bodyRedacted,
    sentAt: message.sentAt,
    /**
     * Only for the client's OWN messages — a receipt on the agency's message would be
     * telling them whether they themselves have read it. Null, not false, so the UI
     * renders nothing rather than an empty tick. See seenBy() on what false means.
     */
    seenByTeam: message.direction === 'inbound' ? seenBy(message, staffReadAt) : null,
    truncated: Boolean(message.bodyTruncated),
    quotedTrimmed: Boolean(message.quotedTrimmed),
    attachments: (message.attachments || []).map((a) => ({
        id: a.attachmentId,
        name: a.filenameRedacted,
        mimeType: a.mimeType,
        size: a.size,
    })),
});

/**
 * One thread, as STAFF see it.
 *
 * `label` is the whole point: the client's Zoho project, brand, or stored reference —
 * never their name. See Services/User/esfClientLabel.js.
 */
const toStaffThread = (thread, label) => {
    const status = deriveThreadStatus(thread, { audience: 'staff' });

    return {
        id: String(thread._id),
        client: label,
        subject: thread.displaySubject,
        status: status.label,
        state: status.state,
        needsReply: status.needsAttention,
        lastMessageAt: thread.lastMessageAt,
        messageCount: thread.messageCount,
        unread: thread.staffUnreadCount > 0,
        /**
         * How many are unread, not how many exist — the inbox badges this, and
         * badging messageCount instead would claim five new messages on a thread
         * with one. A count carries no identity.
         */
        unreadCount: thread.staffUnreadCount || 0,
        /**
         * The receipt for the LAST message, so the list can tick a row the way the
         * conversation ticks a bubble. Null when the client spoke last — there is
         * nothing of ours awaiting their eyes.
         */
        lastSeenByClient: thread.lastMessageDirection === 'outbound'
            ? seenBy({ sentAt: thread.lastMessageAt }, thread.lastClientReadAt)
            : null,
        resolved: Boolean(thread.resolvedAt),
    };
};

/** One message, as STAFF see it. */
const toStaffMessage = (message, { clientReadAt = null } = {}) => ({
    id: String(message._id),
    direction: message.direction,
    // The client is the label, never a person; ESF is "your team", never an individual
    // — the same rule the Status page already applies in the other direction.
    author: message.direction === 'inbound' ? 'Client' : 'Your team',
    body: message.bodyRedacted,
    sentAt: message.sentAt,
    /**
     * Only for the team's OWN messages. Null, not false, on the client's — staff
     * already read those by definition, and a tick there would read as a claim about
     * the client. See seenBy() for why false is not "unread".
     */
    seenByClient: message.direction === 'outbound' ? seenBy(message, clientReadAt) : null,
    truncated: Boolean(message.bodyTruncated),
    quotedTrimmed: Boolean(message.quotedTrimmed),
    /**
     * Flagged so the UI can say so. A staff member reading a message that lost its
     * detail to a redaction fallback should know that is why it reads thinly, rather
     * than concluding the client wrote something terse.
     */
    redactedBy: message.redactedBy,
    attachments: (message.attachments || []).map((a) => ({
        id: a.attachmentId,
        name: a.filenameRedacted,
        mimeType: a.mimeType,
        size: a.size,
    })),
});

/**
 * The Mongo projections these serialisers depend on.
 *
 * Exported so the controllers use them by name and a test can assert them. Keeping
 * the raw fields out of the query — rather than merely out of the response — means
 * they never enter that request's process memory at all, so they cannot reach a log,
 * an error report or a debugger.
 */
const PROJECTION = {
    // The two readAt timestamps are here for the per-message read receipts. They are
    // timestamps, not identity — nothing about them says who the client is.
    thread: 'displaySubject lastMessageAt lastMessageDirection messageCount resolvedAt clientUnreadCount staffUnreadCount lastClientReadAt lastStaffReadAt userId',
    message: 'direction bodyRedacted sentAt bodyTruncated quotedTrimmed redactedBy attachments threadId userId',
};

module.exports = {
    toClientThread,
    toClientMessage,
    toStaffThread,
    toStaffMessage,
    assertNoIdentityLeak,
    PROJECTION,
};

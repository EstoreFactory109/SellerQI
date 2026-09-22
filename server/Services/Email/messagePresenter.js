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
const toClientMessage = (message) => ({
    id: String(message._id),
    direction: message.direction,
    // "You" vs the agency. No individual is named in either direction.
    author: message.direction === 'inbound' ? 'You' : 'eStore Factory',
    body: message.bodyRedacted,
    sentAt: message.sentAt,
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
        resolved: Boolean(thread.resolvedAt),
    };
};

/** One message, as STAFF see it. */
const toStaffMessage = (message) => ({
    id: String(message._id),
    direction: message.direction,
    // The client is the label, never a person; ESF is "your team", never an individual
    // — the same rule the Status page already applies in the other direction.
    author: message.direction === 'inbound' ? 'Client' : 'Your team',
    body: message.bodyRedacted,
    sentAt: message.sentAt,
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
    thread: 'displaySubject lastMessageAt lastMessageDirection messageCount resolvedAt clientUnreadCount staffUnreadCount userId',
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

/**
 * EmailThreadModels.js — the client↔ESF email conversation, as the portal sees it.
 *
 * Gmail is the system of record. These collections exist so both Messages pages are a
 * database read rather than three Gmail calls per view, and so they keep working when
 * Gmail is slow — the same reasoning as ZohoProjectTaskModel's header.
 *
 * ONE DOCUMENT PER MESSAGE, deliberately. A client relationship spanning years of
 * replies is exactly the unbounded-embedded-array shape that has already produced
 * 16MB document failures in this repo (ERR_OUT_OF_RANGE). QMateChatModel is the
 * in-repo counter-example and not the pattern to copy here.
 *
 * WHAT IS DELIBERATELY ABSENT
 * There is no raw body field, and that is the most important line in this file.
 * ZohoProjectTaskModel keeps raw comments so a prompt change can re-summarise without
 * re-fetching, and that reasoning does NOT transfer: there the client was the excluded
 * party and staff were the audience, here STAFF ARE THE ADVERSARY. Raw text in Mongo
 * is one stray `.lean()` without a projection, one export script, or one database
 * dump away from defeating the whole boundary. If a REDACTION_VERSION bump needs a
 * re-run, the original is re-fetched from Gmail.
 *
 * The client's own address IS stored — replies have to be delivered somewhere — but
 * behind `select: false`, the same discipline as ZohoConnectionModel.refreshToken.
 */

const mongoose = require('mongoose');

const EmailThreadSchema = new mongoose.Schema({
    /** Gmail's thread id — the natural key. Unique makes thread creation idempotent. */
    gmailThreadId: { type: String, required: true, unique: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /**
     * The address this client mails from, which may be a verified additional address
     * rather than their primary.
     *
     * INTERNAL ONLY — never serialised to either page. Staff must not see it, and the
     * client already knows it. It exists so a reply can be addressed.
     */
    clientEmail: { type: String, default: null, select: false },

    /**
     * The subject exactly as received, and the tidied one for display.
     *
     * Both are needed: Gmail rejects a threaded send whose subject does not match the
     * thread's, so the raw form has to survive — while the UI wants it without the
     * accumulated "Re: Re: Fwd:".
     */
    rawSubject: { type: String, default: null, select: false },
    displaySubject: { type: String, default: null },

    firstMessageAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: null, index: true },

    /**
     * Denormalised so the thread list never has to touch the messages collection.
     * This one field is what derives the status shown on both pages.
     */
    lastMessageDirection: { type: String, enum: ['inbound', 'outbound'], default: 'inbound' },
    messageCount: { type: Number, default: 0 },

    /** Staff-set. Overrides the derived status when present. */
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * Two unread counters, not one. "Unread" means opposite things to the two
     * audiences, and a single counter would show a client their own reply as unread.
     */
    clientUnreadCount: { type: Number, default: 0 },
    staffUnreadCount: { type: Number, default: 0 },
    lastClientReadAt: { type: Date, default: null },
    lastStaffReadAt: { type: Date, default: null },

    /**
     * Threading headers for the next reply. Kept on the thread so sending needs no
     * second query.
     *
     * `referencesTail` is hard-capped: some clients build an unbounded References
     * chain, and this is a per-thread array that must not grow with the conversation.
     */
    rfc822MessageIdOfLast: { type: String, default: null, select: false },
    referencesTail: { type: [String], default: [], select: false },
}, { timestamps: true });

// The client page's only query.
EmailThreadSchema.index({ userId: 1, lastMessageAt: -1 });
// The staff inbox: open threads first, newest activity first.
EmailThreadSchema.index({ resolvedAt: 1, lastMessageAt: -1 });

const EmailMessageSchema = new mongoose.Schema({
    /**
     * Gmail's message id, unique.
     *
     * THIS INDEX IS THE IDEMPOTENCY GUARANTEE. Pub/Sub delivers at least once, so the
     * same message will be ingested more than once; the unique key is what makes the
     * second attempt a no-op instead of a duplicate in the client's thread.
     */
    gmailMessageId: { type: String, required: true, unique: true },

    gmailThreadId: { type: String, required: true, index: true },
    threadId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailThread', required: true },
    // Copied down so every client-scoped query avoids a join.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    direction: { type: String, enum: ['inbound', 'outbound'], required: true },

    /**
     * How this message entered the system.
     *
     * 'portal-client' matters beyond debugging: a reply the client typed in the portal
     * is inserted into Gmail by us, which fires our own watch notification and comes
     * back as new inbound mail. This field plus the X-SellerQI-Origin header is how
     * that loop is broken.
     */
    origin: {
        type: String,
        enum: ['email', 'portal-client', 'portal-staff'],
        default: 'email',
    },

    /** The Message-ID header. Reconciles a message we inserted with the one Gmail returns. */
    rfc822MessageId: { type: String, default: null, index: true, sparse: true },

    /** INTERNAL ONLY, like the thread's copy. */
    fromEmail: { type: String, default: null, select: false },

    sentAt: { type: Date, default: null, index: true },

    /**
     * The redacted body — the ONLY body stored. See the header: there is no raw field
     * to accidentally serialise, export or dump.
     */
    bodyRedacted: { type: String, default: '' },
    bodyTruncated: { type: Boolean, default: false },
    /** Whether a quoted reply chain was cut, so the UI can say the history is elsewhere. */
    quotedTrimmed: { type: Boolean, default: false },

    /** 'ai' | 'deterministic' | 'reused' — which path produced bodyRedacted. */
    redactedBy: { type: String, default: null },
    redactionVersion: { type: Number, default: null },
    /** Hash of the pre-redaction text, so unchanged input is never re-processed. */
    redactionSourceHash: { type: String, default: null },

    /**
     * Attachment METADATA only — bytes are streamed from Gmail on demand and never
     * stored here.
     *
     * KNOWN AND ACCEPTED EXCEPTION TO THE BOUNDARY: attachment *contents* identify the
     * sender in ways nothing here can redact — a PDF letterhead, EXIF owner data, a
     * DOCX dc:creator, a photographed business card. Staff can download them anyway,
     * which was decided knowingly. The filename is redacted; the file is not.
     */
    attachments: {
        type: [new mongoose.Schema({
            attachmentId: { type: String, default: null },
            filenameRedacted: { type: String, default: null },
            mimeType: { type: String, default: null },
            size: { type: Number, default: 0 },
        }, { _id: false })],
        default: [],
    },

    /** Which staff member sent it, for outbound. Never shown to the client. */
    sentByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    syncedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Rendering one thread, oldest first.
EmailMessageSchema.index({ gmailThreadId: 1, sentAt: 1 });

const EmailThread = mongoose.models.EmailThread
    || mongoose.model('EmailThread', EmailThreadSchema);
const EmailMessage = mongoose.models.EmailMessage
    || mongoose.model('EmailMessage', EmailMessageSchema);

module.exports = { EmailThread, EmailMessage };

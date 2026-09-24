/**
 * TaskRequestModel.js — a client asking for work, and the decision on it.
 *
 * Modelled on EsfInviteModel.js, which is this repo's only real pending→terminal
 * workflow: a status enum, actor-plus-timestamp pairs rather than a bare flag, and a
 * partial index that only constrains rows still in flight.
 *
 * ── THE RAW / REDACTED SPLIT IS THE POINT OF THIS FILE ──
 * Two copies of the client's words are kept, and they go to different places:
 *
 *   titleRaw / descriptionRaw   →  Zoho, where the work is actually done
 *   title / description         →  the staff Task Requests page
 *
 * That asymmetry is deliberate. `redactStructural` strips every URL, so a request saying
 * "update this listing: amazon.com/dp/B08…" would reach Zoho with the one thing that
 * makes it actionable removed. Zoho is the agency's own workspace and sits outside the
 * portal's staff/client boundary; the portal page sits inside it, so that is where the
 * redacted copy belongs.
 *
 * The raw pair is `select: false`, the same discipline EmailThreadModels applies to
 * rawSubject — it loads only when a query asks for it by name, so it cannot reach a
 * response by accident.
 *
 * ── NO ATTACHMENT BYTES ──
 * Only filename, type and size. The files live in Gmail, reached through
 * `gmailMessageId`. Zoho cannot accept them at all on this portal
 * (ZOHO_TASK_ATTACHMENTS_ENABLED, and the reason is a configuration one outside this
 * repo), so the request email is not a courtesy copy — it is the only place the
 * documents exist.
 */

const mongoose = require('mongoose');

const STATUSES = ['pending', 'accepted', 'rejected'];

/** How many requests one client may have awaiting a decision. */
const MAX_PENDING_REQUESTS = 10;

const TaskRequestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // The client's own words. Sent to Zoho; never served to the portal.
    titleRaw: { type: String, default: null, select: false },
    descriptionRaw: { type: String, default: null, select: false },

    // Redacted. What the staff page renders.
    title: { type: String, required: true },
    description: { type: String, default: '' },

    /**
     * The "NEEDED BY" date from the existing form.
     *
     * Carried through to the Zoho task's end date rather than kept as a note, because
     * ZohoTaskSync.classifyTask files a task with no dates under "In progress" — so a
     * date that failed to carry would put the task in the wrong column on the client's
     * own Status page.
     */
    neededBy: { type: Date, default: null },

    /**
     * Metadata only. The bytes are in Gmail — see the header.
     * `filenameRedacted` because "Nitesh Kumar brief.pdf" names the client in a label.
     */
    attachments: {
        type: [new mongoose.Schema({
            filenameRedacted: { type: String, default: null },
            mimeType: { type: String, default: null },
            size: { type: Number, default: 0 },
        }, { _id: false })],
        default: [],
    },

    /** The request email. Without it the attachments cannot be fetched at all. */
    gmailMessageId: { type: String, default: null },

    /**
     * Where this came from. 'portal' is the client filling in the form; 'ai' is this
     * system reading a request out of an email they wrote.
     *
     * Surfaced on the queue rather than kept internal, because an admin deciding whether
     * to create real work should know whether a human typed this or a model inferred it.
     */
    source: { type: String, enum: ['portal', 'ai'], default: 'portal' },
    aiConfidence: { type: Number, default: null },

    /**
     * The conversation it was read out of, so the admin can check the model got it right
     * rather than taking its word.
     */
    sourceThreadId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailThread', default: null },
    sourceMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailMessage', default: null, index: true },

    /** Which of the details needed for scheduling the message did not contain. */
    missingDetails: { type: [String], default: [] },

    /**
     * When we asked the client to fill those gaps.
     *
     * Its presence is the guard against asking twice. Without it a thread where the
     * client keeps replying without answering would be met with the same question every
     * time, which reads as a system that is not listening.
     */
    detailsRequestedAt: { type: Date, default: null },

    /**
     * A decision the AI read in the conversation but has NOT applied.
     *
     * Staged rather than acted on deliberately: accepting creates a real task in the live
     * Zoho portal on a client's account, and a model reading "I don't think we should do
     * this" as approval is a plausible failure with an expensive result. Confirming is a
     * human click, which is the whole point of the approval gate this would otherwise
     * bypass.
     */
    stagedDecision: {
        intent: { type: String, enum: ['accept', 'reject', null], default: null },
        reason: { type: String, default: null },
        confidence: { type: Number, default: null },
        detectedAt: { type: Date, default: null },
        sourceMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailMessage', default: null },
    },

    status: { type: String, enum: STATUSES, default: 'pending', index: true },

    requestedAt: { type: Date, default: Date.now },

    // Who decided, and when. A pair rather than a flag, so the queue can be audited
    // after the fact — the same shape EsfInvite uses for acceptance.
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },

    /** Shown to the client verbatim, so they learn something rather than just "no". */
    rejectionReason: { type: String, default: null },

    // Set on accept. zohoProjectId is stored alongside the task id because a client's
    // project link can be changed later, and the task belongs to the project it was
    // actually created in.
    zohoTaskId: { type: String, default: null },
    zohoProjectId: { type: String, default: null },
}, { timestamps: true });

// The client's own list, newest first.
TaskRequestSchema.index({ userId: 1, requestedAt: -1 });
// The staff queue: everything awaiting a decision, oldest first.
TaskRequestSchema.index({ status: 1, requestedAt: 1 });
/**
 * Threads are indexed but NOT unique, and that is a correction.
 *
 * This was a unique partial index — at most one pending request per conversation —
 * meant to stop a client's answer to our follow-up being read as a fresh request. It did
 * that, and it also made it impossible for a client to raise a genuinely SEPARATE ask in
 * an existing thread. They do that constantly, and the second request vanished with no
 * reply and no trace.
 *
 * Telling those two apart is a judgement, not a constraint, so it moved to
 * MessageIntentService.classifyFollowUp, with a per-client pending cap as the guard
 * against a runaway.
 *
 * NOTE: dropping this from the schema does not drop it from a database that already has
 * it — Mongoose never removes indexes. It has to be dropped by hand once.
 */
TaskRequestSchema.index({ sourceThreadId: 1 });

const TaskRequest = mongoose.models.TaskRequest
    || mongoose.model('TaskRequest', TaskRequestSchema);

module.exports = TaskRequest;
module.exports.STATUSES = STATUSES;
module.exports.MAX_PENDING_REQUESTS = MAX_PENDING_REQUESTS;

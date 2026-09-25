/**
 * EsfUntappedModel.js
 *
 * The client's "Untapped" page: opportunities the agency has spotted but nobody has
 * committed to yet, written in Zoho and rendered here.
 *
 * ── WHERE IT COMES FROM ──
 * A tasklist called "Untapped" in the client's Zoho project holds two tasks, "Within
 * Amazon" and "Off Amazon". Each of their SUBTASKS is one opportunity, with the money
 * and the explanation typed into its description. Services/AI/UntappedParserService.js
 * pulls those two things out; the nightly sync writes the result here.
 *
 * Note that no extra Zoho call fetches those subtasks. They arrive in the ordinary task
 * list the sync already reads, tagged with `depth` and `parental_info.parent_task_id` —
 * which matters, because the obvious routes are both closed: the tasklists endpoint
 * needs a scope this connection does not have (and adding one forces a reconnect), and
 * the v3 subtasks endpoint answers URL_RULE_NOT_CONFIGURED.
 *
 * ONE DOCUMENT PER PROJECT, opportunities inline — following EsfSuggestedWorkModel
 * rather than ZohoProjectTaskModel's one-doc-per-task rule, and safe for the same
 * reason: a page shows a handful of cards, the array is REPLACED on every sync rather
 * than appended to, and it is capped below. It cannot grow over time.
 *
 * Nothing here is a source of truth. Zoho is. Deleting this collection costs one sync.
 */

const mongoose = require('mongoose');

/**
 * A ceiling, not an expectation. The page is a short list a human reads in one go; a
 * project with hundreds of subtasks under "Untapped" is a mistake in Zoho, and this
 * stops that mistake becoming an unbounded document.
 */
const MAX_OPPORTUNITIES = 40;

const OpportunitySchema = new mongoose.Schema({
    /** The Zoho subtask. Lets an admin find the original from what the client saw. */
    taskId: { type: String, required: true },
    /** The "Within Amazon" / "Off Amazon" task this sat under. */
    parentTaskId: { type: String, default: null },

    /**
     * Which of the page's two sections this belongs in, decided from the PARENT's name
     * rather than the subtask's — the parent is the section. Stored resolved so the page
     * never re-does the matching, and so a rename in Zoho shows up as a sync-time
     * warning instead of a silently empty section.
     */
    section: { type: String, enum: ['within', 'off'], required: true },

    /** The subtask name. Already plain text — toPlainLabel ran at normalise time. */
    title: { type: String, default: null },
    /** The explanation, verbatim from the agency. Plain text, never HTML. */
    body: { type: String, default: '' },

    /**
     * Null is a real, renderable state: the author wrote a description with no figure
     * in it, or in a shape the parser did not recognise. The card shows the words and
     * no number. Dropping it instead would hide work the agency had written down.
     */
    amount: { type: Number, default: null },
    // 'month' | 'year' | 'week' | 'once'
    period: { type: String, default: null },
    /** The agency's own wording, e.g. "estimated upside". Not ours to standardise. */
    amountLabel: { type: String, default: null },

    /** Zoho's own order within the parent, so the page can match the portal. */
    rank: { type: Number, default: null },

    /**
     * How the figure was read: 'pattern' deterministically, 'ai' by the fallback, 'none'
     * when neither worked. Surfaced so a page full of 'none' is diagnosable as a format
     * drift in Zoho rather than looking like the agency wrote nothing.
     */
    parsedBy: { type: String, enum: ['pattern', 'ai', 'none'], default: 'none' },
}, { _id: false });

const EsfUntappedSchema = new mongoose.Schema({
    projectId: { type: String, required: true, unique: true },

    /**
     * The client this project is linked to. Present so the row is reachable by user —
     * which is also what puts it in scope of the full-account purge, as it must be:
     * these bodies describe a client's business in detail.
     */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    projectName: { type: String, default: null },

    // Amounts travel with their code — rendering a GBP figure with a dollar sign would
    // misstate what is at stake. Same rule as EsfSuggestedWork.
    currencyCode: { type: String, default: 'USD' },

    opportunities: { type: [OpportunitySchema], default: [] },

    /** Bumped when the parser changes, so a stale shape is recognisable. */
    parserVersion: { type: Number, default: null },
    syncedAt: { type: Date, default: Date.now },
}, { timestamps: true });

const EsfUntapped = mongoose.models.EsfUntapped
    || mongoose.model('EsfUntapped', EsfUntappedSchema);

module.exports = EsfUntapped;
module.exports.MAX_OPPORTUNITIES = MAX_OPPORTUNITIES;

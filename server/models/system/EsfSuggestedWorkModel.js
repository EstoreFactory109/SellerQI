/**
 * EsfSuggestedWorkModel.js
 *
 * The Dashboard's "Top things to fix", matched against what the ESF team already has
 * open in Zoho, so the client's Status page can put the genuinely unaddressed ones in
 * "Coming up" without repeating work that is already underway.
 *
 * Written by the nightly Zoho sync (Services/Zoho/ZohoTaskSync.js), never on page load
 * — the match needs an LLM call and this page must stay a plain database read.
 *
 * ONE DOCUMENT PER PROJECT, with the suggestions inline. That is the opposite of
 * ZohoProjectTaskModel's one-doc-per-task rule, and safe for the same reason that rule
 * exists: this array is bounded by TopOpportunities (5-6 items, hard-capped at 12) and
 * is REPLACED on every sync rather than appended to, so it cannot grow over time.
 *
 * Nothing here is a source of truth. It is derived from TopOpportunities plus the Zoho
 * task rows, so deleting the collection costs one sync.
 */

const mongoose = require('mongoose');

const SuggestionSchema = new mongoose.Schema({
    // Ties back to the TopOpportunities candidate this came from.
    candidateId: { type: String, required: true },
    rank: { type: Number, default: null },

    title: { type: String, default: null },
    action: { type: String, default: null },
    category: { type: String, default: null },
    issueType: { type: String, default: null },
    amount: { type: Number, default: 0 },
    count: { type: Number, default: 0 },

    /**
     * True when the team already has a Zoho task covering this.
     *
     * Kept rather than filtered out at write time: it is the whole point of the match,
     * and storing the rejected ones is what makes a bad match debuggable ("why did my
     * biggest issue vanish from Coming up?") without re-running the LLM.
     */
    covered: { type: Boolean, default: false },
    coveredByTaskId: { type: String, default: null },
    coveredByTaskName: { type: String, default: null },
    // 'ai' | 'tokens' (deterministic fallback) | 'none'
    matchedBy: { type: String, default: 'none' },
}, { _id: false });

const EsfSuggestedWorkSchema = new mongoose.Schema({
    projectId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Which marketplace the opportunities were read from — the Status page has no
    // country dimension, so this records what was actually used.
    country: { type: String, default: null },
    region: { type: String, default: null },
    // Amounts are in the marketplace's own currency, so the code travels with them —
    // rendering a EUR figure with a dollar sign would misstate what is at stake.
    currencyCode: { type: String, default: 'USD' },

    suggestions: { type: [SuggestionSchema], default: [] },

    // Opportunity ids + task names, so an unchanged pairing skips a paid re-match.
    sourceHash: { type: String, default: null },
    promptVersion: { type: Number, default: null },
    // 'ai' | 'fallback' | 'reused'
    generatedBy: { type: String, default: null },
    generatedAt: { type: Date, default: null },
}, { timestamps: true });

const EsfSuggestedWork = mongoose.models.EsfSuggestedWork
    || mongoose.model('EsfSuggestedWork', EsfSuggestedWorkSchema);

module.exports = EsfSuggestedWork;

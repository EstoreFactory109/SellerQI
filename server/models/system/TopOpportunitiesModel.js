/**
 * TopOpportunities Model
 *
 * Stores the AI-selected top 5-6 money-recovery actions for an account, so the
 * frontend never has to wait on (or pay for) an LLM call during a request.
 *
 * Written once per account per week by the scheduled pipeline
 * (see TopOpportunitiesService.calculateAndStoreTopOpportunities).
 */

const mongoose = require('mongoose');

const opportunitySchema = new mongoose.Schema({
    // Ties back to a candidate id from OpportunityRankingService.GROUP_DEFINITIONS
    candidateId: { type: String, required: true },
    rank: { type: Number, required: true },

    category: { type: String, default: '' },
    issueType: { type: String, default: '' },
    title: { type: String, default: '' },

    // Dollars carried over from the candidate — never recomputed by the LLM
    amount: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
    confidence: { type: String, enum: ['measured', 'estimated'], default: 'measured' },
    isGrowthOpportunity: { type: Boolean, default: false },

    // LLM-authored fields
    why: { type: String, default: '' },
    action: { type: String, default: '' },
    doFirstBecause: { type: String, default: '' },
    overlapsWith: { type: [String], default: [] }
}, { _id: false });

const topOpportunitiesSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    country: { type: String, required: true, index: true },
    region: {
        type: String,
        required: true,
        enum: ['NA', 'EU', 'FE'],
        index: true
    },

    // ISO 4217 code for every `amount` on this document. Amazon reports money in
    // the marketplace's own currency, so these figures are marketplace-local —
    // storing the code means consumers don't have to re-derive it from `country`.
    currencyCode: { type: String, default: 'USD' },

    opportunities: { type: [opportunitySchema], default: [] },

    // How many grouped candidates the AI chose from (not the raw issue count)
    candidatesConsidered: { type: Number, default: 0 },
    // Raw issue records the candidates were distilled from — for the "we looked
    // at N issues and picked 6" message, and to evidence the token saving
    issuesConsidered: { type: Number, default: 0 },

    // Naive sum of the SELECTED amounts only — a subset by definition. Do not use
    // this for a headline like "Est. recoverable"; use accountRecoverableAmount.
    totalEstimatedRecovery: { type: Number, default: 0 },

    // The account's whole POTENTIAL PROFIT IMPACT, de-duplicated per ASIN and shared
    // with TopProducts so the Dashboard, Tasks page and product views cannot show a
    // seller different totals. Not a sum of the groups above: a product's profit gap
    // already contains its wasted ad spend, and that overlap crosses issue types.
    potentialProfitImpact: { type: Number, default: 0 },

    // Capital locked in unsellable stock — a different quantity, never added to profit.
    capitalTiedUp: { type: Number, default: 0 },

    generatedAt: { type: Date, default: Date.now },
    source: {
        type: String,
        enum: ['schedule', 'integration', 'manual', 'api_fallback'],
        default: 'schedule'
    },

    // Observability: which model ran, what it cost, and whether the AI step was
    // skipped in favour of the deterministic fallback.
    model: { type: String, default: '' },
    tokensUsed: {
        promptTokens: { type: Number, default: 0 },
        completionTokens: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 }
    },
    usedFallback: { type: Boolean, default: false },
    fallbackReason: { type: String, default: '' }
}, { timestamps: true });

topOpportunitiesSchema.index({ userId: 1, country: 1, region: 1 }, { unique: true });

/**
 * Upsert the stored opportunities for an account.
 */
topOpportunitiesSchema.statics.upsertForAccount = async function (userId, country, region, payload = {}) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    return this.findOneAndUpdate(
        { userId: userObjectId, country, region },
        {
            $set: {
                currencyCode: payload.currencyCode || 'USD',
                opportunities: payload.opportunities || [],
                candidatesConsidered: payload.candidatesConsidered || 0,
                issuesConsidered: payload.issuesConsidered || 0,
                totalEstimatedRecovery: payload.totalEstimatedRecovery || 0,
                potentialProfitImpact: payload.potentialProfitImpact || 0,
                capitalTiedUp: payload.capitalTiedUp || 0,
                generatedAt: new Date(),
                source: payload.source || 'schedule',
                model: payload.model || '',
                tokensUsed: payload.tokensUsed || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                usedFallback: !!payload.usedFallback,
                fallbackReason: payload.fallbackReason || ''
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

topOpportunitiesSchema.statics.getForAccount = async function (userId, country, region) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    return this.findOne({ userId: userObjectId, country, region }).lean();
};

module.exports = mongoose.model('TopOpportunities', topOpportunitiesSchema);

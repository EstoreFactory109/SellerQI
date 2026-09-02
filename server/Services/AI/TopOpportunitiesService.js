/**
 * TopOpportunitiesService
 *
 * Picks the top 5-6 money-recovery actions for an account using the OpenAI API.
 *
 * The token problem, and how this avoids it:
 * A real account can have 7,000+ tasks. Sending them all would be ~500k tokens
 * per call. Instead, TaskOpportunityGroupsService first collapses them into ~12
 * ranked "opportunity groups" (~1.2k tokens), and only that shortlist goes to
 * the model. The model never searches for the expensive issues — our own code
 * already computed the dollars (see RecoverableAmountUtils.js). The model only
 * does the part it's genuinely good at: choosing which few to do first, in what
 * order, and explaining why.
 *
 * Candidates are grouped TASKS, deliberately: the Tasks page renders the very
 * same tasks individually, so a group's total is exactly the sum of the rows a
 * seller sees there, and the two pages can never rank or count things
 * differently. See TaskOpportunityGroupsService for why that matters.
 *
 * This mirrors the established pattern in this codebase — deterministic compute,
 * LLM narrates (see AdvisoryEngine.js and the five engine narrators).
 *
 * If OpenAI is unavailable or returns something unusable, we fall back to the
 * deterministic top-6 by dollars. This feature never hard-fails on the LLM.
 */

const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');
const TopOpportunities = require('../../models/system/TopOpportunitiesModel.js');
const TaskOpportunityGroupsService = require('../Calculations/TaskOpportunityGroupsService.js');
const { getCurrencyCode, formatMoneyForProse } = require('../../utils/marketplaceCurrency.js');

// Matches the five existing narrators (gpt-4o-mini). The prompt is tiny and runs
// weekly, so upgrading is a one-line env change if better judgment is wanted.
const TOP_OPPORTUNITIES_MODEL = process.env.TOP_OPPORTUNITIES_MODEL || 'gpt-4o-mini';

const MIN_SELECTIONS = 5;
const MAX_SELECTIONS = 6;
const MAX_OUTPUT_TOKENS = 1200;

// Cost backstop. The integration flow can legitimately run several times for one
// account (retries that succeed, the monolithic AND phased flows, multi-marketplace
// re-syncs), and each run would otherwise mean another paid OpenAI call. Neither
// intended path is affected: first fetch has no prior record, and the Sunday job is
// weekly. 'manual' bypasses it so on-demand regeneration still works.
const MIN_REGENERATE_INTERVAL_HOURS = Number(process.env.TOP_OPPORTUNITIES_MIN_INTERVAL_HOURS) || 6;
const THROTTLE_EXEMPT_SOURCES = ['manual'];

let openaiClient = null;

function getOpenAIClient() {
    if (openaiClient) return openaiClient;

    const apiKey = process.env.OPENAPI_KEY;
    if (!apiKey) {
        // Not thrown — callers degrade to the deterministic fallback instead.
        logger.warn('[TopOpportunities] OPENAPI_KEY is not set; will use deterministic fallback');
        return null;
    }

    try {
        openaiClient = new OpenAI({ apiKey });
        return openaiClient;
    } catch (err) {
        logger.error('[TopOpportunities] Failed to initialize OpenAI client', { message: err.message });
        return null;
    }
}

const SYSTEM_PROMPT = `You are an Amazon seller profit advisor. You are given a PRE-RANKED list of money-recovery opportunities for one seller account. Every opportunity already has an exact dollar figure computed from the seller's real Amazon data.

Your job: choose the ${MIN_SELECTIONS}-${MAX_SELECTIONS} opportunities the seller should act on first, and order them.

STRICT RULES:
1. Choose ONLY from the candidateId values provided. Never invent an opportunity.
2. Never invent, recalculate, or restate the money figures differently. The amounts given are final.
2a. CURRENCY: the amounts are in the currency given as "currencyCode" in the input — they are NOT necessarily US dollars. Do NOT write any currency symbol ($, £, €, ¥) or currency code in your text. Describe impact in words ("recovers the most", "a significant amount") and let the app render the figure. If you must reference a number, write it bare with no symbol.
3. Dollars matter most, but not blindly:
   - Prefer confidence "measured" over "estimated" when amounts are close.
   - Any item whose recoverableAmount is 0 (including anything flagged isGrowthOpportunity) may be included only if it is genuinely valuable, and NEVER above an item with a real recoverable amount. Some zero-value items are still urgent — an account-health problem can stop all sales — so rank those first among the zero-value ones, using impactSeverity as your guide.
4. Think about ORDER and OVERLAP. If one fix should happen before another (e.g. stop wasting ad spend on a product that already loses money per unit), say so in doFirstBecause. If two candidates affect the same products, list the other's candidateId in overlapsWith.
5. "why" must be one or two plain-language sentences a non-technical seller understands. No jargon, no hedging.
6. "action" must be a concrete next step the seller can actually do.

Return ONLY valid JSON in this exact shape:
{"selections":[{"candidateId":"...","rank":1,"why":"...","action":"...","doFirstBecause":"","overlapsWith":[]}]}`;

/**
 * Compact the candidates for the prompt — drop anything the model doesn't need
 * so the payload stays small.
 */
function buildPromptPayload(candidates) {
    return candidates.map(c => ({
        candidateId: c.id,
        category: c.category,
        problem: c.title,
        affectedItems: c.count,
        recoverableAmount: c.totalAmount,
        confidence: c.confidence,
        isGrowthOpportunity: c.isGrowthOpportunity,
        // 0-100. Lets the model order the zero-value items sensibly (an account
        // suspension outranks a title tweak) without ever placing them above money.
        impactSeverity: c.impactWeight,
        examples: (c.topExamples || []).map(e => e.label).slice(0, 3)
    }));
}

/**
 * Merge an LLM selection back onto its candidate, so dollars/counts always come
 * from our own computation and only the prose comes from the model.
 */
function mergeSelectionWithCandidate(selection, candidate, rank) {
    return {
        candidateId: candidate.id,
        rank,
        category: candidate.category,
        issueType: candidate.issueType,
        title: candidate.title,
        amount: candidate.totalAmount,
        count: candidate.count,
        confidence: candidate.confidence,
        isGrowthOpportunity: candidate.isGrowthOpportunity,
        why: String(selection?.why || '').trim(),
        action: String(selection?.action || candidate.action || '').trim(),
        doFirstBecause: String(selection?.doFirstBecause || '').trim(),
        overlapsWith: Array.isArray(selection?.overlapsWith)
            ? selection.overlapsWith.filter(id => typeof id === 'string')
            : []
    };
}

/**
 * Deterministic fallback: top N candidates by recoverable amount, using the
 * template copy already defined on each group. Used when the AI step is
 * unavailable or its output can't be trusted.
 *
 * @param {Array} candidates
 * @param {number} [limit]
 * @param {string} [country] - marketplace, so money in the prose uses the right
 *   currency (Amazon reports in marketplace-local currency, not always USD)
 */
function buildDeterministicSelections(candidates, limit = MAX_SELECTIONS, country = null) {
    return candidates.slice(0, limit).map((candidate, idx) => mergeSelectionWithCandidate(
        {
            why: candidate.totalAmount > 0
                ? `${candidate.count} item(s) affected, with about ${formatMoneyForProse(candidate.totalAmount, country)} recoverable.`
                : `${candidate.count} item(s) affected. No direct monetary loss, but worth addressing.`,
            action: candidate.action
        },
        candidate,
        idx + 1
    ));
}

/**
 * Validate the model's picks against the candidates we actually sent.
 * Drops hallucinated ids and duplicates, then tops the list back up from the
 * deterministic ranking if the model returned too few.
 */
function validateSelections(rawSelections, candidates, country = null) {
    const byId = new Map(candidates.map(c => [c.id, c]));
    const seen = new Set();
    const valid = [];

    const ordered = Array.isArray(rawSelections)
        ? [...rawSelections].sort((a, b) => (Number(a?.rank) || 99) - (Number(b?.rank) || 99))
        : [];

    for (const selection of ordered) {
        const candidate = byId.get(selection?.candidateId);
        if (!candidate) {
            logger.warn('[TopOpportunities] Model returned an unknown candidateId; dropping', {
                candidateId: selection?.candidateId
            });
            continue;
        }
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        valid.push(mergeSelectionWithCandidate(selection, candidate, valid.length + 1));
        if (valid.length >= MAX_SELECTIONS) break;
    }

    // Top up from the deterministic ranking if the model under-delivered.
    if (valid.length < MIN_SELECTIONS) {
        for (const candidate of candidates) {
            if (valid.length >= MIN_SELECTIONS) break;
            if (seen.has(candidate.id)) continue;
            seen.add(candidate.id);
            const [filler] = buildDeterministicSelections([candidate], 1, country);
            valid.push({ ...filler, rank: valid.length + 1 });
        }
    }

    // Structurally enforce money-before-no-money. The prompt asks for this, but a
    // prompt is not a guarantee: a seller must never see a $0 item ranked above
    // real recoverable cash. Within each side the model's judgement is preserved.
    const withMoney = valid.filter(s => (s.amount || 0) > 0);
    const withoutMoney = valid.filter(s => (s.amount || 0) <= 0);
    if (withMoney.length && withoutMoney.length) {
        const firstZeroBeforeMoney = valid.findIndex(s => (s.amount || 0) <= 0)
            < valid.findLastIndex(s => (s.amount || 0) > 0);
        if (firstZeroBeforeMoney) {
            logger.warn('[TopOpportunities] Model ranked a zero-value item above real money; reordering', {
                order: valid.map(s => `${s.candidateId}:${s.amount}`)
            });
        }
    }

    return [...withMoney, ...withoutMoney].map((s, idx) => ({ ...s, rank: idx + 1 }));
}

/**
 * Ask the model to pick the top opportunities from the shortlist.
 * @returns {Promise<{selections: Array, model: string, tokensUsed: Object}|null>} null on any failure
 */
async function selectWithAI(candidates, accountContext = {}, country = null) {
    const client = getOpenAIClient();
    if (!client) return null;

    const payload = {
        // Tells the model the amounts aren't necessarily USD. It's instructed not
        // to emit any symbol/code itself — the app formats the numeric amount.
        currencyCode: getCurrencyCode(country),
        account: {
            totalSales: accountContext.totalSales ?? null,
            netProfit: accountContext.netProfit ?? null,
            adSpend: accountContext.adSpend ?? null
        },
        opportunities: buildPromptPayload(candidates)
    };

    try {
        const completion = await client.chat.completions.create({
            model: TOP_OPPORTUNITIES_MODEL,
            temperature: 0.1,
            max_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: JSON.stringify(payload) }
            ]
        });

        const content = completion?.choices?.[0]?.message?.content;
        if (!content || !content.trim()) {
            logger.warn('[TopOpportunities] Model returned empty content');
            return null;
        }

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (parseError) {
            logger.warn('[TopOpportunities] Model returned unparseable JSON', { message: parseError.message });
            return null;
        }

        const usage = completion?.usage || {};
        return {
            selections: parsed?.selections,
            model: TOP_OPPORTUNITIES_MODEL,
            tokensUsed: {
                promptTokens: usage.prompt_tokens || 0,
                completionTokens: usage.completion_tokens || 0,
                totalTokens: usage.total_tokens || 0
            }
        };

    } catch (error) {
        logger.error('[TopOpportunities] OpenAI call failed', {
            model: TOP_OPPORTUNITIES_MODEL,
            message: error.message
        });
        return null;
    }
}

/**
 * Build the top opportunities for an account and store them.
 *
 * Signature matches the scheduler's calculation-service contract:
 * serviceFunction(userId, Country, Region, source) — see
 * ScheduledIntegration.js's isCalculationService branch.
 *
 * @param {string} userId
 * @param {string} country
 * @param {string} region
 * @param {string} source - 'schedule' | 'integration' | 'manual' | 'api_fallback'
 */
async function calculateAndStoreTopOpportunities(userId, country, region, source = 'schedule', options = {}) {
    const startTime = Date.now();

    try {
        // Cost backstop — bail out before any ranking work or OpenAI call if we
        // already generated recently. See MIN_REGENERATE_INTERVAL_HOURS.
        // `options.minIntervalHours` lets a caller widen or waive the window: the
        // scheduler passes 0 when tasks were just rebuilt (the throttle's premise
        // — that nothing changed — is false exactly then) and a multi-day value
        // for its stale-view safety net.
        const minIntervalHours = Number.isFinite(options.minIntervalHours)
            ? options.minIntervalHours
            : MIN_REGENERATE_INTERVAL_HOURS;
        if (!THROTTLE_EXEMPT_SOURCES.includes(source) && minIntervalHours > 0) {
            const existing = await TopOpportunities.getForAccount(userId, country, region);
            if (existing?.generatedAt) {
                const ageHours = (Date.now() - new Date(existing.generatedAt).getTime()) / 3600000;
                if (ageHours < minIntervalHours) {
                    logger.info('[TopOpportunities] Skipping regeneration — generated recently', {
                        userId,
                        country,
                        region,
                        source,
                        ageHours: Math.round(ageHours * 10) / 10,
                        minIntervalHours
                    });
                    return {
                        success: true,
                        data: existing,
                        skippedByThrottle: true,
                        duration: Date.now() - startTime
                    };
                }
            }
        }

        // Candidates come from the seller's TASKS, grouped by issue type — the same
        // single source of truth the Tasks page renders individually. That is what
        // makes a group's total exactly the sum of the task rows beneath it, and
        // stops either surface from being blind to a category the other highlights.
        const ranked = await TaskOpportunityGroupsService.getTaskOpportunityGroups(userId, country, region);

        if (!ranked.success) {
            return { success: false, error: ranked.error };
        }

        const candidates = ranked.groups;
        const issuesConsidered = ranked.tasksConsidered;

        // The headline figures come from the per-ASIN rollup, never from summing the
        // groups — see the comment on potentialProfitImpact below. Non-fatal: without
        // them the record simply stores zeros rather than a wrong number.
        let accountFigures = { potentialProfitImpact: 0, capitalTiedUp: 0 };
        try {
            const rollup = await TaskOpportunityGroupsService.getTopProductsToFix(userId, country, region);
            if (rollup.success) {
                accountFigures = {
                    potentialProfitImpact: rollup.potentialProfitImpact || 0,
                    capitalTiedUp: rollup.capitalTiedUp || 0
                };
            }
        } catch (err) {
            logger.warn('[TopOpportunities] could not compute account profit figures', { message: err.message });
        }

        // Every `amount` below is in the marketplace's own currency, not always USD.
        const currencyCode = getCurrencyCode(country);

        if (!candidates.length) {
            logger.info('[TopOpportunities] No opportunities found for account', { userId, country, region });
            const saved = await TopOpportunities.upsertForAccount(userId, country, region, {
                currencyCode,
                opportunities: [],
                candidatesConsidered: 0,
                issuesConsidered,
                totalEstimatedRecovery: 0,
                source
            });
            return { success: true, data: saved, duration: Date.now() - startTime };
        }

        const aiResult = await selectWithAI(candidates, {}, country);

        let selections;
        let usedFallback = false;
        let fallbackReason = '';
        let model = '';
        let tokensUsed = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        if (aiResult) {
            selections = validateSelections(aiResult.selections, candidates, country);
            model = aiResult.model;
            tokensUsed = aiResult.tokensUsed;

            if (!selections.length) {
                usedFallback = true;
                fallbackReason = 'AI response contained no valid candidate selections';
            }
        } else {
            usedFallback = true;
            fallbackReason = 'AI unavailable or call failed';
        }

        if (usedFallback) {
            selections = buildDeterministicSelections(candidates, MAX_SELECTIONS, country);
            logger.warn('[TopOpportunities] Using deterministic fallback', {
                userId, country, region, reason: fallbackReason
            });
        }

        // Sum only what was actually selected. Can double-count across groups and
        // mixes measured with estimated — surfaced as an estimate, not a promise.
        const totalEstimatedRecovery = Math.round(
            selections.reduce((sum, s) => sum + (s.amount || 0), 0) * 100
        ) / 100;

        const saved = await TopOpportunities.upsertForAccount(userId, country, region, {
            currencyCode,
            opportunities: selections,
            candidatesConsidered: candidates.length,
            issuesConsidered,
            totalEstimatedRecovery,
            // Account-wide and de-duplicated PER ASIN. Deliberately not the sum of the
            // groups above: a product's profit gap already contains its wasted ad
            // spend, and that overlap crosses issue types, so only a per-ASIN pass can
            // remove it. Computed by the same rollup the product views use.
            potentialProfitImpact: accountFigures.potentialProfitImpact,
            capitalTiedUp: accountFigures.capitalTiedUp,
            source,
            model,
            tokensUsed,
            usedFallback,
            fallbackReason
        });

        const duration = Date.now() - startTime;

        logger.info('[TopOpportunities] Stored top opportunities', {
            userId,
            country,
            region,
            source,
            issuesConsidered,
            candidatesConsidered: candidates.length,
            selected: selections.length,
            totalEstimatedRecovery,
            model: model || 'none',
            totalTokens: tokensUsed.totalTokens,
            usedFallback,
            duration
        });

        return { success: true, data: saved, duration };

    } catch (error) {
        logger.error('[TopOpportunities] Error building top opportunities', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        return { success: false, error: error.message };
    }
}

/**
 * Read the stored opportunities for an account (no LLM call).
 */
async function getTopOpportunities(userId, country, region) {
    return TopOpportunities.getForAccount(userId, country, region);
}

module.exports = {
    calculateAndStoreTopOpportunities,
    getTopOpportunities,
    // exported for tests
    selectWithAI,
    validateSelections,
    buildDeterministicSelections,
    buildPromptPayload,
    TOP_OPPORTUNITIES_MODEL,
    MIN_SELECTIONS,
    MAX_SELECTIONS,
    MIN_REGENERATE_INTERVAL_HOURS,
    THROTTLE_EXEMPT_SOURCES
};

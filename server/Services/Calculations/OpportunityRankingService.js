/**
 * OpportunityRankingService
 *
 * Turns thousands of individual issue records into a SMALL set of "opportunity
 * groups" ranked by recoverable dollars — with no LLM involved.
 *
 * Why grouping matters: a real account can carry 7,000+ issues, but 1,210
 * wasted-keyword rows are not 1,210 things a seller does — they're ONE action
 * ("pause your non-converting keywords, recover $X"). Collapsing issues by
 * (category + issueType) turns thousands of rows into ~12 candidates, which is
 * both what a seller can actually act on and small enough to hand to an LLM.
 *
 * This module is deliberately LLM-free and network-free so it stays cheap,
 * deterministic and unit-testable. TopOpportunitiesService.js layers the AI
 * selection step on top of the candidates produced here.
 *
 * It also owns the six different nesting depths that `amount` currently lives
 * at, so no other module has to duplicate those access paths.
 */

const logger = require('../../utils/Logger.js');
const IssuesPaginationService = require('./IssuesPaginationService.js');

// Keep the candidate payload small — this is what bounds LLM token cost.
const MAX_EXAMPLES_PER_GROUP = 5;
const MAX_CANDIDATES = 12;

/**
 * Amounts we measured from real Amazon figures vs. amounts we inferred.
 * Used so downstream ranking/AI can prefer hard dollars when amounts are close.
 */
const CONFIDENCE = {
    MEASURED: 'measured',
    ESTIMATED: 'estimated'
};

/**
 * Group definitions. Each one knows which stored array it reads, how to pull
 * the dollar figure out of a record, and how to label an example.
 *
 * `sourceField` values match IssuesDataChunks ARRAY_FIELD_NAMES.
 */
const GROUP_DEFINITIONS = [
    // ── Profitability (amount is top-level) ──
    {
        id: 'profitability_negative_profit',
        category: 'profitability',
        issueType: 'negative_profit',
        sourceField: 'profitabilityErrorDetails',
        confidence: CONFIDENCE.MEASURED,
        title: 'Products losing money on every sale',
        action: 'Reprice, cut ad spend, or stop selling these ASINs',
        matches: (r) => r?.errorType === 'negative_profit',
        getAmount: (r) => r?.amount,
        getLabel: (r) => r?.productName || r?.asin
    },
    {
        id: 'profitability_low_margin',
        category: 'profitability',
        issueType: 'low_margin',
        sourceField: 'profitabilityErrorDetails',
        confidence: CONFIDENCE.MEASURED,
        title: 'Products earning below a healthy 10% margin',
        action: 'Review pricing and fees to lift these toward a 10% margin',
        matches: (r) => r?.errorType === 'low_margin',
        getAmount: (r) => r?.amount,
        getLabel: (r) => r?.productName || r?.asin
    },

    // ── Sponsored Ads (amount is top-level) ──
    {
        id: 'ads_wasted_spend_keyword',
        category: 'sponsoredAds',
        issueType: 'wasted_spend_keyword',
        sourceField: 'sponsoredAdsErrorDetails',
        confidence: CONFIDENCE.MEASURED,
        title: 'Keywords spending money with zero sales',
        action: 'Pause these keywords — the spend is pure waste',
        matches: (r) => r?.errorType === 'wasted_spend_keyword',
        getAmount: (r) => r?.amount,
        getLabel: (r) => r?.keyword
    },
    {
        id: 'ads_search_term_zero_sales',
        category: 'sponsoredAds',
        issueType: 'search_term_zero_sales',
        sourceField: 'sponsoredAdsErrorDetails',
        confidence: CONFIDENCE.MEASURED,
        title: 'Search terms getting clicks but no sales',
        action: 'Add these as negative keywords to stop the bleed',
        matches: (r) => r?.errorType === 'search_term_zero_sales',
        getAmount: (r) => r?.amount,
        getLabel: (r) => r?.searchTerm
    },
    {
        id: 'ads_high_acos_campaign',
        category: 'sponsoredAds',
        issueType: 'high_acos_campaign',
        sourceField: 'sponsoredAdsErrorDetails',
        confidence: CONFIDENCE.MEASURED,
        title: 'Campaigns spending too much per sale (ACOS above 40%)',
        action: 'Lower bids or tighten targeting on these campaigns',
        matches: (r) => r?.errorType === 'high_acos_campaign',
        getAmount: (r) => r?.amount,
        getLabel: (r) => r?.campaignName
    },
    {
        // Carries $0 by design (sales are already >$30) — a growth opportunity,
        // not a loss. Surfaced so the AI can mention it, never ranked on money.
        id: 'ads_auto_campaign_migration',
        category: 'sponsoredAds',
        issueType: 'auto_campaign_migration_needed',
        sourceField: 'sponsoredAdsErrorDetails',
        confidence: CONFIDENCE.MEASURED,
        isGrowthOpportunity: true,
        title: 'Winning auto-campaign search terms not yet in a manual campaign',
        action: 'Move these proven search terms into manual campaigns to scale them',
        matches: (r) => r?.errorType === 'auto_campaign_migration_needed',
        getAmount: (r) => r?.amount,
        getLabel: (r) => r?.searchTerm
    },

    // ── Inventory (amount is NESTED) ──
    {
        id: 'inventory_unfulfillable',
        category: 'inventory',
        issueType: 'unfulfillable',
        sourceField: 'inventoryProductWiseErrors',
        confidence: CONFIDENCE.MEASURED,
        title: 'Unsellable stock sitting in FBA',
        action: 'File removals or dispose — this is dead capital',
        matches: (r) => r?.inventoryPlanningErrorData?.unfulfillable?.status === 'Error',
        getAmount: (r) => r?.inventoryPlanningErrorData?.unfulfillable?.amount,
        getLabel: (r) => r?.Title || r?.asin
    },
    {
        id: 'inventory_long_term_storage_fees',
        category: 'inventory',
        issueType: 'longTermStorageFees',
        sourceField: 'inventoryProductWiseErrors',
        confidence: CONFIDENCE.MEASURED,
        title: 'Long-term storage fees accruing on aged stock',
        action: 'Liquidate or remove aged inventory — this fee recurs monthly',
        matches: (r) => r?.inventoryPlanningErrorData?.longTermStorageFees?.status === 'Error',
        getAmount: (r) => r?.inventoryPlanningErrorData?.longTermStorageFees?.amount,
        getLabel: (r) => r?.Title || r?.asin
    },
    {
        id: 'inventory_stranded',
        category: 'inventory',
        issueType: 'stranded',
        sourceField: 'inventoryProductWiseErrors',
        confidence: CONFIDENCE.ESTIMATED,
        title: 'Stranded stock in FBA that cannot be sold',
        action: 'Fix the listing problem to make this inventory sellable again',
        matches: (r) => !!r?.strandedInventoryErrorData,
        getAmount: (r) => r?.strandedInventoryErrorData?.amount,
        getLabel: (r) => r?.Title || r?.asin
    },

    // ── Conversion / Buy Box (amount is NESTED) ──
    {
        id: 'conversion_buybox_loss',
        category: 'conversion',
        issueType: 'buybox_loss',
        sourceField: 'conversionProductWiseErrors',
        confidence: CONFIDENCE.ESTIMATED,
        title: 'Products not winning the Buy Box',
        action: 'Fix price/stock/seller-health so these win the Buy Box back',
        matches: (r) => !!r?.productsWithOutBuyboxErrorData,
        getAmount: (r) => r?.productsWithOutBuyboxErrorData?.amount,
        getLabel: (r) => r?.Title || r?.asin
    }
];

const REQUIRED_FIELDS = [...new Set(GROUP_DEFINITIONS.map(g => g.sourceField))];

/**
 * Round to cents so candidate payloads stay compact and comparable.
 */
const toCents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Build one candidate from a group definition and its source array.
 * @returns {Object|null} null when the group has no matching records
 */
function buildCandidate(definition, records) {
    if (!Array.isArray(records) || records.length === 0) return null;

    const matched = [];
    let totalAmount = 0;

    for (const record of records) {
        if (!definition.matches(record)) continue;
        const amount = Number(definition.getAmount(record)) || 0;
        totalAmount += amount;
        matched.push({
            label: definition.getLabel(record) || 'Unknown',
            amount: toCents(amount)
        });
    }

    if (matched.length === 0) return null;

    // Biggest-dollar examples first, capped so the payload stays small.
    matched.sort((a, b) => b.amount - a.amount);

    return {
        id: definition.id,
        category: definition.category,
        issueType: definition.issueType,
        title: definition.title,
        action: definition.action,
        confidence: definition.confidence,
        isGrowthOpportunity: !!definition.isGrowthOpportunity,
        count: matched.length,
        totalAmount: toCents(totalAmount),
        topExamples: matched.slice(0, MAX_EXAMPLES_PER_GROUP)
    };
}

/**
 * Rank candidates: real recoverable money first (biggest total), then
 * measured-before-estimated as a tie-break, then growth/$0 opportunities last
 * so they can never outrank actual money.
 */
function rankCandidates(candidates) {
    return [...candidates].sort((a, b) => {
        const aHasMoney = a.totalAmount > 0;
        const bHasMoney = b.totalAmount > 0;
        if (aHasMoney !== bHasMoney) return aHasMoney ? -1 : 1;

        if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;

        // Equal dollars — prefer the one we actually measured.
        const aMeasured = a.confidence === CONFIDENCE.MEASURED;
        const bMeasured = b.confidence === CONFIDENCE.MEASURED;
        if (aMeasured !== bMeasured) return aMeasured ? -1 : 1;

        return b.count - a.count;
    });
}

/**
 * Build ranked opportunity candidates from ALREADY-LOADED issue arrays.
 * Pure function — no DB, no network. This is the unit-testable core.
 *
 * @param {Object} issuesData - object with the four issue arrays on it
 * @returns {{candidates: Array, totalRecoverableAmount: number, issuesConsidered: number}}
 */
function buildCandidatesFromIssuesData(issuesData = {}) {
    const candidates = [];
    let issuesConsidered = 0;

    for (const field of REQUIRED_FIELDS) {
        if (Array.isArray(issuesData[field])) issuesConsidered += issuesData[field].length;
    }

    for (const definition of GROUP_DEFINITIONS) {
        const candidate = buildCandidate(definition, issuesData[definition.sourceField]);
        if (candidate) candidates.push(candidate);
    }

    const ranked = rankCandidates(candidates).slice(0, MAX_CANDIDATES);

    // NOTE: this is a naive sum and can double-count — one ASIN may appear in
    // both "negative profit" and "wasted keywords". Present it as a combined
    // ESTIMATE, never as a promise of recoverable cash.
    const totalRecoverableAmount = toCents(
        ranked.reduce((sum, c) => sum + c.totalAmount, 0)
    );

    return { candidates: ranked, totalRecoverableAmount, issuesConsidered };
}

/**
 * Load the stored issues for an account and build ranked candidates.
 *
 * Reads ONLY the four arrays that carry dollar amounts (via the existing
 * projection-aware reader), not the whole issues payload.
 *
 * @param {string} userId
 * @param {string} country
 * @param {string} region
 * @returns {Promise<{success: boolean, candidates?: Array, totalRecoverableAmount?: number, issuesConsidered?: number, error?: string}>}
 */
async function getRankedOpportunities(userId, country, region) {
    const startTime = Date.now();

    try {
        const projection = REQUIRED_FIELDS.reduce((acc, f) => ({ ...acc, [f]: 1 }), {});
        const issuesData = await IssuesPaginationService.ensureIssuesData(userId, country, region, projection);

        if (!issuesData) {
            logger.warn('[OpportunityRankingService] No issues data available', { userId, country, region });
            return { success: false, error: 'No issues data available for this account' };
        }

        const result = buildCandidatesFromIssuesData(issuesData);
        const duration = Date.now() - startTime;

        logger.info('[OpportunityRankingService] Built opportunity candidates', {
            userId,
            country,
            region,
            issuesConsidered: result.issuesConsidered,
            candidates: result.candidates.length,
            totalRecoverableAmount: result.totalRecoverableAmount,
            duration
        });

        return { success: true, ...result, duration };

    } catch (error) {
        logger.error('[OpportunityRankingService] Error building candidates', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        return { success: false, error: error.message };
    }
}

module.exports = {
    getRankedOpportunities,
    buildCandidatesFromIssuesData,
    rankCandidates,
    GROUP_DEFINITIONS,
    REQUIRED_FIELDS,
    CONFIDENCE,
    MAX_EXAMPLES_PER_GROUP,
    MAX_CANDIDATES
};

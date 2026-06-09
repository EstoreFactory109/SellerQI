/**
 * scheduledPhases.js
 *
 * Defines the phases for scheduled (daily / Mon-Wed-Fri) data processing.
 * Each phase is a separate BullMQ job that chains to the next on completion.
 *
 * V2 pipeline (current):
 * 1. INIT          - Validate user, generate tokens, fetch merchant listings, start tracking
 * 2. BATCH_1_2     - Performance reports + inventory (V2/V1 perf, restock, FBA planning, stranded, non-compliance)
 * 3. ADS           - PPC async report services (PPCMetrics, ProductWise, UnitsSold, DateWise, WastedSpend)
 *                    ISOLATED because the async report create→poll→download cycle takes 40-50 min.
 *                    Runs DAILY (moved from Mon/Wed/Fri) so the dashboard always shows yesterday's spend.
 * 4. BATCH_3       - Shipments, brand, ad groups, MCP SalesOnly, MCP BuyBox
 * 5. FINANCE       - syncFinanceData (Sales Report + Finance API) — ISOLATED because it
 *                    polls Amazon for 10-25 min and was previously pinning a slot inside batch_3_4
 * 6. BATCH_4       - Negative keywords, search keywords, keyword recommendations
 * 7. CALC_REVIEW   - Calculations + review processing (issue summary, review ingestion/sender)
 * 8. FINALIZE      - Read DashboardSlices (with Analyse() fallback), cache, history, mark complete
 *
 * V1 (legacy) pipeline:  INIT → BATCH_1_2 → BATCH_3_4 → CALC_REVIEW → FINALIZE
 *
 * Migration safety:
 * - `BATCH_3_4` is kept as a *recognized but deprecated* phase so any in-flight
 *   jobs at deploy time can still drain through `sched_batch_3_4 → sched_calc_review`.
 * - It is NOT in `PHASE_ORDER` so new pipelines never enqueue it.
 * - `getNextPhase('sched_batch_3_4')` returns `'sched_calc_review'` via the
 *   legacy override map below — preserves the old pipeline's exit point.
 */

const PHASES = {
    INIT: 'sched_init',
    BATCH_1_2: 'sched_batch_1_2',
    ADS: 'sched_ads',
    BATCH_3: 'sched_batch_3',
    FINANCE: 'sched_finance',
    BATCH_4: 'sched_batch_4',
    CALC_REVIEW: 'sched_calc_review',
    FINALIZE: 'sched_finalize',
    // Legacy: pre-split combined batch. Not part of PHASE_ORDER. Drained via LEGACY_NEXT_PHASE.
    BATCH_3_4_LEGACY: 'sched_batch_3_4',
    // One-shot ads-only catch-up enqueued by freshnessSweeper for accounts with
    // missing past PPC days. Deliberately NOT in PHASE_ORDER so `getNextPhase`
    // returns null for it — a catch-up job never chains into BATCH_4 / CALC /
    // FINALIZE. It fetches the requested catchupDate's ads data via the
    // existing service functions and exits.
    ADS_CATCHUP: 'sched_ads_catchup',
    // One-shot finance-only catch-up enqueued by the reconciliation sweeper for
    // accounts with missing / provisional / zero finance days. Like ADS_CATCHUP
    // it is NOT in PHASE_ORDER — it runs syncFinanceData with forceDates for the
    // requested day(s) and exits, never chaining to another phase.
    FINANCE_CATCHUP: 'sched_finance_catchup'
};

const PHASE_ORDER = [
    PHASES.INIT,
    PHASES.BATCH_1_2,
    PHASES.ADS,
    PHASES.BATCH_3,
    PHASES.FINANCE,
    PHASES.BATCH_4,
    PHASES.CALC_REVIEW,
    PHASES.FINALIZE
];

// Legacy phase → next-phase map (for in-flight jobs deployed before the split).
// These phases are NOT in PHASE_ORDER so they will never be enqueued by new pipelines,
// but workers must still know where to send the pipeline if they pick one up.
const LEGACY_NEXT_PHASE = {
    [PHASES.BATCH_3_4_LEGACY]: PHASES.CALC_REVIEW
};

function getNextPhase(currentPhase) {
    if (Object.prototype.hasOwnProperty.call(LEGACY_NEXT_PHASE, currentPhase)) {
        return LEGACY_NEXT_PHASE[currentPhase];
    }
    const currentIndex = PHASE_ORDER.indexOf(currentPhase);
    if (currentIndex === -1 || currentIndex === PHASE_ORDER.length - 1) {
        return null;
    }
    return PHASE_ORDER[currentIndex + 1];
}

function isFirstPhase(phase) {
    return phase === PHASES.INIT;
}

function isLastPhase(phase) {
    return phase === PHASES.FINALIZE;
}

function getPhaseIndex(phase) {
    return PHASE_ORDER.indexOf(phase);
}

function calculateOverallProgress(phase, phaseProgress = 100) {
    const phaseIndex = getPhaseIndex(phase);
    if (phaseIndex === -1) return 0;

    const phasesCount = PHASE_ORDER.length;
    const phaseWeight = 100 / phasesCount;
    const completedPhasesProgress = phaseIndex * phaseWeight;
    const currentPhaseProgress = (phaseProgress / 100) * phaseWeight;

    return Math.round(completedPhasesProgress + currentPhaseProgress);
}

function createNextPhaseJobData(nextPhase, currentJobData, phaseResult = {}) {
    const { userId, country, region, parentJobId, enqueuedAt } = currentJobData;

    return {
        userId,
        country,
        region,
        phase: nextPhase,
        parentJobId: parentJobId || currentJobData.jobId,
        enqueuedAt: enqueuedAt || new Date().toISOString(),
        phaseData: {
            ...(currentJobData.phaseData || {}),
            ...(phaseResult.dataForNextPhase || {})
        }
    };
}

function generatePhaseJobId(parentJobId, phase) {
    return `${parentJobId}-${phase}`;
}

function parseParentJobId(phaseJobId) {
    const knownPhases = [...PHASE_ORDER, PHASES.BATCH_3_4_LEGACY];
    for (const phase of knownPhases) {
        if (phaseJobId.endsWith(`-${phase}`)) {
            return phaseJobId.slice(0, -(phase.length + 1));
        }
    }
    return phaseJobId;
}

function getAllPhaseJobIds(parentJobId) {
    // For idempotency checks during enqueue: include legacy phase id so we
    // detect old in-flight jobs and don't double-enqueue.
    return [...PHASE_ORDER, PHASES.BATCH_3_4_LEGACY]
        .map(phase => generatePhaseJobId(parentJobId, phase));
}

function isValidPhase(phase) {
    return PHASE_ORDER.includes(phase)
        || phase === PHASES.BATCH_3_4_LEGACY
        || phase === PHASES.ADS_CATCHUP
        || phase === PHASES.FINANCE_CATCHUP;
}

function getPhaseDescription(phase) {
    const descriptions = {
        [PHASES.INIT]: 'Initializing - validating user, fetching product catalog',
        [PHASES.BATCH_1_2]: 'Fetching performance reports and inventory data',
        [PHASES.ADS]: 'Fetching PPC report data (metrics, product-wise, units, spend, wasted-spend)',
        [PHASES.BATCH_3]: 'Fetching shipments, brand, ad groups, and MCP data',
        [PHASES.FINANCE]: 'Synchronizing finance data (Sales Report + Finance API)',
        [PHASES.BATCH_4]: 'Fetching keyword data (negative, search, recommendations)',
        [PHASES.CALC_REVIEW]: 'Running calculations and processing reviews',
        [PHASES.FINALIZE]: 'Finalizing - analysis, cache update, and completion',
        [PHASES.BATCH_3_4_LEGACY]: '[legacy] Combined batch 3+4 - drains to calc_review',
        [PHASES.ADS_CATCHUP]: '[catchup] Fetching ads data for a single missing past date',
        [PHASES.FINANCE_CATCHUP]: '[catchup] Re-fetching finance data for missing/provisional past date(s)'
    };
    return descriptions[phase] || 'Unknown phase';
}

module.exports = {
    PHASES,
    PHASE_ORDER,
    LEGACY_NEXT_PHASE,
    getNextPhase,
    isFirstPhase,
    isLastPhase,
    getPhaseIndex,
    calculateOverallProgress,
    createNextPhaseJobData,
    generatePhaseJobId,
    parseParentJobId,
    getAllPhaseJobIds,
    isValidPhase,
    getPhaseDescription
};

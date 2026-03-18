/**
 * scheduledPhases.js
 * 
 * Defines the phases for scheduled (daily/Mon-Wed-Fri) data processing.
 * Each phase is a separate BullMQ job that chains to the next on completion.
 * 
 * This mirrors the integration worker's phased architecture so that:
 * - Each phase completes independently and saves progress
 * - Worker crashes only lose the current phase, not all progress
 * - BullMQ stall detection works per-phase (shorter jobs = faster detection)
 * 
 * Phases:
 * 1. INIT        - Validate user, generate tokens, fetch merchant listings, start tracking
 * 2. BATCH_1_2   - Reports + PPC (V2/V1 perf, PPC spends, keywords perf, inventory)
 * 3. BATCH_3_4   - Shipments, economics, keywords (MCP economics, buybox, ad groups, search)
 * 4. CALC_REVIEW  - Calculations + review processing (issue summary, review ingestion/sender)
 * 5. FINALIZE    - Analyse, cache update, history, mark complete, complete tracking
 */

const PHASES = {
    INIT: 'sched_init',
    BATCH_1_2: 'sched_batch_1_2',
    BATCH_3_4: 'sched_batch_3_4',
    CALC_REVIEW: 'sched_calc_review',
    FINALIZE: 'sched_finalize'
};

const PHASE_ORDER = [
    PHASES.INIT,
    PHASES.BATCH_1_2,
    PHASES.BATCH_3_4,
    PHASES.CALC_REVIEW,
    PHASES.FINALIZE
];

function getNextPhase(currentPhase) {
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
    for (const phase of PHASE_ORDER) {
        if (phaseJobId.endsWith(`-${phase}`)) {
            return phaseJobId.slice(0, -(phase.length + 1));
        }
    }
    return phaseJobId;
}

function getAllPhaseJobIds(parentJobId) {
    return PHASE_ORDER.map(phase => generatePhaseJobId(parentJobId, phase));
}

function isValidPhase(phase) {
    return PHASE_ORDER.includes(phase);
}

function getPhaseDescription(phase) {
    const descriptions = {
        [PHASES.INIT]: 'Initializing - validating user, fetching product catalog',
        [PHASES.BATCH_1_2]: 'Fetching performance reports, PPC data, and inventory',
        [PHASES.BATCH_3_4]: 'Fetching shipments, economics, and keyword data',
        [PHASES.CALC_REVIEW]: 'Running calculations and processing reviews',
        [PHASES.FINALIZE]: 'Finalizing - analysis, cache update, and completion'
    };
    return descriptions[phase] || 'Unknown phase';
}

module.exports = {
    PHASES,
    PHASE_ORDER,
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

/**
 * integrationPhases.js
 * 
 * Defines the 5 phases of the integration process for chained job execution.
 * Each phase is designed to complete within 30 minutes to prevent job stalling.
 * 
 * Phases:
 * 1. INIT - Validate user, generate tokens, fetch merchant listings
 * 2. BATCH_1_2 - First and second batch API calls (reports, PPC, inventory)
 * 3. BATCH_3_4 - Third and fourth batch API calls (shipments, economics, keywords)
 * 4. LISTING_ITEMS - Process individual listing items (most time-consuming)
 * 5. FINALIZE - Clear cache, send notifications, update history
 */

const logger = require('../../utils/Logger.js');

// Phase constants
const PHASES = {
    INIT: 'init',
    BATCH_1_2: 'batch_1_2',
    BATCH_3_4: 'batch_3_4',
    LISTING_ITEMS: 'listing_items',
    FINALIZE: 'finalize'
};

// Phase execution order
const PHASE_ORDER = [
    PHASES.INIT,
    PHASES.BATCH_1_2,
    PHASES.BATCH_3_4,
    PHASES.LISTING_ITEMS,
    PHASES.FINALIZE
];

/**
 * Get the next phase after the current one
 * @param {string} currentPhase - Current phase name
 * @returns {string|null} Next phase name or null if this is the last phase
 */
function getNextPhase(currentPhase) {
    const currentIndex = PHASE_ORDER.indexOf(currentPhase);
    if (currentIndex === -1 || currentIndex === PHASE_ORDER.length - 1) {
        return null;
    }
    return PHASE_ORDER[currentIndex + 1];
}

/**
 * Check if a phase is the first phase
 * @param {string} phase - Phase name
 * @returns {boolean}
 */
function isFirstPhase(phase) {
    return phase === PHASES.INIT;
}

/**
 * Check if a phase is the last phase
 * @param {string} phase - Phase name
 * @returns {boolean}
 */
function isLastPhase(phase) {
    return phase === PHASES.FINALIZE;
}

/**
 * Get phase index (0-based)
 * @param {string} phase - Phase name
 * @returns {number}
 */
function getPhaseIndex(phase) {
    return PHASE_ORDER.indexOf(phase);
}

/**
 * Calculate progress percentage based on phase
 * @param {string} phase - Current phase
 * @param {number} phaseProgress - Progress within the phase (0-100)
 * @returns {number} Overall progress (0-100)
 */
function calculateOverallProgress(phase, phaseProgress = 100) {
    const phaseIndex = getPhaseIndex(phase);
    if (phaseIndex === -1) return 0;
    
    const phasesCount = PHASE_ORDER.length;
    const phaseWeight = 100 / phasesCount;
    const completedPhasesProgress = phaseIndex * phaseWeight;
    const currentPhaseProgress = (phaseProgress / 100) * phaseWeight;
    
    return Math.round(completedPhasesProgress + currentPhaseProgress);
}

/**
 * Create job data for the next phase
 * @param {string} nextPhase - Next phase name
 * @param {Object} currentJobData - Current job's data
 * @param {Object} phaseResult - Result from current phase execution
 * @returns {Object} Job data for next phase
 */
function createNextPhaseJobData(nextPhase, currentJobData, phaseResult = {}) {
    const { userId, country, region, parentJobId, triggeredAt } = currentJobData;
    
    return {
        userId,
        country,
        region,
        phase: nextPhase,
        parentJobId: parentJobId || currentJobData.jobId,
        triggeredAt: triggeredAt || new Date().toISOString(),
        // Pass forward any data needed by subsequent phases
        phaseData: {
            ...(currentJobData.phaseData || {}),
            ...(phaseResult.dataForNextPhase || {})
        }
    };
}

/**
 * Generate a unique job ID for a phase
 * @param {string} parentJobId - Parent integration job ID
 * @param {string} phase - Phase name
 * @returns {string} Unique phase job ID
 */
function generatePhaseJobId(parentJobId, phase) {
    return `${parentJobId}-${phase}`;
}

/**
 * Parse parent job ID from a phase job ID
 * @param {string} phaseJobId - Phase job ID
 * @returns {string} Parent job ID
 */
function parseParentJobId(phaseJobId) {
    // Remove phase suffix if present
    for (const phase of PHASE_ORDER) {
        if (phaseJobId.endsWith(`-${phase}`)) {
            return phaseJobId.slice(0, -(phase.length + 1));
        }
    }
    return phaseJobId;
}

/**
 * Get all phase job IDs for a parent job
 * @param {string} parentJobId - Parent job ID
 * @returns {string[]} Array of phase job IDs
 */
function getAllPhaseJobIds(parentJobId) {
    return PHASE_ORDER.map(phase => generatePhaseJobId(parentJobId, phase));
}

/**
 * Validate that a phase name is valid
 * @param {string} phase - Phase name to validate
 * @returns {boolean}
 */
function isValidPhase(phase) {
    return PHASE_ORDER.includes(phase);
}

/**
 * Get a human-readable description of a phase
 * @param {string} phase - Phase name
 * @returns {string}
 */
function getPhaseDescription(phase) {
    const descriptions = {
        [PHASES.INIT]: 'Initializing - validating user and fetching product catalog',
        [PHASES.BATCH_1_2]: 'Fetching performance reports and inventory data',
        [PHASES.BATCH_3_4]: 'Fetching shipments, economics, and keyword data',
        [PHASES.LISTING_ITEMS]: 'Processing individual product listings',
        [PHASES.FINALIZE]: 'Finalizing - clearing cache and sending notifications'
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

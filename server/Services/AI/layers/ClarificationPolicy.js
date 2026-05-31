const { hasAsin } = require('./helpers/EntityGuards.js');
const logger = require('../../../utils/Logger.js');

// Phase 6 / Task 6.1: lowered from 2 to 1. The new UX is to pick the most
// likely interpretation and answer it, offering alternatives as follow-ups,
// rather than looping the user through repeated clarifications.
const MAX_CLARIFICATION_ATTEMPTS = 1;

function shouldAskClarification({ interpretation, resolvedContext, threshold = 0.35, skipForSimple = false, question = '', conversationContext = {} }) {
    logger.info(`[QMate][DEBUG-TRACE] ClarificationPolicy called — intent: ${interpretation?.intent}, confidence: ${interpretation?.confidence}, engine: ${interpretation?.routing?.engine}`);
    const attempts = resolvedContext?.clarificationState?.attempts || 0;
    const maxAttempts = resolvedContext?.clarificationState?.maxAttempts || MAX_CLARIFICATION_ATTEMPTS;
    const explicitLayer1Need = Boolean(interpretation?.clarification?.needed);
    const metrics = Array.isArray(interpretation?.entities?.metrics) ? interpretation.entities.metrics : [];
    const queryShape = interpretation?.entities?.queryShape || null;
    const isClearInfoMetricQuery =
        interpretation?.routing?.engine === 'information_engine' &&
        metrics.length > 0 &&
        queryShape !== 'action' &&
        queryShape !== 'comparison';
    const hasAsinSignal =
        hasAsin(question) ||
        (Array.isArray(interpretation?.entities?.asins) && interpretation.entities.asins.length > 0);
    if (attempts >= maxAttempts) {
        logger.info('[QMate][DEBUG-TRACE] ClarificationPolicy FINAL DECISION — shouldClarify: false, reason: exhausted');
        return { ask: false, exhausted: true };
    }
    // Clarification-first contract: explicit unresolved requirements from layer 1 always win.
    if (explicitLayer1Need) {
        logger.info('[QMate][DEBUG-TRACE] ClarificationPolicy FINAL DECISION — shouldClarify: true, reason: layer1_explicit');
        return { ask: true, exhausted: false, reason: 'layer1_explicit' };
    }
    // ASIN presence is the strongest intent signal — never block on confidence when one is provided.
    if (hasAsinSignal) {
        logger.info('[QMate][DEBUG-TRACE] ClarificationPolicy FINAL DECISION — shouldClarify: false, reason: asin_bypass');
        return { ask: false, exhausted: false, reason: 'asin_bypass' };
    }
    // Do not ask confidence-based clarification for clear metric value queries.
    if (isClearInfoMetricQuery) return { ask: false, exhausted: false, reason: 'metric_query_bypass' };
    if (skipForSimple) return { ask: false, exhausted: false, reason: 'simple_prompt_bypass' };

    // --- Phase 6 / Task 6.1: additional leniency bypasses ---
    // These run BEFORE the confidence threshold check below and short-circuit:
    // if any matches we answer the query rather than asking for clarification.

    // Bypass: If the query contains any recognized metric keyword, just answer it.
    const recognizedMetrics = ['sales', 'revenue', 'profit', 'margin', 'ppc', 'acos', 'roas',
        'spend', 'cost', 'units', 'orders', 'inventory', 'stock', 'issues', 'reimbursement',
        'keyword', 'impression', 'click', 'conversion', 'bsr', 'rank', 'organic'];
    const queryLower = (question || '').toLowerCase();
    const hasRecognizedMetric = recognizedMetrics.some((m) => queryLower.includes(m));
    logger.info(`[QMate][DEBUG-TRACE] Checking recognized_metric_bypass — queryLower: "${queryLower?.substring(0, 80)}", hasRecognizedMetric: ${hasRecognizedMetric}`);
    if (hasRecognizedMetric) {
        logger.info('[QMate][DEBUG-TRACE] ClarificationPolicy FINAL DECISION — shouldClarify: false, reason: recognized_metric_bypass');
        return { ask: false, exhausted: false, reason: 'recognized_metric_bypass' };
    }

    // Bypass: If this is a "show me" / "give me" / "what is" style direct question.
    const directPatterns = /^(show|give|tell|what|how much|how many|how to|how do|how can|why|list|display|get|find|check|see|which|compare)\b/i;
    logger.info(`[QMate][DEBUG-TRACE] Checking direct_question_bypass — matches: ${directPatterns.test(queryLower.trim())}`);
    if (directPatterns.test(queryLower.trim())) {
        logger.info('[QMate][DEBUG-TRACE] ClarificationPolicy FINAL DECISION — shouldClarify: false, reason: direct_question_bypass');
        return { ask: false, exhausted: false, reason: 'direct_question_bypass' };
    }

    // Bypass: If conversation context has active entities (user has established context).
    logger.info(`[QMate][DEBUG-TRACE] Checking conversation_context_bypass — activeAsins: ${conversationContext?.activeAsins?.length}, turnCount: ${conversationContext?.turnCount}`);
    if (conversationContext?.activeAsins?.length > 0 || conversationContext?.turnCount > 1) {
        logger.info('[QMate][DEBUG-TRACE] ClarificationPolicy FINAL DECISION — shouldClarify: false, reason: conversation_context_bypass');
        return { ask: false, exhausted: false, reason: 'conversation_context_bypass' };
    }

    if ((interpretation?.confidence || 0) < threshold) {
        logger.info('[QMate][DEBUG-TRACE] ClarificationPolicy FINAL DECISION — shouldClarify: true, reason: low_confidence');
        return { ask: true, exhausted: false };
    }
    logger.info('[QMate][DEBUG-TRACE] ClarificationPolicy FINAL DECISION — shouldClarify: false, reason: default_no_clarify');
    return { ask: false, exhausted: false };
}

function buildDiscreteClarificationPrompt() {
    return (
        "Would you like me to share just the number, walk through the full breakdown, " +
        "show a chart/trend, or take an action on your account (like pausing keywords)?"
    );
}

/**
 * Phase 3 / Task 3.1: structured-options version of the generic discrete
 * clarification. Returns the same four discrete choices as
 * `buildDiscreteClarificationPrompt` but as clickable `{ id, label, resolved_prompt }`
 * objects the frontend can render as buttons.
 *
 * Each `resolved_prompt` is a complete, answerable question — clicking the
 * button sends that prompt back as the next user message and the resulting
 * QMate run can proceed without another clarification round.
 *
 * @param {string} [originalQuestion] - The user's original question, used to
 *        build resolved_prompts that preserve their intent.
 * @returns {{ id: string, label: string, resolved_prompt: string, icon?: string }[]}
 */
function buildDiscreteClarificationOptions(originalQuestion = '') {
    const base = String(originalQuestion || '').trim();
    const stem = base || 'my latest data';
    return [
        {
            id: 'opt_1',
            label: 'Just give me the number',
            resolved_prompt: base
                ? `${stem} — return a single number only.`
                : 'What is my total sales for the last 30 days?',
            icon: 'hash',
        },
        {
            id: 'opt_2',
            label: 'Walk me through the breakdown',
            resolved_prompt: base
                ? `${stem} — return a full breakdown with reasoning.`
                : 'Give me a full breakdown of my account performance for the last 30 days.',
            icon: 'list',
        },
        {
            id: 'opt_3',
            label: 'Show me a chart/trend',
            resolved_prompt: base
                ? `${stem} — return a trend chart over time.`
                : 'Show me a sales trend chart for the last 30 days.',
            icon: 'trending-up',
        },
        {
            id: 'opt_4',
            label: 'Take an action on my account',
            resolved_prompt: 'Pause my worst-performing PPC keywords',
            icon: 'wrench',
        },
    ];
}

module.exports = {
    shouldAskClarification,
    buildDiscreteClarificationPrompt,
    buildDiscreteClarificationOptions,
};

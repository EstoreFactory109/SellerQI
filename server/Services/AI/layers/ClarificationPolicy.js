const { hasAsin } = require('./helpers/EntityGuards.js');

function shouldAskClarification({ interpretation, resolvedContext, threshold = 0.35, skipForSimple = false, question = '' }) {
    const attempts = resolvedContext?.clarificationState?.attempts || 0;
    const maxAttempts = resolvedContext?.clarificationState?.maxAttempts || 2;
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
    if (attempts >= maxAttempts) return { ask: false, exhausted: true };
    // Clarification-first contract: explicit unresolved requirements from layer 1 always win.
    if (explicitLayer1Need) return { ask: true, exhausted: false, reason: 'layer1_explicit' };
    // ASIN presence is the strongest intent signal — never block on confidence when one is provided.
    if (hasAsinSignal) return { ask: false, exhausted: false, reason: 'asin_bypass' };
    // Do not ask confidence-based clarification for clear metric value queries.
    if (isClearInfoMetricQuery) return { ask: false, exhausted: false, reason: 'metric_query_bypass' };
    if (skipForSimple) return { ask: false, exhausted: false, reason: 'simple_prompt_bypass' };
    if ((interpretation?.confidence || 0) < threshold) return { ask: true, exhausted: false };
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

/**
 * Short-circuit vague meta prompts before LLM (suggestion path).
 */

const VAGUE_TRIGGERS = ['what can you do', 'tell me something', 'what can you help', 'who are you'];

function needsClarification(query = '') {
    const q = String(query).toLowerCase().trim();
    if (!q) return false;
    if (q === 'help' || q === 'help me' || q === 'help!') return true;
    return VAGUE_TRIGGERS.some((v) => q.includes(v));
}

const CLARIFY_FALLBACK_MESSAGE =
    "Can you tell me what you'd like to check in your Amazon account? For example, sales performance, ad results, or inventory issues.";

module.exports = { needsClarification, CLARIFY_FALLBACK_MESSAGE };

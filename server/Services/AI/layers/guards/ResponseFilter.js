/**
 * Blocks generic assistant / capability-list phrasing in model output.
 */

const FORBIDDEN_PATTERNS = [
    'i can help with many topics',
    'i can assist with',
    'i can help you with many things',
    'as an ai language model',
    'as a language model',
    'i can help with a wide range',
    "i'm a large language model",
    'i am a large language model',
];

const GENERIC_FALLBACK_MESSAGE =
    'I can help you analyze your Amazon business (sales, ads, inventory, profitability). What would you like to check?';

function isGenericResponse(text = '') {
    const t = String(text).toLowerCase();
    return FORBIDDEN_PATTERNS.some((p) => t.includes(p));
}

function filterGenericAnswerMarkdown(text, fallbackMessage = GENERIC_FALLBACK_MESSAGE) {
    if (!text || typeof text !== 'string') return fallbackMessage;
    if (isGenericResponse(text)) return fallbackMessage;
    return text;
}

module.exports = {
    isGenericResponse,
    filterGenericAnswerMarkdown,
    GENERIC_FALLBACK_MESSAGE,
};

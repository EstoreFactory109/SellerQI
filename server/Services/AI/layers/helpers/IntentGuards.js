/**
 * Onboarding / meta-intent detection. Lets QMate answer "what can you help me with"
 * directly with a capabilities response instead of forcing a clarification loop.
 */

const ONBOARDING_PHRASES = [
    'what can you do',
    'what can you help',
    'how can you help',
    'what do you do',
    'who are you',
    'what are you',
];

function isOnboardingQuery(query = '') {
    const q = String(query).toLowerCase().trim();
    if (!q) return false;
    if (q === 'help' || q === 'help me' || q === 'help!' || q === 'hi' || q === 'hello' || q === 'hey') {
        return true;
    }
    if (q.startsWith('help me ')) return true;
    return ONBOARDING_PHRASES.some((phrase) => q.includes(phrase));
}

const CAPABILITIES_ANSWER =
    'I can help you analyze your Amazon business — like sales trends, ad performance, inventory issues, and profitability.\n\nWhat would you like to look into?';

const CAPABILITIES_FOLLOW_UPS = [
    'Show me total sales for the last 30 days',
    'Which products have the most issues?',
    'How much money is wasted on ads?',
];

function getCapabilitiesResponse() {
    return {
        answer_markdown: CAPABILITIES_ANSWER,
        follow_up_questions: CAPABILITIES_FOLLOW_UPS,
    };
}

module.exports = {
    isOnboardingQuery,
    getCapabilitiesResponse,
    CAPABILITIES_ANSWER,
    CAPABILITIES_FOLLOW_UPS,
};

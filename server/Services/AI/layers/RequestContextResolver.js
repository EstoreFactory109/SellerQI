const { createResolvedContextContract } = require('./contracts.js');

function toYmd(date) {
    return new Date(date).toISOString().slice(0, 10);
}

function resolveDateRange({ interpreted, startDate, endDate, calendarMode }) {
    const interpretedRange = interpreted?.entities?.timeRange || null;
    if (
        interpretedRange?.type === 'absolute_range' &&
        interpretedRange?.startDate &&
        interpretedRange?.endDate
    ) {
        return {
            startDate: interpretedRange.startDate,
            endDate: interpretedRange.endDate,
            calendarMode: 'custom',
        };
    }

    const mode = calendarMode || 'default';
    if (startDate && endDate) {
        return { startDate, endDate, calendarMode: mode };
    }

    const prompt = interpreted?.raw?.normalizedPrompt || '';
    const now = new Date();
    const end = new Date(now);
    let days = 30;

    if (/\b(last|past)\s*7\s*days?\b/i.test(prompt) || mode === 'last7') days = 7;
    else if (/\b(last|past)\s*14\s*days?\b/i.test(prompt) || mode === 'last14') days = 14;
    else if (/\b(last|past)\s*30\s*days?\b/i.test(prompt)) days = 30;

    const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    return {
        startDate: toYmd(start),
        endDate: toYmd(end),
        calendarMode: mode === 'default' ? (days === 7 ? 'last7' : days === 14 ? 'last14' : 'default') : mode,
    };
}

const CLARIFICATION_MARKERS = [
    'i need a small clarification before proceeding',
    'i want to make sure i answer this correctly',
    'please choose one option so i can answer correctly',
    'i need one clarification before answering',
    'i could not confidently infer',
];

function countClarificationAttempts(chatHistory = []) {
    let attempts = 0;
    for (const msg of chatHistory) {
        if (!msg || String(msg.role || '').toLowerCase() !== 'assistant') continue;
        const text = String(msg.content || '').toLowerCase();
        if (CLARIFICATION_MARKERS.some((marker) => text.includes(marker))) {
            attempts += 1;
        }
    }
    return attempts;
}

function resolveRequestContext(params = {}) {
    const { interpreted, request, runtimeContext } = params;
    const validationErrors = [];
    const userId = request?.userId || runtimeContext?.userId || null;
    const country = request?.country || runtimeContext?.country || null;
    const region = request?.region || runtimeContext?.region || null;

    if (!userId) validationErrors.push('Missing user id');
    if (!country) validationErrors.push('Missing country');
    if (!region) validationErrors.push('Missing region');

    const resolvedRange = resolveDateRange({
        interpreted,
        startDate: runtimeContext?.startDate || null,
        endDate: runtimeContext?.endDate || null,
        calendarMode: runtimeContext?.calendarMode || 'default',
    });

    const clarificationAttempts = countClarificationAttempts(request?.chatHistory || []);

    return createResolvedContextContract({
        userId,
        country,
        region,
        startDate: resolvedRange.startDate,
        endDate: resolvedRange.endDate,
        calendarMode: resolvedRange.calendarMode,
        clarificationState: {
            attempts: clarificationAttempts,
            // Phase 6 / Task 6.1: lowered from 2 to 1 — answer the most likely
            // interpretation instead of looping the user through clarifications.
            maxAttempts: 1,
        },
        derived: {
            askedTimeRange: interpreted?.entities?.timeRange || null,
            requestedMetrics: interpreted?.entities?.metrics || [],
            requestedDimensions: interpreted?.entities?.dimensions || [],
        },
        validationErrors,
    });
}

module.exports = { resolveRequestContext };

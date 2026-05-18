/**
 * Lightweight sanity check on suggestion answers vs numeric context (anti-hallucination).
 */

function hasPositiveIssueSignal(issues) {
    if (!issues || typeof issues !== 'object') return false;
    return Object.values(issues).some((v) => Number(v) > 0);
}

function validateAnswer(answer, context) {
    if (!answer || typeof answer !== 'string') return false;

    const hasRelevantSignal = hasPositiveIssueSignal(context?.issues);
    const lower = answer.toLowerCase();

    const negatesIssues =
        /\bno issues\b/.test(lower) ||
        /\bno errors\b/.test(lower) ||
        /\bno problems\b/.test(lower) ||
        /\bzero issues\b/.test(lower) ||
        /\bdon'?t have any issues\b/.test(lower) ||
        /\bnot enough data\b/.test(lower) ||
        /\bdata not available\b/.test(lower);

    const claimsConcreteProblems =
        /\b(issues?|errors?|problems?)\b/.test(lower) &&
        /\b(have|has|showing|found|detected|critical|severe|urgent|fix|address)\b/.test(lower);

    if (!hasRelevantSignal && claimsConcreteProblems && !negatesIssues) {
        return false;
    }

    return true;
}

/**
 * Extract numeric values from a string.
 * Handles: $1,234.56, 45.2%, 1234, -56.7
 */
function extractNumbers(text) {
    if (!text) return [];
    const matches = String(text).match(/[-]?[\$]?[\d,]+\.?\d*/g) || [];
    return matches
        .map((m) => parseFloat(m.replace(/[$,]/g, '')))
        .filter((n) => !Number.isNaN(n));
}

/**
 * Checks that numbers mentioned in the LLM response actually appear
 * in the data context that was provided to the LLM.
 * Returns { valid: boolean, warnings: string[], cleanedContent: string }
 */
function validateNumbersAgainstContext(responseContent, contextData) {
    // Extract all numbers from the response (currency amounts, percentages, integers)
    const responseNumbers = extractNumbers(responseContent);

    // Extract all numbers from the context data
    const contextNumbers = extractNumbers(
        typeof contextData === 'string' ? contextData : JSON.stringify(contextData)
    );

    // Build a Set of context numbers for fast lookup (with some tolerance for rounding)
    const contextNumberSet = new Set();
    contextNumbers.forEach((n) => {
        contextNumberSet.add(n.toString());
        // Add rounded variants
        contextNumberSet.add(Math.round(n).toString());
        contextNumberSet.add(n.toFixed(2));
    });

    const warnings = [];
    const cleanedContent = responseContent;

    for (const num of responseNumbers) {
        const numStr = num.toString();
        const numRounded = Math.round(num).toString();
        const numFixed = num.toFixed(2);

        if (
            !contextNumberSet.has(numStr) &&
            !contextNumberSet.has(numRounded) &&
            !contextNumberSet.has(numFixed)
        ) {
            // This number was not found in context — potentially hallucinated.
            // Only flag significant numbers (ignore 0, 1, small ordinals).
            if (Math.abs(num) > 10) {
                warnings.push(`Number ${numStr} in response not found in provided context data`);
            }
        }
    }

    return { valid: warnings.length === 0, warnings, cleanedContent };
}

module.exports = {
    validateAnswer,
    hasPositiveIssueSignal,
    validateNumbersAgainstContext,
    extractNumbers,
};

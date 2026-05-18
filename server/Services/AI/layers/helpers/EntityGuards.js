/**
 * Lightweight entity guards used by QMate routing. ASIN presence is the
 * strongest intent signal in this product — when it's there, skip onboarding
 * and clarification short-circuits.
 */

const ASIN_PATTERN = /\bB0[A-Z0-9]{8,9}\b/i;

function extractAsin(query = '') {
    const match = String(query).match(ASIN_PATTERN);
    return match ? match[0].toUpperCase() : null;
}

function hasAsin(query = '') {
    return ASIN_PATTERN.test(String(query));
}

module.exports = {
    ASIN_PATTERN,
    extractAsin,
    hasAsin,
};

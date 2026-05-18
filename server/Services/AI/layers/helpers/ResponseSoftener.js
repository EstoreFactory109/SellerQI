/**
 * Smooths robotic / form-like phrasing out of LLM output so QMate reads like
 * a human analyst instead of a decision tree.
 */

const ROBOTIC_PATTERNS = [
    /\bplease choose( one)?( option)?[:,]?\s*/gi,
    /\bselect one( option)?[:,]?\s*/gi,
    /\boption\s*[1-4][.)]?\s*/gi,
    /\bchoose from the following( options)?[:,]?\s*/gi,
    /\bpick one( option)?[:,]?\s*/gi,
];

function softenResponse(text = '') {
    if (!text || typeof text !== 'string') return text;
    let out = text;
    for (const pattern of ROBOTIC_PATTERNS) {
        out = out.replace(pattern, '');
    }
    return out.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { softenResponse };

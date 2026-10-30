/**
 * Amazon Ads v3 answers a write with { <entity>: { success: [], error: [] } }: an HTTP
 * 200 can still carry per-item failures. Every Ads write checks this.
 */
function v3Errors(result) {
    const errors = [];
    for (const value of Object.values(result || {})) {
        if (value && Array.isArray(value.error)) errors.push(...value.error);
    }
    return errors;
}

/** Amazon's own words for one failed item ({ index, errors: [{ errorType, errorValue: {...message} }] }). */
function reasonOf(errorItem) {
    const seen = new Set();
    const find = (v) => {
        if (!v || typeof v !== 'object' || seen.has(v)) return null;
        seen.add(v);
        if (typeof v.message === 'string' && v.message.trim()) return v.message.trim();
        for (const child of Object.values(v)) {
            const hit = find(child);
            if (hit) return hit;
        }
        return null;
    };
    return find(errorItem) || JSON.stringify(errorItem).slice(0, 300);
}

/** Throws when an Ads v3 answer has per-item failures. */
function assertNoV3Errors(result, sent) {
    const errors = v3Errors(result);
    if (errors.length > 0) {
        const of = sent ? ` ${errors.length} of ${sent}` : '';
        throw Object.assign(new Error(`Amazon rejected${of}: ${reasonOf(errors[0])}`), { response: result });
    }
}

module.exports = { v3Errors, assertNoV3Errors, reasonOf };

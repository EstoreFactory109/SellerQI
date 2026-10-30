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

/** Throws when an Ads v3 answer has per-item failures. */
function assertNoV3Errors(result, sent) {
    const errors = v3Errors(result);
    if (errors.length > 0) {
        const of = sent ? ` ${errors.length} of ${sent}` : '';
        throw Object.assign(new Error(`Amazon rejected${of}: ${JSON.stringify(errors[0]).slice(0, 300)}`), { response: result });
    }
}

module.exports = { v3Errors, assertNoV3Errors };

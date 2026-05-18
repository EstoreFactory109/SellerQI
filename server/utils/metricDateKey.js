/**
 * Calendar date key (YYYY-MM-DD) for per-day Mongo documents.
 * Uses UTC "yesterday" for snapshot-style rows (campaigns, negatives, ad groups).
 */
function getYesterdayMetricDateUtc() {
    const now = new Date();
    const y = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    return y.toISOString().split("T")[0];
}

function toYyyyMmDd(value) {
    if (value == null || value === "") return null;
    if (typeof value === "string") {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().split("T")[0];
    }
    return null;
}

module.exports = { getYesterdayMetricDateUtc, toYyyyMmDd };

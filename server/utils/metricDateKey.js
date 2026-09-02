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

/**
 * Shift a YYYY-MM-DD key by `deltaDays` (negative goes back) and return a YYYY-MM-DD key.
 *
 * Done in UTC on purpose: metricDate keys are plain calendar strings with no timezone, and
 * building a local Date from one would shift the day for anyone west of UTC.
 *
 * Returns null for input that isn't a usable date key, so callers can fall back rather than
 * silently querying a garbage range.
 */
function shiftMetricDateKey(dateKey, deltaDays) {
    const base = toYyyyMmDd(dateKey);
    if (!base) return null;
    const [y, m, d] = base.split("-").map(Number);
    const shifted = new Date(Date.UTC(y, m - 1, d + deltaDays));
    if (Number.isNaN(shifted.getTime())) return null;
    return shifted.toISOString().split("T")[0];
}

module.exports = { getYesterdayMetricDateUtc, toYyyyMmDd, shiftMetricDateKey };

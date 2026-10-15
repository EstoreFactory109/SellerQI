/**
 * AccountHealthHistory — judge Amazon's account-health statuses over the last 7
 * days of reports instead of the newest one alone.
 *
 * Why: Amazon's V2 Seller Performance report can flip a status from one day to the
 * next. A US account with an Account Health Rating of 204 (the At Risk cutoff is
 * 200) read AT_RISK on Oct 10 and Oct 13 and NORMAL on the days around them. Judged
 * one report at a time, it raised an "Account Status" task on Oct 13 while the
 * Account Health page, reading Oct 14, showed everything fine.
 *
 * The rule (per metric, over up to 7 report days, newest first):
 *   error    the newest value is critical (DEACTIVATED), or the newest 2 days are
 *            both bad — a sustained problem
 *   warning  the status keeps slipping: 2+ separate bad stretches (bad, good, bad),
 *            or it is not good today after earlier bad days; worth acting on,
 *            worded as such
 *   ok       a single blip, a single bad stretch that has since recovered, or all
 *            good. (Counting bad days alone called a 3-day AT_RISK stretch followed
 *            by 5 NORMAL days "keeps slipping", which it wasn't.)
 * With a single day of history (new account, gap) there is nothing to compare, so a
 * bad value is judged as before: an error.
 *
 * Reports can arrive several times a day (up to 22 seen in production), so the
 * window counts DAYS: the last report of each UTC day stands for that day.
 */

const V2_Model = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');

const WINDOW_DAYS = 7;
// Bounds the read for an account whose report was written many times a day.
const MAX_HISTORY_DOCS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

// Amazon's Account Health Rating: 200+ is Healthy, 100-199 At Risk. A score this
// close to 200 is why a status can flip from day to day.
const AHR_AT_RISK_CUTOFF = 200;
const AHR_NEAR_CUTOFF_MARGIN = 20;

/**
 * Per V2 field: the healthy value, values that are a step down but never an error
 * on their own (Amazon's FAIR tier), and values that are an error immediately.
 */
const METRIC_RULES = {
    accountStatuses: { good: 'NORMAL', critical: ['DEACTIVATED'] },
    listingPolicyViolations: { good: 'GOOD' },
    validTrackingRateStatus: { good: 'GOOD', mild: ['FAIR'] },
    orderWithDefectsStatus: { good: 'GOOD', mild: ['FAIR'] },
    lateShipmentRateStatus: { good: 'GOOD', mild: ['FAIR'] },
    CancellationRate: { good: 'GOOD', mild: ['FAIR'] },
};

// "NONE" is what Amazon sends for a metric with nothing to measure (e.g. tracking
// rate for an account with no seller-fulfilled shipments) — not a verdict. It was
// counted as a failing Valid Tracking Rate (16 reports in production).
const hasValue = (v) => typeof v === 'string'
    ? v.trim() !== '' && v.trim().toUpperCase() !== 'NONE'
    : v !== null && v !== undefined;

const dayOf = (d) => {
    const t = d instanceof Date ? d : new Date(d);
    return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
};

/**
 * One report per UTC day — the last of that day — newest day first, at most
 * WINDOW_DAYS days.
 * @param {Array} docs - V2 report docs with createdAt, any order
 * @returns {Array<{day: string, doc: Object}>}
 */
function toDailySeries(docs = []) {
    const byDay = new Map();
    for (const doc of docs || []) {
        if (!doc) continue;
        const day = dayOf(doc.createdAt);
        if (!day) continue;
        const prev = byDay.get(day);
        if (!prev || new Date(doc.createdAt) > new Date(prev.createdAt)) byDay.set(day, doc);
    }
    return [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, WINDOW_DAYS)
        .map(([day, doc]) => ({ day, doc }));
}

/**
 * @param {Array<{day, doc}>} series - from toDailySeries, newest first
 * @param {string} field - V2 field name
 * @returns {{ level: 'ok'|'warning'|'error'|'none', latest: string|undefined, latestGood: boolean,
 *             badDays: string[], badValues: Object, daysJudged: number, consecutiveBad: number }}
 */
function judgeMetric(series = [], field) {
    const rule = METRIC_RULES[field] || { good: 'GOOD' };
    const days = series.filter(({ doc }) => hasValue(doc?.[field]));
    if (days.length === 0) {
        return { level: 'none', latest: undefined, latestGood: false, days: [], badDays: [], badValues: {}, daysJudged: 0, consecutiveBad: 0, badRuns: 0 };
    }

    const isGood = (v) => v === rule.good;
    const isMild = (v) => (rule.mild || []).includes(v);
    const isCritical = (v) => (rule.critical || []).includes(v);
    const isBad = (v) => !isGood(v) && !isMild(v);

    const values = days.map(({ doc }) => doc[field]);
    const latest = values[0];
    const badDays = days.filter(({ doc }) => !isGood(doc[field])).map(({ day }) => day);
    const badValues = Object.fromEntries(days.filter(({ doc }) => !isGood(doc[field])).map(({ day, doc }) => [day, doc[field]]));
    let consecutiveBad = 0;
    for (const v of values) { if (isBad(v)) consecutiveBad++; else break; }
    // Separate stretches of not-good days: 2+ means the status went bad, recovered,
    // and went bad again.
    let badRuns = 0;
    values.forEach((v, i) => { if (!isGood(v) && (i === 0 || isGood(values[i - 1]))) badRuns++; });

    const base = {
        latest,
        latestGood: isGood(latest),
        days: days.map(({ day }) => day),
        badDays,
        badValues,
        daysJudged: days.length,
        consecutiveBad,
        badRuns,
    };

    if (isCritical(latest)) return { ...base, level: 'error' };
    if (days.length === 1) {
        // Nothing to compare against: judge today's value as before, except that a
        // FAIR rating is a caution, not a failure.
        if (isBad(latest)) return { ...base, level: 'error' };
        if (isMild(latest)) return { ...base, level: 'warning' };
        return { ...base, level: 'ok' };
    }
    if (consecutiveBad >= 2) return { ...base, level: 'error' };
    if (badRuns >= 2) return { ...base, level: 'warning' };
    if (!isGood(latest) && badDays.length >= 2) return { ...base, level: 'warning' };
    return { ...base, level: 'ok' };
}

/** True when the rating is healthy but within reach of the At Risk cutoff. */
function nearCutoff(ahrScore) {
    const n = Number(ahrScore);
    return Number.isFinite(n) && n >= AHR_AT_RISK_CUTOFF && n < AHR_AT_RISK_CUTOFF + AHR_NEAR_CUTOFF_MARGIN;
}

/** "Oct 10, Oct 13" from ISO days, oldest first. */
function formatDays(days = []) {
    return [...days]
        .sort()
        .map((d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))
        .join(', ');
}

/** "AT_RISK" -> "At Risk". */
function humanizeStatus(value) {
    return String(value || '')
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * V2 reports from the last WINDOW_DAYS days, newest first. Every account-health
 * caller loads this alongside its newest V2/V1 reports and passes it to
 * checkAccountHealth, so the task, the Account Health page, the dashboard widget
 * and QMate all judge the same history.
 */
function loadV2History(userId, country, region, { now = new Date() } = {}) {
    const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
    return V2_Model.find({ User: userId, country, region, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .limit(MAX_HISTORY_DOCS)
        .lean();
}

module.exports = {
    toDailySeries,
    judgeMetric,
    nearCutoff,
    formatDays,
    humanizeStatus,
    loadV2History,
    METRIC_RULES,
    WINDOW_DAYS,
    AHR_AT_RISK_CUTOFF,
};

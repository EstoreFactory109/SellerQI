/**
 * Stale data guard (tasks-logics.xlsx "Data integrity: Stale data").
 *
 * Spreadsheet: internal alert when a source's latest pull is older than 36 hours;
 * hold client tasks from that source. The holding already happens per detector
 * (a stale input reports itself uncovered, so task reconcile resolves nothing on
 * it). This adds the alert: one place that says which inputs are behind, by how
 * much, for the team to chase. It never creates a client task.
 *
 * Each source is judged against its own schedule: daily reports at 36 hours, plus
 * the lag Amazon builds into some data (Sales & Traffic arrives ~2 days behind),
 * and weekly sources at 8 days.
 */

const { STALE_DAILY_HOURS } = require('./KpiRules.js');

const HOUR_MS = 60 * 60 * 1000;
const WEEKLY_HOURS = 8 * 24;
const LAGGED_DAILY_HOURS = STALE_DAILY_HOURS + 48;

/** [input key, how to read its newest time, max age in hours] */
const SOURCES = [
    ['stock', (i) => i.stock?.fetchedAt, STALE_DAILY_HOURS],
    ['suppressed', (i) => i.suppressed?.createdAt, STALE_DAILY_HOURS],
    ['ahrHistory', (i) => (i.ahrHistory?.length ? i.ahrHistory[i.ahrHistory.length - 1].at : null), STALE_DAILY_HOURS],
    ['removals', (i) => i.removals?.createdAt, WEEKLY_HOURS],
    ['restock', (i) => i.restock?.createdAt, STALE_DAILY_HOURS],
    ['planning', (i) => i.planning?.createdAt, STALE_DAILY_HOURS],
    ['traffic', (i) => (i.traffic?.newestDate ? `${i.traffic.newestDate}T23:59:59Z` : null), LAGGED_DAILY_HOURS],
    ['tacos', (i) => (i.tacos?.newestDate ? `${i.tacos.newestDate}T23:59:59Z` : null), LAGGED_DAILY_HOURS],
    ['reviews', (i) => i.reviews?.newest?.at, WEEKLY_HOURS],
    ['fbaFees', (i) => i.fbaFees?.newest?.at, WEEKLY_HOURS],
    ['brandOffers', (i) => i.brandOffers?.newest?.at, WEEKLY_HOURS]
];

/**
 * @param {Object} inputs - KpiInputs
 * @param {Date} now
 * @returns {Array<{source, newest, ageHours, maxHours}>} sources present but behind
 */
function staleSources(inputs, now = new Date()) {
    if (!inputs) return [];
    const out = [];
    for (const [source, newestOf, maxHours] of SOURCES) {
        if (inputs[source] === undefined || inputs[source] === null) continue; // not loaded for this wave / never arrived
        const newest = newestOf(inputs);
        const t = Date.parse(newest || '');
        const ageHours = Number.isFinite(t) ? (now.getTime() - t) / HOUR_MS : Infinity;
        if (ageHours > maxHours) {
            out.push({ source, newest: newest || null, ageHours: Number.isFinite(ageHours) ? Math.round(ageHours) : null, maxHours });
        }
    }
    return out;
}

module.exports = { staleSources, SOURCES };

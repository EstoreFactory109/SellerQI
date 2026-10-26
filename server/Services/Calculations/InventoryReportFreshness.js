/**
 * Read-time age guards for the daily FBA inventory reports (stranded
 * inventory, inbound non-compliance, restock recommendations).
 *
 * Each reader takes the newest saved document for a marketplace. Until the
 * writers learnt to save empty snapshots, a clean report wrote nothing, so the
 * last report that HAD problems stayed "newest" indefinitely — measured in
 * production at up to 187 days old, and still raising Issues-page errors and
 * tasks the seller had long since fixed. Empty snapshots stop that going
 * forward; this guard covers what they cannot: documents already stranded,
 * and any future run that silently stops writing.
 */

const logger = require('../../utils/Logger.js');
const { toTime } = require('./RecoverableAmountUtils.js');

const DAY_MS = 24 * 60 * 60 * 1000;

// All three reports are scheduled DAILY (ScheduleConfig.js). A week tolerates
// several missed runs without blanking a seller's inventory section, while
// still rejecting a document that cannot describe their position today.
const INVENTORY_REPORT_MAX_AGE_DAYS = 7;

// Amazon's inbound non-compliance report reaches far back; the writer keeps
// only issues reported in the last 30 days, and so must the reader, or an
// older document carries months-old issues forward as current.
const INBOUND_ISSUE_WINDOW_DAYS = 30;
// tasks-logics.xlsx "Inbound shipment problems": a problem not seen in the previous
// run. The report is read daily, but a task needs to stay up long enough to act on,
// so a problem counts as new for a week after Amazon reported it. The "per shipment"
// cooldown (TaskCooldowns) keeps a closed problem from coming back.
const INBOUND_NEW_ISSUE_DAYS = 7;

/**
 * Returns `doc` when it is recent enough to present as current, else null.
 * An undatable document is treated as stale rather than trusted.
 *
 * @param {Object|null} doc - lean document with `createdAt`
 * @param {string} label - report name for the log line
 * @param {Object} [context] - extra log fields (user/country/region)
 * @param {Date} [now]
 * @param {number} [maxAgeDays]
 */
function freshInventoryReportOrNull(doc, label, context = {}, now = new Date(), maxAgeDays = INVENTORY_REPORT_MAX_AGE_DAYS) {
    if (!doc) return null;

    const createdAt = toTime(doc.createdAt);
    const ageDays = Number.isFinite(createdAt) ? (toTime(now) - createdAt) / DAY_MS : NaN;
    if (Number.isFinite(ageDays) && ageDays <= maxAgeDays) return doc;

    // Loud on purpose: dropping the document looks identical to "no inventory
    // problems", so a silent skip would hide a sync that has stopped writing.
    logger.warn(`${label} report ignored: newest document is too old to present as current`, {
        ...context,
        createdAt: doc.createdAt || null,
        ageDays: Number.isFinite(ageDays) ? Math.round(ageDays * 10) / 10 : null,
        maxAgeDays
    });
    return null;
}

/**
 * Keeps inbound non-compliance issues reported within the window, using the
 * same UTC-day bounds as the writer. Undatable issues are dropped.
 *
 * @param {Array} errorData - ErrorData rows ({issueReportedDate, ...})
 * @param {Date} [now]
 * @param {number} [windowDays]
 */
function filterInboundIssuesToWindow(errorData, now = new Date(), windowDays = INBOUND_ISSUE_WINDOW_DAYS) {
    if (!Array.isArray(errorData)) return [];

    const today = new Date(toTime(now));
    today.setUTCHours(0, 0, 0, 0);
    const windowStart = today.getTime() - windowDays * DAY_MS;

    return errorData.filter(item => {
        const reported = toTime(item && item.issueReportedDate);
        if (!Number.isFinite(reported)) return false;
        const day = new Date(reported);
        day.setUTCHours(0, 0, 0, 0);
        return day.getTime() >= windowStart && day.getTime() <= today.getTime();
    });
}

module.exports = {
    freshInventoryReportOrNull,
    filterInboundIssuesToWindow,
    INVENTORY_REPORT_MAX_AGE_DAYS,
    INBOUND_ISSUE_WINDOW_DAYS,
    INBOUND_NEW_ISSUE_DAYS
};

/**
 * Helpers for resolving the (startDate, endDate) window passed to Amazon Ads
 * report APIs (Sponsored Products keyword/search-term/advertised-product reports).
 *
 * - If a caller (e.g. a test controller) provides explicit dates we validate
 *   and pass those through to Amazon unchanged.
 * - Otherwise we fall back to the standard "yesterday - 30 days … yesterday"
 *   Pacific-time window that the production ingest paths have always used.
 *
 * Date strings are always YYYY-MM-DD (Amazon Ads expects this format).
 */

const { toYyyyMmDd } = require("./metricDateKey.js");

const DEFAULT_LOOKBACK_DAYS = 30;
const PACIFIC_OFFSET_MS = 7 * 60 * 60 * 1000;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Compute the production default window (Pacific yesterday-30 … Pacific yesterday). */
function getDefaultReportDateRange(lookbackDays = DEFAULT_LOOKBACK_DAYS) {
    const now = new Date();
    const nowPacific = new Date(now.getTime() - PACIFIC_OFFSET_MS);
    const endDateObj = new Date(
        Date.UTC(
            nowPacific.getUTCFullYear(),
            nowPacific.getUTCMonth(),
            nowPacific.getUTCDate() - 1
        )
    );
    const startDateObj = new Date(
        Date.UTC(
            nowPacific.getUTCFullYear(),
            nowPacific.getUTCMonth(),
            nowPacific.getUTCDate() - lookbackDays
        )
    );
    return {
        startDate: startDateObj.toISOString().split("T")[0],
        endDate: endDateObj.toISOString().split("T")[0],
    };
}

/**
 * Resolve a (startDate, endDate) window for an Ads report.
 *
 * @param {Object} [options]
 * @param {string} [options.startDate] YYYY-MM-DD
 * @param {string} [options.endDate]   YYYY-MM-DD
 * @param {number} [options.lookbackDays=30] Only used when both dates omitted.
 *
 * Behaviour:
 * - If BOTH dates are omitted → returns the default Pacific window.
 * - If ONLY ONE is provided → throws (force the caller to be explicit).
 * - If BOTH are provided → validated, normalised, returned as-is.
 */
function resolveReportDateRange(options = {}) {
    const { startDate, endDate, lookbackDays = DEFAULT_LOOKBACK_DAYS } = options || {};

    const hasStart = startDate != null && String(startDate).trim() !== "";
    const hasEnd = endDate != null && String(endDate).trim() !== "";

    if (!hasStart && !hasEnd) {
        const { startDate: s, endDate: e } = getDefaultReportDateRange(lookbackDays);
        return { startDate: s, endDate: e, isCustom: false };
    }

    if (hasStart !== hasEnd) {
        throw new Error(
            "Both startDate and endDate must be provided together (YYYY-MM-DD), or both omitted."
        );
    }

    const normStart = toYyyyMmDd(startDate);
    const normEnd = toYyyyMmDd(endDate);

    if (!normStart || !ISO_DATE_REGEX.test(normStart)) {
        throw new Error(`Invalid startDate: ${startDate}. Expected YYYY-MM-DD.`);
    }
    if (!normEnd || !ISO_DATE_REGEX.test(normEnd)) {
        throw new Error(`Invalid endDate: ${endDate}. Expected YYYY-MM-DD.`);
    }
    if (normStart > normEnd) {
        throw new Error(
            `startDate (${normStart}) must be on or before endDate (${normEnd}).`
        );
    }

    return { startDate: normStart, endDate: normEnd, isCustom: true };
}

module.exports = {
    DEFAULT_LOOKBACK_DAYS,
    getDefaultReportDateRange,
    resolveReportDateRange,
};

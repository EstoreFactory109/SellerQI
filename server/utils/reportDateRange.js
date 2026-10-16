/**
 * Helpers for resolving the (startDate, endDate) window passed to Amazon Ads
 * report APIs (Sponsored Products keyword/search-term/advertised-product reports).
 *
 * - If a caller (e.g. a test controller) provides explicit dates we validate
 *   and pass those through to Amazon unchanged.
 * - Otherwise we fall back to the standard 30-day window ending on the
 *   marketplace's yesterday (Pacific for NA) that the production ingest paths use.
 *
 * Date strings are always YYYY-MM-DD (Amazon Ads expects this format).
 */

const { toYyyyMmDd } = require("./metricDateKey.js");
const { marketplaceYesterdayStr, addDaysToDateStr } = require("./marketplaceTimezone.js");

const DEFAULT_LOOKBACK_DAYS = 30;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compute the production default window: `lookbackDays` days ending on the marketplace's
 * yesterday (yesterday-(lookbackDays-1) … yesterday, both inclusive).
 *
 * `country` picks the marketplace timezone (utils/marketplaceTimezone.js — DST-aware). It
 * defaults to US, i.e. America/Los_Angeles: the same Pacific day the old fixed UTC-7 offset
 * produced in summer, but now also correct in winter (PST, UTC-8).
 */
function getDefaultReportDateRange(lookbackDays = DEFAULT_LOOKBACK_DAYS, country = "US", now = new Date()) {
    const endDate = marketplaceYesterdayStr(country || "US", now);
    return {
        startDate: addDaysToDateStr(endDate, -(lookbackDays - 1)),
        endDate,
    };
}

/**
 * Resolve a (startDate, endDate) window for an Ads report.
 *
 * @param {Object} [options]
 * @param {string} [options.startDate] YYYY-MM-DD
 * @param {string} [options.endDate]   YYYY-MM-DD
 * @param {number} [options.lookbackDays=30] Only used when both dates omitted.
 * @param {string} [options.country]   Marketplace country for the default window (defaults to US).
 *
 * Behaviour:
 * - If BOTH dates are omitted → returns the default marketplace-local window.
 * - If ONLY ONE is provided → throws (force the caller to be explicit).
 * - If BOTH are provided → validated, normalised, returned as-is.
 */
function resolveReportDateRange(options = {}) {
    const { startDate, endDate, lookbackDays = DEFAULT_LOOKBACK_DAYS, country } = options || {};

    const hasStart = startDate != null && String(startDate).trim() !== "";
    const hasEnd = endDate != null && String(endDate).trim() !== "";

    if (!hasStart && !hasEnd) {
        const { startDate: s, endDate: e } = getDefaultReportDateRange(lookbackDays, country);
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

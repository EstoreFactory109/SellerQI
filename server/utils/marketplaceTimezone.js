/**
 * Marketplace-local calendar-day helpers.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The finance sync used to bucket every account's orders into days using a single
 * hardcoded `PACIFIC_OFFSET_HOURS = 7`, i.e. it assumed every seller in the world
 * sells in US Pacific Daylight Time. That is wrong twice over:
 *
 *   1. Non-Pacific marketplaces are shifted by the whole timezone gap. An AU seller
 *      (UTC+10 in July) had their "2026-07-12" bucket actually span 17:00 AEST
 *      Jul 12 → 16:59 AEST Jul 13 — a 17-hour skew, which under-reported daily
 *      sales against Seller Central (the bug this module was written to fix).
 *   2. Even for the US it is wrong for ~5 months a year: `7` is PDT. Pacific is
 *      UTC-8 (PST) in winter, so every US account's winter days were off by an hour.
 *
 * Seller Central reports a day in the MARKETPLACE's own local calendar day, so that
 * is what we must reproduce. Amazon's Ads reports and Data Kiosk
 * `salesAndTraffic` already bucket server-side in marketplace-local time, so using
 * marketplace-local here also brings finance into alignment with those pipelines
 * rather than away from them.
 *
 * ── WHY NO LIBRARY ──────────────────────────────────────────────────────────
 * `Intl.DateTimeFormat` ships full IANA tz + DST rules in Node, so no
 * moment-timezone/luxon/date-fns-tz dependency is needed. Crucially we store IANA
 * ZONE NAMES, never fixed numeric offsets — a fixed number is exactly the bug above.
 */

const logger = require('./Logger.js');

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fallback for an unrecognised country code.
 *
 * Deliberately Pacific: it is what the code did for everyone before this module
 * existed, so an unknown country degrades to the previous behaviour rather than
 * throwing inside the money path or silently producing UTC days.
 */
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Country → IANA timezone for every marketplace the app supports.
 *
 * Sourced from the authoritative `marketplaceConfig` in
 * server/controllers/config/config.js (mirrored in server/Services/MCP/constants.js
 * and the AmazonConnectPopup country picker) — all 23 codes, NOT from
 * FinanceService's COUNTRY_TO_SALES_CHANNEL, which is missing IE and ZA.
 *
 * Note `UK` (not `GB`) is the canonical code in this codebase; `GB` is accepted as
 * an alias because COUNTRY_TO_SALES_CHANNEL carries one.
 *
 * Amazon reports the NA marketplaces in Pacific time, which is why the old
 * hardcoded offset appeared to work — US/CA/MX therefore map to Los_Angeles rather
 * than to their own civil timezones. BR is its own marketplace with its own zone.
 */
const COUNTRY_TO_TIMEZONE = {
  // ── North America (NA) — Amazon reports these in Pacific ──
  US: 'America/Los_Angeles',
  CA: 'America/Los_Angeles',
  MX: 'America/Los_Angeles',
  BR: 'America/Sao_Paulo',

  // ── Europe / Middle East / India / Africa (EU) ──
  IE: 'Europe/Dublin',
  ES: 'Europe/Madrid',
  UK: 'Europe/London',
  GB: 'Europe/London', // alias; `UK` is canonical here
  FR: 'Europe/Paris',
  BE: 'Europe/Brussels',
  NL: 'Europe/Amsterdam',
  DE: 'Europe/Berlin',
  IT: 'Europe/Rome',
  SE: 'Europe/Stockholm',
  ZA: 'Africa/Johannesburg',
  PL: 'Europe/Warsaw',
  EG: 'Africa/Cairo',
  TR: 'Europe/Istanbul',
  SA: 'Asia/Riyadh',
  AE: 'Asia/Dubai',
  IN: 'Asia/Kolkata',

  // ── Far East (FE) ──
  SG: 'Asia/Singapore',
  AU: 'Australia/Sydney',
  JP: 'Asia/Tokyo',
};

/** Countries we have already warned about, so the log isn't spammed per report row. */
const warnedUnknownCountries = new Set();

/**
 * Resolve a country code to its IANA timezone.
 * Unknown/missing codes fall back to Pacific and warn ONCE per code.
 */
function getMarketplaceTimezone(country) {
  if (!country) {
    if (!warnedUnknownCountries.has('<empty>')) {
      warnedUnknownCountries.add('<empty>');
      logger.warn(`[marketplaceTimezone] No country supplied; falling back to ${DEFAULT_TIMEZONE}. Day buckets may be wrong for non-Pacific marketplaces.`);
    }
    return DEFAULT_TIMEZONE;
  }
  const key = String(country).toUpperCase();
  const tz = COUNTRY_TO_TIMEZONE[key];
  if (!tz) {
    if (!warnedUnknownCountries.has(key)) {
      warnedUnknownCountries.add(key);
      logger.warn(`[marketplaceTimezone] Unknown country '${key}'; falling back to ${DEFAULT_TIMEZONE}. Add it to COUNTRY_TO_TIMEZONE.`);
    }
    return DEFAULT_TIMEZONE;
  }
  return tz;
}

// ── Formatter memoisation ────────────────────────────────────────────────────
// The sales report can be tens of thousands of rows and we convert once per row;
// constructing an Intl.DateTimeFormat each time is comparatively expensive.
const dateFormatterCache = new Map();
const partsFormatterCache = new Map();

function getDateFormatter(timeZone) {
  let f = dateFormatterCache.get(timeZone);
  if (!f) {
    // 'en-CA' yields YYYY-MM-DD directly.
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    dateFormatterCache.set(timeZone, f);
  }
  return f;
}

function getPartsFormatter(timeZone) {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

function toDateOrNull(dateInput) {
  if (dateInput === null || dateInput === undefined || dateInput === '') return null;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * A UTC instant → the marketplace's local calendar day as 'YYYY-MM-DD'.
 *
 * This is the direct replacement for the old `toPacificDateStr` and produces the
 * `date` key stored on DailySkuFinance / DailyOverheadFinance / FinanceSyncLog.
 *
 * @param {Date|string|number} dateInput
 * @param {string} country e.g. 'AU'
 * @returns {string|null} 'YYYY-MM-DD', or null if the input isn't a usable date
 */
function toMarketplaceDateStr(dateInput, country) {
  const d = toDateOrNull(dateInput);
  if (!d) return null;
  return getDateFormatter(getMarketplaceTimezone(country)).format(d);
}

/**
 * The offset (ms) that `timeZone` was at, at a given instant. Positive = east of UTC.
 * Derived from Intl rather than a table, so DST is handled by the tz database.
 */
function timezoneOffsetMsAt(date, timeZone) {
  const parts = getPartsFormatter(timeZone).formatToParts(date)
    .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  // Some ICU versions render midnight as hour '24'.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second)
  );
  return asIfUTC - date.getTime();
}

/**
 * A local wall-clock time in `timeZone` → the UTC instant it corresponds to.
 *
 * Two-pass: the first pass guesses the offset using the naive instant, the second
 * re-reads it at the corrected instant. That settles DST boundaries, where the
 * offset that applies depends on the very instant we're solving for.
 */
function zonedWallClockToInstant(dateStr, hour, minute, second, ms, timeZone) {
  const naive = Date.UTC(
    Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)),
    hour, minute, second, ms
  );
  let t = naive - timezoneOffsetMsAt(new Date(naive), timeZone);
  t = naive - timezoneOffsetMsAt(new Date(t), timeZone);
  return new Date(t);
}

/**
 * A marketplace-local calendar day → the UTC instants bounding it, as the ISO
 * strings Amazon's Reports API expects.
 *
 * MUST stay in lockstep with `toMarketplaceDateStr`: this decides which orders
 * Amazon returns, that decides which day we file them under. If the two disagree,
 * the fetched window won't cover the days we then bucket into.
 *
 * Verified to reproduce the OLD hardcoded window byte-for-byte for US in summer:
 *   ('2026-07-12','US') → 2026-07-12T07:00:00.000Z … 2026-07-13T06:59:59.999Z
 *
 * @param {string} startDate 'YYYY-MM-DD' (marketplace-local, inclusive)
 * @param {string} endDate   'YYYY-MM-DD' (marketplace-local, inclusive)
 * @param {string} country
 */
function marketplaceDayWindowISO(startDate, endDate, country) {
  if (!ISO_DATE_REGEX.test(startDate) || !ISO_DATE_REGEX.test(endDate)) {
    throw new Error(`[marketplaceTimezone] marketplaceDayWindowISO expects YYYY-MM-DD, got '${startDate}'/'${endDate}'`);
  }
  const timeZone = getMarketplaceTimezone(country);
  const start = zonedWallClockToInstant(startDate, 0, 0, 0, 0, timeZone);
  // End = local midnight of the day AFTER endDate, minus 1ms. Computing it this way
  // (rather than assuming 23:59:59.999 exists) is correct on DST-transition days,
  // where the local day can be 23 or 25 hours long.
  const dayAfterEnd = addDaysToDateStr(endDate, 1);
  const end = new Date(zonedWallClockToInstant(dayAfterEnd, 0, 0, 0, 0, timeZone).getTime() - 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/** Shift a 'YYYY-MM-DD' string by whole days. Pure calendar math, no timezone involved. */
function addDaysToDateStr(dateStr, days) {
  const t = Date.UTC(
    Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10))
  ) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * "Today" in the marketplace's local calendar. Replaces the various
 * `new Date(Date.now() - 7 * 3600000)` anchors.
 */
function marketplaceTodayStr(country, now = new Date()) {
  return toMarketplaceDateStr(now, country);
}

/**
 * "Yesterday" in the marketplace's local calendar — the newest day Amazon has
 * complete data for, and the end of every sync window.
 *
 * Anchored on the local calendar day rather than by subtracting 24h from `now`, so
 * it stays correct across DST transitions.
 */
function marketplaceYesterdayStr(country, now = new Date()) {
  const today = toMarketplaceDateStr(now, country);
  return today ? addDaysToDateStr(today, -1) : null;
}

module.exports = {
  COUNTRY_TO_TIMEZONE,
  DEFAULT_TIMEZONE,
  getMarketplaceTimezone,
  toMarketplaceDateStr,
  marketplaceDayWindowISO,
  marketplaceTodayStr,
  marketplaceYesterdayStr,
  addDaysToDateStr,
  timezoneOffsetMsAt,
};

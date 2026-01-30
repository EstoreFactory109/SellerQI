/**
 * SalesDropAlertService.js
 *
 * Detects sales velocity drops within a date range using datewise sales from the
 * Economics Metrics model (no API fetch).
 *
 * Date range: end date = yesterday, start date = 7 days before yesterday (8 days total).
 * Detection logic: day-over-day comparison of revenue (and units when available); a day is
 * flagged when either metric drops by at least the configured threshold (e.g. 40%) vs the previous day.
 * Economics datewiseSales has sales.amount only (no units), so units-based drop is skipped for that source.
 *
 * Call detectSalesDrop(userId, region, country, options) when needed.
 */

const { getLatestEconomicsMetrics } = require('../../MCP/EconomicsMetricsService.js');
const logger = require('../../../utils/Logger.js');

/** Default drop threshold (percent): flag a day when units or revenue drops by this much vs previous day */
const DEFAULT_UNITS_DROP_THRESHOLD_PCT = 40;
const DEFAULT_REVENUE_DROP_THRESHOLD_PCT = 40;

/**
 * Get start and end date for the alert window.
 * End date = yesterday (inclusive), start date = 7 days before yesterday (inclusive).
 * @returns {{ startDate: string, endDate: string }} YYYY-MM-DD
 */
function getDateRange() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const endDate = yesterday;
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 7);

  const pad = (n) => String(n).padStart(2, '0');
  return {
    startDate: `${startDate.getUTCFullYear()}-${pad(startDate.getUTCMonth() + 1)}-${pad(startDate.getUTCDate())}`,
    endDate: `${endDate.getUTCFullYear()}-${pad(endDate.getUTCMonth() + 1)}-${pad(endDate.getUTCDate())}`,
  };
}

/**
 * Detect days where sales velocity dropped significantly vs the previous day.
 * Uses the same logic as the MCP-based analysis:
 * - Sort daily data by date.
 * - For each day (from the second day onward), compare to the previous day:
 *   - Units ordered: dropPct = (previousUnits - currentUnits) / previousUnits * 100 (when previous > 0).
 *   - Revenue: dropPct = (previousRevenue - currentRevenue) / previousRevenue * 100 (when previous > 0).
 * - Flag a day when units drop >= unitsDropThresholdPct OR revenue drop >= revenueDropThresholdPct.
 *
 * @param {Array<{ date: string, sales: { amount: number, currencyCode: string }, unitsOrdered: number }>} datewiseSales - Sorted by date ascending
 * @param {Object} options
 * @param {number} [options.unitsDropThresholdPct] - Min drop in units (percent) to flag (default 40)
 * @param {number} [options.revenueDropThresholdPct] - Min drop in revenue (percent) to flag (default 40)
 * @returns {Array<{ date: string, previousDate: string, unitsOrderedDropPct: number|null, revenueDropPct: number|null, previousUnits: number, currentUnits: number, previousRevenue: number, currentRevenue: number, currencyCode: string }>}
 */
function detectSalesDrops(datewiseSales, options = {}) {
  const unitsThreshold = Number(options.unitsDropThresholdPct) || DEFAULT_UNITS_DROP_THRESHOLD_PCT;
  const revenueThreshold = Number(options.revenueDropThresholdPct) || DEFAULT_REVENUE_DROP_THRESHOLD_PCT;

  if (!Array.isArray(datewiseSales) || datewiseSales.length < 2) {
    return [];
  }

  const sorted = [...datewiseSales].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const drops = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const prevDate = prev.date;
    const currDate = curr.date;
    const prevUnits = Number(prev.unitsOrdered) || 0;
    const currUnits = Number(curr.unitsOrdered) || 0;
    const prevRevenue = Number(prev.sales?.amount) || 0;
    const currRevenue = Number(curr.sales?.amount) || 0;
    const currencyCode = curr.sales?.currencyCode || prev.sales?.currencyCode || 'USD';

    let unitsDropPct = null;
    if (prevUnits > 0) {
      unitsDropPct = ((prevUnits - currUnits) / prevUnits) * 100;
    }

    let revenueDropPct = null;
    if (prevRevenue > 0) {
      revenueDropPct = ((prevRevenue - currRevenue) / prevRevenue) * 100;
    }

    const unitsFlag = unitsDropPct !== null && unitsDropPct >= unitsThreshold;
    const revenueFlag = revenueDropPct !== null && revenueDropPct >= revenueThreshold;

    if (unitsFlag || revenueFlag) {
      drops.push({
        date: currDate,
        previousDate: prevDate,
        unitsOrderedDropPct: unitsDropPct,
        revenueDropPct: revenueDropPct,
        previousUnits: prevUnits,
        currentUnits: currUnits,
        previousRevenue: prevRevenue,
        currentRevenue: currRevenue,
        currencyCode,
        flaggedByUnits: unitsFlag,
        flaggedByRevenue: revenueFlag,
      });
    }
  }

  return drops;
}

/**
 * Get datewise sales for the last 7 days from Economics Metrics (filtered by date range).
 * Economics datewiseSales has { date, sales: { amount, currencyCode }, grossProfit }; no unitsOrdered.
 * Maps to shape expected by detectSalesDrops: { date, sales, unitsOrdered } (unitsOrdered = 0 so only revenue drop is used).
 *
 * @param {Object} metrics - Latest economics metrics from getLatestEconomicsMetrics
 * @param {string} startDate - YYYY-MM-DD inclusive
 * @param {string} endDate - YYYY-MM-DD inclusive
 * @returns {Array<{ date: string, sales: { amount: number, currencyCode: string }, unitsOrdered: number }>}
 */
function getDatewiseSalesForRange(metrics, startDate, endDate) {
  const raw = metrics?.datewiseSales || [];
  return raw
    .filter((row) => {
      const d = row.date || '';
      return d >= startDate && d <= endDate;
    })
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map((row) => ({
      date: row.date,
      sales: row.sales ? { amount: Number(row.sales.amount) || 0, currencyCode: row.sales.currencyCode || 'USD' } : { amount: 0, currencyCode: 'USD' },
      unitsOrdered: 0, // Economics datewiseSales does not store daily units; only revenue drop is evaluated
    }));
}

/**
 * Main entry: load datewise sales from Economics Metrics for the user, filter to last 7 days
 * (7 days before yesterday through yesterday), then run sales drop detection.
 *
 * @param {string|ObjectId} userId - User ID
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Marketplace/country code (US, CA, UK, AU, etc.)
 * @param {Object} [options]
 * @param {string} [options.startDate] - Override start date YYYY-MM-DD (default: 7 days before yesterday)
 * @param {string} [options.endDate] - Override end date YYYY-MM-DD (default: yesterday)
 * @param {number} [options.unitsDropThresholdPct] - Units drop threshold percent (default 40)
 * @param {number} [options.revenueDropThresholdPct] - Revenue drop threshold percent (default 40)
 * @returns {Promise<{ detected: boolean, drops: Array<Object>, dateRange: { startDate: string, endDate: string }, marketplace: string, datewiseSales?: Array<Object>, error?: string }>}
 */
async function detectSalesDrop(userId, region, country, options = {}) {
  const { startDate: overrideStart, endDate: overrideEnd, ...detectOptions } = options || {};
  const dateRange = overrideStart && overrideEnd
    ? { startDate: overrideStart, endDate: overrideEnd }
    : getDateRange();

  try {
    if (!userId) {
      logger.warn('[SalesDropAlertService] No userId provided', { region, country });
      return {
        detected: false,
        drops: [],
        dateRange,
        marketplace: country,
        error: 'User ID is required',
      };
    }

    logger.info('[SalesDropAlertService] Loading datewise sales from Economics Metrics for drop detection', {
      userId: userId?.toString?.() || userId,
      region,
      country,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });

    const metrics = await getLatestEconomicsMetrics(userId, region, country);
    if (!metrics) {
      logger.warn('[SalesDropAlertService] No economics metrics found for user', { userId: userId?.toString?.() || userId, region, country });
      return {
        detected: false,
        drops: [],
        dateRange,
        marketplace: country,
        error: 'No economics metrics found for this user/region/country. Run economics sync first.',
      };
    }

    const datewiseSales = getDatewiseSalesForRange(metrics, dateRange.startDate, dateRange.endDate);
    if (datewiseSales.length < 2) {
      logger.info('[SalesDropAlertService] Insufficient daily data for drop detection', {
        region,
        country,
        daysReturned: datewiseSales.length,
      });
      return {
        detected: false,
        drops: [],
        dateRange,
        marketplace: country,
        datewiseSales,
      };
    }

    const drops = detectSalesDrops(datewiseSales, detectOptions);

    if (drops.length > 0) {
      logger.info('[SalesDropAlertService] Sales drop(s) detected', {
        region,
        country,
        dropCount: drops.length,
        dates: drops.map((d) => d.date),
      });
    }

    return {
      detected: drops.length > 0,
      drops,
      dateRange,
      marketplace: country,
      datewiseSales,
    };
  } catch (error) {
    logger.error('[SalesDropAlertService] Error in detectSalesDrop', {
      region,
      country,
      error: error?.message,
    });
    return {
      detected: false,
      drops: [],
      dateRange,
      marketplace: country,
      error: error?.message || 'Unknown error',
    };
  }
}

module.exports = {
  detectSalesDrop,
  detectSalesDrops,
  getDateRange,
  getDatewiseSalesForRange,
  DEFAULT_UNITS_DROP_THRESHOLD_PCT,
  DEFAULT_REVENUE_DROP_THRESHOLD_PCT,
};

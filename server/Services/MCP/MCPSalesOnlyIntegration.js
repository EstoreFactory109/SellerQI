/**
 * MCPSalesOnlyIntegration.js
 *
 * Fetches only Sales+Traffic data (DAY granularity) from Amazon Data Kiosk (MCP)
 * and stores sales-only metrics into `SalesOnlyMetrics`.
 *
 * The goal is to keep "date-wise sales totals" and "total sales" without
 * the heavy economics parts (fees, refunds, gross profit, ASIN-wise breakdown).
 */

const { fetchSalesAndTrafficByDate } = require('./MCPSalesAndTrafficIntegration.js');
const { REGION_VALID_MARKETPLACES } = require('./constants.js');
const logger = require('../../utils/Logger.js');

const {
  saveSalesOnlyMetrics,
} = require('./SalesOnlyMetricsService.js');

const MAX_DAYS_PER_QUERY = 30;

/** Format a Date to YYYY-MM-DD using local timezone (not UTC). */
function toLocalDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Format a Date to YYYY-MM-DD in UTC. */
function toUtcDateString(d) {
  return d.toISOString().split('T')[0];
}

/** Parse YYYY-MM-DD as UTC day-start. */
function parseUtcDate(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Build inclusive query chunks of at most maxDays per chunk. */
function buildDateChunks(startDateStr, endDateStr, maxDays = MAX_DAYS_PER_QUERY) {
  const chunks = [];
  let cursor = parseUtcDate(startDateStr);
  const end = parseUtcDate(endDateStr);

  while (cursor <= end) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + (maxDays - 1));
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    chunks.push({
      startDate: toUtcDateString(chunkStart),
      endDate: toUtcDateString(chunkEnd),
    });

    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return chunks;
}

/** Merge datewise rows by date and return sorted list. */
function mergeDatewiseSalesRows(rows) {
  const byDate = new Map();
  for (const row of rows || []) {
    if (!row?.date) continue;
    byDate.set(row.date, row);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Sum totalSales from datewise rows for consistency. */
function sumTotalSalesFromDatewise(datewiseSales = [], defaultCurrency = 'USD') {
  let amount = 0;
  let currencyCode = defaultCurrency;

  for (const row of datewiseSales) {
    amount += row?.sales?.amount || 0;
    if (row?.sales?.currencyCode) currencyCode = row.sales.currencyCode;
  }

  return {
    amount: parseFloat(amount.toFixed(2)),
    currencyCode,
  };
}

/** Return missing YYYY-MM-DD dates from inclusive range compared to rows. */
function getMissingDates(startDateStr, endDateStr, datewiseSales = []) {
  const available = new Set((datewiseSales || []).map((d) => d?.date).filter(Boolean));
  const missing = [];
  const cursor = parseUtcDate(startDateStr);
  const end = parseUtcDate(endDateStr);

  while (cursor <= end) {
    const day = toUtcDateString(cursor);
    if (!available.has(day)) missing.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return missing;
}

/**
 * Fetch complete datewise sales with chunking + missing-day backfill.
 * Keeps output shape compatible with existing flow.
 */
async function fetchCompleteSalesAndTrafficByDateRange(refreshToken, region, country, startDateStr, endDateStr) {
  const chunks = buildDateChunks(startDateStr, endDateStr, MAX_DAYS_PER_QUERY);
  const allRows = [];
  let fallbackCurrency = 'USD';

  for (const chunk of chunks) {
    const chunkResult = await fetchSalesAndTrafficByDate(
      refreshToken,
      region,
      country,
      chunk.startDate,
      chunk.endDate
    );

    if (!chunkResult?.success || !chunkResult?.data) {
      return {
        success: false,
        error: chunkResult?.error || 'MCP SalesOnly chunk fetch failed',
        data: null,
      };
    }

    if (chunkResult.data.totalSales?.currencyCode) {
      fallbackCurrency = chunkResult.data.totalSales.currencyCode;
    }
    allRows.push(...(chunkResult.data.datewiseSales || []));
  }

  let mergedRows = mergeDatewiseSalesRows(allRows);
  let missingDates = getMissingDates(startDateStr, endDateStr, mergedRows);

  // Backfill each missing day with a one-day query.
  for (const missingDate of missingDates) {
    const singleDayResult = await fetchSalesAndTrafficByDate(
      refreshToken,
      region,
      country,
      missingDate,
      missingDate
    );

    if (singleDayResult?.success && singleDayResult?.data?.datewiseSales?.length) {
      mergedRows = mergeDatewiseSalesRows([
        ...mergedRows,
        ...singleDayResult.data.datewiseSales,
      ]);
      if (singleDayResult.data.totalSales?.currencyCode) {
        fallbackCurrency = singleDayResult.data.totalSales.currencyCode;
      }
    }
  }

  // Re-check after backfill attempts (non-fatal, but logged for visibility).
  missingDates = getMissingDates(startDateStr, endDateStr, mergedRows);
  if (missingDates.length > 0) {
    logger.warn('[MCP SalesOnly] Still missing datewise rows after backfill', {
      region,
      country,
      startDate: startDateStr,
      endDate: endDateStr,
      missingDates,
    });
  }

  const totalSales = sumTotalSalesFromDatewise(mergedRows, fallbackCurrency);
  return {
    success: true,
    data: {
      totalSales,
      datewiseSales: mergedRows,
    },
    error: null,
  };
}

/**
 * Default sales-only window: yesterday minus 30 days through yesterday (local time).
 * Uses local timezone so that "yesterday" is always the calendar day before today
 * regardless of when the job runs (fixes off-by-one when running before 5:30 AM IST).
 */
function getDefaultSalesOnlyDateRangeUtc() {
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1 - 30);
  return {
    startDateStr: toLocalDateString(startDate),
    endDateStr: toLocalDateString(endDate),
  };
}

async function fetchAndStoreSalesOnlyData(userId, refreshToken, region, country) {
  logger.info('[MCP SalesOnly] Starting sales-only fetch', {
    userId,
    region,
    country,
    hasRefreshToken: !!refreshToken,
  });

  try {
    if (!refreshToken) {
      const errorMsg = 'Refresh token not available';
      logger.error('[MCP SalesOnly] No refresh token provided', { userId, region, country });
      return { success: false, error: errorMsg, data: null };
    }

    const validMarketplaces = REGION_VALID_MARKETPLACES[region] || [];
    if (!validMarketplaces.includes(country)) {
      const errorMsg = `Invalid country ${country} for region ${region}. Valid: ${validMarketplaces.join(', ')}`;
      logger.warn('[MCP SalesOnly] ' + errorMsg);
      return { success: false, error: errorMsg, data: null };
    }

    const { startDateStr, endDateStr } = getDefaultSalesOnlyDateRangeUtc();

    const salesResult = await fetchCompleteSalesAndTrafficByDateRange(
      refreshToken,
      region,
      country,
      startDateStr,
      endDateStr
    );

    if (!salesResult?.success || !salesResult.data) {
      return {
        success: false,
        error: salesResult?.error || 'MCP SalesOnly fetch failed',
        data: null,
      };
    }

    const { totalSales, datewiseSales } = salesResult.data;
    const currencyCode = totalSales?.currencyCode || datewiseSales?.[0]?.sales?.currencyCode || 'USD';

    const mappedDatewiseSales = (datewiseSales || []).map((d) => ({
      date: d.date,
      sales: d.sales || { amount: 0, currencyCode },
      grossProfit: { amount: 0, currencyCode: d.sales?.currencyCode || currencyCode },
      unitsSold: 0,
    }));

    const saved = await saveSalesOnlyMetrics({
      userId,
      region,
      country,
      datewiseSales: mappedDatewiseSales,
    });

    logger.info('[MCP SalesOnly] Saved sales-only metrics', {
      userId,
      region,
      country,
      startDate: startDateStr,
      endDate: endDateStr,
    });

    return { success: true, data: saved, error: null, message: 'Sales-only data fetched and stored successfully' };
  } catch (error) {
    logger.error('[MCP SalesOnly] Error fetching/storing sales-only metrics', {
      userId,
      region,
      country,
      error: error?.message,
      stack: error?.stack,
    });

    return { success: false, error: error?.message || 'Unknown error', data: null };
  }
}

module.exports = {
  fetchAndStoreSalesOnlyData,
  getDefaultSalesOnlyDateRangeUtc,
};


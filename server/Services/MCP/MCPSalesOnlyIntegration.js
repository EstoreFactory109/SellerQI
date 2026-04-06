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

function toISODateString(d) {
  return d.toISOString().split('T')[0];
}

/**
 * Default sales-only window (UTC): yesterday minus 30 days through yesterday.
 * Matches Expences.js / scheduled calendar range used for MCP Sales+Traffic DAY data.
 */
function getDefaultSalesOnlyDateRangeUtc() {
  const now = new Date();
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1 - 30));
  return {
    startDateStr: toISODateString(startDate),
    endDateStr: toISODateString(endDate),
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

    const salesResult = await fetchSalesAndTrafficByDate(
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

    // Compute last7Days + last14Days based on the query endDate (yesterday)
    const end = new Date(`${endDateStr}T00:00:00.000Z`);

    const last7Start = new Date(end);
    last7Start.setDate(last7Start.getDate() - 6);
    const last7StartStr = toISODateString(last7Start);

    const last14Start = new Date(end);
    last14Start.setDate(last14Start.getDate() - 13);
    const last14StartStr = toISODateString(last14Start);

    const currencyCode = totalSales?.currencyCode || datewiseSales?.[0]?.sales?.currencyCode || 'USD';

    const last7Items = (datewiseSales || []).filter((d) => d.date >= last7StartStr && d.date <= endDateStr);
    const last14Items = (datewiseSales || []).filter((d) => d.date >= last14StartStr && d.date <= endDateStr);

    const last7Total = last7Items.reduce((sum, item) => sum + (item.sales?.amount || 0), 0);
    const last14Total = last14Items.reduce((sum, item) => sum + (item.sales?.amount || 0), 0);

    const last7Days = {
      totalSales: {
        amount: parseFloat(last7Total.toFixed(2)),
        currencyCode,
      },
      startDate: last7StartStr,
      endDate: endDateStr,
    };

    const last14Days = {
      totalSales: {
        amount: parseFloat(last14Total.toFixed(2)),
        currencyCode,
      },
      startDate: last14StartStr,
      endDate: endDateStr,
    };

    // Persist: `SalesOnlyMetrics` expects grossProfit to exist (we store 0 always)
    const mappedDatewiseSales = (datewiseSales || []).map((d) => ({
      date: d.date,
      sales: d.sales,
      grossProfit: { amount: 0, currencyCode: d.sales?.currencyCode || currencyCode },
      unitsSold: 0,
    }));

    const saved = await saveSalesOnlyMetrics({
      userId,
      region,
      country,
      dateRange: { startDate: startDateStr, endDate: endDateStr },
      totalSales: {
        amount: parseFloat((totalSales?.amount || 0).toFixed(2)),
        currencyCode,
      },
      datewiseSales: mappedDatewiseSales,
      last7Days,
      last14Days,
      queryId: null,
      documentId: null,
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


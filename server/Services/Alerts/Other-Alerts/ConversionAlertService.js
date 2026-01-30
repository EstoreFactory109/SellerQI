/**
 * ConversionAlertService.js
 *
 * Fetches conversion rates (and sessions) for the last 7 days using Sales and Traffic by Date
 * from the Amazon Data Kiosk API. Conversion rate = unitSessionPercentage (units ordered / sessions).
 *
 * Date range: end date = yesterday, start date = 7 days before yesterday (8 days total).
 * Data source: Sales and Traffic API (requires refreshToken).
 *
 * Call getConversionRates(refreshToken, region, country, options) when needed.
 */

const { fetchSalesAndTrafficByDate } = require('../../MCP/MCPSalesAndTrafficIntegration.js');
const { getDateRange } = require('./SalesDropAlertService.js');
const logger = require('../../../utils/Logger.js');

/**
 * Get start and end date for the conversion window.
 * End date = yesterday (inclusive), start date = 7 days before yesterday (inclusive).
 * @returns {{ startDate: string, endDate: string }} YYYY-MM-DD
 */
function getConversionDateRange() {
  return getDateRange();
}

/**
 * Get conversion rates for the last 7 days (7 days before yesterday through yesterday).
 * Fetches Sales and Traffic by Date and returns daily sessions and unitSessionPercentage (conversion rate).
 *
 * @param {string} refreshToken - SP-API refresh token (e.g. from Seller.spiRefreshToken)
 * @param {string} region - Region (NA, EU, FE)
 * @param {string} country - Marketplace/country code (US, CA, UK, AU, etc.)
 * @param {Object} [options]
 * @param {string} [options.startDate] - Override start date YYYY-MM-DD
 * @param {string} [options.endDate] - Override end date YYYY-MM-DD
 * @returns {Promise<{ success: boolean, dateRange: { startDate: string, endDate: string }, marketplace: string, conversionRates: Array<{ date: string, sessions: number, conversionRate: number, pageViews?: number, unitsOrdered?: number }>, error?: string }>}
 */
async function getConversionRates(refreshToken, region, country, options = {}) {
  const { startDate: overrideStart, endDate: overrideEnd } = options || {};
  const dateRange = overrideStart && overrideEnd
    ? { startDate: overrideStart, endDate: overrideEnd }
    : getConversionDateRange();

  try {
    if (!refreshToken) {
      logger.warn('[ConversionAlertService] No refresh token provided', { region, country });
      return {
        success: false,
        dateRange,
        marketplace: country,
        conversionRates: [],
        error: 'Refresh token not available',
      };
    }

    logger.info('[ConversionAlertService] Fetching conversion rates (Sales and Traffic)', {
      region,
      country,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });

    const result = await fetchSalesAndTrafficByDate(
      refreshToken,
      region,
      country,
      dateRange.startDate,
      dateRange.endDate
    );

    if (!result.success || !result.data) {
      logger.warn('[ConversionAlertService] Sales and Traffic fetch failed or no data', {
        region,
        country,
        error: result.error,
      });
      return {
        success: false,
        dateRange,
        marketplace: country,
        conversionRates: [],
        error: result.error || 'Sales and Traffic fetch failed',
      };
    }

    const datewiseSales = result.data.datewiseSales || [];
    const conversionRates = datewiseSales
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map((row) => ({
        date: row.date,
        sessions: Number(row.sessions) || 0,
        conversionRate: Number(row.unitSessionPercentage) || 0,
        pageViews: row.pageViews != null ? Number(row.pageViews) : undefined,
        unitsOrdered: row.unitsOrdered != null ? Number(row.unitsOrdered) : undefined,
      }));

    logger.info('[ConversionAlertService] Conversion rates fetched', {
      region,
      country,
      daysReturned: conversionRates.length,
    });

    return {
      success: true,
      dateRange,
      marketplace: country,
      conversionRates,
    };
  } catch (error) {
    logger.error('[ConversionAlertService] Error in getConversionRates', {
      region,
      country,
      error: error?.message,
    });
    return {
      success: false,
      dateRange,
      marketplace: country,
      conversionRates: [],
      error: error?.message || 'Unknown error',
    };
  }
}

module.exports = {
  getConversionRates,
  getConversionDateRange,
};

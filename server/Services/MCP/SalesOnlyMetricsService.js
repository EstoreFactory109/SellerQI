const mongoose = require('mongoose');

const SalesOnlyMetrics = require('../../models/MCP/SalesOnlyMetricsModel.js');
const logger = require('../../utils/Logger.js');

function toObjectId(userId) {
  return typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
}

function validateDateRange(startDate, endDate) {
  if (!startDate || !endDate) return 'Both startDate and endDate are required (YYYY-MM-DD).';
  const fromDate = new Date(`${startDate}T00:00:00.000Z`);
  const toDate = new Date(`${endDate}T23:59:59.999Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 'Invalid date format. Use YYYY-MM-DD.';
  if (fromDate > toDate) return 'from must be less than or equal to to.';
  return null;
}

/**
 * Save per-day sales metrics using bulkWrite for efficiency.
 * Each item in datewiseSales becomes a separate document.
 *
 * @param {Object} params
 * @param {string|ObjectId} params.userId
 * @param {string} params.region - NA, EU, FE
 * @param {string} params.country - US, UK, DE, etc.
 * @param {Array} params.datewiseSales - Array of { date, sales, grossProfit?, unitsSold? }
 * @returns {Object} - { upsertedCount, modifiedCount }
 */
async function saveSalesOnlyMetrics({ userId, region, country, datewiseSales }) {
  if (!datewiseSales || datewiseSales.length === 0) {
    logger.warn('[SalesOnlyMetricsService] saveSalesOnlyMetrics called with empty datewiseSales');
    return { upsertedCount: 0, modifiedCount: 0 };
  }

  const userObjectId = toObjectId(userId);

  const operations = datewiseSales.map((day) => ({
    updateOne: {
      filter: {
        User: userObjectId,
        region,
        country,
        date: day.date,
      },
      update: {
        $set: {
          User: userObjectId,
          region,
          country,
          date: day.date,
          sales: day.sales || { amount: 0, currencyCode: 'USD' },
          grossProfit: day.grossProfit || { amount: 0, currencyCode: 'USD' },
          unitsSold: day.unitsSold || 0,
          dataSource: 'DataKiosk',
        },
      },
      upsert: true,
    },
  }));

  const result = await SalesOnlyMetrics.bulkWrite(operations, { ordered: false });

  logger.info(
    `[SalesOnlyMetricsService] Saved ${datewiseSales.length} per-day docs for user ${userId}, ${region}/${country}: ` +
      `upserted=${result.upsertedCount}, modified=${result.modifiedCount}`
  );

  return {
    upsertedCount: result.upsertedCount || 0,
    modifiedCount: result.modifiedCount || 0,
  };
}

/**
 * Get aggregated sales metrics for recent 30 days.
 * Returns data in backward-compatible format with totalSales and datewiseSales.
 */
async function getLatestSalesOnlyMetrics(userId, region, country) {
  const userObjectId = toObjectId(userId);
  return SalesOnlyMetrics.getRecentDays(userObjectId, region, country, 31);
}

/**
 * Get sales data for a specific date range using aggregation.
 * Returns { totalSales, datewiseSales, dateRange }
 */
async function getSalesForDateRange(userId, region, country, startDate, endDate) {
  const dateRangeError = validateDateRange(startDate, endDate);
  if (dateRangeError) throw new Error(dateRangeError);

  const userObjectId = toObjectId(userId);
  return SalesOnlyMetrics.getSalesForDateRange(userObjectId, region, country, startDate, endDate);
}

/**
 * Legacy function - now uses per-day document aggregation.
 * Returns aggregated data for the date range.
 */
async function getSalesOnlyMetricsByDateRange(userId, region, country, startDate, endDate) {
  const dateRangeError = validateDateRange(startDate, endDate);
  if (dateRangeError) throw new Error(dateRangeError);

  const result = await getSalesForDateRange(userId, region, country, startDate, endDate);

  return [
    {
      User: userId,
      region,
      country,
      dateRange: result.dateRange,
      totalSales: result.totalSales,
      datewiseSales: result.datewiseSales,
    },
  ];
}

/**
 * Get all daily documents for a date range (raw docs, not aggregated).
 */
async function getDailyDocuments(userId, region, country, startDate, endDate) {
  const dateRangeError = validateDateRange(startDate, endDate);
  if (dateRangeError) throw new Error(dateRangeError);

  const userObjectId = toObjectId(userId);
  return SalesOnlyMetrics.findByDateRange(userObjectId, region, country, startDate, endDate);
}

module.exports = {
  saveSalesOnlyMetrics,
  getLatestSalesOnlyMetrics,
  getSalesForDateRange,
  getSalesOnlyMetricsByDateRange,
  getDailyDocuments,
};

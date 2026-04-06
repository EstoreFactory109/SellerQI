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

async function saveSalesOnlyMetrics({
  userId,
  region,
  country,
  totalSales,
  datewiseSales,
  last7Days,
  last14Days,
  dateRange,
  queryId = null,
  documentId = null,
}) {
  const userObjectId = toObjectId(userId);

  const saved = await SalesOnlyMetrics.findOneAndUpdate(
    {
      User: userObjectId,
      region,
      country,
      'dateRange.startDate': dateRange?.startDate,
      'dateRange.endDate': dateRange?.endDate,
    },
    {
      $set: {
        User: userObjectId,
        region,
        country,
        dateRange: {
          startDate: dateRange?.startDate,
          endDate: dateRange?.endDate,
        },
        totalSales,
        datewiseSales,
        last7Days: last7Days || null,
        last14Days: last14Days || null,
        queryId,
        documentId,
        processedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).lean();

  return saved;
}

async function getLatestSalesOnlyMetrics(userId, region, country) {
  const userObjectId = toObjectId(userId);
  return SalesOnlyMetrics.findOne({ User: userObjectId, region, country })
    .sort({ createdAt: -1 })
    .lean();
}

async function getSalesOnlyMetricsByDateRange(userId, region, country, startDate, endDate) {
  const dateRangeError = validateDateRange(startDate, endDate);
  if (dateRangeError) throw new Error(dateRangeError);

  const userObjectId = toObjectId(userId);
  return SalesOnlyMetrics.find({
    User: userObjectId,
    region,
    country,
    'dateRange.startDate': startDate,
    'dateRange.endDate': endDate,
  })
    .sort({ createdAt: -1 })
    .lean();
}

module.exports = {
  saveSalesOnlyMetrics,
  getLatestSalesOnlyMetrics,
  getSalesOnlyMetricsByDateRange,
};


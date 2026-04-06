const mongoose = require('mongoose');
const AsinWiseSalesRun = require('../../models/finance/AsinWiseSalesRunModel.js');
const AsinWiseSalesItem = require('../../models/finance/AsinWiseSalesItemModel.js');
const AsinWiseSalesDateItem = require('../../models/finance/AsinWiseSalesDateItemModel.js');

function toObjectId(userId) {
  return typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
}

function validateDateRange(from, to) {
  if (!from || !to) return 'Both from and to dates are required (YYYY-MM-DD).';
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return 'Invalid date format. Use YYYY-MM-DD.';
  }
  if (fromDate > toDate) return 'from must be less than or equal to to.';
  return null;
}

async function getLatestRun({ userId, country, region }) {
  return AsinWiseSalesRun.findOne({
    User: toObjectId(userId),
    country,
    region,
  })
    .sort({ generatedAt: -1 })
    .lean();
}

function periodField(periodDays) {
  if (periodDays === 7) return 'last7Days';
  if (periodDays === 14) return 'last14Days';
  if (periodDays === 30) return 'last30Days';
  return null;
}

async function getAsinWiseSalesByPeriod({ userId, country, region, periodDays }) {
  const field = periodField(Number(periodDays));
  if (!field) throw new Error('Invalid period. Expected one of: 7, 14, 30.');

  const run = await getLatestRun({ userId, country, region });
  if (!run) {
    return {
      period: Number(periodDays),
      totalAsins: 0,
      asinSales: [],
      summary: { totalUnits: 0, totalRevenue: 0, startDate: '', endDate: '' },
      metadata: { generatedAt: null, hasData: false },
    };
  }

  const rows = await AsinWiseSalesItem.find({ runId: run._id })
    .sort({ [`${field}.totalRevenue`]: -1 })
    .lean();

  const asinSales = rows.map((r) => ({
    asin: r.asin,
    sku: r.sku || '',
    productName: r.productName || '',
    currency: r.currency || '',
    totalUnits: Number(r[field]?.totalUnits) || 0,
    totalRevenue: Number(r[field]?.totalRevenue) || 0,
  }));

  const summary = run.summary?.[field] || {};
  return {
    period: Number(periodDays),
    totalAsins: asinSales.length,
    asinSales,
    summary: {
      totalUnits: Number(summary.totalUnits) || 0,
      totalRevenue: Number(summary.totalRevenue) || 0,
      startDate: summary.startDate || '',
      endDate: summary.endDate || '',
    },
    metadata: {
      generatedAt: run.generatedAt ? new Date(run.generatedAt).toISOString() : null,
      hasData: true,
    },
  };
}

async function getAsinWiseSalesByDateRange({ userId, country, region, from, to }) {
  const allRuns = await AsinWiseSalesRun.find({
    User: toObjectId(userId),
    country,
    region,
  })
    .sort({ generatedAt: -1 })
    .limit(10)
    .lean();

  if (!allRuns.length) {
    return {
      from,
      to,
      totalAsins: 0,
      asinSales: [],
      summary: { totalUnits: 0, totalRevenue: 0 },
      metadata: { generatedAt: null, hasData: false },
    };
  }

  const allRunIds = allRuns.map((r) => r._id);

  const rows = await AsinWiseSalesDateItem.aggregate([
    { $match: { runId: { $in: allRunIds }, date: { $gte: from, $lte: to } } },
    { $addFields: { _runIdx: { $indexOfArray: [allRunIds, '$runId'] } } },
    { $sort: { _runIdx: 1 } },
    {
      $group: {
        _id: { asin: '$asin', date: '$date' },
        units: { $first: '$units' },
        revenue: { $first: '$revenue' },
      },
    },
    {
      $group: {
        _id: '$_id.asin',
        totalUnits: { $sum: '$units' },
        totalRevenue: { $sum: '$revenue' },
      },
    },
    {
      $project: {
        _id: 0,
        asin: '$_id',
        totalUnits: 1,
        totalRevenue: 1,
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  const latestRun = allRuns[0];
  const itemRows = await AsinWiseSalesItem.find({ runId: latestRun._id })
    .select({ asin: 1, sku: 1, productName: 1, currency: 1, _id: 0 })
    .lean();
  const itemMap = new Map(itemRows.map((r) => [r.asin, r]));

  const asinSales = rows.map((r) => {
    const item = itemMap.get(r.asin) || {};
    return {
      asin: r.asin,
      sku: item.sku || '',
      productName: item.productName || '',
      currency: item.currency || '',
      totalUnits: Number(r.totalUnits) || 0,
      totalRevenue: Number(r.totalRevenue) || 0,
    };
  });

  const totalUnits = asinSales.reduce((sum, r) => sum + (Number(r.totalUnits) || 0), 0);
  const totalRevenue = asinSales.reduce((sum, r) => sum + (Number(r.totalRevenue) || 0), 0);

  return {
    from,
    to,
    totalAsins: asinSales.length,
    asinSales,
    summary: {
      totalUnits,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
    },
    metadata: {
      generatedAt: latestRun.generatedAt ? new Date(latestRun.generatedAt).toISOString() : null,
      hasData: true,
    },
  };
}

module.exports = {
  validateDateRange,
  getAsinWiseSalesByPeriod,
  getAsinWiseSalesByDateRange,
};


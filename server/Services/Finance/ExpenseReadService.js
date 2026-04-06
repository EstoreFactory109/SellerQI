const mongoose = require('mongoose');
const ExpenseRawRow = require('../../models/finance/ExpenseRawRowModel.js');

function toObjectId(userId) {
  return typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
}

function getPeriodStartDate(periodDays) {
  const now = new Date();
  return new Date(now.getTime() - Number(periodDays) * 24 * 60 * 60 * 1000);
}

function buildDateRange(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  return { fromDate, toDate };
}

function validateDateRange(from, to) {
  if (!from || !to) return 'Both from and to dates are required (YYYY-MM-DD).';
  const { fromDate, toDate } = buildDateRange(from, to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return 'Invalid date format. Use YYYY-MM-DD.';
  }
  if (fromDate > toDate) return 'from must be less than or equal to to.';
  return null;
}

async function aggregateTotalsByCategory({ userId, country, region, fromDate, toDate, amazonOnly = false }) {
  const match = {
    User: toObjectId(userId),
    country,
    region,
    postedDate: { $gte: fromDate, $lte: toDate },
    category: { $ne: 'Advertising / PPC' },
  };
  if (amazonOnly) match.isAmazonFee = true;

  const [byCategory, totalRows, byDate] = await Promise.all([
    ExpenseRawRow.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, category: '$_id', totalAmount: 1, count: 1 } },
      { $sort: { totalAmount: 1 } },
    ]),
    ExpenseRawRow.countDocuments(match),
    ExpenseRawRow.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$postedDate' },
          },
          totalAmount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const total = byCategory.reduce((sum, row) => sum + (Number(row.totalAmount) || 0), 0);
  return {
    total: Math.round(total * 100) / 100,
    categories: byCategory.map((c) => ({
      category: c.category,
      totalAmount: Math.round((Number(c.totalAmount) || 0) * 100) / 100,
      count: Number(c.count) || 0,
    })),
    totalRows,
    datewise: byDate.map((d) => ({
      date: d._id,
      totalAmount: Math.abs(Math.round((Number(d.totalAmount) || 0) * 100) / 100),
    })),
  };
}

async function aggregateAsinWiseExpenses({ userId, country, region, fromDate, toDate }) {
  const match = {
    User: toObjectId(userId),
    country,
    region,
    postedDate: { $gte: fromDate, $lte: toDate },
  };

  const rows = await ExpenseRawRow.aggregate([
    { $match: match },
    {
      $group: {
        _id: { sku: '$sku', category: '$category' },
        amount: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.sku',
        totalAmount: { $sum: '$amount' },
        count: { $sum: '$count' },
        breakdown: {
          $push: {
            category: '$_id.category',
            amount: '$amount',
          },
        },
      },
    },
    { $project: { _id: 0, sku: '$_id', totalAmount: 1, count: 1, breakdown: 1 } },
    { $sort: { totalAmount: 1 } },
  ]);

  return rows.map((r) => ({
    sku: r.sku || 'N/A',
    totalAmount: Math.round((Number(r.totalAmount) || 0) * 100) / 100,
    count: Number(r.count) || 0,
    breakdown: (r.breakdown || [])
      .map((b) => ({
        category: b.category,
        amount: Math.round((Number(b.amount) || 0) * 100) / 100,
      }))
      .sort((a, b) => a.amount - b.amount),
  }));
}

async function aggregateRefunds({ userId, country, region, fromDate, toDate }) {
  const match = {
    User: toObjectId(userId),
    country,
    region,
    postedDate: { $gte: fromDate, $lte: toDate },
    transactionType: 'Refund',
  };

  const [byCategory, totalRows] = await Promise.all([
    ExpenseRawRow.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, category: '$_id', totalAmount: 1, count: 1 } },
      { $sort: { totalAmount: 1 } },
    ]),
    ExpenseRawRow.countDocuments(match),
  ]);

  const total = byCategory.reduce((sum, row) => sum + (Number(row.totalAmount) || 0), 0);
  return {
    total: Math.round(total * 100) / 100,
    categories: byCategory.map((c) => ({
      category: c.category,
      totalAmount: Math.round((Number(c.totalAmount) || 0) * 100) / 100,
      count: Number(c.count) || 0,
    })),
    totalRows,
  };
}

async function getRefundsByPeriod({ userId, country, region, periodDays }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  return aggregateRefunds({ userId, country, region, fromDate, toDate });
}

async function getRefundsByDateRange({ userId, country, region, from, to }) {
  const { fromDate, toDate } = buildDateRange(from, to);
  return aggregateRefunds({ userId, country, region, fromDate, toDate });
}

async function getTotalExpensesByPeriod({ userId, country, region, periodDays }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  return aggregateTotalsByCategory({ userId, country, region, fromDate, toDate, amazonOnly: false });
}

async function getTotalExpensesByDateRange({ userId, country, region, from, to }) {
  const { fromDate, toDate } = buildDateRange(from, to);
  return aggregateTotalsByCategory({ userId, country, region, fromDate, toDate, amazonOnly: false });
}

async function getTotalAmazonFeesByPeriod({ userId, country, region, periodDays }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  return aggregateTotalsByCategory({ userId, country, region, fromDate, toDate, amazonOnly: true });
}

async function getTotalAmazonFeesByDateRange({ userId, country, region, from, to }) {
  const { fromDate, toDate } = buildDateRange(from, to);
  return aggregateTotalsByCategory({ userId, country, region, fromDate, toDate, amazonOnly: true });
}

async function getAsinWiseExpensesByPeriod({ userId, country, region, periodDays }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  return aggregateAsinWiseExpenses({ userId, country, region, fromDate, toDate });
}

async function getAsinWiseExpensesByDateRange({ userId, country, region, from, to }) {
  const { fromDate, toDate } = buildDateRange(from, to);
  return aggregateAsinWiseExpenses({ userId, country, region, fromDate, toDate });
}

module.exports = {
  validateDateRange,
  getTotalExpensesByPeriod,
  getTotalExpensesByDateRange,
  getTotalAmazonFeesByPeriod,
  getTotalAmazonFeesByDateRange,
  getAsinWiseExpensesByPeriod,
  getAsinWiseExpensesByDateRange,
  getRefundsByPeriod,
  getRefundsByDateRange,
};


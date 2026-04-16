const mongoose = require('mongoose');
const ExpenseRawRow = require('../../models/finance/ExpenseRawRowModel.js');
const AsinWiseSalesRun = require('../../models/finance/AsinWiseSalesRunModel.js');
const AsinWiseSalesItem = require('../../models/finance/AsinWiseSalesItemModel.js');
const AsinWiseSalesDateItem = require('../../models/finance/AsinWiseSalesDateItemModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { isAmazonFee } = require('../Sp_API/Expences.js');

const FBA_FEE_CATEGORIES = new Set([
  'FBA Fulfillment Fee',
  'FBA Storage Fee',
  'FBA Disposal Fee',
]);

function toObjectId(id) {
  return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
}

function getPeriodStartDate(periodDays) {
  return new Date(Date.now() - Number(periodDays) * 24 * 60 * 60 * 1000);
}

function buildDateRange(from, to) {
  return {
    fromDate: new Date(`${from}T00:00:00.000Z`),
    toDate: new Date(`${to}T23:59:59.999Z`),
  };
}

function formatDateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function getAsinSkuMap(userId, country, region) {
  const seller = await Seller.findOne({ User: toObjectId(userId) })
    .sort({ createdAt: -1 })
    .lean();
  if (!seller) return new Map();

  const account = (seller.sellerAccount || []).find(
    (a) => a.country === country && a.region === region
  );
  if (!account || !account.products) return new Map();

  const map = new Map();
  for (const p of account.products) {
    if (p.asin) {
      map.set(p.asin, {
        sku: p.sku || '',
        productName: p.itemName || '',
      });
    }
  }
  return map;
}

async function getLatestSalesRun(userId, country, region) {
  return AsinWiseSalesRun.findOne({
    User: toObjectId(userId),
    country,
    region,
  })
    .sort({ generatedAt: -1 })
    .lean();
}

/**
 * Return runIds from ALL runs (newest first, capped at 10) so date-range
 * queries can stitch sales data across multiple ingestion windows.
 * Period-based endpoints still use getLatestSalesRun (latest run covers 7/14/30).
 */
async function getAllSalesRunIds(userId, country, region) {
  const runs = await AsinWiseSalesRun.find({
    User: toObjectId(userId),
    country,
    region,
  })
    .sort({ generatedAt: -1 })
    .limit(10)
    .select({ _id: 1 })
    .lean();
  return runs.map((r) => r._id);
}

/**
 * Aggregate AsinWiseSalesDateItem across multiple runs for a date window.
 * Deduplicates by (asin, date) — newer run wins (runs are sorted newest-first
 * via $indexOfArray so the lowest index = newest run).
 *
 * @param {'date'|'asin'|'all'} groupField
 *   - 'date'  → one row per calendar day  (chart)
 *   - 'asin'  → one row per ASIN          (table)
 *   - 'all'   → single total row          (summary)
 * Returns [{ _id, totalRevenue, totalUnits }]
 */
async function aggregateSalesDateItemsAcrossRuns(runIds, fromStr, toStr, groupField) {
  if (!runIds.length) return [];

  const dedup = [
    { $match: { runId: { $in: runIds }, date: { $gte: fromStr, $lte: toStr } } },
    { $addFields: { _runIdx: { $indexOfArray: [runIds, '$runId'] } } },
    { $sort: { _runIdx: 1 } },
    {
      $group: {
        _id: { asin: '$asin', date: '$date' },
        units: { $first: '$units' },
        revenue: { $first: '$revenue' },
      },
    },
  ];

  let regroup;
  if (groupField === 'date') {
    regroup = [
      { $group: { _id: '$_id.date', totalRevenue: { $sum: '$revenue' }, totalUnits: { $sum: '$units' } } },
      { $sort: { _id: 1 } },
    ];
  } else if (groupField === 'asin') {
    regroup = [
      { $group: { _id: '$_id.asin', totalRevenue: { $sum: '$revenue' }, totalUnits: { $sum: '$units' } } },
      { $sort: { totalRevenue: -1 } },
    ];
  } else {
    regroup = [
      { $group: { _id: null, totalRevenue: { $sum: '$revenue' }, totalUnits: { $sum: '$units' } } },
    ];
  }

  return AsinWiseSalesDateItem.aggregate([...dedup, ...regroup]);
}

// ──────────────────────────────────────────────────────────────
// 1) SUMMARY
// ──────────────────────────────────────────────────────────────

async function getSummary({ userId, country, region, fromDate, toDate }) {
  const uid = toObjectId(userId);
  const expMatch = { User: uid, country, region, postedDate: { $gte: fromDate, $lte: toDate }, category: { $ne: 'Advertising / PPC' } };

  const [totalExpAgg, categoryAgg, refundsAgg] = await Promise.all([
    ExpenseRawRow.aggregate([
      { $match: expMatch },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    ExpenseRawRow.aggregate([
      { $match: expMatch },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: '$amount' },
        },
      },
    ]),
    ExpenseRawRow.aggregate([
      { $match: { ...expMatch, transactionType: 'Refund' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const totalExpenses = round2(totalExpAgg[0]?.total || 0);

  let amazonFeesTotal = 0;
  let fbaFeesTotal = 0;
  for (const row of categoryAgg) {
    if (!isAmazonFee(row._id)) continue;
    const amt = Number(row.totalAmount) || 0;
    amazonFeesTotal += amt;
    if (FBA_FEE_CATEGORIES.has(row._id)) fbaFeesTotal += amt;
  }
  amazonFeesTotal = round2(amazonFeesTotal);
  fbaFeesTotal = round2(fbaFeesTotal);

  const refundsTotal = round2(refundsAgg[0]?.total || 0);

  const runIds = await getAllSalesRunIds(userId, country, region);
  let totalSales = 0;
  let totalUnits = 0;
  if (runIds.length) {
    const fromStr = formatDateKey(fromDate);
    const toStr = formatDateKey(toDate);
    const salesAgg = await aggregateSalesDateItemsAcrossRuns(runIds, fromStr, toStr, 'all');
    for (const row of salesAgg) {
      totalSales += Number(row.totalRevenue) || 0;
      totalUnits += Number(row.totalUnits) || 0;
    }
    totalSales = round2(totalSales);
  }

  return {
    totalSales,
    totalUnits,
    totalExpenses: Math.abs(totalExpenses),
    amazonFees: Math.abs(amazonFeesTotal),
    fbaFees: Math.abs(fbaFeesTotal),
    refunds: Math.abs(refundsTotal),
    grossProfit: round2(totalSales - Math.abs(totalExpenses)),
  };
}

async function getSummaryByPeriod({ userId, country, region, periodDays }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  return getSummary({ userId, country, region, fromDate, toDate });
}

async function getSummaryByDateRange({ userId, country, region, from, to }) {
  const { fromDate, toDate } = buildDateRange(from, to);
  return getSummary({ userId, country, region, fromDate, toDate });
}

// ──────────────────────────────────────────────────────────────
// 2) CHART (date-wise)
// ──────────────────────────────────────────────────────────────

async function getChart({ userId, country, region, fromDate, toDate }) {
  const uid = toObjectId(userId);

  const fromStr = formatDateKey(fromDate);
  const toStr = formatDateKey(toDate);

  const [expByDate, salesByDate] = await Promise.all([
    ExpenseRawRow.aggregate([
      {
        $match: {
          User: uid,
          country,
          region,
          postedDate: { $gte: fromDate, $lte: toDate },
          category: { $ne: 'Advertising / PPC' },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$postedDate' },
          },
          totalExpenses: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    (async () => {
      const runIds = await getAllSalesRunIds(userId, country, region);
      return aggregateSalesDateItemsAcrossRuns(runIds, fromStr, toStr, 'date');
    })(),
  ]);

  const expMap = new Map(expByDate.map((r) => [r._id, Math.abs(round2(r.totalExpenses))]));
  const salesMap = new Map(salesByDate.map((r) => [r._id, { revenue: round2(r.totalRevenue), units: Number(r.totalUnits) || 0 }]));

  const allDates = new Set([...expMap.keys(), ...salesMap.keys()]);
  const sorted = Array.from(allDates).sort();

  return sorted.map((date) => {
    const sales = salesMap.get(date)?.revenue || 0;
    const expenses = expMap.get(date) || 0;
    return {
      date,
      totalSales: sales,
      totalExpenses: expenses,
      grossProfit: round2(sales - expenses),
    };
  });
}

async function getChartByPeriod({ userId, country, region, periodDays }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  return getChart({ userId, country, region, fromDate, toDate });
}

async function getChartByDateRange({ userId, country, region, from, to }) {
  const { fromDate, toDate } = buildDateRange(from, to);
  return getChart({ userId, country, region, fromDate, toDate });
}

// ──────────────────────────────────────────────────────────────
// 3) TABLE (ASIN-keyed, joined sales + expenses)
// ──────────────────────────────────────────────────────────────

/** Full profitability table rows (same logic as paginated `getTable`). */
async function buildAllProfitabilityTableRows(userId, country, region, fromDate, toDate) {
  const uid = toObjectId(userId);
  const fromStr = formatDateKey(fromDate);
  const toStr = formatDateKey(toDate);

  const [asinSkuMap, allRunIds, expBySku] = await Promise.all([
    getAsinSkuMap(userId, country, region),
    getAllSalesRunIds(userId, country, region),
    ExpenseRawRow.aggregate([
      {
        $match: {
          User: uid,
          country,
          region,
          postedDate: { $gte: fromDate, $lte: toDate },
          category: { $ne: 'Advertising / PPC' },
        },
      },
      {
        $group: {
          _id: { sku: '$sku', category: '$category' },
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
          hasRefund: {
            $sum: { $cond: [{ $eq: ['$transactionType', 'Refund'] }, 1, 0] },
          },
          refundAmount: {
            $sum: { $cond: [{ $eq: ['$transactionType', 'Refund'] }, '$amount', 0] },
          },
        },
      },
      {
        $group: {
          _id: '$_id.sku',
          totalExpenses: { $sum: '$amount' },
          refunds: { $sum: '$refundAmount' },
          breakdown: {
            $push: {
              category: '$_id.category',
              amount: '$amount',
              count: '$count',
            },
          },
        },
      },
    ]),
  ]);

  const skuExpMap = new Map(
    expBySku.map((r) => {
      const breakdown = (r.breakdown || [])
        .map((b) => ({
          category: b.category,
          amount: Math.abs(round2(b.amount)),
          count: Number(b.count) || 0,
        }))
        .sort((a, b) => b.amount - a.amount);
      const totalExpenses = round2(breakdown.reduce((s, b) => s + b.amount, 0));
      const amazonFees = round2(
        breakdown.reduce((sum, b) => {
          if (!isAmazonFee(b.category)) return sum;
          return sum + (Number(b.amount) || 0);
        }, 0)
      );
      return [
        r._id || 'N/A',
        {
          totalExpenses,
          amazonFees: Math.abs(amazonFees),
          refunds: Math.abs(round2(r.refunds)),
          breakdown,
        },
      ];
    })
  );

  let salesByAsin = [];
  if (allRunIds.length) {
    salesByAsin = await aggregateSalesDateItemsAcrossRuns(allRunIds, fromStr, toStr, 'asin');
  }

  const skuToAsinMap = new Map();
  for (const [asin, info] of asinSkuMap) {
    if (info.sku) skuToAsinMap.set(info.sku, asin);
  }

  const rows = [];
  const seenAsins = new Set();

  for (const sale of salesByAsin) {
    const asin = sale._id;
    seenAsins.add(asin);
    const sellerInfo = asinSkuMap.get(asin) || {};
    const sku = sellerInfo.sku || '';
    const exp = skuExpMap.get(sku) || { totalExpenses: 0, amazonFees: 0, refunds: 0, breakdown: [] };
    const totalSales = round2(sale.totalRevenue);
    const grossProfit = round2(totalSales - exp.totalExpenses);

    rows.push({
      asin,
      sku,
      productName: sellerInfo.productName || '',
      totalSales,
      unitsSold: Number(sale.totalUnits) || 0,
      totalExpenses: exp.totalExpenses,
      amazonFees: exp.amazonFees,
      refunds: exp.refunds,
      breakdown: exp.breakdown,
      grossProfit,
    });
  }

  for (const [sku, exp] of skuExpMap) {
    const asin = skuToAsinMap.get(sku);
    if (asin && !seenAsins.has(asin)) {
      const sellerInfo = asinSkuMap.get(asin) || {};
      rows.push({
        asin,
        sku,
        productName: sellerInfo.productName || '',
        totalSales: 0,
        unitsSold: 0,
        totalExpenses: exp.totalExpenses,
        amazonFees: exp.amazonFees,
        refunds: exp.refunds,
        breakdown: exp.breakdown || [],
        grossProfit: round2(0 - exp.totalExpenses),
      });
    }
  }

  rows.sort((a, b) => b.totalSales - a.totalSales);
  return { rows };
}

async function getTable({ userId, country, region, fromDate, toDate, page = 1, limit = 10 }) {
  const { rows: allRows } = await buildAllProfitabilityTableRows(userId, country, region, fromDate, toDate);

  const totalItems = allRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const startIdx = (page - 1) * limit;
  const paginated = allRows.slice(startIdx, startIdx + limit);

  return {
    rows: paginated,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

/** One table row for an ASIN (same pipeline as `/api/profitability/table`). */
async function getTableRowByAsin({ userId, country, region, fromDate, toDate, asin }) {
  const normalized = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) return null;
  const { rows } = await buildAllProfitabilityTableRows(userId, country, region, fromDate, toDate);
  return rows.find((r) => (r.asin || '').trim().toUpperCase() === normalized) || null;
}

async function getTableRowByAsinByPeriod({ userId, country, region, periodDays, asin }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  return getTableRowByAsin({ userId, country, region, fromDate, toDate, asin });
}

async function getTableRowByAsinByDateRange({ userId, country, region, from, to, asin }) {
  const { fromDate, toDate } = buildDateRange(from, to);
  return getTableRowByAsin({ userId, country, region, fromDate, toDate, asin });
}

async function getTableByPeriod({ userId, country, region, periodDays, page, limit }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  return getTable({ userId, country, region, fromDate, toDate, page, limit });
}

async function getTableByDateRange({ userId, country, region, from, to, page, limit }) {
  const { fromDate, toDate } = buildDateRange(from, to);
  return getTable({ userId, country, region, fromDate, toDate, page, limit });
}

module.exports = {
  getSummaryByPeriod,
  getSummaryByDateRange,
  getChartByPeriod,
  getChartByDateRange,
  getTableByPeriod,
  getTableByDateRange,
  getTableRowByAsinByPeriod,
  getTableRowByAsinByDateRange,
};

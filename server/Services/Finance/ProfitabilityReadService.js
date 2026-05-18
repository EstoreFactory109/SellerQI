const mongoose = require('mongoose');
const ExpenseRawRow = require('../../models/finance/ExpenseRawRowModel.js');
const ExpenseReportRun = require('../../models/finance/ExpenseReportRunModel.js');
const ExpenseSkuAgg = require('../../models/finance/ExpenseSkuAggModel.js');
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

/**
 * Build ASIN ↔ SKU mappings from the seller's product catalog.
 *
 * A single ASIN can map to multiple SKUs (e.g., FBA + MFN variants, multi-warehouse,
 * or historical relisting). Expense rows are stored per-SKU, so to get accurate
 * expenses for an ASIN we must sum across ALL of its SKUs.
 *
 * @returns {{
 *   asinToInfo: Map<string, { skus: string[], productName: string }>,
 *   skuToAsin: Map<string, string>
 * }}
 */
async function getAsinSkuMap(userId, country, region) {
  const empty = { asinToInfo: new Map(), skuToAsin: new Map() };
  const seller = await Seller.findOne({ User: toObjectId(userId) })
    .sort({ createdAt: -1 })
    .lean();
  if (!seller) return empty;

  const account = (seller.sellerAccount || []).find(
    (a) => a.country === country && a.region === region
  );
  if (!account || !account.products) return empty;

  const asinToInfo = new Map();
  const skuToAsin = new Map();
  for (const p of account.products) {
    const asin = p.asin;
    const sku = (p.sku || '').trim();
    if (!asin) continue;

    const existing = asinToInfo.get(asin) || { skus: [], productName: '' };
    if (sku && !existing.skus.includes(sku)) existing.skus.push(sku);
    if (!existing.productName && p.itemName) existing.productName = p.itemName;
    asinToInfo.set(asin, existing);

    if (sku) skuToAsin.set(sku, asin);
  }
  return { asinToInfo, skuToAsin };
}

/**
 * Map period-based queries (7/14/30 days) to the pre-computed period stored
 * in ExpenseSkuAgg. `daysBack` default at ingestion is 30, so `'all'` is the
 * full ingestion window ≈ last 30 days.
 */
function mapPeriodDaysToAggPeriod(periodDays) {
  const n = Number(periodDays);
  if (n === 7) return 'last7';
  if (n === 14) return 'last14';
  if (n === 30) return 'all';
  return null;
}

async function getLatestExpenseRunId(userId, country, region) {
  const run = await ExpenseReportRun.findOne({
    User: toObjectId(userId),
    country,
    region,
  })
    .sort({ generatedAt: -1 })
    .select({ _id: 1 })
    .lean();
  return run ? run._id : null;
}

/**
 * Build sku → expense-summary map from the pre-computed ExpenseSkuAgg
 * collection. Used for period-based profitability queries (7/14/30), where
 * the ingestion pipeline has already aggregated per-SKU totals at save time.
 *
 * We drop `Advertising / PPC` entries from the breakdown (PPC has sku='N/A'
 * in practice but filtering defensively) and exclude empty/'N/A' SKU docs
 * since they are not attributable to an ASIN.
 */
async function buildSkuExpMapFromAgg({ userId, country, region, aggPeriod }) {
  const runId = await getLatestExpenseRunId(userId, country, region);
  if (!runId) return new Map();

  const skuDocs = await ExpenseSkuAgg.find({ runId, period: aggPeriod }).lean();

  const map = new Map();
  for (const doc of skuDocs) {
    const sku = (doc.sku || '').trim();
    if (!sku || sku === 'N/A') continue;

    const breakdown = (doc.breakdown || [])
      .filter((b) => b && b.category && b.category !== 'Advertising / PPC')
      .map((b) => ({
        category: b.category,
        amount: Math.abs(round2(b.amount)),
      }))
      .sort((a, b) => b.amount - a.amount);

    const totalExpenses = round2(breakdown.reduce((s, b) => s + b.amount, 0));
    const amazonFees = round2(
      breakdown.reduce(
        (sum, b) => (isAmazonFee(b.category) ? sum + b.amount : sum),
        0
      )
    );

    map.set(sku, {
      totalExpenses,
      amazonFees: Math.abs(amazonFees),
      // ExpenseSkuAgg breakdown is keyed by category only — no per-SKU refund
      // split is stored, so refunds aren't available in this path. The
      // profitability table UI doesn't render per-row refunds today.
      refunds: 0,
      breakdown,
    });
  }
  return map;
}

/**
 * Build sku → expense-summary map from ExpenseRawRow by aggregating rows
 * whose `postedDate` falls in the given window. Used for custom date-range
 * queries (where pre-computed aggregates don't cover the arbitrary window).
 */
async function buildSkuExpMapFromRaw({ userId, country, region, fromDate, toDate }) {
  const uid = toObjectId(userId);
  const expBySku = await ExpenseRawRow.aggregate([
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
  ]);

  const map = new Map();
  for (const r of expBySku) {
    const rawSku = (r._id || '').trim();
    if (!rawSku || rawSku === 'N/A') continue;

    const breakdown = (r.breakdown || [])
      .map((b) => ({
        category: b.category,
        amount: Math.abs(round2(b.amount)),
        count: Number(b.count) || 0,
      }))
      .sort((a, b) => b.amount - a.amount);
    const totalExpenses = round2(breakdown.reduce((s, b) => s + b.amount, 0));
    const amazonFees = round2(
      breakdown.reduce(
        (sum, b) => (isAmazonFee(b.category) ? sum + b.amount : sum),
        0
      )
    );
    map.set(rawSku, {
      totalExpenses,
      amazonFees: Math.abs(amazonFees),
      refunds: Math.abs(round2(r.refunds)),
      breakdown,
    });
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

/**
 * Full profitability table rows (same logic as paginated `getTable`).
 *
 * Expense source selection:
 *  - `aggPeriod` set ('last7' | 'last14' | 'all')  → pre-computed ExpenseSkuAgg.
 *    Used for period-based endpoints (7/14/30 days) where the expense ingestion
 *    already aggregated per-SKU totals at save time (see ExpenseReportService).
 *    This avoids re-aggregating raw rows and avoids dropping rows whose
 *    `postedDate` is null (e.g. Debt Recovery, Loan Servicing), which the raw
 *    postedDate window query silently excludes.
 *  - `aggPeriod` null  → ExpenseRawRow aggregation filtered by postedDate window.
 *    Used for arbitrary custom date ranges not covered by pre-computed periods.
 */
async function buildAllProfitabilityTableRows(
  userId,
  country,
  region,
  fromDate,
  toDate,
  aggPeriod = null
) {
  const fromStr = formatDateKey(fromDate);
  const toStr = formatDateKey(toDate);

  const [{ asinToInfo, skuToAsin }, allRunIds, skuExpMap] = await Promise.all([
    getAsinSkuMap(userId, country, region),
    getAllSalesRunIds(userId, country, region),
    aggPeriod
      ? buildSkuExpMapFromAgg({ userId, country, region, aggPeriod })
      : buildSkuExpMapFromRaw({ userId, country, region, fromDate, toDate }),
  ]);

  // Aggregate per-SKU expense data across a set of SKUs belonging to the same
  // ASIN. Merges breakdowns by category so the UI shows a single coherent
  // per-ASIN breakdown instead of one SKU's partial view.
  const aggregateExpensesForSkus = (skus) => {
    const breakdownMap = new Map();
    let totalExpenses = 0;
    let amazonFees = 0;
    let refunds = 0;
    const seen = new Set();

    for (const sku of skus) {
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      const exp = skuExpMap.get(sku);
      if (!exp) continue;

      totalExpenses += exp.totalExpenses;
      amazonFees += exp.amazonFees;
      refunds += exp.refunds;

      for (const b of exp.breakdown || []) {
        const cur = breakdownMap.get(b.category) || { amount: 0, count: 0 };
        cur.amount += Number(b.amount) || 0;
        cur.count += Number(b.count) || 0;
        breakdownMap.set(b.category, cur);
      }
    }

    const breakdown = Array.from(breakdownMap.entries())
      .map(([category, v]) => ({
        category,
        amount: round2(v.amount),
        count: v.count,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      totalExpenses: round2(totalExpenses),
      amazonFees: round2(amazonFees),
      refunds: round2(refunds),
      breakdown,
    };
  };

  let salesByAsin = [];
  if (allRunIds.length) {
    salesByAsin = await aggregateSalesDateItemsAcrossRuns(allRunIds, fromStr, toStr, 'asin');
  }

  const rows = [];
  const seenAsins = new Set();
  const consumedSkus = new Set();

  for (const sale of salesByAsin) {
    const asin = sale._id;
    seenAsins.add(asin);
    const sellerInfo = asinToInfo.get(asin) || { skus: [], productName: '' };
    const skus = sellerInfo.skus || [];
    const exp = aggregateExpensesForSkus(skus);
    for (const s of skus) consumedSkus.add(s);

    const totalSales = round2(sale.totalRevenue);
    const grossProfit = round2(totalSales - exp.totalExpenses);

    rows.push({
      asin,
      sku: skus[0] || '',
      skus,
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

  // Expense-only rows: SKUs that have expenses in the window but whose ASIN
  // had no sales. Walk through unused expense SKUs, resolve to ASIN via
  // skuToAsin, and sum across all sibling SKUs of that ASIN.
  for (const sku of skuExpMap.keys()) {
    if (consumedSkus.has(sku)) continue;
    const asin = skuToAsin.get(sku);
    if (!asin || seenAsins.has(asin)) continue;

    seenAsins.add(asin);
    const sellerInfo = asinToInfo.get(asin) || { skus: [sku], productName: '' };
    const skus = sellerInfo.skus && sellerInfo.skus.length ? sellerInfo.skus : [sku];
    const exp = aggregateExpensesForSkus(skus);
    for (const s of skus) consumedSkus.add(s);

    rows.push({
      asin,
      sku: skus[0] || sku,
      skus,
      productName: sellerInfo.productName || '',
      totalSales: 0,
      unitsSold: 0,
      totalExpenses: exp.totalExpenses,
      amazonFees: exp.amazonFees,
      refunds: exp.refunds,
      breakdown: exp.breakdown,
      grossProfit: round2(0 - exp.totalExpenses),
    });
  }

  rows.sort((a, b) => b.totalSales - a.totalSales);
  return { rows };
}

async function getTable({
  userId,
  country,
  region,
  fromDate,
  toDate,
  page = 1,
  limit = 10,
  aggPeriod = null,
}) {
  const { rows: allRows } = await buildAllProfitabilityTableRows(
    userId,
    country,
    region,
    fromDate,
    toDate,
    aggPeriod
  );

  // Keep backend pagination aligned with frontend table visibility:
  // frontend renders only rows with a non-empty SKU.
  const visibleRows = allRows.filter((row) => row && row.sku && String(row.sku).trim() !== '');

  const totalItems = visibleRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const startIdx = (page - 1) * limit;
  const paginated = visibleRows.slice(startIdx, startIdx + limit);

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
async function getTableRowByAsin({
  userId,
  country,
  region,
  fromDate,
  toDate,
  asin,
  aggPeriod = null,
}) {
  const normalized = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) return null;
  const { rows } = await buildAllProfitabilityTableRows(
    userId,
    country,
    region,
    fromDate,
    toDate,
    aggPeriod
  );
  return rows.find((r) => (r.asin || '').trim().toUpperCase() === normalized) || null;
}

async function getTableRowByAsinByPeriod({ userId, country, region, periodDays, asin }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  const aggPeriod = mapPeriodDaysToAggPeriod(periodDays);
  return getTableRowByAsin({ userId, country, region, fromDate, toDate, asin, aggPeriod });
}

async function getTableRowByAsinByDateRange({ userId, country, region, from, to, asin }) {
  const { fromDate, toDate } = buildDateRange(from, to);
  return getTableRowByAsin({ userId, country, region, fromDate, toDate, asin });
}

async function getTableByPeriod({ userId, country, region, periodDays, page, limit }) {
  const fromDate = getPeriodStartDate(periodDays);
  const toDate = new Date();
  const aggPeriod = mapPeriodDaysToAggPeriod(periodDays);
  return getTable({ userId, country, region, fromDate, toDate, page, limit, aggPeriod });
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

const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');

const ExpenseReportRun = require('../../models/finance/ExpenseReportRunModel.js');
const ExpenseCategoryAgg = require('../../models/finance/ExpenseCategoryAggModel.js');
const ExpenseSkuAgg = require('../../models/finance/ExpenseSkuAggModel.js');
const ExpenseSkuDateAgg = require('../../models/finance/ExpenseSkuDateAggModel.js');
const ExpenseDateAgg = require('../../models/finance/ExpenseDateAggModel.js');
const ExpenseProcessedReport = require('../../models/finance/ExpenseProcessedReportModel.js');

const { getExpenseReport } = require('./Expences.js');

const CHUNK_INSERT_SIZE = 500;

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function internalRegionFromModel(regionModel) {
  if (regionModel === 'NA') return 'na';
  if (regionModel === 'EU') return 'eu';
  if (regionModel === 'FE') return 'apac';
  return null;
}

function mapRegionModelToInternal(regionModel) {
  return internalRegionFromModel(regionModel);
}

async function persistExpenseReportResult({ userId, country, regionModel, result }) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const metadata = result?.metadata || {};
  const daysBack = result?.metadata?.daysBack ?? 30;
  const marketplaceId = result?.metadata?.marketplaceId ?? metadata?.marketplaceId ?? 'UNKNOWN';
  const regionInternal = metadata?.region ?? mapRegionModelToInternal(regionModel);

  const run = await ExpenseReportRun.create({
    User: userObjectId,
    country,
    region: regionModel,
    regionInternal,
    marketplaceId,
    daysBack: Number(daysBack) || 30,

    totalRowsProcessed: metadata.totalRowsProcessed ?? (metadata.totalExpenseRows ?? 0),
    totalExpenseRows: metadata.totalExpenseRows ?? 0,
    reportsProcessed: metadata.reportsProcessed ?? 0,

    dateRangeEarliest: metadata.dateRange?.from ?? metadata.dateRange?.earliest ?? null,
    dateRangeLatest: metadata.dateRange?.to ?? metadata.dateRange?.latest ?? null,
    generatedAt: metadata.generatedAt ? new Date(metadata.generatedAt) : new Date(),

    totals: {
      allTime: result?.totalExpenses?.total ?? 0,
      last7Days: result?.totalExpensesLast7Days?.total ?? 0,
      last14Days: result?.totalExpensesLast14Days?.total ?? 0,
    },
  });

  const runId = run._id;

  // 1) Category aggregates
  const categoryDocsByPeriod = [];
  const periodMap = [
    { period: 'all', sectionKey: 'totalExpenses' },
    { period: 'last7', sectionKey: 'totalExpensesLast7Days' },
    { period: 'last14', sectionKey: 'totalExpensesLast14Days' },
  ];

  for (const { period, sectionKey } of periodMap) {
    const categories = result?.[sectionKey]?.categories || [];
    const docs = categories.map((c) => ({
      runId,
      User: userObjectId,
      country,
      region: regionModel,
      period,
      category: c.category,
      totalAmount: Number(c.totalAmount) || 0,
      count: Number(c.count) || 0,
    }));
    categoryDocsByPeriod.push({ period, docs });
  }

  for (const { docs } of categoryDocsByPeriod) {
    const chunks = chunkArray(docs, CHUNK_INSERT_SIZE);
    for (const ch of chunks) {
      if (ch.length === 0) continue;
      await ExpenseCategoryAgg.insertMany(ch, { ordered: false });
    }
  }

  // 2) SKU aggregates (with breakdown)
  const skuPeriods = [
    { period: 'all', sectionKey: 'skuWiseExpenses' },
    { period: 'last7', sectionKey: 'skuWiseExpensesLast7Days' },
    { period: 'last14', sectionKey: 'skuWiseExpensesLast14Days' },
  ];

  for (const { period, sectionKey } of skuPeriods) {
    const skuList = result?.[sectionKey] || [];
    const docs = skuList.map((s) => ({
      runId,
      User: userObjectId,
      country,
      region: regionModel,
      period,
      sku: s.sku,
      totalAmount: Number(s.totalAmount) || 0,
      count: Number(s.count) || 0,
      breakdown: (s.breakdown || []).map((b) => ({
        category: b.category,
        amount: Number(b.amount) || 0,
      })),
    }));

    const chunks = chunkArray(docs, CHUNK_INSERT_SIZE);
    for (const ch of chunks) {
      if (ch.length === 0) continue;
      await ExpenseSkuAgg.insertMany(ch, { ordered: false });
    }
  }

  // 3) SKU+Date wise aggregates (single "period" because response isn't period-sliced)
  const skuDateList = result?.skuDateWiseExpenses || [];
  const dateDocs = skuDateList.map((e) => ({
    runId,
    User: userObjectId,
    country,
    region: regionModel,
    sku: e.sku,
    dateKey: e.date,
    totalAmount: Number(e.totalAmount) || 0,
    count: Number(e.count) || 0,
    breakdown: (e.breakdown || []).map((b) => ({
      category: b.category,
      amount: Number(b.amount) || 0,
    })),
  }));

  const chunks = chunkArray(dateDocs, CHUNK_INSERT_SIZE);
  for (const ch of chunks) {
    if (ch.length === 0) continue;
    await ExpenseSkuDateAgg.insertMany(ch, { ordered: false });
  }

  // 4) Date-wise totals (total + category breakdown per date)
  const dateWiseList = result?.dateWiseExpenses || [];
  const dateWiseDocs = dateWiseList.map((e) => ({
    runId,
    User: userObjectId,
    country,
    region: regionModel,
    dateKey: e.date,
    totalAmount: Number(e.totalAmount) || 0,
    count: Number(e.count) || 0,
    breakdown: (e.breakdown || []).map((b) => ({
      category: b.category,
      amount: Number(b.amount) || 0,
    })),
  }));

  const dateChunks = chunkArray(dateWiseDocs, CHUNK_INSERT_SIZE);
  for (const ch of dateChunks) {
    if (ch.length === 0) continue;
    await ExpenseDateAgg.insertMany(ch, { ordered: false });
  }

  return runId;
}

async function getProcessedReportIds({ userId, country, regionModel }) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const rows = await ExpenseProcessedReport.find({
    User: userObjectId,
    country,
    region: regionModel,
  })
    .select({ reportId: 1, _id: 0 })
    .lean();

  return rows.map((r) => String(r.reportId));
}

async function saveProcessedReportIds({
  userId,
  country,
  regionModel,
  marketplaceId,
  runId,
  reportIds,
}) {
  if (!Array.isArray(reportIds) || reportIds.length === 0) return;

  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const docs = reportIds.map((reportId) => ({
    User: userObjectId,
    country,
    region: regionModel,
    marketplaceId: marketplaceId || undefined,
    runId: runId || undefined,
    reportId: String(reportId),
    processedAt: new Date(),
  }));

  await ExpenseProcessedReport.insertMany(docs, { ordered: false });
}

async function buildExpenseReportResponseFromDB({ userId, country, regionModel }) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const regionInternal = internalRegionFromModel(regionModel);

  const run = await ExpenseReportRun.findOne({
    User: userObjectId,
    country,
    region: regionModel,
  })
    .sort({ generatedAt: -1 })
    .lean();

  if (!run) return null;

  const [allCats, last7Cats, last14Cats] = await Promise.all([
    ExpenseCategoryAgg.find({ runId: run._id, period: 'all' }).sort({ totalAmount: 1 }).lean(),
    ExpenseCategoryAgg.find({ runId: run._id, period: 'last7' }).sort({ totalAmount: 1 }).lean(),
    ExpenseCategoryAgg.find({ runId: run._id, period: 'last14' }).sort({ totalAmount: 1 }).lean(),
  ]);

  const totalExpenses = {
    total: run.totals?.allTime ?? 0,
    categories: allCats.map((c) => ({
      category: c.category,
      totalAmount: c.totalAmount,
      count: c.count,
    })),
  };

  const totalExpensesLast7Days = {
    total: run.totals?.last7Days ?? 0,
    categories: last7Cats.map((c) => ({
      category: c.category,
      totalAmount: c.totalAmount,
      count: c.count,
    })),
  };

  const totalExpensesLast14Days = {
    total: run.totals?.last14Days ?? 0,
    categories: last14Cats.map((c) => ({
      category: c.category,
      totalAmount: c.totalAmount,
      count: c.count,
    })),
  };

  const [skuAll, skuLast7, skuLast14, skuDateWise, dateWiseTotals] = await Promise.all([
    ExpenseSkuAgg.find({ runId: run._id, period: 'all' }).sort({ totalAmount: 1 }).lean(),
    ExpenseSkuAgg.find({ runId: run._id, period: 'last7' }).sort({ totalAmount: 1 }).lean(),
    ExpenseSkuAgg.find({ runId: run._id, period: 'last14' }).sort({ totalAmount: 1 }).lean(),
    ExpenseSkuDateAgg.find({ runId: run._id }).lean(),
    ExpenseDateAgg.find({ runId: run._id }).lean(),
  ]);

  const skuWiseExpenses = skuAll.map((s) => {
    const breakdown = (s.breakdown || [])
      .slice()
      .sort((a, b) => a.amount - b.amount)
      .map((b) => ({ category: b.category, amount: b.amount }));

    return {
      sku: s.sku,
      totalAmount: s.totalAmount,
      count: s.count,
      breakdown,
    };
  });

  const skuWiseExpensesLast7Days = skuLast7.map((s) => {
    const breakdown = (s.breakdown || [])
      .slice()
      .sort((a, b) => a.amount - b.amount)
      .map((b) => ({ category: b.category, amount: b.amount }));

    return {
      sku: s.sku,
      totalAmount: s.totalAmount,
      count: s.count,
      breakdown,
    };
  });

  const skuWiseExpensesLast14Days = skuLast14.map((s) => {
    const breakdown = (s.breakdown || [])
      .slice()
      .sort((a, b) => a.amount - b.amount)
      .map((b) => ({ category: b.category, amount: b.amount }));

    return {
      sku: s.sku,
      totalAmount: s.totalAmount,
      count: s.count,
      breakdown,
    };
  });

  // Match Expences.js comparator:
  // sort by date desc, then SKU
  const skuDateWiseExpenses = skuDateWise
    .map((e) => {
      const breakdown = (e.breakdown || [])
        .slice()
        .sort((a, b) => a.amount - b.amount)
        .map((b) => ({ category: b.category, amount: b.amount }));

      return {
        sku: e.sku,
        date: e.dateKey,
        totalAmount: e.totalAmount,
        count: e.count,
        breakdown,
      };
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? -1 : 1;
      return a.sku.localeCompare(b.sku);
    });

  const dateWiseExpenses = dateWiseTotals
    .map((e) => {
      const breakdown = (e.breakdown || [])
        .slice()
        .sort((a, b) => a.amount - b.amount)
        .map((b) => ({ category: b.category, amount: b.amount }));

      return {
        date: e.dateKey,
        totalAmount: e.totalAmount,
        count: e.count,
        breakdown,
      };
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? -1 : 1;
      return 0;
    });

  return {
    totalExpenses,
    totalExpensesLast7Days,
    totalExpensesLast14Days,
    skuWiseExpenses,
    skuWiseExpensesLast7Days,
    skuWiseExpensesLast14Days,
    skuDateWiseExpenses,
    dateWiseExpenses,
    metadata: {
      totalRowsProcessed: run.totalRowsProcessed,
      totalExpenseRows: run.totalExpenseRows,
      dateRange: {
        from: run.dateRangeEarliest ?? null,
        to: run.dateRangeLatest ?? null,
        fromFormatted: run.dateRangeEarliest
          ? new Date(run.dateRangeEarliest).toLocaleDateString('en-GB', { timeZone: 'UTC' }).replace(/\//g, '/')
          : 'N/A',
        toFormatted: run.dateRangeLatest
          ? new Date(run.dateRangeLatest).toLocaleDateString('en-GB', { timeZone: 'UTC' }).replace(/\//g, '/')
          : 'N/A',
      },
      generatedAt: run.generatedAt ? new Date(run.generatedAt).toISOString() : new Date().toISOString(),

      country,
      region: regionInternal,
      marketplaceId: run.marketplaceId,
      reportsProcessed: run.reportsProcessed,
      daysBack: run.daysBack,
    },
  };
}

/**
 * Generate expense report via SP-API, persist to Mongo in normalized collections,
 * then return the formatted JSON by re-reading from Mongo.
 */
async function fetchPersistAndReturnExpenseReport({
  userId,
  country,
  regionModel, // NA | EU | FE
  refreshToken,
  accessToken,
  daysBack = 30,
  clientId = process.env.SPAPI_CLIENT_ID,
  clientSecret = process.env.SPAPI_CLIENT_SECRET,
}) {
  const regionInternal = internalRegionFromModel(regionModel);
  if (!regionInternal) {
    throw new Error(`Invalid regionModel: ${regionModel}. Expected NA, EU, FE.`);
  }

  logger.info('[ExpenseReportService] Fetching expense report (SP-API) ...', {
    userId,
    country,
    regionModel,
    daysBack,
  });

  const processedReportIds = await getProcessedReportIds({ userId, country, regionModel });

  const computed = await getExpenseReport({
    refreshToken,
    accessToken,
    clientId,
    clientSecret,
    country,
    region: regionInternal,
    daysBack: Number(daysBack) || 30,
    processedReportIds,
  });

  // New Expences.js contract:
  // - computed.hasNewData
  // - computed.data (actual 8-section payload) when hasNewData=true
  // - computed.newReportIds/allReportIds/skippedReportIds
  if (!computed?.hasNewData || !computed?.data) {
    const existing = await buildExpenseReportResponseFromDB({ userId, country, regionModel });
    return {
      hasNewData: false,
      data: existing,
      newReportIds: computed?.newReportIds || [],
      allReportIds: computed?.allReportIds || [],
      skippedReportIds: computed?.skippedReportIds || [],
      metadata: computed?.metadata || {},
    };
  }

  logger.info('[ExpenseReportService] Persisting expense report to Mongo ...');
  const runId = await persistExpenseReportResult({
    userId,
    country,
    regionModel,
    result: computed.data,
  });

  await saveProcessedReportIds({
    userId,
    country,
    regionModel,
    marketplaceId: computed?.metadata?.marketplaceId || computed?.data?.metadata?.marketplaceId,
    runId,
    reportIds: computed.newReportIds || [],
  });

  logger.info('[ExpenseReportService] Returning expense report from Mongo ...');
  const fromDb = await buildExpenseReportResponseFromDB({ userId, country, regionModel });
  return {
    hasNewData: true,
    data: fromDb,
    newReportIds: computed.newReportIds || [],
    allReportIds: computed.allReportIds || [],
    skippedReportIds: computed.skippedReportIds || [],
    metadata: computed.metadata || {},
  };
}

module.exports = {
  fetchPersistAndReturnExpenseReport,
  buildExpenseReportResponseFromDB,
};


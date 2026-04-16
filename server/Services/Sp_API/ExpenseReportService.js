const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');
const { getDefaultExpenseFinanceDaysBack } = require('../../config/expenseFinanceDaysBack.js');

const ExpenseReportRun = require('../../models/finance/ExpenseReportRunModel.js');
const ExpenseCategoryAgg = require('../../models/finance/ExpenseCategoryAggModel.js');
const ExpenseSkuAgg = require('../../models/finance/ExpenseSkuAggModel.js');
const ExpenseSkuDateAgg = require('../../models/finance/ExpenseSkuDateAggModel.js');
const ExpenseDateAgg = require('../../models/finance/ExpenseDateAggModel.js');
const ExpenseAmazonFeeCategoryAgg = require('../../models/finance/ExpenseAmazonFeeCategoryAggModel.js');
const ExpenseAmazonFeeDateAgg = require('../../models/finance/ExpenseAmazonFeeDateAggModel.js');
const ExpenseRawRow = require('../../models/finance/ExpenseRawRowModel.js');

const { fetchNewFinanceData, analyzeExpenses } = require('./Expences.js');

const CHUNK_INSERT_SIZE = 500;

function chunkArray(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
function internalRegionFromModel(regionModel) { if (regionModel === 'NA') return 'na'; if (regionModel === 'EU') return 'eu'; if (regionModel === 'FE') return 'apac'; return null; }
function mapRegionModelToInternal(regionModel) { return internalRegionFromModel(regionModel); }

async function cleanupOverlappingRawRows({ userId, country, regionModel, postedAfter, postedBefore }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const dateFilter = { User: userObjectId, country, region: regionModel, $or: [{ postedDate: { $gte: new Date(postedAfter), $lte: new Date(postedBefore) } }, { postedDate: null }] };
  const result = await ExpenseRawRow.deleteMany(dateFilter);
  logger.info(`[ExpenseReportService] Deleted ${result.deletedCount} overlapping raw rows (${postedAfter} → ${postedBefore}). Runs & aggregates preserved.`);
}

async function saveRawExpenseRows({ userId, country, regionModel, expenseRows }) {
  if (!Array.isArray(expenseRows) || expenseRows.length === 0) return;
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const docs = expenseRows.map((e) => ({
    User: userObjectId, country, region: regionModel, reportId: 'finance-api',
    amount: e.amount, absoluteAmount: e.absoluteAmount, category: e.category,
    isAmazonFee: e.isAmazonFee, amountType: e.amountType || '', amountDescription: e.amountDescription || '',
    sku: e.sku || 'N/A', orderId: e.orderId || '', transactionType: e.transactionType || '',
    postedDate: e.postedDate || null, postedDateStr: e.postedDateStr || '', dedupKey: null,
  }));
  for (const chunk of chunkArray(docs, CHUNK_INSERT_SIZE)) { if (chunk.length === 0) continue; await ExpenseRawRow.insertMany(chunk, { ordered: false }); }
  logger.info(`[ExpenseReportService] Saved ${docs.length} raw expense rows to ExpenseRawRow.`);
}

async function persistExpenseReportResult({ userId, country, regionModel, result, daysBack, postedAfter, postedBefore }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const metadata = result?.metadata || {};
  const regionInternal = mapRegionModelToInternal(regionModel);
  const run = await ExpenseReportRun.create({
    User: userObjectId, country, region: regionModel, regionInternal, marketplaceId: 'FINANCE_API',
    daysBack: Number(daysBack) || getDefaultExpenseFinanceDaysBack(),
    totalRowsProcessed: metadata.totalExpenseRows ?? 0, totalExpenseRows: metadata.totalExpenseRows ?? 0, reportsProcessed: 0,
    totalAmazonFeeRows: metadata.totalAmazonFeeRows ?? 0,
    amazonFeeCategories: Array.isArray(metadata.amazonFeeCategories) ? metadata.amazonFeeCategories : [],
    nonAmazonFeeCategories: Array.isArray(metadata.nonAmazonFeeCategories) ? metadata.nonAmazonFeeCategories : [],
    dateRangeEarliest: metadata.dateRange?.from ?? null, dateRangeLatest: metadata.dateRange?.to ?? null,
    reportDateRangeFrom: postedAfter ? new Date(postedAfter) : null, reportDateRangeTo: postedBefore ? new Date(postedBefore) : null,
    generatedAt: metadata.generatedAt ? new Date(metadata.generatedAt) : new Date(),
    totals: {
      allTime: result?.totalExpenses?.total ?? 0, last7Days: result?.totalExpensesLast7Days?.total ?? 0, last14Days: result?.totalExpensesLast14Days?.total ?? 0,
      amazonAllTime: result?.totalAmazonFees?.total ?? 0, amazonLast7Days: result?.totalAmazonFeesLast7Days?.total ?? 0, amazonLast14Days: result?.totalAmazonFeesLast14Days?.total ?? 0,
    },
  });
  const runId = run._id;

  const periodMap = [{ period: 'all', sectionKey: 'totalExpenses' }, { period: 'last7', sectionKey: 'totalExpensesLast7Days' }, { period: 'last14', sectionKey: 'totalExpensesLast14Days' }];
  for (const { period, sectionKey } of periodMap) {
    const categories = result?.[sectionKey]?.categories || [];
    const docs = categories.map((c) => ({ runId, User: userObjectId, country, region: regionModel, period, category: c.category, totalAmount: Number(c.totalAmount) || 0, count: Number(c.count) || 0 }));
    for (const ch of chunkArray(docs, CHUNK_INSERT_SIZE)) { if (ch.length === 0) continue; await ExpenseCategoryAgg.insertMany(ch, { ordered: false }); }
  }

  const skuPeriods = [{ period: 'all', sectionKey: 'skuWiseExpenses' }, { period: 'last7', sectionKey: 'skuWiseExpensesLast7Days' }, { period: 'last14', sectionKey: 'skuWiseExpensesLast14Days' }];
  for (const { period, sectionKey } of skuPeriods) {
    const skuList = result?.[sectionKey] || [];
    const docs = skuList.map((s) => ({ runId, User: userObjectId, country, region: regionModel, period, sku: s.sku, totalAmount: Number(s.totalAmount) || 0, count: Number(s.count) || 0, breakdown: (s.breakdown || []).map((b) => ({ category: b.category, amount: Number(b.amount) || 0 })) }));
    for (const ch of chunkArray(docs, CHUNK_INSERT_SIZE)) { if (ch.length === 0) continue; await ExpenseSkuAgg.insertMany(ch, { ordered: false }); }
  }

  const skuDateList = result?.skuDateWiseExpenses || [];
  const dateDocs = skuDateList.map((e) => ({ runId, User: userObjectId, country, region: regionModel, sku: e.sku, dateKey: e.date, totalAmount: Number(e.totalAmount) || 0, count: Number(e.count) || 0, breakdown: (e.breakdown || []).map((b) => ({ category: b.category, amount: Number(b.amount) || 0 })) }));
  for (const ch of chunkArray(dateDocs, CHUNK_INSERT_SIZE)) { if (ch.length === 0) continue; await ExpenseSkuDateAgg.insertMany(ch, { ordered: false }); }

  const dateWiseList = result?.dateWiseExpenses || [];
  const dateWiseDocs = dateWiseList.map((e) => ({ runId, User: userObjectId, country, region: regionModel, dateKey: e.date, totalAmount: Number(e.totalAmount) || 0, count: Number(e.count) || 0, breakdown: (e.breakdown || []).map((b) => ({ category: b.category, amount: Number(b.amount) || 0 })) }));
  for (const ch of chunkArray(dateWiseDocs, CHUNK_INSERT_SIZE)) { if (ch.length === 0) continue; await ExpenseDateAgg.insertMany(ch, { ordered: false }); }

  const amazonPeriodMap = [{ period: 'all', sectionKey: 'totalAmazonFees' }, { period: 'last7', sectionKey: 'totalAmazonFeesLast7Days' }, { period: 'last14', sectionKey: 'totalAmazonFeesLast14Days' }];
  for (const { period, sectionKey } of amazonPeriodMap) {
    const categories = result?.[sectionKey]?.categories || [];
    const docs = categories.map((c) => ({ runId, User: userObjectId, country, region: regionModel, period, category: c.category, totalAmount: Number(c.totalAmount) || 0, count: Number(c.count) || 0 }));
    for (const ch of chunkArray(docs, CHUNK_INSERT_SIZE)) { if (ch.length === 0) continue; await ExpenseAmazonFeeCategoryAgg.insertMany(ch, { ordered: false }); }
  }

  const dateWiseAmazon = result?.dateWiseAmazonFees || [];
  const amazonDateDocs = dateWiseAmazon.map((e) => ({ runId, User: userObjectId, country, region: regionModel, dateKey: e.date, totalAmount: Number(e.totalAmount) || 0, count: Number(e.count) || 0, breakdown: (e.breakdown || []).map((b) => ({ category: b.category, amount: Number(b.amount) || 0 })) }));
  for (const ch of chunkArray(amazonDateDocs, CHUNK_INSERT_SIZE)) { if (ch.length === 0) continue; await ExpenseAmazonFeeDateAgg.insertMany(ch, { ordered: false }); }

  return runId;
}

async function buildExpenseReportResponseFromDB({ userId, country, regionModel }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const regionInternal = internalRegionFromModel(regionModel);
  const run = await ExpenseReportRun.findOne({ User: userObjectId, country, region: regionModel }).sort({ generatedAt: -1 }).lean();
  if (!run) return null;

  const [allCats, last7Cats, last14Cats, amazonCatsAll, amazonCatsLast7, amazonCatsLast14] = await Promise.all([
    ExpenseCategoryAgg.find({ runId: run._id, period: 'all' }).sort({ totalAmount: 1 }).lean(),
    ExpenseCategoryAgg.find({ runId: run._id, period: 'last7' }).sort({ totalAmount: 1 }).lean(),
    ExpenseCategoryAgg.find({ runId: run._id, period: 'last14' }).sort({ totalAmount: 1 }).lean(),
    ExpenseAmazonFeeCategoryAgg.find({ runId: run._id, period: 'all' }).sort({ totalAmount: 1 }).lean(),
    ExpenseAmazonFeeCategoryAgg.find({ runId: run._id, period: 'last7' }).sort({ totalAmount: 1 }).lean(),
    ExpenseAmazonFeeCategoryAgg.find({ runId: run._id, period: 'last14' }).sort({ totalAmount: 1 }).lean(),
  ]);

  const mapCats = (cats) => cats.map((c) => ({ category: c.category, totalAmount: c.totalAmount, count: c.count }));
  const totalExpenses = { total: run.totals?.allTime ?? 0, categories: mapCats(allCats) };
  const totalExpensesLast7Days = { total: run.totals?.last7Days ?? 0, categories: mapCats(last7Cats) };
  const totalExpensesLast14Days = { total: run.totals?.last14Days ?? 0, categories: mapCats(last14Cats) };
  const totalAmazonFees = { total: run.totals?.amazonAllTime ?? 0, categories: mapCats(amazonCatsAll) };
  const totalAmazonFeesLast7Days = { total: run.totals?.amazonLast7Days ?? 0, categories: mapCats(amazonCatsLast7) };
  const totalAmazonFeesLast14Days = { total: run.totals?.amazonLast14Days ?? 0, categories: mapCats(amazonCatsLast14) };

  const [skuAll, skuLast7, skuLast14, skuDateWise, dateWiseTotals, dateWiseAmazonTotals] = await Promise.all([
    ExpenseSkuAgg.find({ runId: run._id, period: 'all' }).sort({ totalAmount: 1 }).lean(),
    ExpenseSkuAgg.find({ runId: run._id, period: 'last7' }).sort({ totalAmount: 1 }).lean(),
    ExpenseSkuAgg.find({ runId: run._id, period: 'last14' }).sort({ totalAmount: 1 }).lean(),
    ExpenseSkuDateAgg.find({ runId: run._id }).lean(),
    ExpenseDateAgg.find({ runId: run._id }).lean(),
    ExpenseAmazonFeeDateAgg.find({ runId: run._id }).lean(),
  ]);

  const mapSkuRows = (rows) => rows.map((s) => ({ sku: s.sku, totalAmount: s.totalAmount, count: s.count, breakdown: (s.breakdown || []).slice().sort((a, b) => a.amount - b.amount).map((b) => ({ category: b.category, amount: b.amount })) }));
  const mapDateRows = (rows) => rows.map((e) => ({ date: e.dateKey, totalAmount: e.totalAmount, count: e.count, breakdown: (e.breakdown || []).slice().sort((a, b) => a.amount - b.amount).map((b) => ({ category: b.category, amount: b.amount })) })).sort((a, b) => (a.date !== b.date ? (a.date > b.date ? -1 : 1) : 0));

  const skuDateWiseExpenses = skuDateWise.map((e) => ({ sku: e.sku, date: e.dateKey, totalAmount: e.totalAmount, count: e.count, breakdown: (e.breakdown || []).slice().sort((a, b) => a.amount - b.amount).map((b) => ({ category: b.category, amount: b.amount })) })).sort((a, b) => { if (a.date !== b.date) return a.date > b.date ? -1 : 1; return a.sku.localeCompare(b.sku); });

  return {
    totalExpenses, totalExpensesLast7Days, totalExpensesLast14Days,
    skuWiseExpenses: mapSkuRows(skuAll), skuWiseExpensesLast7Days: mapSkuRows(skuLast7), skuWiseExpensesLast14Days: mapSkuRows(skuLast14),
    skuDateWiseExpenses, dateWiseExpenses: mapDateRows(dateWiseTotals),
    totalAmazonFees, totalAmazonFeesLast7Days, totalAmazonFeesLast14Days, dateWiseAmazonFees: mapDateRows(dateWiseAmazonTotals),
    metadata: {
      totalRowsProcessed: run.totalRowsProcessed, totalExpenseRows: run.totalExpenseRows, totalAmazonFeeRows: run.totalAmazonFeeRows ?? 0,
      amazonFeeCategories: run.amazonFeeCategories || [], nonAmazonFeeCategories: run.nonAmazonFeeCategories || [],
      dateRange: { from: run.dateRangeEarliest ?? null, to: run.dateRangeLatest ?? null,
        fromFormatted: run.dateRangeEarliest ? new Date(run.dateRangeEarliest).toLocaleDateString('en-GB', { timeZone: 'UTC' }).replace(/\//g, '/') : 'N/A',
        toFormatted: run.dateRangeLatest ? new Date(run.dateRangeLatest).toLocaleDateString('en-GB', { timeZone: 'UTC' }).replace(/\//g, '/') : 'N/A',
      },
      generatedAt: run.generatedAt ? new Date(run.generatedAt).toISOString() : new Date().toISOString(),
      country, region: regionInternal, marketplaceId: run.marketplaceId, daysBack: run.daysBack,
      reportDateRange: { from: run.reportDateRangeFrom ?? null, to: run.reportDateRangeTo ?? null,
        fromFormatted: run.reportDateRangeFrom ? new Date(run.reportDateRangeFrom).toLocaleDateString('en-GB', { timeZone: 'UTC' }) : 'N/A',
        toFormatted: run.reportDateRangeTo ? new Date(run.reportDateRangeTo).toLocaleDateString('en-GB', { timeZone: 'UTC' }) : 'N/A',
      },
    },
  };
}

async function fetchPersistAndReturnExpenseReport({
  userId,
  country,
  regionModel,
  refreshToken,
  accessToken,
  daysBack = getDefaultExpenseFinanceDaysBack(),
  // Optional exact date-range override (YYYY-MM-DD)
  from,
  to,
  clientId = process.env.SPAPI_CLIENT_ID,
  clientSecret = process.env.SPAPI_CLIENT_SECRET,
}) {
  const regionInternal = internalRegionFromModel(regionModel);
  if (!regionInternal) throw new Error(`Invalid regionModel: ${regionModel}. Expected NA, EU, FE.`);
  logger.info('[ExpenseReportService] Starting expense report flow ...', {
    userId,
    country,
    regionModel,
    daysBack,
    from: from || null,
    to: to || null,
  });

  let effectiveDaysBack = Number(daysBack) || getDefaultExpenseFinanceDaysBack();
  if (from && to) {
    const fromD = new Date(`${from}T00:00:00.000Z`);
    const toD = new Date(`${to}T23:59:59.999Z`);
    if (!Number.isNaN(fromD.getTime()) && !Number.isNaN(toD.getTime()) && fromD <= toD) {
      // Inclusive day count (approx)
      effectiveDaysBack = Math.max(1, Math.ceil((toD.getTime() - fromD.getTime()) / (24 * 60 * 60 * 1000)));
    }
  }

  const fetchResult = await fetchNewFinanceData({
    refreshToken,
    accessToken,
    clientId,
    clientSecret,
    country,
    region: regionInternal,
    daysBack: effectiveDaysBack,
    from,
    to,
  });

  if (!fetchResult.hasNewData || !fetchResult.expenseRows || fetchResult.expenseRows.length === 0) {
    logger.info('[ExpenseReportService] No financial events found. Returning existing DB data.');
    const existing = await buildExpenseReportResponseFromDB({ userId, country, regionModel });
    return { hasNewData: false, data: existing };
  }

  logger.info(`[ExpenseReportService] Fetched ${fetchResult.expenseRows.length} expense rows. Analyzing...`);
  const analysis = analyzeExpenses(fetchResult.expenseRows);
  logger.info(`[ExpenseReportService] Analysis complete. Total: ${analysis.totalExpenses.total} | Amazon fees: ${analysis.totalAmazonFees.total}`);

  logger.info('[ExpenseReportService] Cleaning up overlapping raw rows...');
  await cleanupOverlappingRawRows({ userId, country, regionModel, postedAfter: fetchResult.postedAfter, postedBefore: fetchResult.postedBefore });

  logger.info(`[ExpenseReportService] Saving ${fetchResult.expenseRows.length} raw rows to ExpenseRawRow...`);
  await saveRawExpenseRows({ userId, country, regionModel, expenseRows: fetchResult.expenseRows });

  logger.info('[ExpenseReportService] Persisting fresh analysis to Mongo...');
  await persistExpenseReportResult({
    userId,
    country,
    regionModel,
    result: analysis,
    daysBack: effectiveDaysBack,
    postedAfter: fetchResult.postedAfter,
    postedBefore: fetchResult.postedBefore,
  });

  logger.info('[ExpenseReportService] Returning expense report from Mongo...');
  const fromDb = await buildExpenseReportResponseFromDB({ userId, country, regionModel });
  return { hasNewData: true, data: fromDb };
}

module.exports = { fetchPersistAndReturnExpenseReport, buildExpenseReportResponseFromDB };
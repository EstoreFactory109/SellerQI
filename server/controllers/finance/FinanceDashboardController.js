// ═══════════════════════════════════════════════════════════════════════════
// Finance dashboard HTTP READ handlers.
//
// This file used to also carry a STALE DUPLICATE of the entire finance sync/fetch pipeline
// (syncFinanceData, fetchNewSalesAndExpenses, parseSalesReportRows, backfillPendingExpenses,
// buildOverheadBuckets, the category maps, its own `PACIFIC_OFFSET_HOURS = 7` and
// toPacificDateStr, ...). It was never routed — only the read handlers below are — but it WAS
// exported, so a future `require` could have picked it up, and it had drifted badly: it was
// missing every reliability fix made to FinanceService.js.
//
// It was deleted when day bucketing moved from a hardcoded Pacific offset to marketplace-local
// (utils/marketplaceTimezone.js), rather than fixing the same bug twice in two copies.
//
// The canonical, maintained implementation is server/Services/Sp_API/FinanceService.js.
// → To trigger a finance sync, call FinanceService.syncFinanceData.
// → Do not reintroduce fetch/sync logic here.
// ═══════════════════════════════════════════════════════════════════════════

const mongoose = require('mongoose');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const FinanceDashboardReadService = require('../../Services/Finance/FinanceDashboardReadService.js');

const FinanceSyncLog = require('../../models/finance/FinanceSyncLogModel.js');
const PendingExpenseOrder = require('../../models/finance/PendingExpenseOrderModel.js');
const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');

// ═══════════════════════════════════════════════
// HTTP: Dashboard reads (FinanceDashboardReadService)
// ═══════════════════════════════════════════════

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateFinanceDateRange(startDate, endDate) {
  if (!startDate || !endDate || !DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return 'startDate and endDate are required (YYYY-MM-DD).';
  }
  if (startDate > endDate) return 'startDate must be on or before endDate.';
  return null;
}

/** Default date window from DataFetchTracking (same source as dashboard phase 1). */
const getFinanceDateRange = asyncHandler(async (req, res) => {
  const userObjectId =
    typeof req.userId === 'string' ? new mongoose.Types.ObjectId(req.userId) : req.userId;

  const doc = await DataFetchTracking.findOne({
    User: userObjectId,
    country: req.country,
    region: req.region,
    status: { $in: ['completed', 'partial'] },
  })
    .sort({ fetchedAt: -1 })
    .select('dataRange status')
    .lean();

  const startDate = doc?.dataRange?.startDate || null;
  const endDate = doc?.dataRange?.endDate || null;

  return res.status(200).json(
    new ApiResponse(
      200,
      { startDate, endDate, calendarMode: 'default' },
      'Finance dashboard default date range'
    )
  );
});

const getFinanceDashboard = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const validationError = validateFinanceDateRange(startDate, endDate);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }
  const data = await FinanceDashboardReadService.getDashboard({
    userId: req.userId,
    country: req.country,
    region: req.region,
    startDate,
    endDate,
  });
  return res.status(200).json(new ApiResponse(200, data, 'Finance dashboard data'));
});

const getFinanceAsinDetail = asyncHandler(async (req, res) => {
  const { asin } = req.params;
  const { startDate, endDate } = req.query;
  const validationError = validateFinanceDateRange(startDate, endDate);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }
  if (!asin || String(asin).trim() === '') {
    return res.status(400).json(new ApiError(400, 'asin is required'));
  }
  const rows = await FinanceDashboardReadService.getAsinDetail({
    userId: req.userId,
    country: req.country,
    region: req.region,
    asin: String(asin).trim(),
    startDate,
    endDate,
  });
  return res.status(200).json(new ApiResponse(200, rows, 'ASIN finance detail'));
});

const getFinanceAsinSnapshot = asyncHandler(async (req, res) => {
  const { asin } = req.params;
  const { startDate, endDate } = req.query;
  const validationError = validateFinanceDateRange(startDate, endDate);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }
  const normalized = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) {
    return res.status(400).json(new ApiError(400, 'Invalid ASIN.'));
  }
  const data = await FinanceDashboardReadService.getAsinSnapshot({
    userId: req.userId,
    country: req.country,
    region: req.region,
    startDate,
    endDate,
    asin: normalized,
  });
  return res.status(200).json(
    new ApiResponse(200, data, 'ASIN finance snapshot')
  );
});

/** Wraps internal getSyncStatus (pending orders + FinanceSyncLog range). */
const getFinanceSyncStatus = asyncHandler(async (req, res) => {
  const data = await getSyncStatus({
    userId: req.userId,
    country: req.country,
    regionModel: req.region,
  });
  return res.status(200).json(new ApiResponse(200, data, 'Finance sync status'));
});

// ═══════════════════════════════════════════════
// QUERY: Sync status (internal — used by HTTP + jobs)
// ═══════════════════════════════════════════════
async function getSyncStatus({ userId, country, regionModel }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const match = { User: userObjectId, country: country.toUpperCase(), region: regionModel };

  const [syncResult] = await FinanceSyncLog.aggregate([
    { $match: { ...match, status: 'success' } },
    { $group: { _id: null, latestDate: { $max: '$date' }, earliestDate: { $min: '$date' }, totalSyncedDays: { $sum: 1 } } },
    { $project: { _id: 0 } },
  ]);

  const pendingCount = await PendingExpenseOrder.countDocuments(match);

  return {
    latestDate: syncResult?.latestDate || null,
    earliestDate: syncResult?.earliestDate || null,
    totalSyncedDays: syncResult?.totalSyncedDays || 0,
    pendingExpenseOrders: pendingCount,
  };
}

// ─────────────────────────────────────────────
// EXPORTS — the five routed read handlers only.
// ─────────────────────────────────────────────
module.exports = {
  getFinanceDateRange,
  getFinanceDashboard,
  getFinanceAsinDetail,
  getFinanceAsinSnapshot,
  getFinanceSyncStatus,
};

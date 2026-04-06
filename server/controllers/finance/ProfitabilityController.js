const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const ProfitabilityReadService = require('../../Services/Finance/ProfitabilityReadService.js');

function parsePeriod(period) {
  const value = Number(period);
  if (![7, 14, 30].includes(value)) return null;
  return value;
}

function getUserContext(req) {
  return { userId: req.userId, country: req.country, region: req.region };
}

function validateDates(from, to) {
  if (!from || !to) return 'Both from and to dates are required (YYYY-MM-DD).';
  const f = new Date(`${from}T00:00:00.000Z`);
  const t = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return 'Invalid date format.';
  if (f > t) return 'from must be <= to.';
  return null;
}

const getSummaryByPeriod = asyncHandler(async (req, res) => {
  const periodDays = parsePeriod(req.query.period);
  if (!periodDays) return res.status(400).json(new ApiError(400, 'Invalid period. Expected 7, 14, or 30.'));

  const data = await ProfitabilityReadService.getSummaryByPeriod({ ...getUserContext(req), periodDays });
  return res.status(200).json(new ApiResponse(200, data, `Profitability summary for last ${periodDays} days`));
});

const getSummaryByDateRange = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const err = validateDates(from, to);
  if (err) return res.status(400).json(new ApiError(400, err));

  const data = await ProfitabilityReadService.getSummaryByDateRange({ ...getUserContext(req), from, to });
  return res.status(200).json(new ApiResponse(200, data, 'Profitability summary for date range'));
});

const getChartByPeriod = asyncHandler(async (req, res) => {
  const periodDays = parsePeriod(req.query.period);
  if (!periodDays) return res.status(400).json(new ApiError(400, 'Invalid period. Expected 7, 14, or 30.'));

  const data = await ProfitabilityReadService.getChartByPeriod({ ...getUserContext(req), periodDays });
  return res.status(200).json(new ApiResponse(200, data, `Profitability chart for last ${periodDays} days`));
});

const getChartByDateRange = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const err = validateDates(from, to);
  if (err) return res.status(400).json(new ApiError(400, err));

  const data = await ProfitabilityReadService.getChartByDateRange({ ...getUserContext(req), from, to });
  return res.status(200).json(new ApiResponse(200, data, 'Profitability chart for date range'));
});

const getTableByPeriod = asyncHandler(async (req, res) => {
  const periodDays = parsePeriod(req.query.period);
  if (!periodDays) return res.status(400).json(new ApiError(400, 'Invalid period. Expected 7, 14, or 30.'));

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));

  const data = await ProfitabilityReadService.getTableByPeriod({ ...getUserContext(req), periodDays, page, limit });
  return res.status(200).json(new ApiResponse(200, data, `Profitability table for last ${periodDays} days`));
});

const getTableByDateRange = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const err = validateDates(from, to);
  if (err) return res.status(400).json(new ApiError(400, err));

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));

  const data = await ProfitabilityReadService.getTableByDateRange({ ...getUserContext(req), from, to, page, limit });
  return res.status(200).json(new ApiResponse(200, data, 'Profitability table for date range'));
});

module.exports = {
  getSummaryByPeriod,
  getSummaryByDateRange,
  getChartByPeriod,
  getChartByDateRange,
  getTableByPeriod,
  getTableByDateRange,
};

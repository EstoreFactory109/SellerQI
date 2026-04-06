const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const ExpenseReadService = require('../../Services/Finance/ExpenseReadService.js');
const { buildExpenseReportResponseFromDB } = require('../../Services/Sp_API/ExpenseReportService.js');

function parsePeriod(period) {
  const value = Number(period);
  if (![7, 14, 30].includes(value)) return null;
  return value;
}

function getUserContext(req) {
  return {
    userId: req.userId,
    country: req.country,
    region: req.region,
  };
}

const getTotalExpensesByPeriod = asyncHandler(async (req, res) => {
  const periodDays = parsePeriod(req.query.period);
  if (!periodDays) {
    return res.status(400).json(new ApiError(400, 'Invalid period. Expected one of: 7, 14, 30.'));
  }

  const data = await ExpenseReadService.getTotalExpensesByPeriod({
    ...getUserContext(req),
    periodDays,
  });

  return res.status(200).json(
    new ApiResponse(200, data, `Total expenses fetched for last ${periodDays} days`)
  );
});

const getTotalExpensesByDateRange = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const validationError = ExpenseReadService.validateDateRange(from, to);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }

  const data = await ExpenseReadService.getTotalExpensesByDateRange({
    ...getUserContext(req),
    from,
    to,
  });

  return res.status(200).json(
    new ApiResponse(200, data, 'Total expenses fetched for selected date range')
  );
});

const getTotalAmazonFeesByPeriod = asyncHandler(async (req, res) => {
  const periodDays = parsePeriod(req.query.period);
  if (!periodDays) {
    return res.status(400).json(new ApiError(400, 'Invalid period. Expected one of: 7, 14, 30.'));
  }

  const data = await ExpenseReadService.getTotalAmazonFeesByPeriod({
    ...getUserContext(req),
    periodDays,
  });

  return res.status(200).json(
    new ApiResponse(200, data, `Total Amazon fees fetched for last ${periodDays} days`)
  );
});

const getTotalAmazonFeesByDateRange = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const validationError = ExpenseReadService.validateDateRange(from, to);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }

  const data = await ExpenseReadService.getTotalAmazonFeesByDateRange({
    ...getUserContext(req),
    from,
    to,
  });

  return res.status(200).json(
    new ApiResponse(200, data, 'Total Amazon fees fetched for selected date range')
  );
});

const getAsinWiseExpensesByPeriod = asyncHandler(async (req, res) => {
  const periodDays = parsePeriod(req.query.period);
  if (!periodDays) {
    return res.status(400).json(new ApiError(400, 'Invalid period. Expected one of: 7, 14, 30.'));
  }

  const data = await ExpenseReadService.getAsinWiseExpensesByPeriod({
    ...getUserContext(req),
    periodDays,
  });

  return res.status(200).json(
    new ApiResponse(200, data, `ASIN-wise expenses fetched for last ${periodDays} days`)
  );
});

const getAsinWiseExpensesByDateRange = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const validationError = ExpenseReadService.validateDateRange(from, to);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }

  const data = await ExpenseReadService.getAsinWiseExpensesByDateRange({
    ...getUserContext(req),
    from,
    to,
  });

  return res.status(200).json(
    new ApiResponse(200, data, 'ASIN-wise expenses fetched for selected date range')
  );
});

const getRefundsByPeriod = asyncHandler(async (req, res) => {
  const periodDays = parsePeriod(req.query.period);
  if (!periodDays) {
    return res.status(400).json(new ApiError(400, 'Invalid period. Expected one of: 7, 14, 30.'));
  }

  const data = await ExpenseReadService.getRefundsByPeriod({
    ...getUserContext(req),
    periodDays,
  });

  return res.status(200).json(
    new ApiResponse(200, data, `Refunds fetched for last ${periodDays} days`)
  );
});

const getRefundsByDateRange = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const validationError = ExpenseReadService.validateDateRange(from, to);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }

  const data = await ExpenseReadService.getRefundsByDateRange({
    ...getUserContext(req),
    from,
    to,
  });

  return res.status(200).json(
    new ApiResponse(200, data, 'Refunds fetched for selected date range')
  );
});

/** Latest persisted expense report (ExpenseReportRun + aggs) for current marketplace */
const getExpenseReportSnapshot = asyncHandler(async (req, res) => {
  const data = await buildExpenseReportResponseFromDB({
    userId: req.userId,
    country: req.country,
    regionModel: req.region,
  });

  if (!data) {
    return res.status(200).json(
      new ApiResponse(200, null, 'No expense report snapshot in database yet')
    );
  }

  return res.status(200).json(
    new ApiResponse(200, data, 'Expense report snapshot from database')
  );
});

module.exports = {
  getTotalExpensesByPeriod,
  getTotalExpensesByDateRange,
  getTotalAmazonFeesByPeriod,
  getTotalAmazonFeesByDateRange,
  getAsinWiseExpensesByPeriod,
  getAsinWiseExpensesByDateRange,
  getRefundsByPeriod,
  getRefundsByDateRange,
  getExpenseReportSnapshot,
};


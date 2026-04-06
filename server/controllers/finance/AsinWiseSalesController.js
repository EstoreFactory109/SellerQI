const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const AsinWiseSalesReadService = require('../../Services/Finance/AsinWiseSalesReadService.js');

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

const getAsinWiseSalesByPeriod = asyncHandler(async (req, res) => {
  const periodDays = parsePeriod(req.query.period);
  if (!periodDays) {
    return res.status(400).json(new ApiError(400, 'Invalid period. Expected one of: 7, 14, 30.'));
  }

  const data = await AsinWiseSalesReadService.getAsinWiseSalesByPeriod({
    ...getUserContext(req),
    periodDays,
  });

  return res.status(200).json(
    new ApiResponse(200, data, `ASIN-wise sales fetched for last ${periodDays} days`)
  );
});

const getAsinWiseSalesByDateRange = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const validationError = AsinWiseSalesReadService.validateDateRange(from, to);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }

  const data = await AsinWiseSalesReadService.getAsinWiseSalesByDateRange({
    ...getUserContext(req),
    from,
    to,
  });

  return res.status(200).json(
    new ApiResponse(200, data, 'ASIN-wise sales fetched for selected date range')
  );
});

module.exports = {
  getAsinWiseSalesByPeriod,
  getAsinWiseSalesByDateRange,
};


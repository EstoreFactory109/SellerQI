const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const FbaInventoryReadService = require('../../Services/inventory/FbaInventoryReadService.js');

/**
 * GET .../asin/:asin — full stored FBA inventory rows for that ASIN (all MSKUs) for the location in IBEXLocationToken.
 */
const getFbaInventoryByAsin = asyncHandler(async (req, res) => {
  const asin = req.params.asin;
  if (!asin || !String(asin).trim()) {
    return res.status(400).json(new ApiError(400, 'ASIN is required'));
  }

  let data;
  try {
    data = await FbaInventoryReadService.getByAsin({
      userId: req.userId,
      country: req.country,
      region: req.region,
      asin,
    });
  } catch (e) {
    return res.status(400).json(new ApiError(400, e.message || 'Invalid request'));
  }

  if (!data.items || data.items.length === 0) {
    return res.status(404).json(
      new ApiError(404, 'No FBA inventory snapshot found for this ASIN in the selected marketplace')
    );
  }

  return res
    .status(200)
    .json(new ApiResponse(200, data, 'FBA inventory storage data fetched for ASIN'));
});

module.exports = {
  getFbaInventoryByAsin,
};

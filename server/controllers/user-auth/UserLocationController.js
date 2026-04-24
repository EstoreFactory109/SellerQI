const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { getUserLocation } = require('../../Services/User/UserLocationService.js');

/**
 * GET /app/user-location
 *
 * Returns the Amazon marketplace `country` and `region` associated with the
 * currently authenticated user. Used by the onboarding ConnectAccounts page
 * so it can build the correct Amazon Seller Central / Amazon Ads OAuth URL
 * without relying on URL query parameters.
 *
 * This endpoint is fully standalone:
 *   - It only reads from the Seller collection.
 *   - It does not modify any documents.
 *   - It does not depend on any existing flow and is not referenced by
 *     any other controller or service.
 */
const getLoggedInUserLocation = asyncHandler(async (req, res) => {
    const userId = req.userId;

    if (!userId) {
        return res.status(401).json(new ApiResponse(401, null, 'Unauthorized'));
    }

    const { country, region } = await getUserLocation(userId);

    if (!country || !region) {
        return res
            .status(404)
            .json(new ApiResponse(404, { country, region }, 'No seller account location found for this user'));
    }

    return res
        .status(200)
        .json(new ApiResponse(200, { country, region }, 'User location fetched successfully'));
});

module.exports = { getLoggedInUserLocation };

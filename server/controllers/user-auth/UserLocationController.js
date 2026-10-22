const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { getUserLocation } = require('../../Services/User/UserLocationService.js');
const { createLocationToken } = require('../../utils/Tokens.js');
const { getHttpCookieOptions } = require('../../utils/cookieConfig.js');

/**
 * GET /app/user-location
 *
 * Returns the Amazon marketplace `country` and `region` the ConnectAccounts page
 * should build its Amazon Seller Central / Amazon Ads OAuth URL for.
 *
 * Query `?country=&region=`: the marketplace the page was opened for (Settings'
 * "Connect" on a marketplace card, or the add-marketplace popup). Used when the
 * user owns it; otherwise the session's marketplace, then the user's first one.
 *
 * When the answer differs from the session's location cookie, the cookie is moved
 * to it. The token endpoints save to the cookie's marketplace, so without this the
 * consent page could be for one marketplace and the token saved to another.
 *
 * Reads only the Seller collection; the only write is the location cookie.
 */
const getLoggedInUserLocation = asyncHandler(async (req, res) => {
    const userId = req.userId;

    if (!userId) {
        return res.status(401).json(new ApiResponse(401, null, 'Unauthorized'));
    }

    const requested = { country: req.query?.country, region: req.query?.region };
    const session = { country: req.country, region: req.region };
    const { country, region } = await getUserLocation(userId, [requested, session]);

    if (!country || !region) {
        return res
            .status(404)
            .json(new ApiResponse(404, { country, region }, 'No seller account location found for this user'));
    }

    if (country !== session.country || region !== session.region) {
        const locationToken = await createLocationToken(country, region);
        if (locationToken) res.cookie('IBEXLocationToken', locationToken, getHttpCookieOptions());
    }

    return res
        .status(200)
        .json(new ApiResponse(200, { country, region }, 'User location fetched successfully'));
});

module.exports = { getLoggedInUserLocation };

/**
 * Pause Keyword Controller (main / production)
 *
 * Pauses an Amazon Ads keyword. Used by the PPC Dashboard "Wasted Spend Keywords" table.
 * Requires auth + getLocation (req.userId, req.country, req.region).
 *
 * POST /api/pagewise/ads/pause-keyword
 * Body: { keywordId: string, adType?: "SP" | "SB" | "SD" }  — adType defaults to "SP"
 */

const mongoose = require('mongoose');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
const { pauseKeywords } = require('../../Services/AmazonAds/Pause-ArchiveKeywords.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');

const validAdTypes = ['SP', 'SB', 'SD'];

async function resolveAdsCredentials(userId, country, region) {
  let userIdQuery = userId;
  if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
    userIdQuery = new mongoose.Types.ObjectId(userId);
  }

  const sellerCentral = await Seller.findOne({ User: userIdQuery });
  if (!sellerCentral) {
    throw new ApiError(404, 'Seller account not found', {
      suggestion: 'Ensure the user has connected their Amazon Seller Central account.',
    });
  }

  const sellerAccount = sellerCentral.sellerAccount?.find(
    (acc) => acc.country === country && acc.region === region
  );
  if (!sellerAccount) {
    throw new ApiError(404, `No seller account for country: ${country}, region: ${region}`);
  }

  if (!sellerAccount.adsRefreshToken) {
    throw new ApiError(400, 'Ads refresh token not found', {
      suggestion: 'Connect the Amazon Ads account first.',
    });
  }

  const accessToken = await generateAdsAccessToken(sellerAccount.adsRefreshToken);
  if (!accessToken) {
    throw new ApiError(500, 'Failed to generate Ads access token', {
      suggestion: 'Refresh token may be invalid. Try reconnecting the Amazon Ads account.',
    });
  }

  let profileId = sellerAccount.ProfileId?.toString();
  if (!profileId) {
    const profiles = await getProfileById(accessToken, region, country, userId);
    if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
      throw new ApiError(400, 'No Amazon Ads profiles found for this account');
    }
    const countryCodeMap = {
      US: 'US', CA: 'CA', MX: 'MX', BR: 'BR',
      UK: 'UK', GB: 'UK', DE: 'DE', FR: 'FR', ES: 'ES', IT: 'IT', NL: 'NL', SE: 'SE', PL: 'PL', BE: 'BE',
      JP: 'JP', AU: 'AU', SG: 'SG', IN: 'IN', AE: 'AE', SA: 'SA',
    };
    const targetCountryCode = countryCodeMap[country] || country;
    const matchingProfile =
      profiles.find(
        (p) =>
          p.countryCode === targetCountryCode ||
          p.countryCode?.toUpperCase() === country?.toUpperCase()
      ) || profiles[0];
    profileId = matchingProfile.profileId?.toString();
    if (!profileId) {
      throw new ApiError(400, 'Could not resolve a profile ID from Amazon Ads API.');
    }
  }

  return { accessToken, profileId, region };
}

/**
 * POST /api/pagewise/ads/pause-keyword
 * Body: { keywordId: string (required), adType?: "SP" | "SB" | "SD" }
 */
const pauseKeyword = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const country = req.country;
  const region = req.region;
  const { keywordId, adType = 'SP' } = req.body || {};

  if (!userId || !country || !region) {
    return res.status(400).json(
      new ApiError(400, 'User ID, country, and region are required (set by auth and getLocation)')
    );
  }

  if (!keywordId) {
    return res.status(400).json(
      new ApiError(400, 'keywordId is required in request body')
    );
  }

  const adTypeUpper = (adType || 'SP').toUpperCase();
  if (!validAdTypes.includes(adTypeUpper)) {
    return res.status(400).json(
      new ApiError(400, `Invalid adType. Use one of: ${validAdTypes.join(', ')}`)
    );
  }

  const clientId = process.env.AMAZON_ADS_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json(
      new ApiError(500, 'AMAZON_ADS_CLIENT_ID is not set in environment')
    );
  }

  const { accessToken, profileId, region: resolvedRegion } = await resolveAdsCredentials(
    userId,
    country,
    region
  );

  logger.info('[PauseKeyword] Pausing keyword', { keywordId: String(keywordId), adType: adTypeUpper, userId });

  const result = await pauseKeywords({
    adType: adTypeUpper,
    keywordId: String(keywordId),
    accessToken,
    profileId,
    region: resolvedRegion,
    clientId,
  });

  const failed = Object.entries(result).find(([, v]) => v && v.success === false);
  if (failed) {
    const [, errObj] = failed;
    return res.status(400).json(
      new ApiError(400, errObj.error || 'Failed to pause keyword', { result })
    );
  }

  return res.status(200).json(
    new ApiResponse(200, result, 'Keyword paused successfully')
  );
});

module.exports = { pauseKeyword };

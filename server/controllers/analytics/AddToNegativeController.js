/**
 * Add to Negative Keywords Controller (main / production)
 *
 * Adds selected keywords as negative keywords in Amazon Ads (ad-group or campaign level).
 * Requires auth + getLocation (req.userId, req.country, req.region).
 *
 * POST /api/pagewise/ads/add-to-negative
 * Body: {
 *   keywords: Array<{ campaignId, adGroupId?, keywordText, matchType? }>,  // adGroupId required for level 'adGroup'
 *   level?: 'adGroup' | 'campaign',   // default 'adGroup'
 *   matchType?: 'negativeExact' | 'negativePhrase'  // default applied per keyword or 'negativeExact'
 * }
 */

const mongoose = require('mongoose');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
const { addToNegative, getConfig } = require('../../Services/AmazonAds/addToNegetive.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');

const validLevels = ['adgroup', 'campaign'];

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
 * POST /api/pagewise/ads/add-to-negative
 * Body: { keywords: [...], level?: 'adGroup' | 'campaign', matchType?: 'negativeExact' | 'negativePhrase' }
 */
const addToNegativeKeywords = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const country = req.country;
  const region = req.region;
  const { keywords, level = 'adGroup', matchType: defaultMatchType } = req.body || {};

  if (!userId || !country || !region) {
    return res.status(400).json(
      new ApiError(400, 'User ID, country, and region are required (set by auth and getLocation)')
    );
  }

  if (!Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json(
      new ApiError(400, 'keywords array is required and must not be empty')
    );
  }

  const levelLower = (level || 'adGroup').toLowerCase();
  if (!validLevels.includes(levelLower)) {
    return res.status(400).json(
      new ApiError(400, `Invalid level. Use one of: ${validLevels.join(', ')}`)
    );
  }

  if (levelLower === 'adgroup') {
    const missing = keywords.some((kw) => !kw.campaignId || !kw.adGroupId || !kw.keywordText);
    if (missing) {
      return res.status(400).json(
        new ApiError(400, 'Each keyword must have campaignId, adGroupId, and keywordText when level is adGroup')
      );
    }
  } else {
    const missing = keywords.some((kw) => !kw.campaignId || !kw.keywordText);
    if (missing) {
      return res.status(400).json(
        new ApiError(400, 'Each keyword must have campaignId and keywordText when level is campaign')
      );
    }
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

  const config = getConfig({
    accessToken,
    profileId,
    region: resolvedRegion,
    clientId,
  });

  const normalizedKeywords = keywords.map((kw) => ({
    campaignId: String(kw.campaignId),
    adGroupId: kw.adGroupId != null ? String(kw.adGroupId) : undefined,
    keywordText: kw.keywordText,
    matchType: kw.matchType || defaultMatchType || 'negativeExact',
    state: kw.state || 'enabled',
  }));

  logger.info('[AddToNegative] Adding keywords to negative', {
    count: normalizedKeywords.length,
    level: levelLower,
    userId,
  });

  const result = await addToNegative(config, normalizedKeywords, { level: levelLower });

  return res.status(200).json(
    new ApiResponse(200, result, 'Keywords added to negative successfully')
  );
});

module.exports = { addToNegativeKeywords };

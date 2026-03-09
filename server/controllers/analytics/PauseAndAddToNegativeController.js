/**
 * Pause and Add to Negative Controller (main / production)
 *
 * Performs two operations synchronously in one request:
 * 1. Pause the keyword in Amazon Ads (SP)
 * 2. Add the same keyword as a negative keyword (ad-group level)
 *
 * Requires auth + getLocation (req.userId, req.country, req.region).
 *
 * POST /api/pagewise/ads/pause-and-add-to-negative
 * Body: {
 *   keywordId: string (required),
 *   campaignId: string (required),
 *   adGroupId: string (required),
 *   keywordText: string (required),
 *   matchType?: 'negativeExact' | 'negativePhrase',
 *   adType?: 'SP' | 'SB' | 'SD'
 * }
 */

const mongoose = require('mongoose');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
const { pauseKeywords } = require('../../Services/AmazonAds/Pause-ArchiveKeywords.js');
const { addToNegative, getConfig } = require('../../Services/AmazonAds/addToNegetive.js');
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
 * POST /api/pagewise/ads/pause-and-add-to-negative
 * Body: { keywordId, campaignId, adGroupId, keywordText, matchType?, adType? }
 */
const pauseAndAddToNegative = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const country = req.country;
  const region = req.region;
  const { keywordId, campaignId, adGroupId, keywordText, matchType = 'negativePhrase', adType = 'SP' } = req.body || {};

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
  if (!campaignId || !adGroupId || !keywordText) {
    return res.status(400).json(
      new ApiError(400, 'campaignId, adGroupId, and keywordText are required for add-to-negative step')
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

  const config = getConfig({
    accessToken,
    profileId,
    region: resolvedRegion,
    clientId,
  });

  logger.info('[PauseAndAddToNegative] Step 1: Pausing keyword', { keywordId: String(keywordId), userId });

  // Step 1: Pause the keyword
  const pauseResult = await pauseKeywords({
    adType: adTypeUpper,
    keywordId: String(keywordId),
    accessToken,
    profileId,
    region: resolvedRegion,
    clientId,
  });

  const pauseFailed = Object.entries(pauseResult).find(([, v]) => v && v.success === false);
  if (pauseFailed) {
    const [, errObj] = pauseFailed;
    return res.status(400).json(
      new ApiError(400, errObj.error || 'Failed to pause keyword', { step: 'pause', result: pauseResult })
    );
  }

  logger.info('[PauseAndAddToNegative] Step 2: Adding to negative', { keywordText, userId });

  // Step 2: Add to negative (ad-group level)
  const keywords = [{
    campaignId: String(campaignId),
    adGroupId: String(adGroupId),
    keywordText: String(keywordText).trim(),
    matchType: matchType === 'negativeExact' ? 'negativeExact' : 'negativePhrase',
  }];

  let addResult;
  try {
    addResult = await addToNegative(config, keywords, { level: 'adGroup' });
  } catch (err) {
    logger.error('[PauseAndAddToNegative] Add to negative failed', { message: err.message });
    return res.status(400).json(
      new ApiError(400, err.message || 'Failed to add keyword to negative (keyword was paused successfully)', {
        step: 'addToNegative',
        pauseSucceeded: true,
      })
    );
  }

  return res.status(200).json(
    new ApiResponse(200, {
      pause: pauseResult,
      addToNegative: addResult,
    }, 'Keyword paused and added to negative successfully')
  );
});

/**
 * POST /api/pagewise/ads/pause-and-add-to-negative-bulk
 * Body: {
 *   keywords: Array<{ keywordId, campaignId, adGroupId, keywordText, matchType? }> (required, non-empty),
 *   adType?: 'SP' | 'SB' | 'SD'
 * }
 * Runs async: pause all keywords in one call, then add all to negative in one call (no main-thread blocking).
 */
const pauseAndAddToNegativeBulk = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const country = req.country;
  const region = req.region;
  const { keywords: keywordsBody, adType = 'SP' } = req.body || {};

  if (!userId || !country || !region) {
    return res.status(400).json(
      new ApiError(400, 'User ID, country, and region are required (set by auth and getLocation)')
    );
  }

  if (!Array.isArray(keywordsBody) || keywordsBody.length === 0) {
    return res.status(400).json(
      new ApiError(400, 'keywords array is required and must not be empty')
    );
  }

  const keywords = keywordsBody
    .filter((k) => k && (k.keywordId != null && k.keywordId !== '') && k.campaignId && k.adGroupId && k.keywordText)
    .map((k) => ({
      keywordId: String(k.keywordId),
      campaignId: String(k.campaignId),
      adGroupId: String(k.adGroupId),
      keywordText: String(k.keywordText).trim(),
      matchType: (k.matchType || '').toLowerCase() === 'negativeexact' ? 'negativeExact' : 'negativePhrase',
    }));

  if (keywords.length === 0) {
    return res.status(400).json(
      new ApiError(400, 'Each keyword must have keywordId, campaignId, adGroupId, and keywordText')
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

  const config = getConfig({
    accessToken,
    profileId,
    region: resolvedRegion,
    clientId,
  });

  const keywordIds = keywords.map((k) => k.keywordId);

  logger.info('[PauseAndAddToNegativeBulk] Step 1: Pausing keywords', { count: keywordIds.length, userId });

  const pauseResult = await pauseKeywords({
    adType: adTypeUpper,
    keywordIds,
    accessToken,
    profileId,
    region: resolvedRegion,
    clientId,
  });

  const pauseFailed = Object.entries(pauseResult).find(([, v]) => v && v.success === false);
  if (pauseFailed) {
    const [, errObj] = pauseFailed;
    return res.status(400).json(
      new ApiError(400, errObj.error || 'Failed to pause keywords', { step: 'pause', result: pauseResult })
    );
  }

  logger.info('[PauseAndAddToNegativeBulk] Step 2: Adding to negative', { count: keywords.length, userId });

  const negativePayload = keywords.map((k) => ({
    campaignId: k.campaignId,
    adGroupId: k.adGroupId,
    keywordText: k.keywordText,
    matchType: k.matchType,
  }));

  let addResult;
  try {
    addResult = await addToNegative(config, negativePayload, { level: 'adGroup' });
  } catch (err) {
    logger.error('[PauseAndAddToNegativeBulk] Add to negative failed', { message: err.message });
    return res.status(400).json(
      new ApiError(400, err.message || 'Failed to add keywords to negative (keywords were paused successfully)', {
        step: 'addToNegative',
        pauseSucceeded: true,
      })
    );
  }

  return res.status(200).json(
    new ApiResponse(200, {
      pause: pauseResult,
      addToNegative: addResult,
    }, `${keywords.length} keyword(s) paused and added to negative successfully`)
  );
});

module.exports = { pauseAndAddToNegative, pauseAndAddToNegativeBulk };

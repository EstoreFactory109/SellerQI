/**
 * Pause / Archive Keywords Test Controller
 *
 * Test endpoints for pausing or archiving Amazon Ads keywords (SP, SB, SD).
 * Resolves credentials from the seller account (userId, country, region) and calls
 * the Pause-ArchiveKeywords service.
 *
 * Endpoints:
 * - POST /api/test/pause-keywords   - Pause one or more keywords
 * - POST /api/test/archive-keywords - Archive one or more keywords
 * - GET  /api/test/pause-archive-keywords/info - API info
 *
 * Request Body (POST):
 * {
 *   "userId": "string (required)",
 *   "country": "string (required) - US, UK, DE, etc.",
 *   "region": "string (required) - NA, EU, FE",
 *   "adType": "string (required) - SP | SB | SD | ALL",
 *   "keywordId": "string (optional) - single keyword ID",
 *   "keywordIds": "string[] (optional) - list of keyword IDs",
 *   "keywordText": "string (optional) - keyword text to look up",
 *   "matchType": "string (optional) - EXACT | PHRASE | BROAD (when using keywordText)"
 * }
 * Provide exactly one of: keywordId, keywordIds, or keywordText.
 */

const mongoose = require('mongoose');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
const { pauseKeywords, archiveKeywords } = require('../../Services/AmazonAds/Pause-ArchiveKeywords.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');

const validRegions = ['NA', 'EU', 'FE'];
const validAdTypes = ['SP', 'SB', 'SD', 'ALL'];

/**
 * Resolve ads credentials for the given user/country/region.
 * @returns {{ accessToken: string, profileId: string, region: string }}
 */
async function resolveAdsCredentials(userId, country, region) {
  let userIdQuery = userId;
  if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
    userIdQuery = new mongoose.Types.ObjectId(userId);
  }

  const sellerCentral = await Seller.findOne({ User: userIdQuery });
  if (!sellerCentral) {
    throw new ApiError(404, 'Seller account not found for the provided userId', {
      suggestion: 'Ensure the user has connected their Amazon Seller Central account.',
    });
  }

  const sellerAccount = sellerCentral.sellerAccount?.find(
    (acc) => acc.country === country && acc.region === region
  );
  if (!sellerAccount) {
    throw new ApiError(404, `No seller account for country: ${country}, region: ${region}`, {
      availableAccounts:
        sellerCentral.sellerAccount?.map((acc) => ({
          country: acc.country,
          region: acc.region,
          hasAdsToken: !!acc.adsRefreshToken,
          hasProfileId: !!acc.ProfileId,
        })) || [],
    });
  }

  if (!sellerAccount.adsRefreshToken) {
    throw new ApiError(400, 'Ads refresh token not found for this seller account', {
      suggestion: 'Connect the Amazon Ads account first.',
    });
  }

  let accessToken = await generateAdsAccessToken(sellerAccount.adsRefreshToken);
  if (!accessToken) {
    throw new ApiError(500, 'Failed to generate Ads access token', {
      suggestion: 'Refresh token may be invalid. Try reconnecting the Amazon Ads account.',
    });
  }

  let profileId = sellerAccount.ProfileId?.toString();
  if (!profileId) {
    const profiles = await getProfileById(accessToken, region, country, userId);
    if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
      throw new ApiError(400, 'No Amazon Ads profiles found for this account', {
        suggestion: 'Ensure you have active Amazon Advertising campaigns.',
      });
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
 * POST /api/test/pause-keywords
 * Pause one or more Amazon Ads keywords.
 */
const testPauseKeywords = async (req, res) => {
  logger.info('🟢 [Test] testPauseKeywords called', { body: req.body });

  try {
    const { userId, country, region, adType, keywordId, keywordIds, keywordText, matchType } =
      req.body;

    if (!userId || !country || !region) {
      return res.status(400).json(
        new ApiError(400, 'userId, country, and region are required')
      );
    }
    if (!validRegions.includes(region)) {
      return res.status(400).json(
        new ApiError(400, `Invalid region. Use one of: ${validRegions.join(', ')}`)
      );
    }
    if (!adType) {
      return res.status(400).json(
        new ApiError(400, 'adType is required (SP, SB, SD, or ALL)')
      );
    }
    if (!validAdTypes.includes(adType.toUpperCase())) {
      return res.status(400).json(
        new ApiError(400, `Invalid adType. Use one of: ${validAdTypes.join(', ')}`)
      );
    }

    const hasId = Boolean(keywordId);
    const hasIds = Array.isArray(keywordIds) && keywordIds.length > 0;
    const hasText = Boolean(keywordText);
    if (!hasId && !hasIds && !hasText) {
      return res.status(400).json(
        new ApiError(400, 'Provide one of: keywordId, keywordIds, or keywordText')
      );
    }

    const { accessToken, profileId, region: resolvedRegion } = await resolveAdsCredentials(
      userId,
      country,
      region
    );

    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json(
        new ApiError(500, 'AMAZON_ADS_CLIENT_ID is not set in environment')
      );
    }

    const result = await pauseKeywords({
      adType: adType.toUpperCase(),
      keywordId: hasId ? String(keywordId) : undefined,
      keywordIds: hasIds ? keywordIds.map(String) : undefined,
      keywordText: hasText ? keywordText : undefined,
      matchType: matchType || undefined,
      accessToken,
      profileId,
      region: resolvedRegion,
      clientId,
    });

    return res.status(200).json(
      new ApiResponse(200, result, 'Pause keywords request completed')
    );
  } catch (error) {
    logger.error('❌ [testPauseKeywords] Error', { message: error.message, stack: error.stack });

    if (error instanceof ApiError) {
      return res.status(error.statusCode || 400).json(error);
    }
    if (error.response) {
      const status = error.response.status || 500;
      const data = error.response.data || {};
      return res.status(status).json(
        new ApiError(status, 'Amazon Ads API Error', {
          message: error.message,
          details: data,
          suggestion: status === 401 || status === 403 ? 'Reconnect your Amazon Ads account.' : undefined,
        })
      );
    }
    return res.status(500).json(
      new ApiError(500, 'Internal Server Error', {
        message: error.message || 'Unexpected error in testPauseKeywords',
      })
    );
  }
};

/**
 * POST /api/test/archive-keywords
 * Archive one or more Amazon Ads keywords.
 */
const testArchiveKeywords = async (req, res) => {
  logger.info('🟢 [Test] testArchiveKeywords called', { body: req.body });

  try {
    const { userId, country, region, adType, keywordId, keywordIds, keywordText, matchType } =
      req.body;

    if (!userId || !country || !region) {
      return res.status(400).json(
        new ApiError(400, 'userId, country, and region are required')
      );
    }
    if (!validRegions.includes(region)) {
      return res.status(400).json(
        new ApiError(400, `Invalid region. Use one of: ${validRegions.join(', ')}`)
      );
    }
    if (!adType) {
      return res.status(400).json(
        new ApiError(400, 'adType is required (SP, SB, SD, or ALL)')
      );
    }
    if (!validAdTypes.includes(adType.toUpperCase())) {
      return res.status(400).json(
        new ApiError(400, `Invalid adType. Use one of: ${validAdTypes.join(', ')}`)
      );
    }

    const hasId = Boolean(keywordId);
    const hasIds = Array.isArray(keywordIds) && keywordIds.length > 0;
    const hasText = Boolean(keywordText);
    if (!hasId && !hasIds && !hasText) {
      return res.status(400).json(
        new ApiError(400, 'Provide one of: keywordId, keywordIds, or keywordText')
      );
    }

    const { accessToken, profileId, region: resolvedRegion } = await resolveAdsCredentials(
      userId,
      country,
      region
    );

    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json(
        new ApiError(500, 'AMAZON_ADS_CLIENT_ID is not set in environment')
      );
    }

    const result = await archiveKeywords({
      adType: adType.toUpperCase(),
      keywordId: hasId ? String(keywordId) : undefined,
      keywordIds: hasIds ? keywordIds.map(String) : undefined,
      keywordText: hasText ? keywordText : undefined,
      matchType: matchType || undefined,
      accessToken,
      profileId,
      region: resolvedRegion,
      clientId,
    });

    return res.status(200).json(
      new ApiResponse(200, result, 'Archive keywords request completed')
    );
  } catch (error) {
    logger.error('❌ [testArchiveKeywords] Error', { message: error.message, stack: error.stack });

    if (error instanceof ApiError) {
      return res.status(error.statusCode || 400).json(error);
    }
    if (error.response) {
      const status = error.response.status || 500;
      const data = error.response.data || {};
      return res.status(status).json(
        new ApiError(status, 'Amazon Ads API Error', {
          message: error.message,
          details: data,
          suggestion: status === 401 || status === 403 ? 'Reconnect your Amazon Ads account.' : undefined,
        })
      );
    }
    return res.status(500).json(
      new ApiError(500, 'Internal Server Error', {
        message: error.message || 'Unexpected error in testArchiveKeywords',
      })
    );
  }
};

/**
 * GET /api/test/pause-archive-keywords/info
 * Returns description and request format for the pause/archive keywords test API.
 */
const getPauseArchiveKeywordsInfo = async (req, res) => {
  return res.status(200).json(
    new ApiResponse(200, {
      description: 'Pause or archive Amazon Ads keywords (Sponsored Products, Sponsored Brands, Sponsored Display). Credentials are resolved from the seller account using userId, country, and region.',
      endpoints: {
        pauseKeywords: {
          method: 'POST',
          path: '/api/test/pause-keywords',
          body: {
            userId: 'string (required)',
            country: 'string (required) - e.g. US, UK, DE',
            region: 'string (required) - NA | EU | FE',
            adType: 'string (required) - SP | SB | SD | ALL',
            keywordId: 'string (optional) - single keyword ID',
            keywordIds: 'string[] (optional) - list of keyword IDs',
            keywordText: 'string (optional) - keyword text to look up (requires single adType, not ALL)',
            matchType: 'string (optional) - EXACT | PHRASE | BROAD (when using keywordText)',
          },
        },
        archiveKeywords: {
          method: 'POST',
          path: '/api/test/archive-keywords',
          body: 'Same as pause-keywords',
        },
      },
      adTypes: {
        SP: 'Sponsored Products',
        SB: 'Sponsored Brands',
        SD: 'Sponsored Display',
        ALL: 'Apply to SP, SB, and SD (only when using keywordId or keywordIds)',
      },
      responseFormat: {
        '[adType]': '{ success: boolean, data?: object, error?: string }',
        example: { SP: { success: true, data: {} }, SB: { success: false, error: '...' } },
      },
    }, 'Pause/Archive Keywords Test API Information')
  );
};

module.exports = {
  testPauseKeywords,
  testArchiveKeywords,
  getPauseArchiveKeywordsInfo,
};

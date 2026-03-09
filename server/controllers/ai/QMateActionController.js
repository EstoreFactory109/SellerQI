/**
 * QMateActionController.js
 * 
 * Handles QMate's "Fix It" capabilities:
 * 1. Generate content suggestions (title, bullet points, description, backend keywords)
 * 2. Apply fixes to Amazon listings
 * 
 * These endpoints are called by the frontend when QMate suggests content_actions.
 */

const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { generateRankingContentSuggestion } = require('../../Services/AI/RankingContentAIService.js');
const { updateProductContent } = require('../../Services/Sp_API/UpdateProductContentService.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');

const ALLOWED_ATTRIBUTES = ['title', 'bulletpoints', 'description', 'generic_keyword'];

/**
 * POST /api/qmate/generate-suggestion
 * 
 * Generate AI content suggestions for a product attribute.
 * This is the same as what the "Fix It" button's "Generate" feature does.
 * 
 * Request body:
 * {
 *   "asin": "B00EXAMPLE",
 *   "attribute": "title" | "bulletpoints" | "description" | "generic_keyword",
 *   "currentValue": "Current content (optional - will be fetched if not provided)"
 * }
 */
const generateSuggestion = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { asin, attribute, currentValue } = req.body;

    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }

    if (!country || !region) {
        return res.status(400).json(new ApiError(400, 'Country and region are required'));
    }

    if (!asin) {
        return res.status(400).json(new ApiError(400, 'ASIN is required'));
    }

    if (!attribute || !ALLOWED_ATTRIBUTES.includes(attribute.toLowerCase())) {
        return res.status(400).json(
            new ApiError(400, `attribute must be one of: ${ALLOWED_ATTRIBUTES.join(', ')}`)
        );
    }

    const normalizedAttribute = attribute.toLowerCase();

    logger.info('[QMateAction] Generating suggestion', {
        userId,
        country,
        region,
        asin,
        attribute: normalizedAttribute,
        hasCurrentValue: !!currentValue
    });

    try {
        // Build params for the ranking content AI service
        const params = {
            userId,
            country,
            region,
            asin,
            attribute: normalizedAttribute
        };

        // Add current value if provided
        if (currentValue) {
            switch (normalizedAttribute) {
                case 'title':
                    params.title = currentValue;
                    break;
                case 'bulletpoints':
                    params.bulletpoints = Array.isArray(currentValue) ? currentValue : [currentValue];
                    break;
                case 'description':
                    params.description = currentValue;
                    break;
                case 'generic_keyword':
                    params.backendKeywords = currentValue;
                    break;
            }
        }

        const result = await generateRankingContentSuggestion(params);

        logger.info('[QMateAction] Suggestion generated successfully', {
            userId,
            asin,
            attribute: normalizedAttribute
        });

        return res.status(200).json(
            new ApiResponse(200, {
                asin,
                attribute: normalizedAttribute,
                suggestions: result
            }, 'Suggestion generated successfully')
        );

    } catch (error) {
        logger.error('[QMateAction] Error generating suggestion', {
            error: error.message,
            stack: error.stack,
            userId,
            asin,
            attribute: normalizedAttribute
        });

        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json(
            new ApiError(statusCode, error.message || 'Failed to generate suggestion')
        );
    }
});

/**
 * POST /api/qmate/apply-fix
 * 
 * Apply a content fix to an Amazon listing.
 * This is the same as what the "Fix It" button's "Apply" feature does.
 * 
 * Request body:
 * {
 *   "asin": "B00EXAMPLE",
 *   "sku": "SKU123",
 *   "attribute": "title" | "bulletpoints" | "description" | "generic_keyword",
 *   "value": "The new content to apply"
 * }
 */
const applyFix = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { asin, sku, attribute, value } = req.body;

    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }

    if (!country || !region) {
        return res.status(400).json(new ApiError(400, 'Country and region are required'));
    }

    if (!sku) {
        return res.status(400).json(
            new ApiError(400, 'SKU is required to apply fixes. Please provide the product SKU.')
        );
    }

    if (!attribute || !ALLOWED_ATTRIBUTES.includes(attribute.toLowerCase())) {
        return res.status(400).json(
            new ApiError(400, `attribute must be one of: ${ALLOWED_ATTRIBUTES.join(', ')}`)
        );
    }

    if (value === undefined || value === null || value === '') {
        return res.status(400).json(new ApiError(400, 'value is required'));
    }

    const normalizedAttribute = attribute.toLowerCase();

    logger.info('[QMateAction] Applying fix', {
        userId,
        country,
        region,
        asin,
        sku,
        attribute: normalizedAttribute,
        valueLength: typeof value === 'string' ? value.length : (Array.isArray(value) ? value.length : 'N/A')
    });

    try {
        // Call the update product content service
        const result = await updateProductContent({
            sku,
            userId,
            country,
            region,
            dataToBeUpdated: normalizedAttribute,
            valueToBeUpdated: value,
            options: {
                autoFixConflicts: true
            }
        });

        logger.info('[QMateAction] Fix applied successfully', {
            userId,
            asin,
            sku,
            attribute: normalizedAttribute,
            result: result.success ? 'success' : 'failed'
        });

        if (result.success === false || result.error) {
            return res.status(400).json(
                new ApiResponse(400, result, result.message || result.error || 'Failed to apply fix')
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                asin,
                sku,
                attribute: normalizedAttribute,
                applied: true,
                result
            }, 'Fix applied successfully')
        );

    } catch (error) {
        logger.error('[QMateAction] Error applying fix', {
            error: error.message,
            stack: error.stack,
            userId,
            asin,
            sku,
            attribute: normalizedAttribute
        });

        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json(
            new ApiError(statusCode, error.message || 'Failed to apply fix')
        );
    }
});

/**
 * POST /api/qmate/batch-suggestions
 * 
 * Generate suggestions for multiple attributes at once.
 * 
 * Request body:
 * {
 *   "asin": "B00EXAMPLE",
 *   "attributes": ["title", "bulletpoints", "description", "generic_keyword"]
 * }
 */
const batchSuggestions = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { asin, attributes } = req.body;

    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }

    if (!country || !region) {
        return res.status(400).json(new ApiError(400, 'Country and region are required'));
    }

    if (!asin) {
        return res.status(400).json(new ApiError(400, 'ASIN is required'));
    }

    if (!Array.isArray(attributes) || attributes.length === 0) {
        return res.status(400).json(new ApiError(400, 'attributes array is required'));
    }

    const validAttributes = attributes.filter(a => 
        typeof a === 'string' && ALLOWED_ATTRIBUTES.includes(a.toLowerCase())
    );

    if (validAttributes.length === 0) {
        return res.status(400).json(
            new ApiError(400, `No valid attributes provided. Must be one of: ${ALLOWED_ATTRIBUTES.join(', ')}`)
        );
    }

    logger.info('[QMateAction] Generating batch suggestions', {
        userId,
        country,
        region,
        asin,
        attributes: validAttributes
    });

    const results = {};
    const errors = {};

    // Generate suggestions in parallel
    await Promise.all(validAttributes.map(async (attr) => {
        const normalizedAttr = attr.toLowerCase();
        try {
            const result = await generateRankingContentSuggestion({
                userId,
                country,
                region,
                asin,
                attribute: normalizedAttr
            });
            results[normalizedAttr] = result;
        } catch (error) {
            errors[normalizedAttr] = error.message;
            logger.warn('[QMateAction] Failed to generate suggestion for attribute', {
                asin,
                attribute: normalizedAttr,
                error: error.message
            });
        }
    }));

    logger.info('[QMateAction] Batch suggestions completed', {
        userId,
        asin,
        successCount: Object.keys(results).length,
        errorCount: Object.keys(errors).length
    });

    return res.status(200).json(
        new ApiResponse(200, {
            asin,
            suggestions: results,
            errors: Object.keys(errors).length > 0 ? errors : undefined
        }, 'Batch suggestions generated')
    );
});

/**
 * GET /api/qmate/lookup-sku/:asin
 * 
 * Look up the SKU for a given ASIN.
 * This is used when QMate's content_actions has a null SKU
 * and the frontend needs to resolve it before applying a fix.
 */
const lookupSku = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { asin } = req.params;

    if (!userId) {
        return res.status(400).json(new ApiError(400, 'User ID is required'));
    }

    if (!country || !region) {
        return res.status(400).json(new ApiError(400, 'Country and region are required'));
    }

    if (!asin) {
        return res.status(400).json(new ApiError(400, 'ASIN is required'));
    }

    logger.info('[QMateAction] Looking up SKU for ASIN', {
        userId,
        country,
        region,
        asin
    });

    try {
        const sellerData = await Seller.findOne(
            { User: userId },
            { 'sellerAccount': { $elemMatch: { region, country } } }
        ).lean();

        const products = sellerData?.sellerAccount?.[0]?.products || [];
        const product = products.find(p => p.asin === asin);

        if (!product) {
            logger.warn('[QMateAction] Product not found for ASIN', { userId, asin });
            return res.status(404).json(
                new ApiError(404, `Product with ASIN ${asin} not found in your catalog`)
            );
        }

        if (!product.sku) {
            logger.warn('[QMateAction] SKU not available for ASIN', { userId, asin });
            return res.status(404).json(
                new ApiError(404, `SKU not available for ASIN ${asin}`)
            );
        }

        logger.info('[QMateAction] SKU found for ASIN', {
            userId,
            asin,
            sku: product.sku
        });

        return res.status(200).json(
            new ApiResponse(200, {
                asin,
                sku: product.sku,
                itemName: product.itemName || null,
                status: product.status || null
            }, 'SKU found successfully')
        );

    } catch (error) {
        logger.error('[QMateAction] Error looking up SKU', {
            error: error.message,
            stack: error.stack,
            userId,
            asin
        });

        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json(
            new ApiError(statusCode, error.message || 'Failed to look up SKU')
        );
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PPC Keyword Actions (Pause, Add to Negative, Pause & Add to Negative)
// ─────────────────────────────────────────────────────────────────────────────

const { pauseKeywords } = require('../../Services/AmazonAds/Pause-ArchiveKeywords.js');
const { addToNegative, getConfig } = require('../../Services/AmazonAds/addToNegetive.js');
const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
const mongoose = require('mongoose');

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
 * POST /api/qmate/ppc/pause-keyword
 * Pause a single keyword.
 * Body: { keywordId: string, adType?: 'SP' | 'SB' | 'SD' }
 */
const pauseKeywordAction = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { keywordId, adType = 'SP' } = req.body || {};

    if (!userId || !country || !region) {
        return res.status(400).json(new ApiError(400, 'User ID, country, and region are required'));
    }

    if (!keywordId) {
        return res.status(400).json(new ApiError(400, 'keywordId is required'));
    }

    const adTypeUpper = (adType || 'SP').toUpperCase();
    if (!validAdTypes.includes(adTypeUpper)) {
        return res.status(400).json(new ApiError(400, `Invalid adType. Use one of: ${validAdTypes.join(', ')}`));
    }

    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
        return res.status(500).json(new ApiError(500, 'AMAZON_ADS_CLIENT_ID is not set'));
    }

    const { accessToken, profileId, region: resolvedRegion } = await resolveAdsCredentials(userId, country, region);

    logger.info('[QMateAction] Pausing keyword', { keywordId, adType: adTypeUpper, userId });

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
        return res.status(400).json(new ApiError(400, errObj.error || 'Failed to pause keyword', { result }));
    }

    return res.status(200).json(new ApiResponse(200, result, 'Keyword paused successfully'));
});

/**
 * POST /api/qmate/ppc/add-to-negative
 * Add a keyword to negative (ad-group level).
 * Body: { campaignId, adGroupId, keywordText, matchType?: 'negativeExact' | 'negativePhrase' }
 */
const addToNegativeAction = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { campaignId, adGroupId, keywordText, matchType = 'negativePhrase' } = req.body || {};

    if (!userId || !country || !region) {
        return res.status(400).json(new ApiError(400, 'User ID, country, and region are required'));
    }

    if (!campaignId || !adGroupId || !keywordText) {
        return res.status(400).json(new ApiError(400, 'campaignId, adGroupId, and keywordText are required'));
    }

    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
        return res.status(500).json(new ApiError(500, 'AMAZON_ADS_CLIENT_ID is not set'));
    }

    const { accessToken, profileId, region: resolvedRegion } = await resolveAdsCredentials(userId, country, region);

    const config = getConfig({ accessToken, profileId, region: resolvedRegion, clientId });

    logger.info('[QMateAction] Adding keyword to negative', { keywordText, campaignId, adGroupId, userId });

    const keywords = [{
        campaignId: String(campaignId),
        adGroupId: String(adGroupId),
        keywordText: String(keywordText).trim(),
        matchType: matchType === 'negativeExact' ? 'negativeExact' : 'negativePhrase',
    }];

    const result = await addToNegative(config, keywords, { level: 'adGroup' });

    return res.status(200).json(new ApiResponse(200, result, 'Keyword added to negative successfully'));
});

/**
 * POST /api/qmate/ppc/pause-and-add-to-negative
 * Pause a keyword then add it to negative.
 * Body: { keywordId, campaignId, adGroupId, keywordText, matchType?, adType? }
 */
const pauseAndAddToNegativeAction = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { keywordId, campaignId, adGroupId, keywordText, matchType = 'negativePhrase', adType = 'SP' } = req.body || {};

    if (!userId || !country || !region) {
        return res.status(400).json(new ApiError(400, 'User ID, country, and region are required'));
    }

    if (!keywordId) {
        return res.status(400).json(new ApiError(400, 'keywordId is required'));
    }
    if (!campaignId || !adGroupId || !keywordText) {
        return res.status(400).json(new ApiError(400, 'campaignId, adGroupId, and keywordText are required'));
    }

    const adTypeUpper = (adType || 'SP').toUpperCase();
    if (!validAdTypes.includes(adTypeUpper)) {
        return res.status(400).json(new ApiError(400, `Invalid adType. Use one of: ${validAdTypes.join(', ')}`));
    }

    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
        return res.status(500).json(new ApiError(500, 'AMAZON_ADS_CLIENT_ID is not set'));
    }

    const { accessToken, profileId, region: resolvedRegion } = await resolveAdsCredentials(userId, country, region);

    const config = getConfig({ accessToken, profileId, region: resolvedRegion, clientId });

    logger.info('[QMateAction] Step 1: Pausing keyword', { keywordId, userId });

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
        return res.status(400).json(new ApiError(400, errObj.error || 'Failed to pause keyword', { step: 'pause', result: pauseResult }));
    }

    logger.info('[QMateAction] Step 2: Adding to negative', { keywordText, userId });

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
        logger.error('[QMateAction] Add to negative failed', { message: err.message });
        return res.status(400).json(new ApiError(400, err.message || 'Failed to add to negative (keyword was paused)', { step: 'addToNegative', pauseSucceeded: true }));
    }

    return res.status(200).json(new ApiResponse(200, { pause: pauseResult, addToNegative: addResult }, 'Keyword paused and added to negative successfully'));
});

/**
 * POST /api/qmate/ppc/bulk-pause
 * Pause multiple keywords.
 * Body: { keywordIds: string[], adType?: 'SP' | 'SB' | 'SD' }
 */
const bulkPauseAction = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { keywordIds, adType = 'SP' } = req.body || {};

    if (!userId || !country || !region) {
        return res.status(400).json(new ApiError(400, 'User ID, country, and region are required'));
    }

    if (!Array.isArray(keywordIds) || keywordIds.length === 0) {
        return res.status(400).json(new ApiError(400, 'keywordIds array is required and must not be empty'));
    }

    if (keywordIds.length > 10) {
        return res.status(400).json(new ApiError(400, 'Maximum 10 keywords allowed per bulk action'));
    }

    const ids = keywordIds.map((id) => String(id)).filter(Boolean);
    if (ids.length === 0) {
        return res.status(400).json(new ApiError(400, 'At least one valid keywordId is required'));
    }

    const adTypeUpper = (adType || 'SP').toUpperCase();
    if (!validAdTypes.includes(adTypeUpper)) {
        return res.status(400).json(new ApiError(400, `Invalid adType. Use one of: ${validAdTypes.join(', ')}`));
    }

    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
        return res.status(500).json(new ApiError(500, 'AMAZON_ADS_CLIENT_ID is not set'));
    }

    const { accessToken, profileId, region: resolvedRegion } = await resolveAdsCredentials(userId, country, region);

    logger.info('[QMateAction] Bulk pausing keywords', { count: ids.length, adType: adTypeUpper, userId });

    const result = await pauseKeywords({
        adType: adTypeUpper,
        keywordIds: ids,
        accessToken,
        profileId,
        region: resolvedRegion,
        clientId,
    });

    const failed = Object.entries(result).find(([, v]) => v && v.success === false);
    if (failed) {
        const [, errObj] = failed;
        return res.status(400).json(new ApiError(400, errObj.error || 'Failed to pause keywords', { result }));
    }

    return res.status(200).json(new ApiResponse(200, result, `${ids.length} keyword(s) paused successfully`));
});

/**
 * POST /api/qmate/ppc/bulk-pause-and-add-to-negative
 * Pause multiple keywords then add to negative.
 * Body: { keywords: [{ keywordId, campaignId, adGroupId, keywordText, matchType? }], adType? }
 */
const bulkPauseAndAddToNegativeAction = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { keywords: keywordsBody, adType = 'SP' } = req.body || {};

    if (!userId || !country || !region) {
        return res.status(400).json(new ApiError(400, 'User ID, country, and region are required'));
    }

    if (!Array.isArray(keywordsBody) || keywordsBody.length === 0) {
        return res.status(400).json(new ApiError(400, 'keywords array is required and must not be empty'));
    }

    if (keywordsBody.length > 10) {
        return res.status(400).json(new ApiError(400, 'Maximum 10 keywords allowed per bulk action'));
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
        return res.status(400).json(new ApiError(400, 'Each keyword must have keywordId, campaignId, adGroupId, and keywordText'));
    }

    const adTypeUpper = (adType || 'SP').toUpperCase();
    if (!validAdTypes.includes(adTypeUpper)) {
        return res.status(400).json(new ApiError(400, `Invalid adType. Use one of: ${validAdTypes.join(', ')}`));
    }

    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
        return res.status(500).json(new ApiError(500, 'AMAZON_ADS_CLIENT_ID is not set'));
    }

    const { accessToken, profileId, region: resolvedRegion } = await resolveAdsCredentials(userId, country, region);

    const config = getConfig({ accessToken, profileId, region: resolvedRegion, clientId });

    const keywordIds = keywords.map((k) => k.keywordId);

    logger.info('[QMateAction] Bulk pause and add to negative', { count: keywordIds.length, userId });

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
        return res.status(400).json(new ApiError(400, errObj.error || 'Failed to pause keywords', { step: 'pause', result: pauseResult }));
    }

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
        logger.error('[QMateAction] Bulk add to negative failed', { message: err.message });
        return res.status(400).json(new ApiError(400, err.message || 'Failed to add to negative (keywords were paused)', { step: 'addToNegative', pauseSucceeded: true }));
    }

    return res.status(200).json(new ApiResponse(200, { pause: pauseResult, addToNegative: addResult }, `${keywords.length} keyword(s) paused and added to negative successfully`));
});

module.exports = {
    generateSuggestion,
    applyFix,
    batchSuggestions,
    lookupSku,
    pauseKeywordAction,
    addToNegativeAction,
    pauseAndAddToNegativeAction,
    bulkPauseAction,
    bulkPauseAndAddToNegativeAction
};

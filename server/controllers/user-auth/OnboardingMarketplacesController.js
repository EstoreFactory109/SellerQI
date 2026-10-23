/**
 * Multi-marketplace onboarding endpoints (/app/onboarding). The flow and its rules live in
 * Services/Onboarding/multiMarketplaceOnboarding.js; this file is request/response only.
 *
 * Every endpoint except GET /marketplaces answers 404 for users the flow is off for (agency / ESF
 * clients, or everyone when MULTI_MARKETPLACE_ONBOARDING_ENABLED=false), so the single-marketplace
 * flow is untouched for them.
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const User = require('../../models/user-auth/userModel.js');
const { createLocationToken } = require('../../utils/Tokens.js');
const { getHttpCookieOptions } = require('../../utils/cookieConfig.js');
const { createState, consumeState, KINDS } = require('../../Services/Onboarding/oauthState.js');
const { isRegion, regionOf } = require('../../Services/Onboarding/marketplaces.js');
const onboarding = require('../../Services/Onboarding/multiMarketplaceOnboarding.js');
const logger = require('../../utils/Logger.js');

const loadUser = (userId) => User.findById(userId).select('email isAgencyClient isEsfClient agencyId').lean();

/** Answers ApiErrors with their status; anything else is a 500 with a generic message. */
const fail = (res, error, fallback) => {
    if (error instanceof ApiError) {
        return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    }
    logger.error(`[Onboarding] ${fallback}: ${error?.message}`);
    return res.status(502).json(new ApiResponse(502, null, `${fallback}. Please try again.`));
};

/** Gate for every endpoint but the checklist read. */
const requireEnabled = asyncHandler(async (req, res, next) => {
    const user = await loadUser(req.userId);
    if (!onboarding.isEnabledFor(user)) return res.status(404).json(new ApiResponse(404, null, 'Not found'));
    return next();
});

/**
 * Point the session at the main marketplace once it is connected, so the dashboard opens on it
 * and the existing marketplace-scoped endpoints read it.
 */
const followPrimary = async (req, res, checklist) => {
    const primary = checklist?.primary;
    if (!primary) return;
    const connected = checklist.marketplaces.some((m) => m.primary && m.spApi);
    if (!connected || (req.country === primary.country && req.region === primary.region)) return;
    const token = await createLocationToken(primary.country, primary.region);
    if (token) res.cookie('IBEXLocationToken', token, getHttpCookieOptions());
};

/** GET /app/onboarding/marketplaces — the checklist, or { enabled: false }. */
const getChecklist = asyncHandler(async (req, res) => {
    const user = await loadUser(req.userId);
    if (!onboarding.isEnabledFor(user)) {
        return res.status(200).json(new ApiResponse(200, { enabled: false }, 'Multi-marketplace onboarding is off'));
    }
    const checklist = await onboarding.getChecklist(req.userId);
    return res.status(200).json(new ApiResponse(200, { enabled: true, ...checklist }, 'OK'));
});

/** POST /app/onboarding/oauth-state { kind, region, primaryCountry?, plannedCountries? } → { state } */
const createOauthState = asyncHandler(async (req, res) => {
    const { kind, region, primaryCountry, plannedCountries } = req.body || {};
    if (!KINDS.includes(kind) || !isRegion(region)) {
        return res.status(400).json(new ApiResponse(400, null, 'kind and region are required'));
    }
    if (primaryCountry && regionOf(primaryCountry) !== region) {
        return res.status(400).json(new ApiResponse(400, null, 'The main marketplace is not in this region'));
    }
    try {
        const planned = Array.isArray(plannedCountries)
            ? plannedCountries.map((c) => String(c || '').toUpperCase()).filter((c) => regionOf(c)).slice(0, 30)
            : [];
        const state = await createState({
            userId: req.userId,
            kind,
            region,
            primaryCountry: primaryCountry || null,
            plannedCountries: primaryCountry ? planned : [],
        });
        return res.status(200).json(new ApiResponse(200, { state }, 'OK'));
    } catch (error) {
        return fail(res, error, 'Could not start the Amazon connection');
    }
});

const acceptState = async (req, res, kind) => {
    const payload = await consumeState(req.body?.state, { userId: req.userId, kind });
    if (!payload) {
        res.status(400).json(new ApiResponse(400, null, 'This Amazon connection link has expired or was already used. Please connect again.'));
        return null;
    }
    return payload;
};

/** POST /app/onboarding/spapi/callback { authCode, sellingPartnerId, state } */
const sellerCentralCallback = asyncHandler(async (req, res) => {
    try {
        const payload = await acceptState(req, res, 'spapi');
        if (!payload) return undefined;
        const checklist = await onboarding.connectSellerCentral({
            userId: req.userId,
            region: payload.region,
            authCode: req.body?.authCode,
            sellingPartnerId: req.body?.sellingPartnerId,
            primaryCountry: payload.primaryCountry,
            plannedCountries: payload.plannedCountries,
        });
        return res.status(200).json(new ApiResponse(200, { region: payload.region, ...checklist }, 'Seller Central connected'));
    } catch (error) {
        return fail(res, error, 'Could not connect Seller Central');
    }
});

/** POST /app/onboarding/marketplaces { region, countries } */
const confirmMarketplaces = asyncHandler(async (req, res) => {
    try {
        const checklist = await onboarding.confirmMarketplaces({
            userId: req.userId,
            region: req.body?.region,
            countries: req.body?.countries,
        });
        await followPrimary(req, res, checklist);
        return res.status(200).json(new ApiResponse(200, checklist, 'Marketplaces saved'));
    } catch (error) {
        return fail(res, error, 'Could not save your marketplaces');
    }
});

/** POST /app/onboarding/ads/callback { authCode, state } */
const adsCallback = asyncHandler(async (req, res) => {
    try {
        const payload = await acceptState(req, res, 'ads');
        if (!payload) return undefined;
        const checklist = await onboarding.connectAds({
            userId: req.userId,
            region: payload.region,
            authCode: req.body?.authCode,
        });
        return res.status(200).json(new ApiResponse(200, { region: payload.region, ...checklist }, 'Amazon Ads connected'));
    } catch (error) {
        return fail(res, error, 'Could not connect Amazon Ads');
    }
});

/** POST /app/onboarding/ads/profiles { region, mapping: [{ country, profileId|null }] } */
const saveAdsProfiles = asyncHandler(async (req, res) => {
    try {
        const checklist = await onboarding.saveAdsProfiles({
            userId: req.userId,
            region: req.body?.region,
            mapping: req.body?.mapping,
        });
        return res.status(200).json(new ApiResponse(200, checklist, 'Ads profiles saved'));
    } catch (error) {
        return fail(res, error, 'Could not save your Ads profiles');
    }
});

/** POST /app/onboarding/start { scope: 'primary'|'all' } */
const startFetches = asyncHandler(async (req, res) => {
    const scope = req.body?.scope === 'primary' ? 'primary' : 'all';
    try {
        const result = await onboarding.startFetches({ userId: req.userId, scope });
        await followPrimary(req, res, result.checklist);
        return res.status(200).json(new ApiResponse(200, result, 'Fetching started'));
    } catch (error) {
        return fail(res, error, 'Could not start preparing your data');
    }
});

module.exports = {
    requireEnabled,
    getChecklist,
    createOauthState,
    sellerCentralCallback,
    confirmMarketplaces,
    adsCallback,
    saveAdsProfiles,
    startFetches,
};

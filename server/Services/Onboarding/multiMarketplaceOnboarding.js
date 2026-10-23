/**
 * Multi-marketplace onboarding: connect each Amazon region once, confirm its marketplaces.
 *
 *   1. The seller picks a main marketplace and approves its region in Seller Central.
 *   2. connectSellerCentral exchanges the code, asks Amazon which marketplaces the approval covers
 *      (getMarketplaceParticipations) and keeps that on a RegionGrant.
 *   3. confirmMarketplaces copies the region's token onto a Seller.sellerAccount entry for every
 *      marketplace the seller ticks — one approval, many marketplaces.
 *   4. connectAds / saveAdsProfiles: one Ads login per region, each marketplace matched to its
 *      Ads profile.
 *   5. startFetches: the main marketplace first, the others after (queue priority).
 *
 * Other regions repeat 2-4. Every write to the Seller document is atomic per marketplace
 * (arrayFilters), never a whole-document save, and nothing here ever REMOVES a marketplace —
 * the old flow replaced the whole list until a token existed.
 */
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const User = require('../../models/user-auth/userModel.js');
const RegionGrant = require('../../models/user-auth/RegionGrantModel.js');
const { generateRefreshToken, generateAdsRefreshToken } = require('../Sp_API/GenerateTokens.js');
const { generateAdsAccessToken } = require('../AmazonAds/GenerateToken.js');
const { getProfileById } = require('../AmazonAds/GenerateProfileId.js');
const { getMarketplaceParticipations, supportedParticipations } = require('../Sp_API/MarketplaceParticipations.js');
const { addIntegrationJob, getAggregatedJobStatus } = require('../BackgroundJobs/integrationQueue.js');
const { UserSchedulingService } = require('../BackgroundJobs/UserSchedulingService.js');
const { REGIONS, isRegion, regionOf, countriesInRegion, fromAmazonCountryCode } = require('./marketplaces.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');
const { v4: uuidv4 } = require('uuid');

/** Main marketplace first; everyone's extra marketplaces after every signup's main one. */
const PRIMARY_PRIORITY = 1;
const SECONDARY_PRIORITY = 5;

/* ------------------------------------------------------------------ flag -- */

/**
 * Who gets the new flow. ON by default for self-serve sellers.
 * MULTI_MARKETPLACE_ONBOARDING_ENABLED=false is the kill switch: everyone goes back to the
 * single-marketplace flow, except the emails in MULTI_MARKETPLACE_ONBOARDING_USERS
 * (comma-separated), so it can still be tried while switched off. Agency and ESF clients keep the
 * current flow either way.
 */
const isEnabledFor = (user) => {
    if (!user) return false;
    if (user.isAgencyClient || user.isEsfClient || user.agencyId) return false;
    if (String(process.env.MULTI_MARKETPLACE_ONBOARDING_ENABLED || '').toLowerCase() !== 'false') return true;
    const allow = String(process.env.MULTI_MARKETPLACE_ONBOARDING_USERS || '')
        .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    return Boolean(user.email) && allow.includes(String(user.email).toLowerCase());
};

/* ---------------------------------------------------------- seller writes -- */

/** The user's Seller document, created (and linked to the user) when missing. */
const ensureSellerDoc = async (userId) => {
    const existing = await Seller.findOne({ User: userId }).sort({ createdAt: -1 }).select('_id User').lean();
    if (existing) return existing;
    const created = await Seller.create({ User: userId, selling_partner_id: uuidv4(), sellerAccount: [] });
    await User.updateOne({ _id: userId }, { $set: { sellerCentral: created._id } });
    return { _id: created._id, User: userId };
};

/**
 * Add the marketplace when absent, then set its fields — both atomic. The add is guarded by
 * "no entry for this country+region yet", so two confirms at once cannot create duplicates.
 */
const upsertMarketplace = async (sellerId, country, region, fields) => {
    await Seller.updateOne(
        { _id: sellerId, sellerAccount: { $not: { $elemMatch: { country, region } } } },
        { $push: { sellerAccount: { selling_partner_id: uuidv4(), country, region } } }
    );
    const set = {};
    for (const [key, value] of Object.entries(fields)) set[`sellerAccount.$[acct].${key}`] = value;
    await Seller.updateOne(
        { _id: sellerId },
        { $set: set },
        { arrayFilters: [{ 'acct.country': country, 'acct.region': region }] }
    );
};

const isDuplicateSellerId = (error) => error?.code === 11000 && /selling_partner_id/.test(String(error?.message));

/* ------------------------------------------------------- seller central -- */

/**
 * The seller came back from Seller Central with an authorisation for `region`.
 * @returns the marketplaces to offer: what Amazon reported, or the whole region when that failed
 */
const connectSellerCentral = async ({ userId, region, authCode, sellingPartnerId, primaryCountry }) => {
    if (!isRegion(region)) throw new ApiError(400, 'Unknown region');
    if (!authCode) throw new ApiError(400, 'Authorization code is required');

    const tokens = await generateRefreshToken(authCode, region);

    let participations = [];
    let discoveryFailed = false;
    try {
        participations = supportedParticipations(
            await getMarketplaceParticipations(tokens.accessToken, region),
            region
        );
    } catch (error) {
        // The approval itself worked; offer the region's list instead of losing it.
        discoveryFailed = true;
        logger.warn(`[Onboarding] marketplace discovery failed for ${userId} ${region}: ${error.message}`);
    }

    const update = {
        sellingPartnerId: sellingPartnerId || null,
        spiRefreshToken: tokens.refreshToken,
        participations,
        discoveryFailed,
    };
    // The main marketplace is chosen once, with the first approval; later regions never move it.
    if (primaryCountry && regionOf(primaryCountry) === region
        && !(await RegionGrant.exists({ User: userId, primaryCountry: { $ne: null } }))) {
        update.primaryCountry = String(primaryCountry).toUpperCase();
    }

    await RegionGrant.updateOne({ User: userId, region }, { $set: update }, { upsert: true });
    return getChecklist(userId);
};

/**
 * Add the ticked marketplaces of an authorised region. Only marketplaces Amazon reported are
 * accepted (any of the region's when discovery failed): the token does not work for others.
 */
const confirmMarketplaces = async ({ userId, region, countries }) => {
    if (!isRegion(region)) throw new ApiError(400, 'Unknown region');
    const grant = await RegionGrant.findOne({ User: userId, region }).select('+spiRefreshToken').lean();
    if (!grant?.spiRefreshToken) throw new ApiError(409, 'Connect Seller Central for this region first');

    const allowed = new Set(grant.discoveryFailed
        ? countriesInRegion(region)
        : grant.participations.map((p) => p.country));
    const wanted = [...new Set((Array.isArray(countries) ? countries : []).map((c) => String(c).toUpperCase()))];
    const rejected = wanted.filter((c) => !allowed.has(c));
    if (rejected.length) throw new ApiError(400, `Not available with this approval: ${rejected.join(', ')}`);
    if (grant.primaryCountry && !wanted.includes(grant.primaryCountry)) {
        throw new ApiError(400, 'Your main marketplace has to stay selected');
    }
    if (!wanted.length) throw new ApiError(400, 'Select at least one marketplace');

    const seller = await ensureSellerDoc(userId);
    try {
        for (const country of wanted) {
            await upsertMarketplace(seller._id, country, region, {
                spiRefreshToken: grant.spiRefreshToken,
                ...(grant.sellingPartnerId ? { selling_partner_id: grant.sellingPartnerId } : {}),
            });
        }
    } catch (error) {
        if (isDuplicateSellerId(error)) {
            throw new ApiError(409, 'This Amazon seller account is already connected to another SellerQI account');
        }
        throw error;
    }

    try {
        await UserSchedulingService.updateUserSellerAccounts(userId);
    } catch (error) {
        logger.error(`[Onboarding] schedule update failed for ${userId}: ${error.message}`);
    }
    return getChecklist(userId);
};

/* --------------------------------------------------------------- ads -- */

/** Each confirmed marketplace's matching Ads profile, when there is exactly one. */
const proposeProfileMapping = (countries, profiles) => countries.map((country) => {
    const candidates = profiles.filter((p) => p.countryCode === country);
    const sellerProfiles = candidates.filter((p) => !p.type || p.type === 'seller');
    const pick = sellerProfiles.length === 1 ? sellerProfiles[0] : (candidates.length === 1 ? candidates[0] : null);
    return { country, profileId: pick ? pick.profileId : null, candidates };
});

const connectAds = async ({ userId, region, authCode }) => {
    if (!isRegion(region)) throw new ApiError(400, 'Unknown region');
    if (!authCode) throw new ApiError(400, 'Authorization code is required');

    const { refreshToken } = await generateAdsRefreshToken(authCode, region);
    const accessToken = await generateAdsAccessToken(refreshToken);
    const raw = await getProfileById(accessToken, region);
    const adsProfiles = (Array.isArray(raw) ? raw : []).map((p) => ({
        profileId: String(p.profileId),
        countryCode: fromAmazonCountryCode(p.countryCode),
        currencyCode: p.currencyCode || null,
        name: p.accountInfo?.name || null,
        type: p.accountInfo?.type || null,
    }));

    await RegionGrant.updateOne(
        { User: userId, region },
        { $set: { adsRefreshToken: refreshToken, adsProfiles } },
        { upsert: true }
    );
    return getChecklist(userId);
};

/**
 * Link each marketplace to an Ads profile. A null profileId leaves that marketplace without Ads,
 * as "continue without a profile" does today.
 */
const saveAdsProfiles = async ({ userId, region, mapping }) => {
    if (!isRegion(region)) throw new ApiError(400, 'Unknown region');
    const grant = await RegionGrant.findOne({ User: userId, region }).select('+adsRefreshToken').lean();
    if (!grant?.adsRefreshToken) throw new ApiError(409, 'Connect Amazon Ads for this region first');

    const seller = await Seller.findOne({ User: userId }).sort({ createdAt: -1 }).select('_id sellerAccount.country sellerAccount.region').lean();
    const connected = new Set((seller?.sellerAccount || []).filter((a) => a.region === region).map((a) => a.country));
    const profiles = new Map(grant.adsProfiles.map((p) => [p.profileId, p]));

    for (const row of Array.isArray(mapping) ? mapping : []) {
        const country = String(row?.country || '').toUpperCase();
        if (!connected.has(country)) throw new ApiError(400, `${country} is not connected in this region`);
        if (row.profileId == null) continue;
        const profile = profiles.get(String(row.profileId));
        if (!profile) throw new ApiError(400, `Unknown Ads profile for ${country}`);
        await upsertMarketplace(seller._id, country, region, {
            adsRefreshToken: grant.adsRefreshToken,
            ProfileId: profile.profileId,
            // Historical name: this field holds the Ads currency (see saveProfileId).
            countryCode: profile.currencyCode,
        });
    }
    return getChecklist(userId);
};

/* ---------------------------------------------------------- fetching -- */

const integrationJobId = (userId, country, region) => `integration-${userId}-${country}-${region}`;

/** queued | preparing | ready | failed | not_started, from the first-fetch pipeline's status row. */
const fetchState = async (userId, country, region) => {
    try {
        const status = await getAggregatedJobStatus(integrationJobId(userId, country, region));
        if (!status?.found) return { status: 'not_started' };
        if (status.status === 'completed') return { status: 'ready' };
        if (status.status === 'failed') return { status: 'failed' };
        // A job with a priority sits in 'prioritized' until a worker picks it up.
        if (['waiting', 'prioritized', 'waiting-children', 'delayed', 'pending'].includes(status.status)) return { status: 'queued' };
        return { status: 'preparing', phase: status.currentPhase || null, description: status.currentPhaseDescription || null };
    } catch (error) {
        logger.warn(`[Onboarding] fetch status unavailable for ${userId} ${country}-${region}: ${error.message}`);
        return { status: 'unknown' };
    }
};

/** States a first fetch can be started from. 'unknown' (the status could not be read) is
 *  included: addIntegrationJob checks the queue itself, and if the queue is unreachable it throws,
 *  so the seller sees an error instead of a page that claims their data is being prepared. */
const STARTABLE = ['not_started', 'failed', 'unknown'];

/**
 * Start first fetches. `scope: 'primary'` starts only the main marketplace (as soon as its region
 * is done, so the dashboard is ready as fast as before); `'all'` also starts every other connected
 * marketplace at a lower priority. Marketplaces already queued, running or finished are left alone.
 */
const startFetches = async ({ userId, scope = 'all' }) => {
    const checklist = await getChecklist(userId);
    const targets = checklist.marketplaces.filter((m) => m.spApi && (scope === 'all' || m.primary));
    const started = [];
    for (const m of targets) {
        if (!STARTABLE.includes(m.fetch.status)) continue;
        await addIntegrationJob(userId, m.country, m.region, {
            priority: m.primary ? PRIMARY_PRIORITY : SECONDARY_PRIORITY,
        });
        started.push(m.country);
    }
    return { started, checklist: await getChecklist(userId) };
};

/* ---------------------------------------------------------- checklist -- */

/** Everything the connect checklist and the "analysing" screen show. Never returns a token. */
const getChecklist = async (userId) => {
    const [grants, seller] = await Promise.all([
        RegionGrant.find({ User: userId }).select('+spiRefreshToken +adsRefreshToken').lean(),
        Seller.findOne({ User: userId }).sort({ createdAt: -1 })
            .select('sellerAccount.country sellerAccount.region sellerAccount.spiRefreshToken sellerAccount.adsRefreshToken sellerAccount.ProfileId')
            .lean(),
    ]);
    const grantFor = new Map(grants.map((g) => [g.region, g]));
    const primaryGrant = grants.find((g) => g.primaryCountry);
    const primary = primaryGrant ? { country: primaryGrant.primaryCountry, region: primaryGrant.region } : null;

    const accounts = (seller?.sellerAccount || []).filter((a) => a?.country && a?.region);
    const marketplaces = await Promise.all(accounts.map(async (a) => ({
        country: a.country,
        region: a.region,
        primary: Boolean(primary && primary.country === a.country && primary.region === a.region),
        spApi: Boolean(a.spiRefreshToken),
        ads: Boolean(a.adsRefreshToken && a.ProfileId),
        fetch: await fetchState(userId, a.country, a.region),
    })));

    const regions = REGIONS.map((region) => {
        const grant = grantFor.get(region);
        const confirmed = accounts.filter((a) => a.region === region).map((a) => a.country);
        const mapping = grant?.adsRefreshToken
            ? proposeProfileMapping(confirmed, grant.adsProfiles || [])
            : [];
        return {
            region,
            sellerCentral: Boolean(grant?.spiRefreshToken) || accounts.some((a) => a.region === region && a.spiRefreshToken),
            ads: Boolean(grant?.adsRefreshToken),
            discoveryFailed: Boolean(grant?.discoveryFailed),
            available: grant
                ? (grant.discoveryFailed ? countriesInRegion(region).map((country) => ({ country })) : grant.participations)
                : [],
            confirmed,
            adsMapping: mapping,
        };
    });

    return { primary, regions, marketplaces };
};

module.exports = {
    isEnabledFor,
    connectSellerCentral,
    confirmMarketplaces,
    connectAds,
    saveAdsProfiles,
    startFetches,
    getChecklist,
    proposeProfileMapping,
    PRIMARY_PRIORITY,
    SECONDARY_PRIORITY,
};

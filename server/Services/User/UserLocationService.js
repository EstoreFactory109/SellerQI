const Seller = require('../../models/user-auth/sellerCentralModel.js');

/**
 * UserLocationService
 *
 * Returns the Amazon marketplace location (country + region) associated with
 * the given user by looking at their most recently created Seller document
 * and selecting the first `sellerAccount` entry that has both `country` and
 * `region` populated.
 *
 * This service is intentionally standalone and read-only — it does NOT mutate
 * any state and does NOT depend on any other service. It is consumed by the
 * /app/user-location endpoint so the onboarding flow can decide which
 * Amazon Seller Central / Amazon Ads OAuth host to redirect to.
 *
 * `preferred` lists marketplaces to try first, in order — the one the connect
 * page is for, then the session's current one. The first that this user really
 * has is returned. Without it a user adding a second marketplace (say UK to an
 * existing US account) was always given the FIRST one, so Amazon's consent page
 * opened for the wrong region while the token was saved against the new one.
 * Entries that are not the user's own are ignored, so a caller cannot use this
 * to claim someone else's marketplace.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {Array<{country?: string, region?: string}>} [preferred]
 * @returns {Promise<{country: string|null, region: string|null}>}
 */
const getUserLocation = async (userId, preferred = []) => {
    if (!userId) {
        return { country: null, region: null };
    }

    const sellerDoc = await Seller.findOne({ User: userId }).sort({ createdAt: -1 });

    if (!sellerDoc || !Array.isArray(sellerDoc.sellerAccount) || sellerDoc.sellerAccount.length === 0) {
        return { country: null, region: null };
    }

    for (const want of preferred) {
        if (!want?.country || !want?.region) continue;
        const country = String(want.country).toUpperCase();
        const region = String(want.region).toUpperCase();
        const owned = sellerDoc.sellerAccount.find((acc) =>
            acc
            && String(acc.country || '').toUpperCase() === country
            && String(acc.region || '').toUpperCase() === region);
        if (owned) return { country: owned.country, region: owned.region };
    }

    const firstFullyPopulated = sellerDoc.sellerAccount.find((acc) => {
        return acc
            && typeof acc.country === 'string' && acc.country.trim() !== ''
            && typeof acc.region === 'string' && acc.region.trim() !== '';
    });

    if (firstFullyPopulated) {
        return {
            country: firstFullyPopulated.country,
            region: firstFullyPopulated.region,
        };
    }

    const first = sellerDoc.sellerAccount[0] || {};
    return {
        country: first.country || null,
        region: first.region || null,
    };
};

module.exports = { getUserLocation };

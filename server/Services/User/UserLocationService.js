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
 * Amazon Seller Central / Amazon Ads OAuth host to redirect to, without
 * relying on URL query parameters.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<{country: string|null, region: string|null}>}
 */
const getUserLocation = async (userId) => {
    if (!userId) {
        return { country: null, region: null };
    }

    const sellerDoc = await Seller.findOne({ User: userId }).sort({ createdAt: -1 });

    if (!sellerDoc || !Array.isArray(sellerDoc.sellerAccount) || sellerDoc.sellerAccount.length === 0) {
        return { country: null, region: null };
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

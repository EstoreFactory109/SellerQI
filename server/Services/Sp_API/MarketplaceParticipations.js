/**
 * Which marketplaces a Seller Central authorisation covers.
 *
 * GET /sellers/v1/marketplaceParticipations on the region's SP-API host lists every marketplace
 * the seller account has a presence in. Onboarding uses it to offer the marketplaces the seller
 * actually sells in, pre-ticked, instead of asking them to guess from a country list.
 *
 * Plain `x-amz-access-token` call (no SigV4), like most SP-API calls in this codebase.
 */
const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { SP_API_HOSTS, marketplaceById } = require('../Onboarding/marketplaces.js');

const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} accessToken SP-API (LWA) access token for the region
 * @param {'NA'|'EU'|'FE'} region
 * @returns {Promise<Array<{marketplaceId, countryCode, name, isParticipating, hasSuspendedListings}>>}
 */
async function getMarketplaceParticipations(accessToken, region) {
    const host = SP_API_HOSTS[region];
    if (!host) throw new Error(`Unknown region "${region}"`);

    for (let attempt = 1; ; attempt += 1) {
        try {
            const response = await axios.get(`https://${host}/sellers/v1/marketplaceParticipations`, {
                headers: { 'x-amz-access-token': accessToken, Accept: 'application/json' },
                timeout: 15000,
            });
            const rows = Array.isArray(response?.data?.payload) ? response.data.payload : [];
            return rows.map((row) => ({
                marketplaceId: row?.marketplace?.id,
                countryCode: row?.marketplace?.countryCode,
                name: row?.marketplace?.name,
                isParticipating: row?.participation?.isParticipating === true,
                hasSuspendedListings: row?.participation?.hasSuspendedListings === true,
            }));
        } catch (error) {
            const status = error?.response?.status;
            if (status === 429 && attempt < MAX_ATTEMPTS) {
                await sleep(1000 * attempt);
                continue;
            }
            logger.error(`[MarketplaceParticipations] ${region} lookup failed (status ${status || 'none'}): ${error.message}`);
            throw error;
        }
    }
}

/**
 * The participations SellerQI can onboard: participating, a marketplace we support, and in the
 * region that was authorised (an EU token can list non-EU entries such as India's separate
 * account; those are only offered under their own region).
 *
 * @returns {Array<{country, marketplaceId, region, name, hasSuspendedListings}>}
 */
function supportedParticipations(participations, region) {
    const seen = new Set();
    const result = [];
    for (const p of participations || []) {
        if (!p?.isParticipating) continue;
        const known = marketplaceById(p.marketplaceId);
        if (!known || known.region !== region || seen.has(known.country)) continue;
        seen.add(known.country);
        result.push({
            country: known.country,
            marketplaceId: known.marketplaceId,
            region: known.region,
            name: p.name || known.country,
            hasSuspendedListings: Boolean(p.hasSuspendedListings),
        });
    }
    return result;
}

module.exports = { getMarketplaceParticipations, supportedParticipations };

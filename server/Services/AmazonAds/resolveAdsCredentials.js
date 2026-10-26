/**
 * Amazon Ads access token and profile for one marketplace of a seller.
 * Same lookup the PPC page's pause / add-to-negative buttons use (their
 * controllers keep their own copy).
 */
const mongoose = require('mongoose');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAdsAccessToken } = require('./GenerateToken.js');
const { getProfileById } = require('./GenerateProfileId.js');

const COUNTRY_CODE = {
    US: 'US', CA: 'CA', MX: 'MX', BR: 'BR',
    UK: 'UK', GB: 'UK', DE: 'DE', FR: 'FR', ES: 'ES', IT: 'IT', NL: 'NL', SE: 'SE', PL: 'PL', BE: 'BE',
    JP: 'JP', AU: 'AU', SG: 'SG', IN: 'IN', AE: 'AE', SA: 'SA',
};

async function resolveAdsCredentials(userId, country, region) {
    const User = typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId) : userId;
    const seller = await Seller.findOne({ User });
    const account = seller?.sellerAccount?.find((acc) => acc.country === country && acc.region === region);
    if (!account) throw new Error(`No seller account for ${country}-${region}`);
    if (!account.adsRefreshToken) throw new Error('Amazon Ads is not connected for this marketplace');

    const accessToken = await generateAdsAccessToken(account.adsRefreshToken);
    if (!accessToken) throw new Error('Could not get an Amazon Ads access token; reconnect Amazon Ads');

    let profileId = account.ProfileId?.toString();
    if (!profileId) {
        const profiles = await getProfileById(accessToken, region, country, userId);
        if (!Array.isArray(profiles) || profiles.length === 0) throw new Error('No Amazon Ads profile for this account');
        const code = COUNTRY_CODE[country] || country;
        const match = profiles.find((p) => p.countryCode === code || p.countryCode?.toUpperCase() === country?.toUpperCase()) || profiles[0];
        profileId = match.profileId?.toString();
        if (!profileId) throw new Error('Could not resolve an Amazon Ads profile');
    }
    return { accessToken, profileId, region };
}

module.exports = { resolveAdsCredentials };

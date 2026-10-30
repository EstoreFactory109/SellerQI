/**
 * SP-API access for one seller marketplace, for changes made after the seller's
 * approval (messages, feeds, report cancels). LWA token only: SP-API no longer
 * needs request signing for these operations (seen live, Oct 2026).
 */
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('./GenerateTokens.js');
const { URIs, marketplaceConfig } = require('../../controllers/config/config.js');

const hostOf = (baseUri) => `https://${String(baseUri || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

/** @returns {Promise<{accessToken, host, marketplaceId, sellerId}>} */
async function credentialsFor(userId, country, region) {
    const seller = await Seller.findOne({ User: userId }).select('sellerAccount.country sellerAccount.region sellerAccount.spiRefreshToken sellerAccount.selling_partner_id').lean();
    const account = (seller?.sellerAccount || []).find((a) => a.country === country && a.region === region);
    if (!account?.spiRefreshToken) throw new Error('Seller Central is not connected for this marketplace.');
    const marketplaceId = marketplaceConfig[country];
    if (!URIs[region] || !marketplaceId) throw new Error(`Unsupported marketplace ${region}/${country}.`);
    const accessToken = await generateAccessToken(userId, account.spiRefreshToken);
    if (!accessToken) throw new Error('Could not get an Amazon access token. The seller may need to reconnect Seller Central.');
    return { accessToken, host: hostOf(URIs[region]), marketplaceId, sellerId: account.selling_partner_id || null };
}

module.exports = { credentialsFor, hostOf };

/**
 * Amazon's "Request to update negative feedback" buyer message (Messaging API,
 * action updateFeedback). Amazon writes the message itself (no text from us) and
 * allows it once per order. Used only after the seller approved it on the Tasks page
 * (TaskActionService 'request_feedback_update').
 *
 * Before sending, the order's allowed actions are read: Amazon leaves updateFeedback
 * out when it may not be sent (already sent, or the order is too old), and then
 * nothing is sent.
 */
const axios = require('axios');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAccessToken } = require('./GenerateTokens.js');
const { URIs, marketplaceConfig } = require('../../controllers/config/config.js');

const hostOf = (baseUri) => `https://${String(baseUri || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

async function credentialsFor(userId, country, region) {
    const seller = await Seller.findOne({ User: userId }).select('sellerAccount.country sellerAccount.region sellerAccount.spiRefreshToken').lean();
    const account = (seller?.sellerAccount || []).find(a => a.country === country && a.region === region);
    if (!account?.spiRefreshToken) throw new Error('Seller Central is not connected for this marketplace.');
    const marketplaceId = marketplaceConfig[country];
    if (!URIs[region] || !marketplaceId) throw new Error(`Unsupported marketplace ${region}/${country}.`);
    const accessToken = await generateAccessToken(userId, account.spiRefreshToken);
    if (!accessToken) throw new Error('Could not get an Amazon access token.');
    return { accessToken, host: hostOf(URIs[region]), marketplaceId };
}

/** The message actions Amazon allows for this order now (a read). */
async function allowedMessageActions({ accessToken, host, marketplaceId, orderId }) {
    const res = await axios.get(`${host}/messaging/v1/orders/${encodeURIComponent(orderId)}?marketplaceIds=${marketplaceId}`,
        { headers: { 'x-amz-access-token': accessToken }, timeout: 30000 });
    return (res.data?._links?.actions || []).map(a => a?.name).filter(Boolean);
}

async function requestFeedbackUpdate({ userId, country, region, orderId }) {
    const creds = await credentialsFor(userId, country, region);
    const actions = await allowedMessageActions({ ...creds, orderId });
    if (!actions.includes('updateFeedback')) {
        throw new Error('Amazon does not allow this message for this order now (it was already sent, or the order is too old), so nothing was sent.');
    }
    const res = await axios.post(
        `${creds.host}/messaging/v1/orders/${encodeURIComponent(orderId)}/messages/updateFeedback?marketplaceIds=${creds.marketplaceId}`,
        {}, { headers: { 'x-amz-access-token': creds.accessToken, 'Content-Type': 'application/json' }, timeout: 30000 });
    if (Array.isArray(res.data?.errors) && res.data.errors.length > 0) {
        throw Object.assign(new Error(`Amazon rejected it: ${JSON.stringify(res.data.errors[0]).slice(0, 300)}`), { response: res.data });
    }
    return { orderId, sent: true };
}

module.exports = { requestFeedbackUpdate, allowedMessageActions };

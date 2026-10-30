/**
 * SP-API Notifications (v1): where Amazon sends event notifications (a
 * destination: an SQS queue) and which events a seller is subscribed to.
 *
 * Destinations are SellerQI-wide and need a grantless token (client_credentials,
 * scope sellingpartnerapi::notifications); subscriptions are per seller and use
 * the seller's own token, except deleting one, which is grantless too.
 */
const axios = require('axios');
const { URIs } = require('../../controllers/config/config.js');

const SCOPE = 'sellingpartnerapi::notifications';
const TIMEOUT_MS = 30000;
const host = (region) => `https://${String(URIs[region] || '').replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
let cached = null;

async function grantlessToken() {
    if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE, client_id: process.env.SPAPI_CLIENT_ID, client_secret: process.env.SPAPI_CLIENT_SECRET });
    const res = await axios.post('https://api.amazon.com/auth/o2/token', body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: TIMEOUT_MS });
    if (!res.data?.access_token) throw new Error('Amazon gave no grantless token for notifications.');
    cached = { token: res.data.access_token, expiresAt: Date.now() + (Number(res.data.expires_in) || 3600) * 1000 };
    return cached.token;
}

async function createDestination({ region, name, sqsArn }) {
    const token = await grantlessToken();
    const res = await axios.post(`${host(region)}/notifications/v1/destinations`, { name, resourceSpecification: { sqs: { arn: sqsArn } } },
        { headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS });
    return res.data?.payload;
}

async function listDestinations({ region }) {
    const token = await grantlessToken();
    const res = await axios.get(`${host(region)}/notifications/v1/destinations`, { headers: { 'x-amz-access-token': token }, timeout: TIMEOUT_MS });
    return res.data?.payload || [];
}

/** The seller's subscription to one event type, or null (404 = none). */
async function getSubscription({ accessToken, region, notificationType }) {
    try {
        const res = await axios.get(`${host(region)}/notifications/v1/subscriptions/${notificationType}`, { headers: { 'x-amz-access-token': accessToken }, timeout: TIMEOUT_MS });
        return res.data?.payload || null;
    } catch (error) {
        if (error.response?.status === 404) return null;
        throw error;
    }
}

async function createSubscription({ accessToken, region, notificationType, destinationId }) {
    const res = await axios.post(`${host(region)}/notifications/v1/subscriptions/${notificationType}`, { payloadVersion: '1.0', destinationId },
        { headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS });
    return res.data?.payload;
}

async function deleteSubscription({ region, notificationType, subscriptionId }) {
    const token = await grantlessToken();
    await axios.delete(`${host(region)}/notifications/v1/subscriptions/${notificationType}/${encodeURIComponent(subscriptionId)}`,
        { headers: { 'x-amz-access-token': token }, timeout: TIMEOUT_MS });
    return { notificationType, subscriptionId, deleted: true };
}

module.exports = { grantlessToken, createDestination, listDestinations, getSubscription, createSubscription, deleteSubscription, SCOPE };

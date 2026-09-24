/**
 * pubsubVerifier.js — proving a push actually came from our Pub/Sub subscription.
 *
 * The endpoint is necessarily public: Google's servers call it and carry none of our
 * cookies. Everything that keeps it safe is in this file.
 *
 * ── VERIFYING THE SIGNATURE IS NOT ENOUGH, AND THAT IS THE WHOLE POINT ──
 * A valid Google-signed OIDC token proves only that SOME Google service account minted
 * it for our audience. Anyone with a Google Cloud account can create a service account,
 * create their own push subscription pointed at our URL, and send us perfectly valid,
 * perfectly signed tokens. Checking `verifyIdToken` alone and stopping there is the
 * mistake, and it looks completely correct in review.
 *
 * So the email in the verified payload must ALSO match the one service account we
 * expect, and the notification must be for our mailbox. Three checks, not one.
 *
 * ── AND EVEN THEN, THE BODY IS NOT TRUSTED ──
 * The token authenticates the CALLER, not the contents. The `historyId` in the message
 * is a doorbell: it tells us to look, never where to look from. Nothing downstream
 * accepts it as a cursor.
 */

const { OAuth2Client } = require('google-auth-library');
const logger = require('../../utils/Logger.js');
const { getPubSubConfig, getCredentials } = require('./config.js');

/**
 * A dedicated client, NOT the sign-in singleton.
 *
 * Sharing it would couple Gmail push verification to Google sign-in: a change to either
 * one's configuration would silently alter the other, and this one is a public endpoint.
 */
let verifierClient = null;
const getVerifier = () => {
    if (!verifierClient) verifierClient = new OAuth2Client();
    return verifierClient;
};

/** `Bearer <jwt>` → `<jwt>`. */
const bearerToken = (authorizationHeader) => {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorizationHeader || '').trim());
    return match ? match[1].trim() : null;
};

/**
 * Pub/Sub wraps the Gmail notification in base64 inside `message.data`.
 * The decoded payload is `{ emailAddress, historyId }`.
 */
const decodeNotification = (body) => {
    const data = body?.message?.data;
    if (!data) return null;
    try {
        return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    } catch (_) {
        return null;
    }
};

/**
 * Verify a push request.
 *
 * @param {object} req  needs `headers.authorization` and `body`
 * @returns {{ok: boolean, reason?: string, notification?: object}}
 */
const verifyPush = async (req) => {
    const { audience, serviceAccount } = getPubSubConfig();
    const { inboxAddress } = getCredentials();

    if (!serviceAccount) {
        // Refusing is the only safe default: without the expected account configured,
        // the endpoint would accept any Google service account in the world.
        return { ok: false, reason: 'push-not-configured' };
    }

    const token = bearerToken(req.headers?.authorization);
    if (!token) return { ok: false, reason: 'missing-token' };

    let payload;
    try {
        const ticket = await getVerifier().verifyIdToken({
            idToken: token,
            // When the subscription sets an audience, pin it. Left unset,
            // google-auth-library skips the audience check, which is why the identity
            // check below carries the weight either way.
            ...(audience ? { audience } : {}),
        });
        payload = ticket.getPayload();
    } catch (error) {
        logger.warn(`[GmailPush] token verification failed: ${error.message}`);
        return { ok: false, reason: 'invalid-token' };
    }

    /**
     * THE CHECK THAT ACTUALLY PROTECTS THIS ENDPOINT.
     * A signature proves a Google service account; this proves it is OURS.
     */
    const caller = String(payload?.email || '').trim().toLowerCase();
    if (caller !== serviceAccount) {
        logger.warn('[GmailPush] rejected a validly-signed token from an unexpected service account');
        return { ok: false, reason: 'unexpected-service-account' };
    }

    if (payload.email_verified === false) {
        return { ok: false, reason: 'unverified-service-account' };
    }

    const notification = decodeNotification(req.body);
    if (!notification) return { ok: false, reason: 'undecodable-notification' };

    /**
     * The notification must concern the mailbox we connected. A push for a different
     * address means the subscription is misconfigured, and acting on it would sync a
     * mailbox we never consented to.
     */
    const notifiedAddress = String(notification.emailAddress || '').trim().toLowerCase();
    if (inboxAddress && notifiedAddress && notifiedAddress !== inboxAddress) {
        logger.warn('[GmailPush] rejected a notification for a different mailbox');
        return { ok: false, reason: 'wrong-mailbox' };
    }

    return { ok: true, notification };
};

module.exports = { verifyPush, bearerToken, decodeNotification };

// ─────────────────────────────────────────
// authService.js
// Lightweight LWA auth helper for review requests
// ─────────────────────────────────────────

const fetch = global.fetch || require('node-fetch');
const logger = require('../../../utils/Logger.js');

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/**
 * Exchange a refresh token for an LWA access token scoped for SP-API.
 * This is intentionally kept self-contained for the review request flow,
 * using seller-specific client credentials passed from the caller.
 *
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {string} refreshToken
 * @returns {Promise<string>} accessToken
 */
async function getLWAAccessToken(clientId, clientSecret, refreshToken) {
  if (!clientId || !clientSecret || !refreshToken) {
    logger.error('[ReviewAuthService] Missing client credentials or refresh token');
    throw new Error('Missing client credentials or refresh token');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const res = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!res.ok) {
      let errBody = null;
      try {
        errBody = await res.json();
      } catch {
        // ignore JSON parse errors
      }
      logger.error('[ReviewAuthService] Failed to obtain LWA access token', {
        status: res.status,
        body: errBody,
      });
      throw new Error('Failed to obtain LWA access token');
    }

    const data = await res.json();
    if (!data.access_token) {
      logger.error('[ReviewAuthService] LWA response missing access_token', {
        response: data,
      });
      throw new Error('LWA response missing access_token');
    }

    return data.access_token;
  } catch (error) {
    logger.error('[ReviewAuthService] Error while obtaining LWA access token', {
      error: error?.message,
    });
    throw error;
  }
}

module.exports = {
  getLWAAccessToken,
};


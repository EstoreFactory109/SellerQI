const { signRequest, normalizeEndpoint } = require("./orders");
const {
  classifySpApiFailure,
  FAILURE,
  SpApiAuthDeniedError,
} = require("../../utils/spApiErrors.js");

const MAX_AUTH_RETRIES = 1;

/**
 * Checks if an order is eligible for a review solicitation.
 *
 * Calls GET /solicitations/v1/orders/{orderId}
 * Amazon checks internally whether the order has been delivered
 * and falls within the 5–30 day eligibility window.
 *
 * @param {string} accessToken - LWA access token
 * @param {string} orderId - Amazon Order ID
 * @param {object} config - SP-API + AWS config (aligned with rest of app)
 * @param {string} config.endpoint - SP-API endpoint (e.g., "https://sellingpartnerapi-fe.amazon.com")
 * @param {string} config.marketplaceId - Marketplace ID (e.g., "A1F83G8C2ARO7P")
 * @param {string} config.awsAccessKeyId
 * @param {string} config.awsSecretAccessKey
 * @param {string} config.awsRegion
 * @param {string} [config.awsSessionToken]
 * @param {object} [credentialProvider] - optional utils/spApiCredentials.js provider.
 *
 * @returns {Promise<object>} - Raw JSON response body from SP-API
 */
async function checkReviewEligibility(
  accessToken,
  orderId,
  {
    endpoint,
    marketplaceId,
    awsAccessKeyId,
    awsSecretAccessKey,
    awsRegion,
    awsSessionToken,
  },
  credentialProvider = null
) {
  if (!orderId) throw new Error("orderId is required");
  if (!accessToken && !credentialProvider) throw new Error("accessToken is required");
  if (!endpoint) throw new Error("endpoint is required");
  if (!marketplaceId) throw new Error("marketplaceId is required");

  const normalizedEndpoint = normalizeEndpoint(endpoint);
  if (!normalizedEndpoint) throw new Error("endpoint is required");

  const url = `${normalizedEndpoint}/solicitations/v1/orders/${orderId}?marketplaceIds=${marketplaceId}`;

  // The auth retry lives INSIDE this function because it is the only place the HTTP status is
  // visible — the contract is to return just the raw body. Without this, an expired token
  // would return an error body whose `actions` array is empty, and every remaining order
  // would be silently recorded as "still ineligible" and deferred 24h.
  let authRetries = 0;

  for (;;) {
    const creds = credentialProvider ? await credentialProvider.getValid() : null;

    const headers = signRequest({
      method: "GET",
      url,
      accessToken: creds ? creds.accessToken : accessToken,
      awsConfig: creds
        ? creds.awsConfig
        : {
            awsAccessKeyId,
            awsSecretAccessKey,
            awsRegion,
            awsSessionToken,
          },
      body: "",
    });

    const response = await fetch(url, { method: "GET", headers });
    // Return the raw JSON body from SP-API (no custom mapping or messages)
    const data = await response.json().catch(() => ({}));

    if (response.ok || !credentialProvider) return data;

    const classification = classifySpApiFailure({ status: response.status, body: data });

    if (classification === FAILURE.AUTH_DENIED) {
      const amazonMessage = data?.errors?.[0]?.message || "";
      throw new SpApiAuthDeniedError(
        `Solicitations eligibility authorization denied: ${amazonMessage || response.status}`,
        { amazonMessage, status: response.status }
      );
    }

    const refreshable =
      classification === FAILURE.TOKEN_EXPIRED ||
      classification === FAILURE.CREDS_EXPIRED ||
      classification === FAILURE.AUTH_AMBIGUOUS;

    if (!refreshable || authRetries >= MAX_AUTH_RETRIES) return data;

    authRetries++;
    await credentialProvider.refreshFor(classification);
  }
}

module.exports = { checkReviewEligibility };
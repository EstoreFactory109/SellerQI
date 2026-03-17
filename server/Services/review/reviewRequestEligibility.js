const { signRequest } = require("./orders");

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
  }
) {
  if (!orderId) throw new Error("orderId is required");
  if (!accessToken) throw new Error("accessToken is required");
  if (!endpoint) throw new Error("endpoint is required");
  if (!marketplaceId) throw new Error("marketplaceId is required");

  const url = `${endpoint}/solicitations/v1/orders/${orderId}?marketplaceIds=${marketplaceId}`;

  const headers = signRequest({
    method: "GET",
    url,
    accessToken,
    awsConfig: {
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
  return data;
}

module.exports = { checkReviewEligibility };
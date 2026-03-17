const { signRequest } = require("./orders");

/**
 * Sends a review solicitation request for a specific order.
 *
 * @param {string} accessToken - LWA access token
 * @param {string} orderId - Amazon Order ID
 * @param {object} config - SP-API + AWS config
 * @param {string} config.endpoint
 * @param {string} config.marketplaceId
 * @param {string} config.awsAccessKeyId
 * @param {string} config.awsSecretAccessKey
 * @param {string} config.awsRegion
 * @param {string} [config.awsSessionToken]
 * @returns {Promise<object>} - { success, orderId, status?, error? }
 */
async function sendReviewRequest(
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

  const url = `${endpoint}/solicitations/v1/orders/${orderId}/solicitations/productReview?marketplaceIds=${marketplaceId}`;

  const headers = signRequest({
    method: "POST",
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

  const response = await fetch(url, { method: "POST", headers });

  if (response.status === 201) {
    return { success: true, orderId };
  }

  const errorData = await response.json().catch(() => ({}));
  return {
    success: false,
    orderId,
    status: response.status,
    error: errorData?.errors?.[0]?.message || "Unknown error",
  };
}

module.exports = {
  sendReviewRequest,
};

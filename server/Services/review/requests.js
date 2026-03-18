const { signRequest, normalizeEndpoint } = require("./orders");

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

  const normalizedEndpoint = normalizeEndpoint(endpoint);
  if (!normalizedEndpoint) throw new Error("endpoint is required");

  const url = `${normalizedEndpoint}/solicitations/v1/orders/${orderId}/solicitations/productReviewAndSellerFeedback?marketplaceIds=${marketplaceId}`

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
  const errorMessage = errorData?.errors?.[0]?.message || "Unknown error";

  // Amazon returns 403 + "not available for this amazonOrderId" when the
  // solicitation was already sent (e.g. manually via Seller Central).
  const alreadySent =
    response.status === 403 &&
    /not available for this/i.test(errorMessage);

  return {
    success: false,
    alreadySent,
    orderId,
    status: response.status,
    error: errorMessage,
  };
}

module.exports = {
  sendReviewRequest,
};

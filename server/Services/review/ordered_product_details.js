const { signRequest, normalizeEndpoint } = require("./orders");
const {
  classifySpApiFailure,
  FAILURE,
  SpApiAuthDeniedError,
} = require("../../utils/spApiErrors.js");

// One refresh is enough to rescue an aged-out credential on a single-shot call; beyond that
// the problem is not expiry. Kept small because this runs once per order.
const MAX_AUTH_RETRIES = 1;

/**
 * Fetches product details for a given Amazon order ID.
 *
 * @param {string} orderId - The Amazon Order ID (e.g., "250-2680949-4655861")
 * @param {string} accessToken - LWA access token for SP-API
 * @param {object} awsConfig - AWS credentials and endpoint config
 * @param {string} awsConfig.endpoint - SP-API endpoint (e.g., "https://sellingpartnerapi-fe.amazon.com")
 * @param {string} awsConfig.awsAccessKeyId
 * @param {string} awsConfig.awsSecretAccessKey
 * @param {string} awsConfig.awsRegion
 * @param {string} [awsConfig.awsSessionToken]
 *
 * @returns {Promise<object>} - { orderId, items: [...] }
 *
 * Each item in the array contains:
 *   - ASIN, SellerSKU, Title
 *   - QuantityOrdered, QuantityShipped
 *   - ItemPrice, ItemTax, PromotionDiscount
 *   - Condition, IsGift, and more
 */
async function getProductDetailsByOrderId(
  orderId,
  accessToken,
  {
    endpoint,
    awsAccessKeyId,
    awsSecretAccessKey,
    awsRegion,
    awsSessionToken,
  },
  credentialProvider = null
) {
  if (!orderId) throw new Error("orderId is required");
  if (!accessToken && !credentialProvider) throw new Error("accessToken is required");

  const normalizedEndpoint = normalizeEndpoint(endpoint);
  if (!normalizedEndpoint) throw new Error("endpoint is required");

  const url = `${normalizedEndpoint}/orders/v0/orders/${orderId}/orderItems`;

  // This endpoint is called once per order, so a run that walks thousands of orders will
  // cross the ~60 min credential lifetime partway through. With a provider we refresh and
  // retry the single failing call; without one, behaviour is exactly as before.
  let response;
  let data;
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

    response = await fetch(url, { method: "GET", headers });
    data = await response.json().catch(() => null);

    if (response.ok || !credentialProvider) break;

    const classification = classifySpApiFailure({ status: response.status, body: data });
    const amazonMessage = data?.errors?.[0]?.message || data?.message || "";

    // A grant/role denial applies to every remaining order too — abort the whole run
    // rather than failing thousands of orders one at a time.
    if (classification === FAILURE.AUTH_DENIED) {
      throw new SpApiAuthDeniedError(
        `OrderItems API authorization denied: ${amazonMessage || response.status}`,
        { amazonMessage, status: response.status }
      );
    }

    const refreshable =
      classification === FAILURE.TOKEN_EXPIRED ||
      classification === FAILURE.CREDS_EXPIRED ||
      classification === FAILURE.AUTH_AMBIGUOUS;

    if (!refreshable || authRetries >= MAX_AUTH_RETRIES) break;

    authRetries++;
    await credentialProvider.refreshFor(classification);
  }

  if (!response.ok) {
    console.error(
      `❌ OrderItems API Error for ${orderId}:`,
      JSON.stringify(data, null, 2)
    );
    throw new Error(
      `OrderItems API failed for ${orderId}: ${response.status} — ${
        data?.errors?.[0]?.message || "Unknown error"
      }`
    );
  }

  // The body is parsed with a `.catch(() => null)` above so that an unparsable ERROR body can
  // still be classified. Keep an unparsable SUCCESS body a hard failure, exactly as the
  // previous bare `await response.json()` did — otherwise the order would be silently
  // recorded as ingested with zero items instead of being retried on a later run.
  if (data === null) {
    throw new Error(`OrderItems API returned an unparsable body for ${orderId}`);
  }

  const orderItems = data?.payload?.OrderItems || [];

  // Extract the most useful product fields into a clean format
  const items = orderItems.map((item) => ({
    asin: item.ASIN || null,
    sellerSKU: item.SellerSKU || null,
    title: item.Title || null,
    quantityOrdered: item.QuantityOrdered || 0,
    quantityShipped: item.QuantityShipped || 0,
    itemPrice: item.ItemPrice || null,
    itemTax: item.ItemTax || null,
    promotionDiscount: item.PromotionDiscount || null,
    condition: item.ConditionId || null,
    conditionSubtype: item.ConditionSubtypeId || null,
    isGift: item.IsGift === "true",
    serialNumbers: item.SerialNumbers || [],
    // Keep the raw item in case caller needs extra fields
    _raw: item,
  }));

  return {
    orderId,
    itemCount: items.length,
    items,
  };
}



module.exports = { getProductDetailsByOrderId };
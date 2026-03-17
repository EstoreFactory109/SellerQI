const { signRequest } = require("./orders");

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
  }
) {
  if (!orderId) throw new Error("orderId is required");
  if (!accessToken) throw new Error("accessToken is required");

  const url = `${endpoint}/orders/v0/orders/${orderId}/orderItems`;

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
  const data = await response.json();

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
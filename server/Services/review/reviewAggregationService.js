const { fetchOrders } = require("./orders");
const { getProductDetailsByOrderId } = require("./ordered_product_details");
const { checkReviewEligibility } = require("./reviewRequestEligibility");
const ReviewOrder = require("../../models/review/ReviewOrderModel");
const ReviewOrderItem = require("../../models/review/ReviewOrderItemModel");

/**
 * Orchestrates fetching orders, items, and review eligibility,
 * then stores everything in MongoDB using ReviewOrder / ReviewOrderItem models.
 *
 * This is designed for long-term storage and is rate-limit aware.
 *
 * @param {Object} params
 * @param {ObjectId} params.userId       - Our internal User _id
 * @param {string} params.country        - Seller country
 * @param {string} params.region         - SP-API region (NA, EU, FE)
 * @param {string} params.accessToken    - LWA access token
 * @param {Object} params.awsConfig      - SP-API + AWS SigV4 config
 * @param {string} params.awsConfig.marketplaceId
 * @param {string} params.awsConfig.endpoint
 * @param {string} params.awsConfig.awsAccessKeyId
 * @param {string} params.awsConfig.awsSecretAccessKey
 * @param {string} params.awsConfig.awsRegion
 * @param {string} [params.awsConfig.awsSessionToken]
 *
 * @returns {Promise<{ totalOrders: number, orders: Array }>}
 */
async function fetchAndStoreReviewOrders({
  userId,
  country,
  region,
  accessToken,
  awsConfig,
}) {
  const { marketplaceId } = awsConfig;

  // Unique identifier for this fetch run so we can query "last N batches" later
  const fetchBatchId = new Date().toISOString();

  // 1) Fetch orders (last 7 days, shipped) via orders.js
  const orders = await fetchOrders(accessToken, awsConfig);

  const detailedOrders = [];

  // 2) For each order, fetch items + eligibility, then upsert into DB
  for (const order of orders) {
    const orderId =
      order.AmazonOrderId ||
      order.AmazonOrderID ||
      order.OrderId ||
      order.orderId;

    if (!orderId) {
      // Still push into response, but skip DB write to avoid ambiguity
      detailedOrders.push({
        ...order,
        itemCount: 0,
        items: [],
        reviewEligibility: null,
        storage: {
          saved: false,
          reason: "Order ID not found on order object",
        },
      });
      await sleep(1000);
      continue;
    }

    try {
      // 2a) Fetch product details (OrderItems)
      const { itemCount, items } = await getProductDetailsByOrderId(
        orderId,
        accessToken,
        awsConfig
      );

      // 2b) Be gentle with rate limits before eligibility call
      await sleep(5000);

      // 2c) Check review eligibility (raw response)
      const eligibilityResponse = await checkReviewEligibility(
        accessToken,
        orderId,
        awsConfig
      );

      // Derive simple boolean flag: can we request a review?
      const actions =
        eligibilityResponse?.payload?.actions ||
        eligibilityResponse?._embedded?.actions ||
        [];
      const canRequestReview = Array.isArray(actions) && actions.length > 0;

      // 2d) Upsert ReviewOrder document — protect already-processed orders
      const existingOrder = await ReviewOrder.findOne({
        marketplaceId,
        amazonOrderId: orderId,
      })
        .select({ reviewRequestStatus: 1 })
        .lean();

      const alreadyActedOn =
        existingOrder &&
        (existingOrder.reviewRequestStatus === "sent" ||
          existingOrder.reviewRequestStatus === "failed");

      const updateFields = {
        User: userId,
        country,
        region,
        marketplaceId,
        amazonOrderId: orderId,
        purchaseDate: order.PurchaseDate
          ? new Date(order.PurchaseDate)
          : undefined,
        orderStatus: order.OrderStatus,
        buyerEmail: order.BuyerInfo?.BuyerEmail,
        buyerName: order.BuyerInfo?.BuyerName,
        orderTotalAmount: order.OrderTotal?.Amount
          ? Number(order.OrderTotal.Amount)
          : undefined,
        orderTotalCurrencyCode: order.OrderTotal?.CurrencyCode,
        itemCount,
        rawOrder: order,
        fetchBatchId,
      };

      if (!alreadyActedOn) {
        updateFields.eligibilityLastCheckedAt = new Date();
        updateFields.eligibilityResponse = eligibilityResponse;
        updateFields.canRequestReview = canRequestReview;
      }

      const setOnInsert = !existingOrder
        ? { reviewRequestStatus: "not_requested" }
        : {};

      const reviewOrderDoc = await ReviewOrder.findOneAndUpdate(
        { marketplaceId, amazonOrderId: orderId },
        {
          $set: updateFields,
          $setOnInsert: setOnInsert,
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

      // 2e) Upsert ReviewOrderItem documents for each item
      const itemBulkOps = items.map((itm) => ({
        updateOne: {
          filter: {
            reviewOrder: reviewOrderDoc._id,
            User: userId,
            marketplaceId,
            amazonOrderId: orderId,
            asin: itm.asin || null,
            sellerSKU: itm.sellerSKU || null,
          },
          update: {
            $set: {
              reviewOrder: reviewOrderDoc._id,
              User: userId,
              marketplaceId,
              amazonOrderId: orderId,
              asin: itm.asin || null,
              sellerSKU: itm.sellerSKU || null,
              title: itm.title,
              quantityOrdered: itm.quantityOrdered,
              quantityShipped: itm.quantityShipped,
              itemPrice: itm.itemPrice,
              itemTax: itm.itemTax,
              promotionDiscount: itm.promotionDiscount,
              condition: itm.condition,
              conditionSubtype: itm.conditionSubtype,
              isGift: itm.isGift,
              serialNumbers: itm.serialNumbers,
              rawItem: itm._raw,
            },
          },
          upsert: true,
        },
      }));

      if (itemBulkOps.length) {
        await ReviewOrderItem.bulkWrite(itemBulkOps, { ordered: false });
      }

      detailedOrders.push({
        ...order,
        itemCount,
        items,
        reviewEligibility: eligibilityResponse,
        canRequestReview,
        storage: {
          saved: true,
          reviewOrderId: reviewOrderDoc._id,
        },
      });
    } catch (err) {
      console.error(
        `❌ Failed to process order ${orderId} for review storage:`,
        err.message
      );

      detailedOrders.push({
        ...order,
        itemCount: 0,
        items: [],
        reviewEligibility: null,
        storage: {
          saved: false,
          error: err.message || "Failed to fetch/store order review data",
        },
      });
    }

    // 2f) Small delay before moving to next order to further reduce 429 risk
    await sleep(2000);
  }

  return {
    totalOrders: detailedOrders.length,
    orders: detailedOrders,
  };
}

// Local sleep helper to avoid circular import from orders.js
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  fetchAndStoreReviewOrders,
};


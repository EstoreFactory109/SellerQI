const { fetchOrders } = require("./orders");
const { getProductDetailsByOrderId } = require("./ordered_product_details");
const ReviewOrder = require("../../models/review/ReviewOrderModel");
const ReviewOrderItem = require("../../models/review/ReviewOrderItemModel");

/**
 * Lightweight ingestion service for the integration worker.
 * Fetches orders + items from SP-API and upserts into DB.
 * Does NOT check review eligibility (that's the scheduled worker's job).
 *
 * @param {Object} params
 * @param {ObjectId} params.userId
 * @param {string}   params.country
 * @param {string}   params.region
 * @param {string}   params.accessToken  - LWA access token
 * @param {Object}   params.awsConfig    - SP-API + AWS SigV4 config
 * @returns {Promise<{ totalOrders: number, ingested: number, failed: number }>}
 */
async function ingestReviewOrders({
  userId,
  country,
  region,
  accessToken,
  awsConfig,
}) {
  const { marketplaceId } = awsConfig;
  const fetchBatchId = new Date().toISOString();

  const orders = await fetchOrders(accessToken, awsConfig);

  console.log(
    `[reviewIngestion] Fetched ${orders.length} orders for user ${userId} (${country}/${region})`
  );

  let ingested = 0;
  let failed = 0;

  for (const order of orders) {
    const orderId =
      order.AmazonOrderId ||
      order.AmazonOrderID ||
      order.OrderId ||
      order.orderId;

    if (!orderId) {
      failed++;
      await sleep(500);
      continue;
    }

    try {
      const { itemCount, items } = await getProductDetailsByOrderId(
        orderId,
        accessToken,
        awsConfig
      );

      // Upsert order — never overwrite reviewRequestStatus if already sent/failed
      const existingOrder = await ReviewOrder.findOne({
        marketplaceId,
        amazonOrderId: orderId,
      })
        .select({ reviewRequestStatus: 1 })
        .lean();

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

      // Only set reviewRequestStatus on brand-new inserts
      const setOnInsert =
        !existingOrder
          ? { reviewRequestStatus: "not_requested", canRequestReview: null }
          : {};

      const reviewOrderDoc = await ReviewOrder.findOneAndUpdate(
        { marketplaceId, amazonOrderId: orderId },
        {
          $set: updateFields,
          $setOnInsert: setOnInsert,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      // Upsert items
      if (items.length) {
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

        await ReviewOrderItem.bulkWrite(itemBulkOps, { ordered: false });
      }

      ingested++;
    } catch (err) {
      console.error(
        `[reviewIngestion] Failed to process order ${orderId}:`,
        err.message
      );
      failed++;
    }

    await sleep(2000);
  }

  console.log(
    `[reviewIngestion] Done — ingested: ${ingested}, failed: ${failed}, total: ${orders.length}`
  );

  return {
    totalOrders: orders.length,
    ingested,
    failed,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  ingestReviewOrders,
};

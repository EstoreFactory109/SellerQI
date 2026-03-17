const ReviewOrder = require("../../models/review/ReviewOrderModel");
const { sendReviewRequest } = require("./requests");
const { checkReviewEligibility } = require("./reviewRequestEligibility");

/**
 * Processes unsent review requests from the last 2 fetch batches for a user.
 *
 * Flow per order:
 *  1. If canRequestReview === true  -> send request -> mark sent/failed
 *  2. If canRequestReview !== true  -> re-check eligibility via SP-API
 *     a. Now eligible  -> update canRequestReview, send request -> mark sent/failed
 *     b. Still not eligible -> update eligibility data, leave status as-is
 *
 * Memory-safe: uses Mongoose .cursor() to stream one doc at a time.
 *
 * @param {Object} params
 * @param {ObjectId} params.userId
 * @param {string}   params.country
 * @param {string}   params.region
 * @param {string}   params.accessToken - LWA access token
 * @param {Object}   params.awsConfig   - SP-API + AWS SigV4 config
 * @returns {Promise<Object>} summary counts
 */
async function processReviewRequests({
  userId,
  country,
  region,
  accessToken,
  awsConfig,
}) {
  // 1) Find the last 2 distinct fetchBatchIds for this user/location
  const batchIds = await ReviewOrder.distinct("fetchBatchId", {
    User: userId,
    country,
    region,
    fetchBatchId: { $ne: null },
  });

  // Sort descending (ISO strings sort lexicographically) and take last 2
  batchIds.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  const last2Batches = batchIds.slice(0, 2);

  // Build filter: orders from last 2 batches OR orders that have no batchId yet (legacy data)
  const batchFilter =
    last2Batches.length > 0
      ? { $or: [{ fetchBatchId: { $in: last2Batches } }, { fetchBatchId: null }] }
      : {};

  console.log(
    `[processReviewRequests] Batches: ${last2Batches.length ? last2Batches.join(", ") : "(none — processing all legacy orders)"}`
  );

  // 2) Stream orders one at a time using cursor (memory-safe)
  const cursor = ReviewOrder.find({
    User: userId,
    country,
    region,
    reviewRequestStatus: "not_requested",
    ...batchFilter,
  })
    .sort({ purchaseDate: -1 })
    .cursor();

  const summary = {
    processed: 0,
    sent: 0,
    reChecked: 0,
    stillIneligible: 0,
    failed: 0,
  };

  for await (const order of cursor) {
    summary.processed++;
    const { amazonOrderId } = order;

    console.log(
      `[${summary.processed}] Processing order ${amazonOrderId} (canRequestReview=${order.canRequestReview})`
    );

    try {
      if (order.canRequestReview) {
        // Already eligible -> send directly
        const result = await sendReviewRequest(
          accessToken,
          amazonOrderId,
          awsConfig
        );

        if (result.success) {
          await ReviewOrder.updateOne(
            { _id: order._id },
            {
              $set: {
                reviewRequestStatus: "sent",
                reviewRequestLastSentAt: new Date(),
                reviewRequestError: null,
              },
            }
          );
          summary.sent++;
          console.log(`  -> Sent successfully`);
        } else {
          await ReviewOrder.updateOne(
            { _id: order._id },
            {
              $set: {
                reviewRequestStatus: "failed",
                reviewRequestError: result.error || `HTTP ${result.status}`,
              },
            }
          );
          summary.failed++;
          console.log(`  -> Send failed: ${result.error}`);
        }
      } else {
        // Not eligible yet -> re-check eligibility
        summary.reChecked++;

        await sleep(5000);

        const eligibilityResponse = await checkReviewEligibility(
          accessToken,
          amazonOrderId,
          awsConfig
        );

        const actions =
          eligibilityResponse?.payload?.actions ||
          eligibilityResponse?._embedded?.actions ||
          [];
        const nowEligible = Array.isArray(actions) && actions.length > 0;

        if (nowEligible) {
          // Became eligible -> update flag, then send
          await ReviewOrder.updateOne(
            { _id: order._id },
            {
              $set: {
                canRequestReview: true,
                eligibilityLastCheckedAt: new Date(),
                eligibilityResponse,
              },
            }
          );

          await sleep(5000);

          const result = await sendReviewRequest(
            accessToken,
            amazonOrderId,
            awsConfig
          );

          if (result.success) {
            await ReviewOrder.updateOne(
              { _id: order._id },
              {
                $set: {
                  reviewRequestStatus: "sent",
                  reviewRequestLastSentAt: new Date(),
                  reviewRequestError: null,
                },
              }
            );
            summary.sent++;
            console.log(`  -> Re-checked: now eligible, sent successfully`);
          } else {
            await ReviewOrder.updateOne(
              { _id: order._id },
              {
                $set: {
                  reviewRequestStatus: "failed",
                  reviewRequestError: result.error || `HTTP ${result.status}`,
                },
              }
            );
            summary.failed++;
            console.log(`  -> Re-checked: now eligible, but send failed: ${result.error}`);
          }
        } else {
          // Still not eligible -> update eligibility data only, leave status as not_requested
          await ReviewOrder.updateOne(
            { _id: order._id },
            {
              $set: {
                eligibilityLastCheckedAt: new Date(),
                eligibilityResponse,
              },
            }
          );
          summary.stillIneligible++;
          console.log(`  -> Re-checked: still not eligible`);
        }
      }
    } catch (err) {
      console.error(
        `  -> Error processing order ${amazonOrderId}:`,
        err.message
      );
      summary.failed++;

      await ReviewOrder.updateOne(
        { _id: order._id },
        {
          $set: {
            reviewRequestStatus: "failed",
            reviewRequestError: err.message || "Unexpected error during review request processing",
          },
        }
      ).catch(() => {});
    }

    // Rate-limit delay between orders
    await sleep(5000);
  }

  console.log("[processReviewRequests] Summary:", summary);
  return summary;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  processReviewRequests,
};

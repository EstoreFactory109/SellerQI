const ReviewOrder = require("../../models/review/ReviewOrderModel");
const { sendReviewRequest } = require("./requests");
const { checkReviewEligibility } = require("./reviewRequestEligibility");

const MIN_ORDER_AGE_DAYS = 5;
const MAX_ORDER_AGE_DAYS = 30;
const ELIGIBILITY_RECHECK_HOURS = 24;

/**
 * Processes unsent review requests for a user.
 *
 * Query: reviewRequestStatus=not_requested, purchaseDate within 5–30 day window,
 * and nextEligibilityCheckAt <= now (or null).
 *
 * Uses Mongoose .cursor() for memory safety.
 *
 * @param {Object} params
 * @param {ObjectId} params.userId
 * @param {string}   params.country
 * @param {string}   params.region
 * @param {string}   params.accessToken
 * @param {Object}   params.awsConfig
 * @returns {Promise<Object>} summary counts
 */
async function processReviewRequests({
  userId,
  country,
  region,
  accessToken,
  awsConfig,
}) {
  const now = new Date();

  const minDate = new Date(now);
  minDate.setDate(minDate.getDate() - MAX_ORDER_AGE_DAYS);

  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() - MIN_ORDER_AGE_DAYS);

  const cursor = ReviewOrder.find({
    User: userId,
    country,
    region,
    reviewRequestStatus: "not_requested",
    purchaseDate: { $gte: minDate, $lte: maxDate },
    $or: [
      { nextEligibilityCheckAt: { $lte: now } },
      { nextEligibilityCheckAt: null },
    ],
  })
    .sort({ purchaseDate: -1 })
    .cursor();

  const summary = {
    processed: 0,
    sent: 0,
    alreadySent: 0,
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
              $inc: { sendAttemptCount: 1 },
            }
          );
          summary.sent++;
          console.log(`  -> Sent successfully`);
        } else if (result.alreadySent) {
          await ReviewOrder.updateOne(
            { _id: order._id },
            {
              $set: {
                reviewRequestStatus: "sent",
                reviewRequestLastSentAt: new Date(),
                reviewRequestError: "Sent externally (via Seller Central)",
              },
              $inc: { sendAttemptCount: 1 },
            }
          );
          summary.alreadySent++;
          console.log(`  -> Already sent externally (Seller Central)`);
        } else {
          await ReviewOrder.updateOne(
            { _id: order._id },
            {
              $set: {
                reviewRequestStatus: "failed",
                reviewRequestError: result.error || `HTTP ${result.status}`,
              },
              $inc: { sendAttemptCount: 1 },
            }
          );
          summary.failed++;
          console.log(`  -> Send failed: ${result.error}`);
        }
      } else {
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
          await ReviewOrder.updateOne(
            { _id: order._id },
            {
              $set: {
                canRequestReview: true,
                eligibilityLastCheckedAt: new Date(),
                eligibilityResponse,
              },
              $inc: { eligibilityCheckCount: 1 },
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
                $inc: { sendAttemptCount: 1 },
              }
            );
            summary.sent++;
            console.log(`  -> Re-checked: now eligible, sent successfully`);
          } else if (result.alreadySent) {
            await ReviewOrder.updateOne(
              { _id: order._id },
              {
                $set: {
                  reviewRequestStatus: "sent",
                  reviewRequestLastSentAt: new Date(),
                  reviewRequestError: "Sent externally (via Seller Central)",
                },
                $inc: { sendAttemptCount: 1 },
              }
            );
            summary.alreadySent++;
            console.log(`  -> Re-checked: already sent externally (Seller Central)`);
          } else {
            await ReviewOrder.updateOne(
              { _id: order._id },
              {
                $set: {
                  reviewRequestStatus: "failed",
                  reviewRequestError: result.error || `HTTP ${result.status}`,
                },
                $inc: { sendAttemptCount: 1 },
              }
            );
            summary.failed++;
            console.log(
              `  -> Re-checked: now eligible, but send failed: ${result.error}`
            );
          }
        } else {
          const nextCheck = new Date();
          nextCheck.setHours(nextCheck.getHours() + ELIGIBILITY_RECHECK_HOURS);

          await ReviewOrder.updateOne(
            { _id: order._id },
            {
              $set: {
                eligibilityLastCheckedAt: new Date(),
                eligibilityResponse,
                canRequestReview: false,
                nextEligibilityCheckAt: nextCheck,
              },
              $inc: { eligibilityCheckCount: 1 },
            }
          );
          summary.stillIneligible++;
          console.log(
            `  -> Re-checked: still not eligible, next check at ${nextCheck.toISOString()}`
          );
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
            reviewRequestError:
              err.message ||
              "Unexpected error during review request processing",
          },
          $inc: { sendAttemptCount: 1 },
        }
      ).catch(() => {});
    }

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

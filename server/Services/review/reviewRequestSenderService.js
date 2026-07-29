const ReviewOrder = require("../../models/review/ReviewOrderModel");
const { sendReviewRequest } = require("./requests");
const { checkReviewEligibility } = require("./reviewRequestEligibility");
const { ORDER_CONFIG } = require("./orders");
const {
  classifySpApiFailure,
  FAILURE,
  SpApiAuthDeniedError,
} = require("../../utils/spApiErrors.js");

// Single source of truth for the 5-30 day solicitation window, shared with orders.js instead
// of being redeclared here. Amazon enforces the same window server-side; if these drift, sends
// either stop happening or get rejected.
const MIN_ORDER_AGE_DAYS = ORDER_CONFIG.minOrderAgeDays;
const MAX_ORDER_AGE_DAYS = ORDER_CONFIG.maxOrderAgeDays;

const ELIGIBILITY_RECHECK_HOURS = 24;
const MAX_AUTH_RETRIES = 1;

// Upper bound on orders handled per run. At 5-15s per order this keeps a run's wall-clock
// bounded; the remainder stays `not_requested` and is picked up next run.
const MAX_ORDERS_PER_RUN = parseInt(
  process.env.REVIEW_SENDER_MAX_ORDERS_PER_RUN || "400",
  10
);

/**
 * Merge the provider's rotating AWS keys over the caller's awsConfig, which also carries
 * `endpoint` and `marketplaceId` that the provider does not know about.
 */
function withFreshCreds(awsConfig, creds) {
  return creds ? { ...awsConfig, ...creds.awsConfig } : awsConfig;
}

/**
 * sendReviewRequest wrapped with credential refresh.
 *
 * IMPORTANT: `result.success` and `result.alreadySent` both return immediately, BEFORE any
 * auth classification. `alreadySent` is the Solicitations API's legitimate 403 + "not
 * available for this amazonOrderId" (already solicited, e.g. manually via Seller Central) —
 * see Services/review/requests.js:61-65. Treating it as an auth failure would refresh
 * credentials pointlessly and, worse, could mark a healthy order as `failed`. requests.js
 * itself is deliberately left untouched.
 */
async function sendWithAuthRetry(accessToken, amazonOrderId, awsConfig, credentialProvider) {
  let authRetries = 0;

  for (;;) {
    const creds = credentialProvider ? await credentialProvider.getValid() : null;
    const result = await sendReviewRequest(
      creds ? creds.accessToken : accessToken,
      amazonOrderId,
      withFreshCreds(awsConfig, creds)
    );

    if (result.success || result.alreadySent || !credentialProvider) return result;

    const classification = classifySpApiFailure({
      status: result.status,
      message: result.error,
    });

    if (classification === FAILURE.AUTH_DENIED) {
      throw new SpApiAuthDeniedError(
        `Solicitations authorization denied: ${result.error || result.status}`,
        { amazonMessage: result.error || "", status: result.status }
      );
    }

    const refreshable =
      classification === FAILURE.TOKEN_EXPIRED ||
      classification === FAILURE.CREDS_EXPIRED ||
      classification === FAILURE.AUTH_AMBIGUOUS;

    if (!refreshable || authRetries >= MAX_AUTH_RETRIES) return result;

    authRetries++;
    await credentialProvider.refreshFor(classification);
  }
}

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
 * @param {Object}   [params.credentialProvider] - utils/spApiCredentials.js provider. The
 *   sender sleeps 5s+ per order, so a few hundred orders already exceeds the ~60 min
 *   credential life; without a provider it fails partway through exactly as ingestion did.
 * @returns {Promise<Object>} summary counts
 */
async function processReviewRequests({
  userId,
  country,
  region,
  accessToken,
  awsConfig,
  credentialProvider = null,
}) {
  const now = new Date();

  const minDate = new Date(now);
  minDate.setDate(minDate.getDate() - MAX_ORDER_AGE_DAYS);

  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() - MIN_ORDER_AGE_DAYS);

  // Bounded, materialised batch rather than a streaming .cursor().
  //
  // This loop sleeps 5-15s per order, so an unbounded cursor was held open for the entire run
  // — hours for a large backlog — risking a server-side cursor timeout that aborts mid-run,
  // and the wait only got longer once a credential refresh could occur inside an iteration.
  // Reading a capped slice up front removes that failure mode completely. Only _id,
  // amazonOrderId and canRequestReview are used below, so `.lean()` with a narrow projection
  // keeps this small. Whatever is not reached this run is picked up by the next one, since
  // these orders stay `not_requested`.
  const orders = await ReviewOrder.find({
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
    // OLDEST first. This matters now that the query is capped: those orders reach the 30-day
    // solicitation deadline soonest, so they must be sent before newer ones. Sorting newest
    // first (as the uncapped cursor did, harmlessly) would permanently starve the tail of a
    // backlog larger than one run — those orders would age out unsolicited.
    .sort({ purchaseDate: 1 })
    .limit(MAX_ORDERS_PER_RUN)
    .select({ _id: 1, amazonOrderId: 1, canRequestReview: 1 })
    .lean();

  const summary = {
    processed: 0,
    sent: 0,
    alreadySent: 0,
    reChecked: 0,
    stillIneligible: 0,
    failed: 0,
    // Signals a backlog larger than one run can drain, so the cap is visible rather than
    // looking like the queue simply ended.
    capped: orders.length >= MAX_ORDERS_PER_RUN,
  };

  for (const order of orders) {
    summary.processed++;
    const { amazonOrderId } = order;

    console.log(
      `[${summary.processed}] Processing order ${amazonOrderId} (canRequestReview=${order.canRequestReview})`
    );

    try {
      if (order.canRequestReview) {
        const result = await sendWithAuthRetry(
          accessToken,
          amazonOrderId,
          awsConfig,
          credentialProvider
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
          awsConfig,
          credentialProvider
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

          const result = await sendWithAuthRetry(
            accessToken,
            amazonOrderId,
            awsConfig,
            credentialProvider
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
      // ★ MUST come before the "failed" write below. An authorization denial applies to the
      //   whole account, not this one order — if we fell through, every remaining order in
      //   the cursor would be permanently stamped reviewRequestStatus:"failed" (they are
      //   only re-queried while "not_requested"), silently destroying the backlog for a
      //   seller whose grant simply needs reconnecting.
      if (err instanceof SpApiAuthDeniedError) throw err;

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

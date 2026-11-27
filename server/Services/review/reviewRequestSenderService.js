const ReviewOrder = require("../../models/review/ReviewOrderModel");
const { sendReviewRequest } = require("./requests");
const {
  checkReviewEligibility,
  hasReviewSolicitationAction,
  isPermanentRefusal,
} = require("./reviewRequestEligibility");
const { ORDER_CONFIG, SENT_EXTERNALLY_NOTE } = require("./orders");
const {
  classifySpApiFailure,
  FAILURE,
  SpApiAuthDeniedError,
  SpApiTransientError,
} = require("../../utils/spApiErrors.js");

// Single source of truth for the order-age window, shared with orders.js. Amazon's real
// window is 5 days after the earliest delivery to 30 days after the latest delivery; we only
// know the purchase date (FBA orders carry no delivery date), so the bounds here are the
// widest ages at which an order can possibly be eligible. Amazon's own eligibility answer,
// not this window, decides whether a request can be sent.
// Orders are first checked at FIRST_CHECK_AGE_DAYS: delivery cannot precede purchase, and
// measured FBA orders were eligible from about day 7, so day 5-6 checks are almost always "no".
const FIRST_CHECK_AGE_DAYS = ORDER_CONFIG.firstCheckAgeDays ?? ORDER_CONFIG.minOrderAgeDays;
const MAX_ORDER_AGE_DAYS = ORDER_CONFIG.maxOrderAgeDays;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const ELIGIBILITY_RECHECK_HOURS = 24;
// Orders older than this are only worth a check once everything younger has been handled:
// an FBA order's real window has mostly closed by about day 32, so spending the per-run cap
// on the very oldest orders (as plain oldest-first would, now that the ceiling is 45) checks
// orders that are almost never eligible while live ones wait.
const LIVE_WINDOW_AGE_DAYS = 32;
// Past this age an FBA order's real window has mostly closed; only slow-delivery orders
// can still be eligible, so check them less often.
const OLD_ORDER_AGE_DAYS = 32;
const OLD_ORDER_RECHECK_HOURS = 72;
// Check-only runs (auto-send off): an order already found eligible is refreshed this often.
// Matches the freshness the Review Requests page treats as "now" (ELIGIBILITY_FRESH_DAYS).
const ELIGIBLE_RECHECK_HOURS = 72;
// Amazon throttling: stop the run after this many back-to-back "no answer" results rather
// than burning retries on every remaining order.
const MAX_CONSECUTIVE_TRANSIENT = 5;
const MAX_AUTH_RETRIES = 1;

// Amazon allows 1 call/second per seller for both the eligibility check and the send
// (x-amzn-RateLimit-Limit: 1.0). A burst test showed no throttling even at 0.7s gaps, so
// 1.2s keeps ~20% headroom. Each call itself takes ~0.8s.
const BASE_CALL_SPACING_MS = parseInt(process.env.REVIEW_CALL_SPACING_MS || "1200", 10);
const MAX_CALL_SPACING_MS = 10000;

// Upper bounds on one run. Whatever is not reached stays `not_requested` and is picked up
// next run. Sized for the largest account (~6k new orders/day, most eligible, so ~2 calls
// = ~2.4s per order): 18h covers ~27k orders/day, enough to clear a backlog in about a week
// and then keep up with a few hours a day. Small accounts finish in minutes either way.
// The count only guards memory and a runaway query (60k narrow lean docs is ~10 MB); time
// is the real limit. The worker also passes a hard `deadline` (end of its daily tick), so a
// run can never spill into the next day's tick, whatever these are set to.
const MAX_ORDERS_PER_RUN = parseInt(
  process.env.REVIEW_SENDER_MAX_ORDERS_PER_RUN || "60000",
  10
);
const RUN_BUDGET_MS = parseInt(
  process.env.REVIEW_SENDER_RUN_BUDGET_MS || String(18 * 60 * 60 * 1000),
  10
);
// Check-only accounts (auto-send off) never send; their checks only keep the status shown on
// the Review Requests page honest, so they get a small share.
const CHECK_ONLY_MAX_ORDERS_PER_RUN = parseInt(
  process.env.REVIEW_CHECKONLY_MAX_ORDERS_PER_RUN || "300",
  10
);

/**
 * Keeps calls to Amazon at least `spacingMs` apart (measured start to start, which is what
 * the rate limit counts) instead of sleeping a fixed time around every order. Slows itself
 * down when Amazon pushes back and eases back to the base pace after clean calls.
 */
function createPacer({
  spacingMs = BASE_CALL_SPACING_MS,
  maxSpacingMs = MAX_CALL_SPACING_MS,
} = {}) {
  let spacing = spacingMs;
  let lastCallAt = 0;
  return {
    async wait() {
      const gap = lastCallAt + spacing - Date.now();
      if (gap > 0) await sleep(gap);
      lastCallAt = Date.now();
    },
    slowDown() {
      spacing = Math.min(spacing * 2, maxSpacingMs);
    },
    speedUp() {
      if (spacing > spacingMs) spacing = Math.max(spacingMs, Math.round(spacing * 0.8));
    },
    get spacingMs() {
      return spacing;
    },
  };
}

// How soon to re-check an order that keeps answering "no": the first few answers daily, then
// less often. Most permanent "no"s (already requested in Seller Central, multi-channel) never
// change, so they should not cost a call every day for 40 days.
function recheckHoursForIneligible(ageDays, checksSoFar) {
  if (ageDays > OLD_ORDER_AGE_DAYS) return OLD_ORDER_RECHECK_HOURS;
  if (checksSoFar < 3) return ELIGIBILITY_RECHECK_HOURS;
  if (checksSoFar < 6) return 2 * ELIGIBILITY_RECHECK_HOURS;
  return OLD_ORDER_RECHECK_HOURS;
}

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

/** A send that Amazon could not answer (throttled / 5xx): not a verdict on the order. */
function isTransientSendResult(result) {
  return result?.status === 429 || result?.status >= 500;
}

/**
 * Record the outcome of a send. Returns "transient" when Amazon gave no answer (the order
 * is left untouched so the next run retries it), otherwise "done".
 */
async function applySendResult(order, result, summary, label) {
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
    console.log(`  -> ${label}sent successfully`);
    return "done";
  }

  if (result.alreadySent) {
    await ReviewOrder.updateOne(
      { _id: order._id },
      {
        $set: {
          reviewRequestStatus: "sent",
          reviewRequestLastSentAt: new Date(),
          reviewRequestError: SENT_EXTERNALLY_NOTE,
        },
        $inc: { sendAttemptCount: 1 },
      }
    );
    summary.alreadySent++;
    console.log(`  -> ${label}already sent externally (Seller Central)`);
    return "done";
  }

  if (isTransientSendResult(result)) {
    // "failed" is terminal (only not_requested orders are re-queried), so a throttled POST
    // must not be recorded as one.
    summary.checkErrors++;
    console.log(`  -> ${label}send not answered by Amazon (HTTP ${result.status}), will retry next run`);
    return "transient";
  }

  await ReviewOrder.updateOne(
    { _id: order._id },
    {
      $set: {
        reviewRequestStatus: "failed",
        reviewRequestFailedAt: new Date(),
        reviewRequestError: result.error || `HTTP ${result.status}`,
      },
      $inc: { sendAttemptCount: 1 },
    }
  );
  summary.failed++;
  console.log(`  -> ${label}send failed: ${result.error}`);
  return "done";
}

/**
 * Processes unsent review requests for a user.
 *
 * Query: reviewRequestStatus=not_requested, purchaseDate within the order-age window,
 * and nextEligibilityCheckAt <= now (or null).
 *
 * In `checkOnly` mode (account has auto-send off) the same orders are checked with Amazon
 * and `canRequestReview` is recorded, but nothing is ever sent. Sending stays gated on the
 * seller's opt-in; the check is read-only.
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
 * @param {boolean}  [params.checkOnly=false] - record eligibility only, never send.
 * @param {Date|number} [params.deadline] - hard stop (the worker's end of tick); the run
 *   stops starting new orders at the earlier of this and RUN_BUDGET_MS.
 * @returns {Promise<Object>} summary counts
 */
async function processReviewRequests({
  userId,
  country,
  region,
  accessToken,
  awsConfig,
  credentialProvider = null,
  checkOnly = false,
  deadline = null,
}) {
  const now = new Date();
  const startedAt = Date.now();
  const deadlineMs = deadline ? new Date(deadline).getTime() : Infinity;
  const stopAt = Math.min(startedAt + RUN_BUDGET_MS, deadlineMs);
  const runCap = checkOnly ? CHECK_ONLY_MAX_ORDERS_PER_RUN : MAX_ORDERS_PER_RUN;
  const pacer = createPacer();

  const minDate = new Date(now);
  minDate.setDate(minDate.getDate() - MAX_ORDER_AGE_DAYS);

  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() - FIRST_CHECK_AGE_DAYS);

  // An order already found eligible (by an earlier check-only run) is deferred like any other
  // checked order, but when sending is on it must be sent now, not when the deferral ends.
  const dueClauses = [
    { nextEligibilityCheckAt: { $lte: now } },
    { nextEligibilityCheckAt: null },
  ];
  if (!checkOnly) dueClauses.push({ canRequestReview: true });

  // Bounded, materialised batch rather than a streaming .cursor().
  //
  // This loop sleeps 5-15s per order, so an unbounded cursor was held open for the entire run
  // — hours for a large backlog — risking a server-side cursor timeout that aborts mid-run,
  // and the wait only got longer once a credential refresh could occur inside an iteration.
  // Reading a capped slice up front removes that failure mode completely. Only the fields
  // selected below are used, so `.lean()` with a narrow projection keeps this small.
  // Whatever is not reached this run is picked up by the next one, since these orders stay
  // `not_requested`.
  // Two passes so the cap goes to orders that can still be eligible first:
  //   1) orders up to LIVE_WINDOW_AGE_DAYS old, OLDEST first (nearest their deadline),
  //   2) only with capacity left over, the older tail up to the ceiling.
  // Oldest-first inside each pass still matters: a plain newest-first sort would permanently
  // starve the tail of a backlog larger than one run, and those orders would age out unsent.
  const baseFilter = {
    User: userId,
    country,
    region,
    reviewRequestStatus: "not_requested",
    $or: dueClauses,
  };
  // Sending accounts: oldest first (nearest their deadline). Check-only accounts: newest
  // first, because the only point of those checks is the status the seller sees, and the
  // Review Requests page lists newest orders first; with the small check-only cap, oldest
  // first would spend it all on orders at the very end of their window.
  const sortDir = checkOnly ? -1 : 1;
  const fetchSlice = (purchaseDate, limit) =>
    ReviewOrder.find({ ...baseFilter, purchaseDate })
      .sort({ purchaseDate: sortDir })
      .limit(limit)
      .select({ _id: 1, amazonOrderId: 1, canRequestReview: 1, purchaseDate: 1, eligibilityCheckCount: 1 })
      .lean();

  const liveMinDate = new Date(now.getTime() - LIVE_WINDOW_AGE_DAYS * DAY_MS);
  let orders = await fetchSlice(
    { $gte: liveMinDate > minDate ? liveMinDate : minDate, $lte: maxDate },
    runCap
  );
  if (orders.length < runCap && liveMinDate > minDate) {
    const tail = await fetchSlice(
      { $gte: minDate, $lt: liveMinDate },
      runCap - orders.length
    );
    orders = orders.concat(tail);
  }

  const summary = {
    processed: 0,
    sent: 0,
    alreadySent: 0,
    reChecked: 0,
    stillIneligible: 0,
    eligibleFound: 0,
    // Amazon gave no answer (throttled / 5xx); the order was left alone for the next run.
    checkErrors: 0,
    failed: 0,
    checkOnly,
    stoppedEarly: null,
    // Signals a backlog larger than one run can drain, so the cap is visible rather than
    // looking like the queue simply ended.
    capped: orders.length >= runCap,
  };

  let consecutiveTransient = 0;

  for (const order of orders) {
    if (Date.now() >= stopAt) {
      summary.stoppedEarly = stopAt === deadlineMs ? "deadline" : "budget";
      console.warn(
        `[processReviewRequests] Stopped (${summary.stoppedEarly}) after ${summary.processed} orders; the rest are picked up next run`
      );
      break;
    }

    if (consecutiveTransient >= MAX_CONSECUTIVE_TRANSIENT) {
      summary.stoppedEarly = "throttled";
      console.warn(
        `[processReviewRequests] ${consecutiveTransient} consecutive no-answer results from Amazon; stopping this run`
      );
      break;
    }

    summary.processed++;
    const { amazonOrderId } = order;
    const transientBefore = consecutiveTransient;

    console.log(
      `[${summary.processed}] Processing order ${amazonOrderId} (canRequestReview=${order.canRequestReview}${checkOnly ? ", check-only" : ""})`
    );

    try {
      if (order.canRequestReview && !checkOnly) {
        await pacer.wait();
        const result = await sendWithAuthRetry(
          accessToken,
          amazonOrderId,
          awsConfig,
          credentialProvider
        );
        const outcome = await applySendResult(order, result, summary, "");
        consecutiveTransient = outcome === "transient" ? consecutiveTransient + 1 : 0;
      } else {
        summary.reChecked++;

        await pacer.wait();

        const eligibilityResponse = await checkReviewEligibility(
          accessToken,
          amazonOrderId,
          awsConfig,
          credentialProvider
        );
        // A real answer (even "no") from here on.
        consecutiveTransient = 0;

        const nowEligible = hasReviewSolicitationAction(eligibilityResponse);

        if (nowEligible) {
          const eligibleUpdate = {
            canRequestReview: true,
            eligibilityLastCheckedAt: new Date(),
            eligibilityResponse,
          };
          if (checkOnly) {
            eligibleUpdate.nextEligibilityCheckAt = new Date(Date.now() + ELIGIBLE_RECHECK_HOURS * HOUR_MS);
          }
          await ReviewOrder.updateOne(
            { _id: order._id },
            { $set: eligibleUpdate, $inc: { eligibilityCheckCount: 1 } }
          );

          if (checkOnly) {
            summary.eligibleFound++;
            console.log(`  -> Check-only: eligible (auto-send is off, not sending)`);
          } else {
            await pacer.wait();

            const result = await sendWithAuthRetry(
              accessToken,
              amazonOrderId,
              awsConfig,
              credentialProvider
            );
            const outcome = await applySendResult(order, result, summary, "Re-checked: now eligible, ");
            consecutiveTransient = outcome === "transient" ? consecutiveTransient + 1 : 0;
          }
        } else {
          const purchasedAt = order.purchaseDate ? new Date(order.purchaseDate).getTime() : null;
          const ageDays = purchasedAt ? (Date.now() - purchasedAt) / DAY_MS : 0;

          let nextCheck;
          if (isPermanentRefusal(eligibilityResponse)) {
            // Amazon will never allow this order (e.g. multi-channel): stop re-checking it.
            nextCheck = new Date((purchasedAt || Date.now()) + (MAX_ORDER_AGE_DAYS + 1) * DAY_MS);
          } else {
            const hours = recheckHoursForIneligible(ageDays, order.eligibilityCheckCount || 0);
            nextCheck = new Date(Date.now() + hours * HOUR_MS);
          }

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
      //   whole account, not this one order — if we fell through, every remaining order
      //   in the batch would be permanently stamped reviewRequestStatus:"failed" (they are
      //   only re-queried while "not_requested"), silently destroying the backlog for a
      //   seller whose grant simply needs reconnecting.
      if (err instanceof SpApiAuthDeniedError) throw err;

      // Amazon gave no answer (throttled / 5xx after retries). That says nothing about the
      // order, so leave it exactly as it is: no "failed", no "still ineligible" deferral.
      if (err instanceof SpApiTransientError) {
        summary.checkErrors++;
        consecutiveTransient++;
        console.warn(
          `  -> No answer from Amazon for order ${amazonOrderId} (${err.message}); will retry next run`
        );
        pacer.slowDown();
        continue;
      }

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
            reviewRequestFailedAt: new Date(),
            reviewRequestError:
              err.message ||
              "Unexpected error during review request processing",
          },
          $inc: { sendAttemptCount: 1 },
        }
      ).catch(() => {});
    }

    // Pace: back off when this order ended in a throttled send, ease back after clean ones.
    if (consecutiveTransient > transientBefore) pacer.slowDown();
    else pacer.speedUp();
  }

  summary.spacingMs = pacer.spacingMs;
  console.log("[processReviewRequests] Summary:", summary);
  return summary;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  processReviewRequests,
  createPacer,
  recheckHoursForIneligible,
};

const { signRequest, normalizeEndpoint } = require("./orders");
const {
  classifySpApiFailure,
  FAILURE,
  SpApiAuthDeniedError,
  SpApiTransientError,
} = require("../../utils/spApiErrors.js");

const MAX_AUTH_RETRIES = 1;

// Throttling / 5xx are not an answer about the order. Retry a few times with backoff, then
// throw SpApiTransientError so the caller leaves the order alone instead of recording it as
// "not eligible" (an error body has no `actions`, which used to look exactly like "no").
const MAX_TRANSIENT_RETRIES = 3;
const TRANSIENT_MAX_DELAY_MS = 30000;

// The only solicitation action we can send. Any other action in the response is irrelevant.
const REVIEW_ACTION = "productReviewAndSellerFeedback";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function transientDelayMs(attempt, retryAfterHeader) {
  const base = Number.parseInt(process.env.REVIEW_ELIGIBILITY_RETRY_BASE_MS ?? "2000", 10);
  const retryAfter = Number.parseFloat(retryAfterHeader);
  const delay = Number.isFinite(retryAfter) && retryAfter >= 0
    ? retryAfter * 1000
    : (Number.isFinite(base) ? base : 2000) * 2 ** attempt;
  return Math.min(delay, TRANSIENT_MAX_DELAY_MS);
}

/**
 * Does this eligibility response offer the review + seller feedback solicitation?
 * Matches on the action name anywhere inside the action entries so it does not depend on
 * which HAL shape (`_embedded.actions`, `payload.actions`, `_links.actions`) Amazon returned.
 */
function hasReviewSolicitationAction(response) {
  const actions =
    response?.payload?.actions ||
    response?._embedded?.actions ||
    response?._links?.actions ||
    [];
  if (!Array.isArray(actions)) return false;
  return actions.some((a) => {
    try {
      return JSON.stringify(a ?? "").toLowerCase().includes(REVIEW_ACTION.toLowerCase());
    } catch {
      return false;
    }
  });
}

/**
 * Amazon will never allow a request for this order (re-checking is pointless), as opposed
 * to "not yet" or "no right now".
 */
function isPermanentRefusal(response) {
  const message = String(response?.errors?.[0]?.message || "");
  return /multi-channel/i.test(message);
}

/**
 * Checks if an order is eligible for a review solicitation.
 *
 * Calls GET /solicitations/v1/orders/{orderId}
 * Amazon checks internally whether the order has been delivered
 * and falls within the 5–30 day eligibility window.
 *
 * @param {string} accessToken - LWA access token
 * @param {string} orderId - Amazon Order ID
 * @param {object} config - SP-API + AWS config (aligned with rest of app)
 * @param {string} config.endpoint - SP-API endpoint (e.g., "https://sellingpartnerapi-fe.amazon.com")
 * @param {string} config.marketplaceId - Marketplace ID (e.g., "A1F83G8C2ARO7P")
 * @param {string} config.awsAccessKeyId
 * @param {string} config.awsSecretAccessKey
 * @param {string} config.awsRegion
 * @param {string} [config.awsSessionToken]
 * @param {object} [credentialProvider] - optional utils/spApiCredentials.js provider.
 *
 * @returns {Promise<object>} - Raw JSON response body from SP-API
 */
async function checkReviewEligibility(
  accessToken,
  orderId,
  {
    endpoint,
    marketplaceId,
    awsAccessKeyId,
    awsSecretAccessKey,
    awsRegion,
    awsSessionToken,
  },
  credentialProvider = null
) {
  if (!orderId) throw new Error("orderId is required");
  if (!accessToken && !credentialProvider) throw new Error("accessToken is required");
  if (!endpoint) throw new Error("endpoint is required");
  if (!marketplaceId) throw new Error("marketplaceId is required");

  const normalizedEndpoint = normalizeEndpoint(endpoint);
  if (!normalizedEndpoint) throw new Error("endpoint is required");

  const url = `${normalizedEndpoint}/solicitations/v1/orders/${orderId}?marketplaceIds=${marketplaceId}`;

  // The auth retry lives INSIDE this function because it is the only place the HTTP status is
  // visible — the contract is to return just the raw body. Without this, an expired token
  // would return an error body whose `actions` array is empty, and every remaining order
  // would be silently recorded as "still ineligible" and deferred 24h.
  let authRetries = 0;
  let transientRetries = 0;

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

    const response = await fetch(url, { method: "GET", headers });
    // Return the raw JSON body from SP-API (no custom mapping or messages)
    const data = await response.json().catch(() => ({}));

    if (response.ok) return data;

    const classification = classifySpApiFailure({ status: response.status, body: data });

    if (classification === FAILURE.THROTTLE || response.status >= 500) {
      if (transientRetries >= MAX_TRANSIENT_RETRIES) {
        const amazonMessage = data?.errors?.[0]?.message || "";
        throw new SpApiTransientError(
          `Solicitations eligibility unavailable: ${amazonMessage || response.status}`,
          { status: response.status, amazonMessage }
        );
      }
      await sleep(transientDelayMs(transientRetries, response.headers?.get?.("retry-after")));
      transientRetries++;
      continue;
    }

    if (!credentialProvider) return data;

    if (classification === FAILURE.AUTH_DENIED) {
      const amazonMessage = data?.errors?.[0]?.message || "";
      throw new SpApiAuthDeniedError(
        `Solicitations eligibility authorization denied: ${amazonMessage || response.status}`,
        { amazonMessage, status: response.status }
      );
    }

    const refreshable =
      classification === FAILURE.TOKEN_EXPIRED ||
      classification === FAILURE.CREDS_EXPIRED ||
      classification === FAILURE.AUTH_AMBIGUOUS;

    if (!refreshable || authRetries >= MAX_AUTH_RETRIES) return data;

    authRetries++;
    await credentialProvider.refreshFor(classification);
  }
}

module.exports = {
  checkReviewEligibility,
  hasReviewSolicitationAction,
  isPermanentRefusal,
};
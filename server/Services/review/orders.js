const crypto = require("crypto");
// Zero-dependency classifier only — deliberately NOT utils/spApiCredentials.js, which would
// drag the User model into this otherwise model-free module. Callers pass a provider in.
const {
  classifySpApiFailure,
  FAILURE,
  SpApiAuthDeniedError,
} = require("../../utils/spApiErrors.js");

// ─── CONFIG ────────────────────────────────────────────────────────────────────
// This module is now a **pure service** that expects caller to provide:
// - accessToken: per-user LWA access token (SP-API)
// - awsAccessKeyId / awsSecretAccessKey / awsRegion / endpoint / marketplaceId: passed via config object
//
// We keep only order-related constants here; credentials come from caller.
const ORDER_CONFIG = {
  // Only Shipped orders are eligible for review requests
  orderStatuses: ["Shipped"],

  // Solicitation eligibility window: 5 to 30 days old
  minOrderAgeDays: 5,
  maxOrderAgeDays: 30,

  // Delay between each solicitation request (ms) to respect rate limits
  delayBetweenRequests: 1000,

  // Gap between Orders API pagination calls.
  // /orders/v0/orders documented limits: rate 0.0167 req/s (1/min), burst 20.
  // 3s keeps us well inside the burst while leaving headroom; adaptive delay
  // from the x-amzn-RateLimit-Limit header (below) will slow us down further
  // if Amazon signals a lower rate at runtime.
  delayBetweenOrderPagesMs: 3000,
};

// Retry tuning for /orders/v0/orders (rate 0.0167 req/s → one token per 60s after
// burst is depleted). We need enough total wait for the bucket to refill under
// real-world dynamic throttling, where Amazon can reduce the effective rate.
const ORDERS_FETCH_MAX_ATTEMPTS = 10;
const ORDERS_FETCH_BASE_BACKOFF_MS = 2000;
const ORDERS_FETCH_MAX_BACKOFF_MS = 120000;
// Floor for 429 waits when Amazon does not provide a `retry-after` header.
// Matches the sustained 1 req / 60s refill rate.
const ORDERS_FETCH_MIN_429_WAIT_MS = 60000;

// Auth-failure retries are tracked separately from throttle retries: a token refresh is
// independent of the rate-limit bucket, so it must not consume a throttle attempt.
// Mirrors MAX_AUTH_REFRESHES_PER_PAGE in Services/Sp_API/Expences.js.
const MAX_AUTH_REFRESHES_PER_PAGE = 2;
// A generic/bare 403 (FAILURE.AUTH_AMBIGUOUS) needs its own budget, because Amazon uses that
// exact shape for three different situations: an expired token, a permanently-denied grant,
// and a transient rejection under load. Two attempts (with a backoff between them, below)
// distinguishes them well enough: a real expiry recovers on the first refresh, a transient
// clears after the wait, and a de-authorized account still fails in ~10s instead of an hour.
const MAX_AMBIGUOUS_AUTH_REFRESHES = 2;
// Pause before retrying an ambiguous 403. Without this, two unlucky back-to-back transient
// 403s on the same page would be misread as a revoked grant — aborting a healthy run and
// flagging the account as needing reconnection.
const AMBIGUOUS_AUTH_RETRY_WAIT_MS = 5000;

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== "string") return endpoint;
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * The ingestion window: from `windowDays` before yesterday, through end of yesterday.
 *
 * Note this is intentionally WIDER than the 5–30 day solicitation window: ingestion runs
 * Mon/Wed/Fri, so orders are captured while still too young to solicit and age into
 * eligibility before a later sender run. The default of 15 days leaves generous slack for a
 * skipped run.
 *
 * @param {number} [windowDays=15]
 */
function getDateRange(windowDays = 15) {
  const today = new Date();

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  yesterday.setHours(23, 59, 59, 0);

  const startDate = new Date(yesterday);
  startDate.setDate(yesterday.getDate() - windowDays);
  startDate.setHours(0, 0, 0, 0);

  return {
    createdAfter: startDate.toISOString(),
    createdBefore: yesterday.toISOString(),
  };
}

/**
 * Split a date range into contiguous slices of `sliceHours`.
 *
 * Slices are the unit of resumable progress. A run that cannot finish the whole window
 * completes whole slices and records them, so the next run continues where it stopped.
 *
 * Why slices and not a saved NextToken: SP-API pagination tokens are short-lived AND bound to
 * the exact query that produced them, and `getDateRange` is anchored to *today* — so Monday's
 * token refers to a window that no longer exists on Wednesday. Cross-run token resume is
 * invalid twice over; a date range is stable and re-walking one is idempotent because upserts
 * key on {marketplaceId, amazonOrderId}.
 *
 * Returned oldest-first: those orders age out of the 5–30 day solicitation window soonest.
 *
 * @returns {Array<{sliceKey:string, createdAfter:string, createdBefore:string}>}
 */
function enumerateSlices(createdAfter, createdBefore, sliceHours = 24) {
  const start = new Date(createdAfter);
  const end = new Date(createdBefore);

  if (!(start < end)) return [];
  const stepMs = Math.max(1, Math.floor(sliceHours)) * 60 * 60 * 1000;

  const slices = [];
  let cursor = start.getTime();

  while (cursor < end.getTime()) {
    const sliceEnd = Math.min(cursor + stepMs, end.getTime());
    slices.push({
      // Hour-resolution key so a sliceHours change does not silently collide with
      // previously-recorded slices at a different granularity.
      sliceKey: new Date(cursor).toISOString().slice(0, 13),
      createdAfter: new Date(cursor).toISOString(),
      createdBefore: new Date(sliceEnd).toISOString(),
    });
    cursor = sliceEnd;
  }

  return slices;
}

/**
 * Is this purchase date inside Amazon's 5–30 day solicitation window?
 *
 * Single source of truth for that window — previously duplicated between the dead
 * `isEligibleForReview` here and private constants in reviewRequestSenderService.js.
 */
function isWithinReviewWindow(purchaseDate, now = new Date()) {
  if (!purchaseDate) return false;
  const purchased = purchaseDate instanceof Date ? purchaseDate : new Date(purchaseDate);
  if (Number.isNaN(purchased.getTime())) return false;

  const ageInDays = (now - purchased) / (1000 * 60 * 60 * 24);
  return (
    ageInDays >= ORDER_CONFIG.minOrderAgeDays &&
    ageInDays <= ORDER_CONFIG.maxOrderAgeDays
  );
}

function isEligibleForReview(order) {
  const purchaseDate = new Date(order.PurchaseDate);
  const now = new Date();
  const ageInDays = (now - purchaseDate) / (1000 * 60 * 60 * 24);

  return (
    order.OrderStatus === "Shipped" &&
    ageInDays >= ORDER_CONFIG.minOrderAgeDays &&
    ageInDays <= ORDER_CONFIG.maxOrderAgeDays
  );
}

// ─── SIGV4 SIGNING ─────────────────────────────────────────────────────────────
function hmac(key, data, encoding) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest(encoding);
}

function hash(data) {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function getSignatureKey(secretKey, dateStamp, regionName, serviceName) {
  const kDate    = hmac("AWS4" + secretKey, dateStamp);
  const kRegion  = hmac(kDate, regionName);
  const kService = hmac(kRegion, serviceName);
  return hmac(kService, "aws4_request");
}

function signRequest({ method, url, accessToken, body = "", awsConfig }) {
  const parsedUrl      = new URL(url);
  const service        = "execute-api";
  const now            = new Date();
  const amzDate        = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp      = amzDate.slice(0, 8);
  const payloadHash    = hash(body);
  const hasSessionToken = !!awsConfig.awsSessionToken;

  const canonicalHeaders =
    `host:${parsedUrl.host}\n` +
    `x-amz-access-token:${accessToken}\n` +
    `x-amz-date:${amzDate}\n` +
    (hasSessionToken ? `x-amz-security-token:${awsConfig.awsSessionToken}\n` : "");

  const signedHeaders = hasSessionToken
    ? "host;x-amz-access-token;x-amz-date;x-amz-security-token"
    : "host;x-amz-access-token;x-amz-date";

  const sortedParams = Array.from(parsedUrl.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [method, parsedUrl.pathname, sortedParams, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${awsConfig.awsRegion}/${service}/aws4_request`;
  const stringToSign    = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hash(canonicalRequest)].join("\n");

  const signingKey = getSignatureKey(awsConfig.awsSecretAccessKey, dateStamp, awsConfig.awsRegion, service);
  const signature  = hmac(signingKey, stringToSign, "hex");

  return {
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${awsConfig.awsAccessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-access-token": accessToken,
    "x-amz-date": amzDate,
    ...(hasSessionToken ? { "x-amz-security-token": awsConfig.awsSessionToken } : {}),
    "Content-Type": "application/json",
  };
}

/**
 * Compute backoff for a throttled Orders API call.
 * Priority: honor Amazon's `retry-after` header when present; otherwise use
 * exponential growth with jitter, but never less than the sustained-rate floor
 * (60s) on 429 — since that is how long a single token takes to refill.
 */
function computeOrdersBackoffMs(response, attempt) {
  const retryAfterRaw = response.headers.get("retry-after");
  const retryAfterMs = retryAfterRaw ? parseInt(retryAfterRaw, 10) * 1000 : NaN;
  const is429 = response.status === 429;

  let waitMs;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    waitMs = retryAfterMs;
  } else {
    waitMs = ORDERS_FETCH_BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * 1000;
  }

  // On 429, never wait less than one token-refill period.
  if (is429) {
    waitMs = Math.max(waitMs, ORDERS_FETCH_MIN_429_WAIT_MS);
  }

  return Math.min(ORDERS_FETCH_MAX_BACKOFF_MS, waitMs);
}

/**
 * Derive an additional per-page delay from Amazon's own `x-amzn-RateLimit-Limit`
 * header (requests/second). Adds a 25% safety margin. Returns 0 if the header
 * is missing or malformed so the caller can fall back to a static delay.
 */
function derivePageDelayFromRateLimitHeader(response) {
  const rateHeader = response.headers.get("x-amzn-RateLimit-Limit");
  if (!rateHeader) return 0;
  const rate = parseFloat(rateHeader);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const baseDelay = 1000 / rate; // ms between requests at Amazon's stated rate
  return Math.ceil(baseDelay * 1.25);
}

/**
 * Single GET with retries on SP-API throttle (429) and transient unavailability (503).
 * `buildHeaders` is invoked on every attempt so SigV4 x-amz-date stays fresh after backoff waits.
 *
 * `credentialProvider` (optional) is a utils/spApiCredentials.js provider. When supplied,
 * credentials are re-read before every attempt (so a run longer than the ~60 min token life
 * keeps signing with something valid) and an auth failure transparently refreshes and retries
 * the SAME page — pagination is never restarted. See Services/Sp_API/Expences.js:171 for the
 * idiom this follows.
 *
 * When it is omitted (the default) this function behaves EXACTLY as it did before credential
 * refresh existed, including throwing `Orders API failed: <status>` on any non-ok response.
 * That equivalence is what keeps existing callers — and the accounts that already ingest
 * successfully — completely unaffected.
 *
 * Returns `{ data, recommendedNextDelayMs }` — the caller uses the recommended
 * delay to pace the next pagination call based on Amazon's live rate-limit header.
 */
async function fetchOrdersPageWithRetry(url, buildHeaders, credentialProvider = null) {
  let authRefreshes = 0;      // definitive token/STS expiry
  let ambiguousRefreshes = 0; // generic or bare 403 — capped tighter, see constant

  for (let attempt = 0; attempt < ORDERS_FETCH_MAX_ATTEMPTS; attempt++) {
    // With a provider, this also performs a PROACTIVE refresh once a credential is near
    // its expiry — which is what stops the 61-minute failure before it can happen.
    const creds = credentialProvider ? await credentialProvider.getValid() : null;
    const headers = buildHeaders(creds);
    const response = await fetch(url, { method: "GET", headers });
    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    const isRetryableThrottle = response.status === 429 || response.status === 503;
    if (isRetryableThrottle && attempt < ORDERS_FETCH_MAX_ATTEMPTS - 1) {
      const waitMs = computeOrdersBackoffMs(response, attempt);
      console.warn(
        `Orders API ${response.status} (rate limit / transient); retry ${attempt + 1}/${ORDERS_FETCH_MAX_ATTEMPTS} in ${Math.round(waitMs / 1000)}s`
      );
      await sleep(waitMs);
      continue;
    }

    // ★ Auth-failure handling. Entirely gated on a provider being present, so the
    //   no-provider path below is untouched.
    if (credentialProvider && !response.ok) {
      const classification = classifySpApiFailure({ status: response.status, body: data });
      const amazonMessage = data?.errors?.[0]?.message || data?.message || "";

      // A real grant/role denial can never be fixed by refreshing — stop immediately
      // rather than spending the rest of the run rediscovering that.
      if (classification === FAILURE.AUTH_DENIED) {
        throw new SpApiAuthDeniedError(
          `Orders API authorization denied: ${amazonMessage || response.status}`,
          { amazonMessage, status: response.status }
        );
      }

      const isAmbiguous = classification === FAILURE.AUTH_AMBIGUOUS;
      const refreshable =
        isAmbiguous ||
        classification === FAILURE.TOKEN_EXPIRED ||
        classification === FAILURE.CREDS_EXPIRED;

      if (refreshable) {
        const used = isAmbiguous ? ambiguousRefreshes : authRefreshes;
        const limit = isAmbiguous ? MAX_AMBIGUOUS_AUTH_REFRESHES : MAX_AUTH_REFRESHES_PER_PAGE;

        if (used < limit) {
          if (isAmbiguous) ambiguousRefreshes++;
          else authRefreshes++;
          console.warn(
            `Orders API ${response.status} (${classification}); refreshing credentials and ` +
            `retrying the same page (${used + 1}/${limit})`
          );
          await credentialProvider.refreshFor(classification);
          // Back off on an ambiguous 403 so a transient rejection under load gets a chance to
          // clear before we conclude the grant itself is revoked.
          if (isAmbiguous) await sleep(AMBIGUOUS_AUTH_RETRY_WAIT_MS);
          attempt--; // an auth retry must not consume a throttle attempt
          continue;
        }

        // Out of ambiguous retries: a fresh token still gets 403, so the grant is the
        // problem after all. Escalate to a denial so the caller can surface it.
        if (isAmbiguous) {
          throw new SpApiAuthDeniedError(
            `Orders API returned 403 after a credential refresh — authorization appears revoked` +
            (amazonMessage ? `: ${amazonMessage}` : ""),
            { amazonMessage, status: response.status }
          );
        }
      }
    }

    if (!response.ok) {
      console.error("Orders API Error:", JSON.stringify(data, null, 2));
      throw new Error(`Orders API failed: ${response.status}`);
    }

    const recommendedNextDelayMs = derivePageDelayFromRateLimitHeader(response);
    return { data, recommendedNextDelayMs };
  }

  throw new Error("Orders API failed: 429 — exhausted retries");
}

// ─── FETCH ORDERS (STREAMING) ──────────────────────────────────────────────────
/**
 * Paginate /orders/v0/orders over an explicit date range, handing each page to `onPage`
 * instead of accumulating it.
 *
 * This exists because buffering every page before writing anything means a failure late in a
 * long walk discards the entire run — the observed outcome for a high-volume account was 0
 * persisted orders after 61 minutes of work. Streaming lets the caller commit incrementally.
 *
 * `onPage` is awaited BEFORE the inter-page pacing delay, so the ~3s gap we already have to
 * respect Amazon's rate limit absorbs the caller's DB write at no extra wall-clock cost.
 *
 * @param {string} accessToken
 * @param {object} awsConfig  { marketplaceId, endpoint, awsAccessKeyId, ... }
 * @param {object} opts
 * @param {string}   opts.createdAfter   ISO timestamp (required)
 * @param {string}   opts.createdBefore  ISO timestamp (required)
 * @param {number}   [opts.maxPages]     stop after this many pages
 * @param {Function} [opts.onPage]       async (orders, {page, nextToken}) => void
 * @param {Function} [opts.shouldStop]   () => falsy | string reason — checked per page
 * @param {object}   [opts.credentialProvider]
 * @param {boolean}  [opts.quiet]        suppress the per-page console output
 * @returns {Promise<{pages:number, totalOrders:number, completed:boolean, stopReason:string|null}>}
 */
async function fetchOrdersStreaming(
  accessToken,
  { marketplaceId, endpoint, awsAccessKeyId, awsSecretAccessKey, awsRegion, awsSessionToken },
  {
    createdAfter,
    createdBefore,
    maxPages = Infinity,
    onPage = null,
    shouldStop = null,
    credentialProvider = null,
    quiet = false,
  } = {}
) {
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  if (!normalizedEndpoint) {
    throw new Error("endpoint is required");
  }
  if (!createdAfter || !createdBefore) {
    throw new Error("createdAfter and createdBefore are required");
  }

  let nextToken    = null;
  let page         = 1; // 1-based label used for logging
  let pagesFetched = 0; // actual completed requests — what we report back
  let totalOrders  = 0;
  let stopReason   = null;

  do {
    const params = new URLSearchParams({
      MarketplaceIds:    marketplaceId,
      CreatedAfter:      createdAfter,
      CreatedBefore:     createdBefore,
      OrderStatuses:     ORDER_CONFIG.orderStatuses.join(","),
      MaxResultsPerPage: "100",
    });

    if (nextToken) params.set("NextToken", nextToken);

    const url     = `${normalizedEndpoint}/orders/v0/orders?${params.toString()}`;
    // `creds` is non-null only when a credentialProvider was supplied; otherwise we sign
    // with the caller's original token/keys, exactly as before.
    const { data, recommendedNextDelayMs } = await fetchOrdersPageWithRetry(
      url,
      (creds) =>
        signRequest({
          method: "GET",
          url,
          accessToken: creds ? creds.accessToken : accessToken,
          awsConfig: creds
            ? creds.awsConfig
            : { awsAccessKeyId, awsSecretAccessKey, awsRegion, awsSessionToken },
          body: "",
        }),
      credentialProvider
    );

    const orders = data?.payload?.Orders || [];
    pagesFetched++;
    totalOrders += orders.length;
    nextToken    = data?.payload?.NextToken || null;

    if (onPage) await onPage(orders, { page, nextToken });

    if (!quiet) {
      console.log(`  Page ${page}: ${orders.length} orders (total: ${totalOrders})`);
    }

    if (page >= maxPages && nextToken) {
      stopReason = "maxPages";
      break;
    }

    const externalStop = shouldStop ? shouldStop() : null;
    if (externalStop && nextToken) {
      stopReason = typeof externalStop === "string" ? externalStop : "shouldStop";
      break;
    }

    page++;

    if (nextToken) {
      // Pace pagination: take the larger of (a) our static floor and (b) the
      // rate implied by Amazon's live x-amzn-RateLimit-Limit header. This lets
      // us use burst capacity when available and slow down when Amazon tells us to.
      const pageDelay = Math.max(
        ORDER_CONFIG.delayBetweenOrderPagesMs,
        recommendedNextDelayMs || 0
      );
      if (pageDelay > 0) {
        await sleep(pageDelay);
      }
    }

  } while (nextToken);

  return {
    pages: pagesFetched,
    totalOrders,
    completed: stopReason === null,
    stopReason,
  };
}

// ─── FETCH ALL ORDERS ──────────────────────────────────────────────────────────
/**
 * Paginate /orders/v0/orders across the default 15-day window and return every order.
 *
 * Thin buffering wrapper over fetchOrdersStreaming, kept so existing callers
 * (reviewIngestionService, reviewAggregationService) are completely unaffected: same
 * signature, same plain-array return, same default date window, same console output.
 *
 * `credentialProvider` (optional, utils/spApiCredentials.js) keeps the LWA token and STS
 * credentials fresh for the whole walk. Omit it and behaviour is exactly as before.
 */
async function fetchOrders(accessToken, awsConfig, credentialProvider = null) {
  // Validated here, before the log line, so an invalid endpoint fails exactly as it did
  // before this was refactored into a wrapper (previously this check preceded any output).
  if (!normalizeEndpoint(awsConfig && awsConfig.endpoint)) {
    throw new Error("endpoint is required");
  }

  const { createdAfter, createdBefore } = getDateRange();
  console.log(`\n📦 Fetching Shipped orders from ${createdAfter} to ${createdBefore}...\n`);

  const allOrders = [];
  await fetchOrdersStreaming(accessToken, awsConfig, {
    createdAfter,
    createdBefore,
    credentialProvider,
    onPage: (orders) => {
      // `concat` previously tolerated a non-array `payload.Orders` by appending it as a single
      // element; spreading would throw instead. Preserve the old leniency.
      if (Array.isArray(orders)) allOrders.push(...orders);
      else if (orders) allOrders.push(orders);
    },
  });

  return allOrders;
}

module.exports = {
  ORDER_CONFIG,
  sleep,
  normalizeEndpoint,
  getDateRange,
  enumerateSlices,
  isWithinReviewWindow,
  isEligibleForReview,
  hmac,
  hash,
  getSignatureKey,
  signRequest,
  fetchOrders,
  fetchOrdersStreaming,
  // Exported for unit tests (throttle backoff + auth-refresh behaviour).
  fetchOrdersPageWithRetry,
  computeOrdersBackoffMs,
};
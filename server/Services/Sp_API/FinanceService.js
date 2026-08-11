const mongoose = require('mongoose');
const https = require('https');
// `http` and `zlib` were only needed by the local downloadContent, now replaced by
// utils/spApiReportDownload.js.
const logger = require('../../utils/Logger.js');

const DailySkuFinance = require('../../models/finance/DailySkuFinanceModel.js');
const DailyOverheadFinance = require('../../models/finance/DailyOverheadFinanceModel.js');
const FinanceSyncLog = require('../../models/finance/FinanceSyncLogModel.js');
const PendingExpenseOrder = require('../../models/finance/PendingExpenseOrderModel.js');
const FinanceBackfillCursor = require('../../models/finance/FinanceBackfillCursorModel.js');
const { downloadReportContent, isUnusableReportPayload } = require('../../utils/spApiReportDownload.js');
const { checkSpApiStatusOnce } = require('./spApiReportAdapter.js');
const { financeStep2SlicingEnabledFor } = require('../../utils/asyncFinanceGate.js');
const { tagHop, HOP_NAMES } = require('../../utils/errorContext.js');
const {
  toMarketplaceDateStr,
  marketplaceDayWindowISO,
  marketplaceTodayStr,
  marketplaceYesterdayStr,
  getMarketplaceTimezone,
} = require('../../utils/marketplaceTimezone.js');

// ★ VERSION — check this in logs to confirm deployment
const FINANCE_SERVICE_VERSION = 'v3.1-sellerboard-match-20260506';
logger.info(`[FinanceService] Loaded ${FINANCE_SERVICE_VERSION}`);

const {
  fetchNewFinanceData,
  parseTransactionsV2024,
  extractRevenueFromTransactions,
  getAccessToken,
  resolveMarketplaceAndRegion,
} = require('./Expences.js');

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const CHUNK_INSERT_SIZE = 500;
const REPORT_TYPE = 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL';

function financeEnvInt(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    if (process.env[name] !== undefined) {
      logger.warn(`[Finance] ignoring invalid ${name}="${process.env[name]}", using ${fallback}`);
    }
    return fallback;
  }
  return parsed;
}

const POLL_INTERVAL_MS = 15000;
// Now env-overridable, mirroring ADS_REPORT_MAX_POLL_ATTEMPTS (AmazonAds/GetPPCMetrics.js:132).
// The default stays 40 (= 600s) deliberately: chunking keeps each report small, so raising it
// would change nothing for the accounts that already sync fine. The knob exists so an
// unusually slow marketplace can be accommodated without a code change.
const MAX_POLL_ATTEMPTS = financeEnvInt('FINANCE_REPORT_MAX_POLL_ATTEMPTS', 40);

// ── Report chunking ──────────────────────────────────────────────────────────
// Max days per Amazon report. A high-volume seller (~8k orders/day) cannot generate a 30-day
// GET_FLAT_FILE_ALL_ORDERS_DATA report inside the poll cap, so the previous single-report
// approach threw before downloading anything, recorded every date as failed, and left the
// cursor unmoved — requesting the identical 30 days on every subsequent run, forever.
//
// 3 days ≈ 24-45k rows for such an account, which both generates in time and keeps peak parse
// memory well under the worker's max_memory_restart (2G, with 3 instances x 25 concurrency).
// Set to 0 to restore the old single-report behaviour (rollback).
const FINANCE_REPORT_CHUNK_DAYS = financeEnvInt('FINANCE_REPORT_CHUNK_DAYS', 3);
// Wall-clock ceiling for one run's chunk loop. Checked between chunks, so a long backlog spreads
// over several runs instead of monopolising a worker slot.
const FINANCE_SYNC_RUN_BUDGET_MS = financeEnvInt('FINANCE_SYNC_RUN_BUDGET_MS', 40 * 60 * 1000);

// Forward reach of the Finance API window past a chunk's end date. Unset (null) means "use the
// region's own SETTLEMENT_LAG", which is the same lag already applied backward — see the long note
// at the window computation for why only Shipment fees need forward coverage at all.
const FINANCE_FORWARD_BUFFER_DAYS = process.env.FINANCE_FORWARD_BUFFER_DAYS !== undefined
  // Floored at 1: finEnd is UTC end-of-day while placement filters are Pacific, so a 0-day buffer
  // would silently drop rows posted after ~16:00 Pacific on the final day of the window.
  ? Math.max(1, financeEnvInt('FINANCE_FORWARD_BUFFER_DAYS', 5))
  : null;

// Heap ceiling checked BETWEEN chunks. Production workers run under PM2 `max_memory_restart: '2G'`,
// and a real OOM there is invisible: the process dies before any catch runs, so nothing is written
// — PM2 restarts and BullMQ retries, looking like nothing happened. Stopping deliberately below the
// limit instead keeps the completed chunks and reports `stopReason: 'memory'` in the run summary
// (which reaches apiData via ScheduledIntegration) and in the logs. Note it does NOT write a
// FinanceSyncLog failure row: the remaining dates were never attempted, so marking them failed
// would misreport them. Same treatment as a budget stop.
const FINANCE_HEAP_LIMIT_MB = financeEnvInt('FINANCE_HEAP_LIMIT_MB', 1200);

// Step 2 slicing. Days of the pending-fee search window covered per run when slicing is enabled.
// 7 keeps a run to roughly 5 minutes on the worst account we have measured (7,124 pending orders
// across 55 days, 1000+ pages, dominated by throttle backoffs) instead of hours.
const FINANCE_STEP2_SLICE_DAYS = Math.max(1, financeEnvInt('FINANCE_STEP2_SLICE_DAYS', 7));

// Per-DATE failure backoff. The freshness sweeper runs every 3h and treats any `failed` day as
// broken, so without a backoff a window that cannot succeed is retried ~8x/day forever — which is
// exactly what happened to one account for a full day. The first few attempts keep the normal
// cadence so a transient blip still self-heals fast; after that it goes quiet, and past the cap it
// is not scheduled again automatically (and IS reported, see diagnoseDailySchedule).
const FINANCE_DATE_RETRY_FREE_ATTEMPTS = Math.max(1, financeEnvInt('FINANCE_DATE_RETRY_FREE_ATTEMPTS', 3));
const FINANCE_MAX_DATE_RETRIES = Math.max(2, financeEnvInt('FINANCE_MAX_DATE_RETRIES', 10));


// ── Empty-report retry (FIX #1) ──────────────────────────────────────────────
// Amazon's GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE report intermittently
// finishes with processingStatus=DONE but an EMPTY document for a window that
// genuinely has orders (the order-date datastore is eventually-consistent and a
// report generated at an unlucky moment misses rows that exist). Re-generating
// the report usually returns the data. We retry a 0-row report a bounded number
// of times before accepting "no data". This is a fetch-layer safeguard only — it
// changes nothing about how rows are parsed or how sales/expenses are computed.
const EMPTY_REPORT_RETRIES = 2;
const EMPTY_REPORT_RETRY_DELAY_MS = 20000;

// ── Day bucketing is MARKETPLACE-LOCAL ───────────────────────────────────────
// There used to be a `const PACIFIC_OFFSET_HOURS = 7` here, applied to every account
// regardless of marketplace. It was wrong twice: non-Pacific marketplaces were skewed by
// the whole timezone gap (an AU seller's day was shifted 17 hours, under-reporting daily
// sales against Seller Central), and even US accounts were an hour out for the ~5 months
// a year Pacific is UTC-8 rather than UTC-7.
//
// Day keys now come from utils/marketplaceTimezone.js, which resolves each country to an
// IANA zone so DST is handled by the tz database. For US in summer this is a byte-for-byte
// no-op (pinned by a test), which is why it was safe to ship to all accounts at once.
//
// Do NOT reintroduce a numeric offset constant here — that is the bug, not the fix.

// ─────────────────────────────────────────────
// TOKEN MANAGER — auto-renew SP-API access tokens
//
// SP-API LWA access tokens expire after ~1 hour. The full daily sync
// chain (INIT → BATCH → ADS → FINANCE) routinely exceeds that, so a
// token minted at the start of the pipeline is often already dead by
// the time Finance runs (or the long Report poll crosses the boundary).
//
// This helper:
//   - Proactively refreshes when the in-memory token is near expiry
//   - Transparently refreshes + retries on "Unauthorized / token expired"
//     responses from SP-API
//
// All existing behaviour is preserved — callers that pass an explicit
// accessToken still get the same flow; the manager just guarantees it
// stays fresh and never bubbles an expired-token failure to the user.
// ─────────────────────────────────────────────
const ACCESS_TOKEN_TTL_MS = 55 * 60 * 1000; // refresh 5 min before 60-min Amazon TTL

function isAccessTokenExpiredError(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    msg.includes('access token you provided has expired') ||
    msg.includes('access token has expired') ||
    msg.includes('"code":"unauthorized"') ||
    msg.includes('invalidaccesstoken') ||
    (msg.includes('unauthorized') && msg.includes('access'))
  );
}

// A genuine SP-API AUTHORIZATION denial (FIX #2) — the seller's grant does not
// cover the requested resource (Reports API role not authorized, or the
// authorization was revoked). Unlike an expired access token, this is NOT
// fixable by refreshing the token; the account must RE-AUTHORIZE. We detect it
// so callers can stop hammering a doomed fetch (observed: 1600+ wasted retries
// across ~4 de-authorized accounts) and surface it for reconnection.
function isAuthorizationDeniedError(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    msg.includes('access to requested resource is denied') ||
    msg.includes('access_denied') ||
    msg.includes('forbidden')
  );
}

/**
 * Bucket a sync failure so `FinanceSyncLog.errorKind` can distinguish causes that need
 * completely different responses. Previously every failure was stored as an opaque message, so
 * an account whose grant had been revoked looked identical to one whose report was merely too
 * big — and only the second is fixable by us.
 *
 * @returns {'auth_denied'|'timeout'|'other'}
 */
function classifySyncFailure(err) {
  if (!err) return 'other';
  if (isAuthorizationDeniedError(err)) return 'auth_denied';
  const msg = (err.message || String(err)).toLowerCase();
  if (msg.includes('heap already at') || msg.includes('out of memory')) return 'memory';
  if (
    msg.includes('did not complete within') ||
    msg.includes('download exceeded') ||
    msg.includes('download stalled') ||
    msg.includes('no response within') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    // Our own per-request budget from httpsRequest. Matched on the full phrase rather than a bare
    // 'timed out' so a Mongoose "buffering timed out after 10000ms" — a DB connectivity failure,
    // not an Amazon one — keeps bucketing as 'other' instead of masquerading as a report timeout.
    msg.includes('request timed out after') ||
    // Socket-level drops. Amazon resets connections during long polls; without these a
    // 'socket hang up' was logged as the catch-all 'other', hiding a distinctly retryable cause.
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('econnaborted') ||
    msg.includes('eai_again') ||
    msg.includes('epipe')
  ) {
    return 'timeout';
  }
  return 'other';
}

function createTokenManager({ accessToken, refreshToken, clientId, clientSecret }) {
  let current = accessToken || null;
  // An inherited token has unknown age. Treat it as having ~5 min of life left
  // so the very next staleness check will refresh if the call takes a while,
  // but we still try the inherited token first (avoids an unnecessary refresh).
  let issuedAt = accessToken ? Date.now() - ACCESS_TOKEN_TTL_MS + (5 * 60 * 1000) : 0;

  async function refresh() {
    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error('[FinanceService] Cannot refresh SP-API access token — missing refreshToken/clientId/clientSecret.');
    }
    logger.info('[FinanceService] Refreshing SP-API access token…');
    current = await getAccessToken(clientId, clientSecret, refreshToken);
    issuedAt = Date.now();
    return current;
  }

  async function getValidToken() {
    if (!current || (Date.now() - issuedAt) >= ACCESS_TOKEN_TTL_MS) {
      await refresh();
    }
    return current;
  }

  async function withRetry(fn) {
    const token = await getValidToken();
    try {
      return await fn(token);
    } catch (err) {
      // Amazon returns an EXPIRED access-token error with the SAME generic
      // "access to requested resource is denied" message as a true authorization
      // denial — distinguished only by the "...access token...has expired" detail.
      // Check that specific expiry phrase FIRST so a recoverable expiry is not
      // misclassified as a permanent denial and skipped over the refresh below.
      const lowerMsg = (err && (err.message || String(err)) || '').toLowerCase();
      const tokenDefinitelyExpired =
        lowerMsg.includes('access token you provided has expired') ||
        lowerMsg.includes('access token has expired');
      if (!tokenDefinitelyExpired) {
        // A genuine authorization denial is not fixable by refreshing — don't
        // waste a token refresh + retry on it (it always fails the same way).
        if (isAuthorizationDeniedError(err)) throw err;
        if (!isAccessTokenExpiredError(err)) throw err;
      }
      logger.warn(`[FinanceService] SP-API call failed with expired token. Refreshing and retrying once… (${err.message})`);
      const fresh = await refresh();
      return fn(fresh);
    }
  }

  return {
    get token() { return current; },
    getValidToken,
    refresh,
    withRetry,
    // The long-lived credentials behind this manager. The Finance API leg needs them to build its
    // own paginated requests, and reading them here rather than threading three more parameters
    // through every caller keeps one source of truth — and stops an extracted helper from silently
    // closing over a `refreshToken` that is no longer in its scope.
    credentials: { refreshToken, clientId, clientSecret },
  };
}

// Settlement lag buffer by region.
const SETTLEMENT_LAG = {
  NA: { beforeDays: 5 },
  EU: { beforeDays: 10 },
  FE: { beforeDays: 5 },
};

// Max age for pending orders — stop trying after this many days
const MAX_PENDING_AGE_DAYS = 45;

// After this many days a day is treated as settled even if it still shows
// Pending-status orders, so a permanently-stuck Pending order can never freeze
// the incremental cursor. Orders almost always leave Pending within 2-3 days;
// 14 is a generous safety ceiling.
const PROVISIONAL_SETTLE_DAYS = 14;

// Country → Sales Channel mapping for filtering the Sales Report.
// The NA region report includes ALL NA marketplaces (US, CA, MX, BR) in one file,
// each in their local currency. We must filter to the correct marketplace
// to avoid mixing MXN/CAD/BRL amounts into USD totals.
const COUNTRY_TO_SALES_CHANNEL = {
  US: 'Amazon.com',
  CA: 'Amazon.ca',
  MX: 'Amazon.com.mx',
  BR: 'Amazon.com.br',
  UK: 'Amazon.co.uk',
  GB: 'Amazon.co.uk',
  DE: 'Amazon.de',
  FR: 'Amazon.fr',
  IT: 'Amazon.it',
  ES: 'Amazon.es',
  NL: 'Amazon.nl',
  SE: 'Amazon.se',
  PL: 'Amazon.pl',
  BE: 'Amazon.com.be',
  IN: 'Amazon.in',
  TR: 'Amazon.com.tr',
  AE: 'Amazon.ae',
  SA: 'Amazon.sa',
  EG: 'Amazon.eg',
  JP: 'Amazon.co.jp',
  AU: 'Amazon.com.au',
  SG: 'Amazon.sg',
  // IE and ZA were missing here while being fully supported at connect time
  // (see marketplaceConfig in controllers/config/config.js). Because the filter below is
  // `if (salesChannel && ...)`, a missing entry made `salesChannel` undefined and skipped
  // channel filtering ENTIRELY for those markets rather than erroring.
  IE: 'Amazon.ie',
  ZA: 'Amazon.co.za',
};

// ─────────────────────────────────────────────
// DATE ASSIGNMENT PATTERN (Sellerboard-matched)
//
// After extensive analysis comparing raw Finance API data, Settlement
// Reports, Sales Reports, and Sellerboard's actual per-day numbers:
//
//   FORWARD SHIPMENT fees (FBA fulfillment, Referral, Promotions):
//     → Grouped by PURCHASE DATE (Pacific Time) from Sales Report
//     → This is the customer's order date, NOT the Finance API postedDate
//
//   REFUND transactions:
//     → Grouped by POSTED DATE (Pacific Time) from Finance API
//     → The date Amazon processed the refund
//
//   REIMBURSEMENTS (FBAInventoryReimbursement):
//     → Grouped by POSTED DATE (Pacific Time) from Finance API
//
//   SERVICE FEES (FBA Disposal, Storage):
//     → Grouped by POSTED DATE (Pacific Time) from Finance API
//
//   OVERHEAD (Advertising, Disbursement, Storage, etc.):
//     → Grouped by POSTED DATE (Pacific Time) from Finance API
//
// Transaction types that use PURCHASE DATE (joined via orderId):
const PURCHASE_DATE_TXN_TYPES = new Set(['Shipment']);
//
// All other types use their own postedDate (Pacific).
// ─────────────────────────────────────────────

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatDateUTC(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Shift a 'YYYY-MM-DD' string by whole days, staying in UTC.
function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateUTC(d);
}

function daysBetweenInclusive(startStr, endStr) {
  const ms = new Date(`${endStr}T00:00:00.000Z`) - new Date(`${startStr}T00:00:00.000Z`);
  return Math.round(ms / 86400000) + 1;
}

/**
 * Decide which date window this sync should fetch — extracted as a PURE function.
 *
 * Why extracted: this is the logic that produced a permanent deadlock for high-volume
 * accounts (the no-history branch requested 30 days unclamped, which never finished inside the
 * report poll cap, so no success row was ever written and the cursor never advanced). It is also
 * unreachable from every existing script — all `forceDates` callers bypass it — so the only
 * practical way to verify it is a unit test. Behaviour is intentionally identical to the inline
 * version it replaces.
 *
 * @param {object} args
 * @param {string} args.yesterdayStr        'YYYY-MM-DD' in Pacific terms — the window's ceiling
 * @param {string|null} args.latestSyncDate cursor: latest settled success day, or null
 * @param {number} args.backfillDays        window size when there is no history at all
 * @param {number|null} args.maxIncrementalDays soft cap on an incremental catch-up window
 * @param {number} args.resyncDays          re-fetch recent days to catch cancellations
 * @param {Array|null} args.forceDates      [start, end] — bypasses the cursor entirely
 * @returns {{mode: string, startDate: string|null, endDate: string|null, note: string}}
 *   mode: 'forced' | 'backfill' | 'resync' | 'incremental' | 'up_to_date'
 */
function resolveSyncWindow({
  yesterdayStr,
  latestSyncDate = null,
  backfillDays = 30,
  maxIncrementalDays = null,
  resyncDays = 0,
  forceDates = null,
}) {
  if (forceDates && forceDates.length === 2) {
    return {
      mode: 'forced',
      startDate: forceDates[0],
      endDate: forceDates[1],
      note: `Force: ${forceDates[0]} → ${forceDates[1]}`,
    };
  }

  if (!latestSyncDate) {
    const startDate = addDaysStr(yesterdayStr, -(backfillDays - 1));
    return {
      mode: 'backfill',
      startDate,
      endDate: yesterdayStr,
      note: `Backfill ${backfillDays} days: ${startDate} → ${yesterdayStr}`,
    };
  }

  if (latestSyncDate >= yesterdayStr) {
    if (resyncDays > 0) {
      const startDate = addDaysStr(yesterdayStr, -(resyncDays - 1));
      return {
        mode: 'resync',
        startDate,
        endDate: yesterdayStr,
        note: `Up to date but re-syncing last ${resyncDays} days to capture order cancellations: ${startDate} → ${yesterdayStr}`,
      };
    }
    return {
      mode: 'up_to_date',
      startDate: null,
      endDate: null,
      note: `Up to date (latest: ${latestSyncDate}). Running backfill only.`,
    };
  }

  let startDate = addDaysStr(latestSyncDate, 1);
  const endDate = yesterdayStr;
  let note = '';

  // Extend backward by resyncDays to re-fetch recent days where orders may have been
  // cancelled after the original sync captured them.
  if (resyncDays > 0) {
    const resyncStartStr = addDaysStr(endDate, -(resyncDays - 1));
    if (resyncStartStr < startDate) {
      note += `Extending start from ${startDate} to ${resyncStartStr} for ${resyncDays}-day cancellation correction window. `;
      startDate = resyncStartStr;
    }
  }

  // Soft cap so a long-broken account can't drag a 60-day fetch into the daily window.
  //
  // Clamp the END forward from the OLDEST unfilled day, NOT the start backward from the
  // newest. Clamping the start would fetch only the most recent `max` days and skip the older
  // ones — and since the cursor is the MAX success date, it would jump past the skipped days
  // and they would never be fetched again (permanent $0). Clamping the end means each run
  // consumes the oldest unfilled days first and the cursor advances by exactly what was
  // filled, so the gap drains over consecutive runs with zero skipped days.
  let clampedEnd = endDate;
  if (maxIncrementalDays && maxIncrementalDays > 0) {
    const gapDays = daysBetweenInclusive(startDate, endDate);
    if (gapDays > maxIncrementalDays) {
      clampedEnd = addDaysStr(startDate, maxIncrementalDays - 1);
      note += `Incremental gap ${gapDays}d exceeds maxIncrementalDays=${maxIncrementalDays}; clamping end ${endDate} → ${clampedEnd} (oldest-first). Remaining ${gapDays - maxIncrementalDays}d will sync on subsequent runs. `;
    }
  }

  return {
    mode: 'incremental',
    startDate,
    endDate: clampedEnd,
    note: `${note}Incremental: ${startDate} → ${clampedEnd}`,
  };
}

/**
 * Drive `fetchChunk` over a list of chunks, oldest first, within a wall-clock budget.
 *
 * Extracted from syncFinanceData so the loop's semantics — ordering, aggregation, budget
 * handling, and which chunk failed — are testable without standing up the whole SP-API stack.
 *
 * On failure the chunk that failed is attached to the error as `err.failedChunk`, so the caller
 * can scope its bookkeeping to exactly those dates instead of the whole window.
 *
 * `classifySkip` (optional) is what stops ONE dead chunk starving every chunk behind it. Without it
 * this loop aborts the whole run at the first failure, and because the cursor is
 * `MAX(FinanceSyncLog.date where status:'success')`, the next run's window starts at that same
 * failing date — so the bad chunk is chunk 1 again and chunks 2..N are never reached, indefinitely.
 * That is the inline twin of the async-path bug fixed in PR #8.
 *
 * It is consulted REACTIVELY — only after an attempt has already failed, never before one. Skipping
 * pre-emptively would save the wasted attempt but the window could then never self-heal: it would be
 * stepped over on every future run too, including the sweeper's forced deep re-sync, so only a manual
 * counter reset could ever revive it.
 *
 * @param {object} args
 * @param {Array<{startDate:string,endDate:string}>} args.chunks
 * @param {number} args.budgetMs
 * @param {Function} args.fetchChunk async (chunk, index) => {salesOrders, skuDocs, overheadDocs, pendingOrders}
 * @param {number} [args.heapLimitBytes]
 * @param {Function} [args.classifySkip] async (chunk, index, err) => 'capped'|'already_success'|null.
 *        Called only after `fetchChunk` threw. A truthy reason steps over the chunk and continues;
 *        anything else (including a throw, or the parameter being omitted) stops the walk — the
 *        default, and the safe direction.
 * @returns {Promise<{chunksCompleted:number, stopReason:string|null, aggregate:object, skippedChunks:Array}>}
 */
async function runChunkedFetch({ chunks, budgetMs, fetchChunk, heapLimitBytes = 0, classifySkip = null }) {
  const deadlineAt = Date.now() + budgetMs;
  const aggregate = { salesOrders: 0, skuDocs: 0, overheadDocs: 0, pendingOrders: 0 };
  const skippedChunks = [];
  let chunksCompleted = 0;
  let stopReason = null;

  for (let i = 0; i < chunks.length; i++) {
    // Guards below count ATTEMPTS (completed + skipped), not completions.
    //
    // That distinction is load-bearing once `classifySkip` is in play. A skip does not increment
    // `chunksCompleted`, and a skip only happens AFTER a failed attempt that may have burned
    // 10-25 minutes — so guarding on completions would let a run grind through one doomed chunk
    // after another and never trip its 40-minute budget, because the counter would sit at 0 the
    // whole time. Counting attempts keeps the original intent intact (attempts is 0 on the first
    // iteration, so the first chunk is never blocked) while making the budget effective again.
    const chunksAttempted = chunksCompleted + skippedChunks.length;

    // Checked BETWEEN chunks only, and never before the first one. Interrupting mid-chunk would
    // leave its dates half-written; refusing to run any chunk would stall the backlog forever.
    if (chunksAttempted > 0 && Date.now() >= deadlineAt) {
      stopReason = 'budget';
      break;
    }

    // Bail out ahead of a hard OOM. A real heap exhaustion kills the process before any catch runs,
    // so nothing is recorded and the job simply appears to vanish (PM2 restarts, BullMQ retries).
    // Stopping here keeps the completed chunks, records why, and lets the next run resume.
    //
    // Same placement rule as the budget check above — BETWEEN chunks, never before the first. A run
    // must always attempt at least one chunk, otherwise an account on a already-warm worker could
    // make zero progress indefinitely, which is the failure mode this whole effort exists to remove.
    if (heapLimitBytes > 0 && chunksAttempted > 0 && process.memoryUsage().heapUsed >= heapLimitBytes) {
      stopReason = 'memory';
      break;
    }

    try {
      const res = await fetchChunk(chunks[i], i);
      aggregate.salesOrders += (res && res.salesOrders) || 0;
      aggregate.skuDocs += (res && res.skuDocs) || 0;
      aggregate.overheadDocs += (res && res.overheadDocs) || 0;
      aggregate.pendingOrders += (res && res.pendingOrders) || 0;
      chunksCompleted++;
    } catch (err) {
      // STOPPING IS THE DEFAULT, and it is deliberate: the cursor is the MAX success date, so
      // continuing past a chunk we still intend to retry would advance it beyond days that were
      // never fetched, stranding them at $0 forever.
      //
      // The one exception is a chunk that is already ABANDONED — every date past its retry cap, or
      // every date already holding good data. Those cannot be made worse by moving on, and refusing
      // to move on is what starved every chunk behind them.
      let skipReason = null;
      if (classifySkip) {
        try {
          skipReason = await classifySkip(chunks[i], i, err);
        } catch (classifyErr) {
          // Fail CLOSED. An unreadable retry state must never license a skip — that would turn a
          // transient Mongo blip into a permanent $0 gap.
          logger.warn(`[Sync] chunk-skip check failed for ${chunks[i].startDate}→${chunks[i].endDate} (${classifyErr.message}); stopping the walk, which is the safe default.`);
          skipReason = null;
        }
      }

      if (skipReason) {
        // NOTE: no `recordSyncFailure` here, unlike the async path which records before classifying.
        // Deliberate, and not an oversight to "correct": a chunk is only skippable once its dates are
        // already at the cap, so bumping the counter further changes no decision and would grow it
        // without bound. The caller's catch still records on the throw path below, so a failure is
        // recorded exactly once either way.
        skippedChunks.push({
          chunk: chunks[i],
          reason: skipReason,
          error: String(err.message || err).slice(0, 200),
        });
        continue;
      }

      err.failedChunk = chunks[i];
      err.chunksCompletedBeforeFailure = chunksCompleted;
      // Carried so the caller can report that earlier chunks were stepped over on the way here —
      // otherwise a later failure would make the run look like a plain stop at chunk N.
      if (skippedChunks.length) err.skippedChunks = skippedChunks;
      throw err;
    }
  }

  return { chunksCompleted, stopReason, aggregate, skippedChunks };
}

/**
 * Record a sync failure as one FinanceSyncLog row per date in [from, to].
 *
 * Extracted for testability and to keep the scoping decision explicit: `from`/`to` are the
 * FAILING CHUNK's bounds, not the whole requested window, so days that were never attempted are
 * not misreported as failures.
 *
 * The `status: { $ne: 'success' }` filter is load-bearing — it prevents a late failure from
 * overwriting rows an earlier chunk (or an earlier run) legitimately succeeded at.
 */
async function recordSyncFailure({ FinanceSyncLogModel, userObjectId, country, region, from, to, err, errorKind }) {
  const dateList = [];
  const d = new Date(`${from}T00:00:00.000Z`);
  const endD = new Date(`${to}T00:00:00.000Z`);
  while (d <= endD) { dateList.push(formatDateUTC(d)); d.setUTCDate(d.getUTCDate() + 1); }

  for (const dateStr of dateList) {
    // Per-date try/catch: recording a failure must never itself throw. This function used to be a
    // single findOneAndUpdate with `status: { $ne: 'success' }` in the filter AND `upsert: true`.
    // The unique index is (User, country, region, date) — `status` is NOT part of it — so whenever a
    // 'success' row already existed the filter missed, Mongo fell through to an INSERT, and the
    // index rejected it with E11000. The failure was therefore NEVER RECORDED, which is why one
    // account looped on the same chunk ~8x/day for a full day with nothing downstream able to tell.
    //
    // The `$ne: 'success'` intent is right and is preserved below — never downgrade a good day to
    // failed. It just cannot be expressed as an upsert filter.
    try {
      const key = { User: userObjectId, country: country.toUpperCase(), region, date: dateStr };

      // 1. Update an existing NON-success row. No upsert, so a missing row simply matches nothing.
      const res = await FinanceSyncLogModel.updateOne(
        { ...key, status: { $ne: 'success' } },
        {
          $set: {
            fetchedAt: new Date(),
            status: 'failed',
            error: err.message.substring(0, 500),
            errorKind,
            nextRetryAfter: null, // recomputed below once we know the attempt count
          },
          $inc: { consecutiveFailures: 1 },
        }
      );

      if ((res.matchedCount || res.n || 0) === 0) {
        // Nothing matched: either no row at all, or a 'success' row we must leave alone.
        const existing = await FinanceSyncLogModel.exists(key);
        if (!existing) {
          try {
            await FinanceSyncLogModel.create({
              ...key,
              marketplaceId: '',
              fetchedAt: new Date(),
              status: 'failed',
              error: err.message.substring(0, 500),
              errorKind,
              consecutiveFailures: 1,
            });
          } catch (insertErr) {
            // A concurrent run inserted first. Its row is as good as ours — this is the only
            // legitimate E11000 here, and swallowing it is correct rather than merely convenient.
            if (insertErr && insertErr.code !== 11000) throw insertErr;
          }
        }
        // else: a 'success' row exists. Deliberately untouched.
      }

      // Back off before the next attempt, so a window that cannot succeed stops being retried on
      // every 3-hourly sweep. Read the row back for the authoritative counter (it may have been
      // incremented by a concurrent run).
      const after = await FinanceSyncLogModel
        .findOne(key, { consecutiveFailures: 1, status: 1 })
        .lean();
      if (after && after.status !== 'success') {
        const attempts = after.consecutiveFailures || 1;
        await FinanceSyncLogModel.updateOne(key, {
          $set: { nextRetryAfter: computeNextRetryAfter(attempts) },
        });
      }
    } catch (recordErr) {
      // One bad date must not abort the rest of the chunk's dates.
      logger.warn(`[Sync] could not record failure for ${dateStr}: ${recordErr.message}`);
    }
  }
  return dateList;
}

/**
 * Escalating backoff for a repeatedly-failing date.
 *
 * The freshness sweeper runs every 3h and treats any `failed` day as broken, so without this a
 * window that cannot succeed is retried ~8x/day forever — which is exactly what happened. Early
 * attempts stay on the normal cadence so a genuinely transient problem still self-heals fast; later
 * ones go quiet.
 *
 * Past FINANCE_MAX_DATE_RETRIES the date is not scheduled again at all. That is a real trade — the
 * day keeps its estimated fees — so it MUST be surfaced loudly (diagnoseDailySchedule reports it)
 * rather than silently abandoned.
 *
 * NOTE on the return value: `null` means "no backoff pending" — NOT "never retry". Being capped is
 * signalled by `consecutiveFailures >= FINANCE_MAX_DATE_RETRIES`, which the sweeper checks
 * separately. Conflating the two into one field would make "give up forever" and "retry on the
 * normal cadence" indistinguishable, i.e. a capped date would be retried immediately — the exact
 * opposite of the intent.
 *
 * @param {number} attempts consecutive failures INCLUDING the one just recorded
 * @returns {Date|null} when the date may next be attempted, or null for no backoff
 */
function computeNextRetryAfter(attempts) {
  // Capped: the counter alone excludes it, so no date is needed.
  if (attempts >= FINANCE_MAX_DATE_RETRIES) return null;
  // First few failures keep the normal 3-hourly sweep cadence so a transient blip self-heals fast.
  if (attempts <= FINANCE_DATE_RETRY_FREE_ATTEMPTS) return null;
  const hours = attempts <= FINANCE_DATE_RETRY_FREE_ATTEMPTS + 2 ? 12 : 24;
  return new Date(Date.now() + hours * 3600 * 1000);
}

/**
 * Bucket ONE FinanceSyncLog row's retry state. Single source of truth for the cap/backoff reading,
 * shared by the sweeper, the chunk walk and diagnoseDailySchedule.
 *
 * It exists because the cap constant was already duplicated between here and freshnessSweeper.js,
 * and a third copy in the diagnostics script is precisely how the three drift out of agreement and
 * start disagreeing about whether a date is dead.
 *
 * The `capped` check MUST come first and MUST read the counter, not `nextRetryAfter` — a capped row
 * has `nextRetryAfter: null` by design (see the note on computeNextRetryAfter), so testing the date
 * first would read "no backoff pending" and classify a permanently-dead date as due right now.
 *
 * @param {{status?:string, consecutiveFailures?:number, nextRetryAfter?:Date|string|null}} log
 * @returns {'capped'|'backed_off'|'due'}
 */
function classifyFinanceRetryState(log, { now = Date.now(), maxRetries = FINANCE_MAX_DATE_RETRIES } = {}) {
  if (!log) return 'due';
  if ((log.consecutiveFailures || 0) >= maxRetries) return 'capped';
  if (log.nextRetryAfter && new Date(log.nextRetryAfter).getTime() > now) return 'backed_off';
  return 'due';
}

/**
 * Decide whether a FAILED chunk may be SKIPPED so the walk can reach later chunks, or whether the
 * walk must STOP at it.
 *
 * WHY THIS EXISTS
 * `_runAsyncFinancePhase` stopped at the first failed chunk unconditionally. Cursor safety is the
 * real reason — the cursor is `max(FinanceSyncLog.date …)`, so jumping a gap strands those days at
 * $0 forever — but that reason only applies to a window we still intend to retry. In production one
 * permanently-failing 3-day chunk blocked every later chunk in the same job, every run, for days:
 * the 30-day deep re-sync never got past chunk 6 of 10, so 2026-07-23→08-03 were never attempted.
 *
 * @returns {Promise<'capped'|'already_success'|null>} null means the caller MUST stop, not skip.
 */
async function classifyChunkSkip({ FinanceSyncLogModel = FinanceSyncLog, userObjectId, country, region, from, to }) {
  try {
    const dates = enumerateDatesInclusive(from, to);
    if (!dates.length) return null;

    const rows = await FinanceSyncLogModel.find(
      { User: userObjectId, country: String(country).toUpperCase(), region, date: { $in: dates } },
      { date: 1, status: 1, consecutiveFailures: 1 }
    ).lean();

    // A date with NO row has never been attempted. Skipping it would advance the cursor over a day
    // we have never even asked Amazon about — the one case cursor safety genuinely protects.
    if (rows.length < dates.length) return null;

    const nonSuccess = rows.filter((r) => r.status !== 'success');

    // Every day already good. This arm is essential, not defensive: recordSyncFailure never
    // downgrades a success row, so a deep-re-sync chunk whose days are all already synced produces
    // ZERO capped dates and would otherwise stall that walk every single day, forever.
    if (nonSuccess.length === 0) return 'already_success';

    // Capped means already abandoned: the sweeper excludes these dates and computeNextRetryAfter
    // returns null for them. Advancing past them adds no new data loss — it only stops them
    // blocking days that can still be fixed.
    const allCapped = nonSuccess.every(
      (r) => classifyFinanceRetryState(r) === 'capped'
    );
    return allCapped ? 'capped' : null;
  } catch (err) {
    // Fail CLOSED. An unreadable retry state must never license skipping a window — that is how a
    // transient Mongo blip would turn into a permanent $0 gap.
    logger.warn(`[Sync] classifyChunkSkip failed for ${from}→${to}: ${err.message}. Treating as "do not skip".`);
    return null;
  }
}

/**
 * Split a window into contiguous sub-ranges of at most `chunkDays`, OLDEST FIRST.
 *
 * Each sub-range becomes its own Amazon report. That is the fix for the deadlock: a 30-day
 * report for a seller doing ~8k orders/day never finishes inside the poll cap, whereas 3-day
 * reports do, and each completed chunk writes success rows so the cursor advances and the next
 * run resumes rather than restarting.
 *
 * Oldest-first is required, not cosmetic: an aged-out day that comes back empty is recorded as a
 * *settled* cursor point, so a mid-loop failure must leave the cursor behind, never ahead.
 *
 * `chunkDays <= 0` returns a single chunk — the rollback path (FINANCE_REPORT_CHUNK_DAYS=0).
 */
function enumerateDateChunks(startDate, endDate, chunkDays) {
  if (!startDate || !endDate || startDate > endDate) return [];
  if (!chunkDays || chunkDays <= 0) return [{ startDate, endDate }];

  const chunks = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const tentativeEnd = addDaysStr(cursor, chunkDays - 1);
    const chunkEnd = tentativeEnd > endDate ? endDate : tentativeEnd;
    chunks.push({ startDate: cursor, endDate: chunkEnd });
    cursor = addDaysStr(chunkEnd, 1);
  }
  return chunks;
}

/**
 * A UTC instant → the day key stored on DailySkuFinance / DailyOverheadFinance,
 * in the MARKETPLACE's local calendar (see the note beside EMPTY_REPORT_RETRIES).
 *
 * `country` is required in practice: omitting it falls back to Pacific and logs a warning,
 * which reproduces the old (wrong-for-most-marketplaces) behaviour rather than throwing
 * inside the money path.
 */
function toMarketplaceDayKey(dateInput, country) {
  return toMarketplaceDateStr(dateInput, country);
}

function internalRegionFromModel(regionModel) {
  if (regionModel === 'NA') return 'na';
  if (regionModel === 'EU') return 'eu';
  if (regionModel === 'FE') return 'apac';
  return null;
}

// ─────────────────────────────────────────────
// HTTP HELPERS
// ─────────────────────────────────────────────
// Transient socket-level failures that are worth retrying verbatim. Amazon resets connections
// during long report-polling loops, and a bare `https.request` surfaces that as
// `Error: socket hang up` (code ECONNRESET). Previously any such error rejected immediately and
// `withRetry` below only rescues token expiry, so ONE reset aborted an entire multi-minute sync.
// Mirrors the ECONNRESET/ETIMEDOUT convention already used across Services/AmazonAds/*.
const TRANSIENT_NET_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED', 'EAI_AGAIN']);

function isTransientNetworkError(err) {
  if (!err) return false;
  if (err.code && TRANSIENT_NET_CODES.has(err.code)) return true;
  // Defensive: 'socket hang up' normally carries code ECONNRESET, but the code can be lost when
  // the error is wrapped or re-thrown.
  const msg = (err.message || String(err)).toLowerCase();
  return msg.includes('socket hang up') || msg.includes('request timed out after');
}

// Per-request budget for the small JSON control-plane calls below (createReport / poll /
// getReportDocument). Deliberately separate from the large-payload budgets in
// utils/spApiReportDownload.js — these responses are a few KB, so a stall means a dead socket.
const REQUEST_TIMEOUT_MS = financeEnvInt('FINANCE_REQUEST_TIMEOUT_MS', 30000);
const REQUEST_MAX_RETRIES = financeEnvInt('FINANCE_REQUEST_MAX_RETRIES', 3);
const REQUEST_RETRY_BASE_MS = financeEnvInt('FINANCE_REQUEST_RETRY_BASE_MS', 2000);

function httpsRequestOnce(options, postData = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', (err) => finish(reject, err));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { finish(resolve, { statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
        catch { finish(resolve, { statusCode: res.statusCode, headers: res.headers, body }); }
      });
    });

    // Guards connect/TLS/headers AND mid-body stalls. Must destroy the socket ourselves, or a
    // half-open connection leaks and keeps the BullMQ job lock held.
    // Feature-detected: setTimeout/destroy are standard on http.ClientRequest, but stubbed
    // request objects (tests, some custom agents) may not implement them, and a missing timeout
    // must degrade to the old no-timeout behaviour rather than throwing.
    if (REQUEST_TIMEOUT_MS > 0 && typeof req.setTimeout === 'function') {
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        const err = new Error(`[FinanceService] request timed out after ${REQUEST_TIMEOUT_MS}ms`);
        err.code = 'ETIMEDOUT';
        if (typeof req.destroy === 'function') req.destroy(err);
        else finish(reject, err);
      });
    }

    req.on('error', (err) => finish(reject, err));
    if (postData) req.write(postData);
    req.end();
  });
}

// Only replay requests that are safe to replay. A socket reset is ambiguous — the request may
// have reached Amazon and only the RESPONSE was lost — so retrying a non-idempotent verb can
// duplicate a server-side side effect.
//
// This matters concretely for `createReport` (POST): SP-API does not dedupe report requests, so a
// blind retry can create a SECOND report for the same window, orphaning it and consuming a quota
// that refills at roughly one request per minute. Since our backoff (2s/4s/8s) is far inside that
// refill window, such a retry would almost certainly come back 429 anyway — harmful and useless.
// GET polls and document lookups have no side effect and are exactly where the observed
// 'socket hang up' occurs, so those are retried.
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `httpsRequestOnce` plus bounded retry on transient socket errors.
 *
 * Scope is deliberately narrow: only socket-level failures on idempotent verbs are retried here.
 * HTTP status handling stays with the callers, token expiry stays with `withRetry`, and 429/503
 * throttling stays with the existing SP-API retry helpers — retrying those here would double up
 * on backoff.
 *
 * There is intentionally NO per-call override to force a retry. Such a flag would let a caller
 * re-introduce the exact duplicate-report hazard this verb check exists to prevent, and nothing
 * needs it — the policy follows from the HTTP method alone.
 *
 * @param {Object} options - https.request options
 * @param {string|null} [postData]
 */
async function httpsRequest(options, postData = null) {
  const method = (options.method || 'GET').toUpperCase();
  const retryTransient = IDEMPOTENT_METHODS.has(method);

  let lastError;
  for (let attempt = 0; attempt <= REQUEST_MAX_RETRIES; attempt++) {
    try {
      return await httpsRequestOnce(options, postData);
    } catch (err) {
      lastError = err;
      const transient = isTransientNetworkError(err);
      const canRetry = retryTransient && transient && attempt < REQUEST_MAX_RETRIES;
      if (!canRetry) {
        if (transient && !retryTransient) {
          logger.warn(
            `[FinanceService] transient network error on non-idempotent ${method} ${options.path || ''} ` +
            `(${err.code || 'no-code'}: ${err.message}). NOT retried — replaying it could duplicate ` +
            `the server-side effect. The caller will surface this and the next scheduled run retries.`
          );
        } else if (transient) {
          // Budget exhausted. Previously silent, which left "retried and gave up" and "never
          // retried at all" indistinguishable in the logs — the ambiguity that made a production
          // `socket hang up` take three rounds to attribute.
          logger.warn(
            `[FinanceService] GAVE UP on ${method} ${options.path || ''} after ` +
            `${REQUEST_MAX_RETRIES + 1} attempt(s) (${err.code || 'no-code'}: ${err.message}).`
          );
        }
        throw err;
      }
      // Jitter, so clustered workers hitting one Amazon blip do not retry in lockstep.
      const nominal = REQUEST_RETRY_BASE_MS * Math.pow(2, attempt);
      const waitMs = Math.round(nominal * (0.75 + Math.random() * 0.5));
      logger.warn(
        `[FinanceService] transient network error on ${method} ${options.path || ''} ` +
        `(${err.code || 'no-code'}: ${err.message}). Retry ${attempt + 1}/${REQUEST_MAX_RETRIES} in ${waitMs}ms.`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

// NOTE: the local `downloadContent` was replaced by utils/spApiReportDownload.js. The old copy
// had no timeout (a stalled S3 socket could hold the 2h BullMQ job lock) and no completeness
// check (a short body resolved as if complete, which the persist layer would then record as a
// settled $0 for real revenue days). It also returned only text, so callers could not tell
// "Amazon sent an empty report" from "we downloaded 40MB and parsed nothing".

// ═══════════════════════════════════════════════
// SALES REPORT API
//
// All three calls below go through `tokenManager.withRetry` so an
// expired access token is refreshed transparently. `pollReportStatus`
// loops for up to 10 minutes and can easily cross the 60-min token
// boundary if the pipeline has been running a while — each poll
// validates/refreshes independently.
// ═══════════════════════════════════════════════
async function createReport(tokenManager, baseUrl, marketplaceId, startDate, endDate) {
  const postData = JSON.stringify({ reportType: REPORT_TYPE, marketplaceIds: [marketplaceId], dataStartTime: startDate, dataEndTime: endDate });
  return tokenManager.withRetry(async (accessToken) => {
    const res = await httpsRequest({ hostname: baseUrl, path: '/reports/2021-06-30/reports', method: 'POST', headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } }, postData);
    if (res.body.errors) throw new Error(`createReport failed: ${JSON.stringify(res.body.errors)}`);
    return res.body.reportId;
  });
}

async function pollReportStatus(tokenManager, baseUrl, reportId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const body = await tokenManager.withRetry(async (accessToken) => {
      const res = await httpsRequest({ hostname: baseUrl, path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`, method: 'GET', headers: { 'x-amz-access-token': accessToken } });
      if (res.body.errors) throw new Error(`getReport failed: ${JSON.stringify(res.body.errors)}`);
      return res.body;
    });
    const status = body.processingStatus;
    // Sampled: up to MAX_POLL_ATTEMPTS (40) lines per report, times one report per chunk, times
    // every account — and it says the same thing each time while a report sits IN_QUEUE. Keep the
    // first (so "polling started" is visible) and every 10th; the terminal states below are always
    // logged by their own branches or the throw.
    if (attempt === 1 || attempt % 10 === 0) {
      logger.info(`[Report] Poll #${attempt}: status = ${status}`);
    } else {
      logger.debug(`[Report] Poll #${attempt}: status = ${status}`);
    }
    if (status === 'DONE') {
      if (attempt !== 1 && attempt % 10 !== 0) logger.info(`[Report] DONE after ${attempt} poll(s).`);
      return body.reportDocumentId;
    }
    if (status === 'CANCELLED' || status === 'FATAL') throw new Error(`Report failed: ${status}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Report did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

async function getReportDocumentUrl(tokenManager, baseUrl, reportDocumentId) {
  try {
    return await tokenManager.withRetry(async (accessToken) => {
      const res = await httpsRequest({ hostname: baseUrl, path: `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`, method: 'GET', headers: { 'x-amz-access-token': accessToken } });
      if (res.body.errors) throw new Error(`getReportDocument failed: ${JSON.stringify(res.body.errors)}`);
      return res.body;
    });
  } catch (err) {
    // `withRetry` can mint a token on the way in, so a failure here may actually be `lwaToken`.
    // tagHop is first-tag-wins, which keeps that distinction instead of flattening it to this hop.
    throw tagHop(err, HOP_NAMES.REPORT_DOCUMENT_URL);
  }
}

function parseTsv(rawData) {
  const lines = rawData.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map((h) => h.trim().replace(/\r/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t').map((v) => v.trim().replace(/\r/g, ''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

// ─────────────────────────────────────────────
// SALES REPORT — split into submit / download+parse so the INLINE path and the non-blocking
// ASYNC path run the SAME code.
//
// This is the "extraction technique" from ASYNC_REPORTS_AND_STREAMING_HANDOFF.md: the async
// adapter must never hold its own copy of the download/parse logic, or the two paths drift and
// silently produce different data. Both call the two functions below.
// ─────────────────────────────────────────────

/**
 * Ask Amazon to build the report. Returns the `reportId` and nothing else — deliberately does NOT
 * poll, so the async path can persist the id and release the worker instead of sleeping.
 */
async function submitSalesReport(tokenManager, baseUrl, marketplaceId, startDate, endDate) {
  logger.info(`[SalesReport] Submitting: ${startDate} → ${endDate}`);
  return createReport(tokenManager, baseUrl, marketplaceId, startDate, endDate);
}

/**
 * Given a READY report's document id, fetch and parse it.
 *
 * The document URL is fetched here rather than passed in, because it is a short-lived pre-signed
 * S3 URL — in the async path minutes or hours can pass between the status check and this call, by
 * which time a carried URL would be expired.
 *
 * @returns {Promise<{rows: Array, download: object}>}
 */
async function downloadSalesReportRows(tokenManager, baseUrl, reportDocumentId, label = 'SalesReport') {
  const startedAt = Date.now();
  const docInfo = await getReportDocumentUrl(tokenManager, baseUrl, reportDocumentId);
  // The report document URL is a pre-signed S3 URL — no access token needed.
  const download = await downloadReportContent(docInfo.url, {
    isGzip: docInfo.compressionAlgorithm === 'GZIP',
    label: `SalesReport ${label}`,
  });
  const rows = parseTsv(download.text);

  // Instrumentation. There was previously none, which is why the safe report size had to be
  // estimated from column counts rather than measured. Keep this at info level — it is one
  // line per report and it is what tells us whether the chunk size is right for an account.
  logger.info(
    `[SalesReport] ${label}: ${rows.length} rows, ` +
    `${download.compressedBytes}B compressed / ${download.decompressedBytes}B raw, ` +
    `download ${download.durationMs}ms, total ${Date.now() - startedAt}ms, ` +
    `heapUsed ${Math.round(process.memoryUsage().heapUsed / 1048576)}MB`
  );

  // A payload that delivered bytes but is not a usable report is a real error, not "no data".
  // Accepting it would let the persist layer settle those days at $0 — and any day older than
  // PROVISIONAL_SETTLE_DAYS is then marked non-provisional, i.e. never retried. For an account
  // doing six figures a day that is silent, permanent revenue loss.
  //
  // A header-only body is NOT this case: it is how Amazon reports a window with no orders. The
  // CALLER decides whether to re-request (inline retries up to EMPTY_REPORT_RETRIES; the async
  // phase allows exactly one, because re-submitting is what congests the report queue).
  if (rows.length === 0 && isUnusableReportPayload(download.text, download.decompressedBytes)) {
    throw new Error(
      `[SalesReport] ${label}: downloaded ${download.decompressedBytes} bytes ` +
      `but found no usable TSV rows — refusing to treat this as "no data".`
    );
  }

  return { rows, download };
}

/**
 * INLINE path: submit → poll → download → parse, with the transient-empty retry.
 * Behaviour is unchanged; it is now expressed in terms of the two shared functions above.
 */
async function fetchSalesReport(tokenManager, baseUrl, marketplaceId, startDate, endDate) {
  const label = `${startDate}→${endDate}`;
  // Retry-on-empty (FIX #1): a DONE-but-empty report is usually a transient
  // generation miss — re-generating returns the rows. Bounded retries; if it's
  // still empty we accept "no data" (the persist layer then preserves whatever
  // already exists for those days — it never wipes on an empty report).
  for (let attempt = 0; attempt <= EMPTY_REPORT_RETRIES; attempt++) {
    const reportId = await submitSalesReport(tokenManager, baseUrl, marketplaceId, startDate, endDate);
    const reportDocumentId = await pollReportStatus(tokenManager, baseUrl, reportId);
    const { rows } = await downloadSalesReportRows(tokenManager, baseUrl, reportDocumentId, label);

    if (rows.length > 0 || attempt === EMPTY_REPORT_RETRIES) {
      if (rows.length === 0 && attempt > 0) {
        logger.warn(`[SalesReport] Still empty after ${attempt} retry(ies) for ${label} — accepting as no data (existing rows are preserved, not wiped).`);
      }
      return rows;
    }
    logger.warn(`[SalesReport] Empty report for ${label} (attempt ${attempt + 1}/${EMPTY_REPORT_RETRIES + 1}); fresh reports are often transiently empty. Re-generating in ${EMPTY_REPORT_RETRY_DELAY_MS / 1000}s…`);
    await new Promise((r) => setTimeout(r, EMPTY_REPORT_RETRY_DELAY_MS));
  }
  return [];
}

function parseSalesReportRows(reportRows, country) {
  const orderMap = new Map();
  let totalItems = 0;
  const salesChannel = country ? COUNTRY_TO_SALES_CHANNEL[country.toUpperCase()] : null;
  let skippedChannel = 0;
  for (const row of reportRows) {
    if ((row['order-status'] || '').toLowerCase() === 'cancelled') continue;
    if ((row['sales-channel'] || '').toLowerCase() === 'non-amazon') continue;
    // Filter by marketplace when country is specified (NA region returns US+CA+MX+BR mixed)
    if (salesChannel && row['sales-channel'] !== salesChannel) { skippedChannel++; continue; }
    const price = parseFloat(row['item-price']) || 0;
    const pacificDate = toMarketplaceDayKey(row['purchase-date'], country);
    if (!pacificDate) continue;
    const orderId = row['amazon-order-id'] || '';
    if (!orderId) continue;
    const sku = row['sku'] || 'N/A';

    if (!orderMap.has(orderId)) orderMap.set(orderId, new Map());
    const skuMap = orderMap.get(orderId);

    if (!skuMap.has(sku)) {
      skuMap.set(sku, { orderId, sku, asin: row['asin'] || '', pacificDate, currency: row['currency'] || '', productName: row['product-name'] || '', totalPrice: 0, totalUnits: 0 });
      totalItems++;
    }
    const item = skuMap.get(sku);
    item.totalPrice += price;
    item.totalUnits += parseInt(row['quantity'], 10) || 0;
    if (!item.asin && row['asin']) item.asin = row['asin'];
  }
  if (skippedChannel > 0) logger.debug(`[SalesReport] Skipped ${skippedChannel} rows from other marketplaces (filtering for ${salesChannel})`);
  logger.info(`[SalesReport] Valid orders: ${orderMap.size}, order-items (order×SKU): ${totalItems}`);
  return orderMap;
}

// ═══════════════════════════════════════════════
// CATEGORY → FIELD MAPPING
// ═══════════════════════════════════════════════
const EXPENSE_CATEGORY_TO_FIELD = {
  'FBA Fulfillment Fee': 'fbaFulfillmentFee', 'Referral Commission': 'referralCommission',
  'Closing Fee': 'closingFee', 'Technology Fee': 'technologyFee',
  'Shipping Chargeback': 'shippingChargeback', 'Gift Wrap Chargeback': 'giftWrapChargeback',
  'Refund Commission': 'refundCommission',
  'Promotions / Discounts': 'promotionsDiscount', 'Shipping Discount': 'shippingDiscount',
  'Tax Discount': 'taxDiscount', 'Shipping Tax Discount': 'shippingTaxDiscount',
  'Sales Tax Collected': 'salesTaxCollected', 'Shipping Tax Collected': 'shippingTaxCollected',
  'Gift Wrap Tax Collected': 'giftWrapTaxCollected',
  'Marketplace Facilitator Tax': 'marketplaceFacilitatorTax',
  'TDS (Tax Deducted at Source)': 'tdsDeducted', 'TCS (Tax Collected at Source)': 'tcsCollected',
  'FBA Reversed Reimbursement': 'fbaReversedReimbursement',
  'Compensated Clawback': 'fbaReversedReimbursement',
  'FBA Disposal Fee': 'fbaDisposalFee',
};

// ★ When a fee comes from a REFUND transaction, some categories must be
// re-mapped to different fields so they don't pollute forward fee totals.
// Sellerboard shows these under "Refund cost", not under "+Amazon fees".
const REFUND_CATEGORY_REMAP = {
  'Referral Commission': 'refundedReferralFee',    // reversed referral fee (positive = money back)
  'Promotions / Discounts': 'refundedPromotion',   // reversed promo discount (positive = promo reversed)
  'Restocking Fee': 'restockingFee',               // restocking deduction (positive = money retained)
};

const REVENUE_CATEGORY_TO_FIELD = {
  'Shipping Revenue': 'shippingRevenue', 'Gift Wrap Revenue': 'giftWrapRevenue',
  'FBA Inventory Reimbursement': 'fbaInventoryReimbursement',
};

const OVERHEAD_CATEGORIES = new Set([
  'FBA Storage Fee', 'FBA Inbound Transportation Fee', 'FBA Inbound Convenience Fee', 'FBA Removal Fee',
  'TaxWithholding', 'Subscription Fee', 'FBA Capacity Reservation Fee', 'Advertising / PPC',
  'Disbursement', 'Seller Reward', 'SAFE-T Reimbursement',
  'SERRAC Reimbursement', 'Reimbursement', 'Fulfillment Fee Refund',
  'Reserve Hold', 'Reserve Release',
]);

// ═══════════════════════════════════════════════
// INDEX FINANCE API ROWS BY ORDER+SKU
//
// ★ FIX 1: Separates rows into purchase-date vs posted-date groups.
// ★ FIX 2: Deduplicates Shipment expenses per orderId+SKU.
//   Amazon Finance API v2024-06-19 sometimes posts DUPLICATE Shipment
//   transactions for the same order (different transactionId, same fees,
//   posted days apart). Without dedup, FBA/Commission gets double-counted.
//   Strategy: for each orderId+SKU, record the transactionId of the FIRST
//   Shipment transaction seen. If a later row has the SAME orderId+SKU but
//   a DIFFERENT transactionId, it's from a duplicate transaction → skip it.
//   This preserves multi-unit orders (same transaction, same transactionId,
//   multiple items with identical fee amounts) while removing duplicate
//   transactions (different transactionId, identical fee structure).
// ═══════════════════════════════════════════════
/**
 * Empty finance index — the accumulator for the fold below.
 *
 * Split out of indexFinanceRowsByOrderId so rows can be folded in one API page at a time and the
 * raw page discarded immediately. Retaining every page's transaction graph for a multi-week window
 * is what exhausted a 2GB heap on a high-volume account.
 *
 * The dedup maps live HERE rather than as loop-locals precisely so that page-by-page folding sees
 * the same "first transactionId per orderId+SKU wins" state a single pass would.
 *
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.orderIdFilter] When supplied, ONLY rows whose `orderId` is in the
 *   set are retained; everything else is discarded as it arrives.
 *
 *   This is for `backfillPendingExpenses` (Step 2), which is looking for the fees of a known list of
 *   pending orders and reads ONLY the four order-keyed lookups below. It must still search a window
 *   running to *now* (fees post late, and shortening that window starves pending orders), but a
 *   measured run showed ~88k expense rows PER DAY for a large seller — a 49-day window is ~4.3M
 *   rows, of which a few thousand match. Filtering as we fold makes memory a function of the
 *   pending-order count instead of the window length.
 *
 *   Rows with no `orderId` (overhead, per-ASIN) are dropped too, since Step 2 never reads
 *   `overheadExpenses` / `postedDateExpenses`. Filtering is by ORDER only — never by SKU — so every
 *   row of a kept order is still seen in arrival order and the dedup result is unchanged.
 *
 *   Omit it (the default) and the index behaves exactly as before, which is what keeps Step 1 and
 *   the one-shot `indexFinanceRowsByOrderId` untouched.
 */
function createFinanceIndex({ orderIdFilter = null } = {}) {
  return {
    // Non-null only for the Step 2 use above; `null` means "retain everything".
    _orderIdFilter: orderIdFilter,
    // Observability: how many rows were discarded by the filter.
    filteredOutCount: 0,
    // ── Expenses that should be placed on PURCHASE DATE (via orderId join) ──
    expensesByOrderSku: new Map(),        // "orderId||sku" → expense[]
    unattributedExpensesByOrder: new Map(), // orderId → expense[] (sku=N/A)
    // ── Expenses that should be placed on POSTED DATE (Pacific) ──
    postedDateExpenses: [],               // Refunds, Reimbursements, ServiceFees
    // ── Overhead (no orderId) ──
    overheadExpenses: [],

    revenueByOrderSku: new Map(),
    unattributedRevenueByOrder: new Map(),
    overheadRevenue: [],
    postedDateRevenue: [],

    // ── Fold state: first transactionId seen per orderId+SKU, and dedup tallies ──
    _firstTxnByOrderSku: new Map(),
    _firstTxnRevByOrderSku: new Map(),
    dedupCount: 0,
    dedupRevCount: 0,
  };
}

/**
 * Fold one batch of rows into an existing index.
 *
 * ORDER MATTERS: the dedup keeps the FIRST transactionId per orderId+SKU, so calling this
 * sequentially over pages reproduces a single pass over their concatenation exactly. Never call it
 * concurrently or out of order.
 */
function addFinanceRowsToIndex(index, expenseRows = [], revenueRows = []) {
  const {
    expensesByOrderSku,
    unattributedExpensesByOrder,
    postedDateExpenses,
    overheadExpenses,
    _firstTxnByOrderSku: firstTxnByOrderSku,
    _orderIdFilter: orderIdFilter,
  } = index;

  // Applied BEFORE any routing or dedup, so a kept row is handled identically to the unfiltered
  // case. Filtering by order (never by SKU) means every row of a kept order is still seen, in
  // arrival order, so the "first transactionId wins" outcome is untouched.
  const keep = (row) => !orderIdFilter || (row.orderId && orderIdFilter.has(row.orderId));

  for (const e of expenseRows) {
    if (!keep(e)) { index.filteredOutCount++; continue; }
    if (!e.orderId) {
      // ★ FIX: If no orderId but HAS a SKU, it's a per-ASIN transaction
      // (e.g., COMPENSATED_CLAWBACK). Route to postedDateExpenses
      // so it lands in the correct SKU bucket.
      const sku = e.sku && e.sku !== 'N/A' ? e.sku : null;
      if (sku) {
        postedDateExpenses.push(e);
      } else {
      overheadExpenses.push(e);
      }
      continue;
    }

    // Route by transaction type
    if (PURCHASE_DATE_TXN_TYPES.has(e.transactionType)) {
      // Shipment → goes to purchase date via orderId join
      const sku = e.sku || 'N/A';
      const orderSkuKey = `${e.orderId}||${sku}`;

      // ★ Transaction-level dedup using transactionId
      const txnId = e.transactionId || '';
      const firstTxn = firstTxnByOrderSku.get(orderSkuKey);

      if (firstTxn === undefined) {
        // First Shipment for this orderId+SKU — record its transactionId
        firstTxnByOrderSku.set(orderSkuKey, txnId);
      } else if (txnId && firstTxn && txnId !== firstTxn) {
        // Different transactionId → duplicate transaction → skip
        index.dedupCount++;
        continue;
      }
      // Same transactionId → same transaction → allow (multi-unit items)

      if (sku === 'N/A') {
        if (!unattributedExpensesByOrder.has(e.orderId)) unattributedExpensesByOrder.set(e.orderId, []);
        unattributedExpensesByOrder.get(e.orderId).push(e);
      } else {
        const key = orderSkuKey;
        if (!expensesByOrderSku.has(key)) expensesByOrderSku.set(key, []);
        expensesByOrderSku.get(key).push(e);
      }
    } else {
      // Refund, FBAInventoryReimbursement, ServiceFee, Adjustment, etc.
      postedDateExpenses.push(e);
    }
  }

  // ── Revenue ──
  const {
    revenueByOrderSku,
    unattributedRevenueByOrder,
    overheadRevenue,
    postedDateRevenue,
    // ★ Same transaction-level dedup for Shipment revenue
    _firstTxnRevByOrderSku: firstTxnRevByOrderSku,
  } = index;

  for (const r of revenueRows) {
    if (!keep(r)) { index.filteredOutCount++; continue; }
    // Skip Product Sales from Shipment — those come from the Sales Report.
    // But KEEP Product Sales from Refund — that's the refunded amount (negative).
    if (r.category === 'Product Sales' && PURCHASE_DATE_TXN_TYPES.has(r.transactionType)) continue;
    if (!r.orderId) {
      // ★ FIX: If no orderId but HAS a SKU, it's a per-ASIN transaction
      // (e.g., MISSING_FROM_INBOUND, WAREHOUSE_DAMAGE_EXCEPTION, WAREHOUSE_LOST)
      // Route to postedDateRevenue so it lands in the correct SKU bucket.
      const sku = r.sku && r.sku !== 'N/A' ? r.sku : null;
      if (sku) {
        postedDateRevenue.push(r);
      } else {
      overheadRevenue.push(r);
      }
      continue;
    }

    if (PURCHASE_DATE_TXN_TYPES.has(r.transactionType)) {
      const sku = r.sku || 'N/A';
      const orderSkuKey = `${r.orderId}||${sku}`;
      const txnId = r.transactionId || '';
      const firstTxn = firstTxnRevByOrderSku.get(orderSkuKey);

      if (firstTxn === undefined) {
        firstTxnRevByOrderSku.set(orderSkuKey, txnId);
      } else if (txnId && firstTxn && txnId !== firstTxn) {
        index.dedupRevCount++;
        continue;
      }

      if (sku === 'N/A') {
        if (!unattributedRevenueByOrder.has(r.orderId)) unattributedRevenueByOrder.set(r.orderId, []);
        unattributedRevenueByOrder.get(r.orderId).push(r);
      } else {
        const key = orderSkuKey;
        if (!revenueByOrderSku.has(key)) revenueByOrderSku.set(key, []);
        revenueByOrderSku.get(key).push(r);
      }
    } else {
      postedDateRevenue.push(r);
    }
  }

  return index;
}

/** Log the dedup tallies once, after all pages have been folded. */
function logFinanceIndexDedup(index) {
  if (index.dedupCount > 0) {
    logger.debug(`[Dedup] Removed ${index.dedupCount} duplicate Shipment expense rows (duplicate transactions with different transactionId).`);
  }
  if (index.dedupRevCount > 0) {
    logger.debug(`[Dedup] Removed ${index.dedupRevCount} duplicate Shipment revenue rows.`);
  }
}

/**
 * One-shot index build — create + fold + log. Retained so existing callers and the buffered
 * (non-streaming) path are unchanged, and so the streaming fold can be tested for equivalence
 * against it.
 */
function indexFinanceRowsByOrderId(expenseRows, revenueRows) {
  const index = createFinanceIndex();
  addFinanceRowsToIndex(index, expenseRows, revenueRows);
  logFinanceIndexDedup(index);
  return index;
}

// ═══════════════════════════════════════════════
// APPLY EXPENSES TO A SKU BUCKET
// ═══════════════════════════════════════════════
function applyExpensesToBucket(bucket, expenses) {
  for (const e of expenses) {
    const field = EXPENSE_CATEGORY_TO_FIELD[e.category];
    if (field) {
      bucket[field] += e.amount;
    } else {
      bucket.otherExpenses += e.amount;
      if (!bucket.otherExpensesMap[e.category]) bucket.otherExpensesMap[e.category] = 0;
      bucket.otherExpensesMap[e.category] += e.amount;
    }
  }
}

function applyRevenueTooBucket(bucket, revenues) {
  for (const r of revenues) {
    const field = REVENUE_CATEGORY_TO_FIELD[r.category];
    if (field) bucket[field] += r.amount;
  }
}

function computeBucketTotals(bucket) {
  bucket.totalRevenue = Math.round((bucket.productSales + bucket.shippingRevenue + bucket.giftWrapRevenue + bucket.fbaInventoryReimbursement) * 100) / 100;
  bucket.totalExpenses = Math.round((bucket.fbaFulfillmentFee + bucket.referralCommission + bucket.closingFee + bucket.technologyFee + bucket.shippingChargeback + bucket.giftWrapChargeback + bucket.refundCommission + bucket.refundedAmount + bucket.refundedReferralFee + bucket.refundedPromotion + bucket.restockingFee + bucket.promotionsDiscount + bucket.shippingDiscount + bucket.taxDiscount + bucket.shippingTaxDiscount + bucket.fbaReversedReimbursement + bucket.fbaDisposalFee + bucket.otherExpenses) * 100) / 100;
  bucket.totalTax = Math.round((bucket.salesTaxCollected + bucket.shippingTaxCollected + bucket.giftWrapTaxCollected + bucket.marketplaceFacilitatorTax + bucket.tdsDeducted + bucket.tcsCollected) * 100) / 100;
  bucket.netAmount = Math.round((bucket.totalRevenue + bucket.totalExpenses + bucket.totalTax) * 100) / 100;
  for (const key of Object.keys(bucket)) { if (typeof bucket[key] === 'number') bucket[key] = Math.round(bucket[key] * 100) / 100; }
}

function createEmptyBucket(sku, asin, date) {
  return {
    sku, asin, date, productName: '',
    productSales: 0, shippingRevenue: 0, giftWrapRevenue: 0, fbaInventoryReimbursement: 0,
    units: 0, orderCount: 0,
    fbaFulfillmentFee: 0, referralCommission: 0, closingFee: 0, technologyFee: 0,
    shippingChargeback: 0, giftWrapChargeback: 0, refundCommission: 0,
    refundedAmount: 0, refundedReferralFee: 0, refundedPromotion: 0, restockingFee: 0,
    promotionsDiscount: 0, shippingDiscount: 0, taxDiscount: 0, shippingTaxDiscount: 0,
    salesTaxCollected: 0, shippingTaxCollected: 0, giftWrapTaxCollected: 0,
    marketplaceFacilitatorTax: 0,
    tdsDeducted: 0, tcsCollected: 0,
    fbaReversedReimbursement: 0, fbaDisposalFee: 0,
    otherExpenses: 0, otherExpensesMap: {},
    totalRevenue: 0, totalExpenses: 0, totalTax: 0, netAmount: 0,
    isEstimated: false, estimatedOrderCount: 0, estimatedFba: 0, estimatedCommission: 0,
  };
}

// ═══════════════════════════════════════════════
// BUILD OVERHEAD BUCKETS
// ═══════════════════════════════════════════════
/**
 * @param {string} [country] Marketplace country, for local-calendar day keys. Optional so the
 *   existing positional callers/tests keep working; omitting it falls back to Pacific.
 *
 * Note on the `|| postedDateStr` fallbacks below: `postedDateStr` is a UTC-derived key, so it
 * would mix conventions — but Expences.js only ever sets it when `postedDate` is truthy
 * (`postedDate ? formatDateYYYYMMDD(postedDate) : ""`, Expences.js:758/1024/1065), and a truthy
 * Date always converts, so the fallback is unreachable in production. It is retained only
 * because unit-test fixtures construct rows with `postedDate: null` plus a `postedDateStr`.
 */
function buildOverheadBuckets(overheadExpenses, overheadRevenue, rangeStart, rangeEnd, country) {
  const overheadBuckets = new Map();

  for (const e of overheadExpenses) {
    const date = toMarketplaceDayKey(e.postedDate, country) || e.postedDateStr || 'Unknown';
    if (rangeStart && rangeEnd && (date < rangeStart || date > rangeEnd)) continue;
    if (!OVERHEAD_CATEGORIES.has(e.category) && e.sku !== 'N/A') continue;
    const key = `${e.category}||${date}`;
    if (!overheadBuckets.has(key)) overheadBuckets.set(key, { category: e.category, date, amount: 0, count: 0, isRevenue: false });
    overheadBuckets.get(key).amount += e.amount;
    overheadBuckets.get(key).count++;
  }

  for (const r of overheadRevenue) {
    if (!OVERHEAD_CATEGORIES.has(r.category)) continue;
    const date = toMarketplaceDayKey(r.postedDate, country) || r.postedDateStr || 'Unknown';
    // ★ Range-filter revenue exactly as the expense loop above does. Omitting this let an
    //   out-of-window date into `overheadBuckets` and therefore into `datesToClear`, whose
    //   deleteMany covers DailySkuFinance too — so a bucket for a date outside the requested
    //   window would DELETE that day's SKU sales rows without reinserting them.
    //
    //   The Finance API window per fetch starts several days before the sales window (the
    //   settlement-lag buffer), and events like Reserve Release / Disbursement post daily, so
    //   such dates are routine. Once the sync fetches in chunks this collides within a single
    //   run: a later chunk would wipe sales an earlier chunk had just written and already
    //   stamped `success`, leaving a settled $0 for a day with real revenue.
    //
    //   Each date's own chunk covers it in range and records these events there, so nothing is
    //   lost by skipping them here.
    if (rangeStart && rangeEnd && (date < rangeStart || date > rangeEnd)) continue;
    const key = `${r.category}||${date}`;
    if (!overheadBuckets.has(key)) overheadBuckets.set(key, { category: r.category, date, amount: 0, count: 0, isRevenue: true });
    overheadBuckets.get(key).amount += r.amount;
    overheadBuckets.get(key).count++;
  }

  return overheadBuckets;
}

// ═══════════════════════════════════════════════
// PERSIST TO MONGODB
// ═══════════════════════════════════════════════
async function persistDailyBuckets({ userId, country, regionModel, marketplaceId, skuBuckets, overheadBuckets, datesToClear }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const skuDocs = [];
  for (const bucket of skuBuckets.values()) {
    const otherBreakdown = Object.entries(bucket.otherExpensesMap || {}).map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }));
    skuDocs.push({
      User: userObjectId, country, region: regionModel, marketplaceId,
      date: bucket.date, sku: bucket.sku, asin: bucket.asin, productName: bucket.productName || '',
      productSales: bucket.productSales, shippingRevenue: bucket.shippingRevenue, giftWrapRevenue: bucket.giftWrapRevenue, fbaInventoryReimbursement: bucket.fbaInventoryReimbursement,
      units: bucket.units, orderCount: bucket.orderCount,
      fbaFulfillmentFee: bucket.fbaFulfillmentFee, referralCommission: bucket.referralCommission, closingFee: bucket.closingFee, technologyFee: bucket.technologyFee,
      shippingChargeback: bucket.shippingChargeback, giftWrapChargeback: bucket.giftWrapChargeback, refundCommission: bucket.refundCommission,
      refundedAmount: bucket.refundedAmount, refundedReferralFee: bucket.refundedReferralFee, refundedPromotion: bucket.refundedPromotion, restockingFee: bucket.restockingFee,
      promotionsDiscount: bucket.promotionsDiscount, shippingDiscount: bucket.shippingDiscount, taxDiscount: bucket.taxDiscount, shippingTaxDiscount: bucket.shippingTaxDiscount,
      salesTaxCollected: bucket.salesTaxCollected, shippingTaxCollected: bucket.shippingTaxCollected, giftWrapTaxCollected: bucket.giftWrapTaxCollected,
      marketplaceFacilitatorTax: bucket.marketplaceFacilitatorTax,
      tdsDeducted: bucket.tdsDeducted, tcsCollected: bucket.tcsCollected,
      fbaReversedReimbursement: bucket.fbaReversedReimbursement, fbaDisposalFee: bucket.fbaDisposalFee,
      otherExpenses: bucket.otherExpenses, otherExpensesBreakdown: otherBreakdown,
      totalRevenue: bucket.totalRevenue, totalExpenses: bucket.totalExpenses, totalTax: bucket.totalTax, netAmount: bucket.netAmount,
      isEstimated: bucket.isEstimated || false, estimatedOrderCount: bucket.estimatedOrderCount || 0, estimatedFba: bucket.estimatedFba || 0, estimatedCommission: bucket.estimatedCommission || 0,
    });
  }
  const overheadDocs = [];
  for (const oh of overheadBuckets.values()) {
    overheadDocs.push({ User: userObjectId, country, region: regionModel, marketplaceId, date: oh.date, category: oh.category, amount: Math.round(oh.amount * 100) / 100, count: oh.count, isRevenue: oh.isRevenue });
  }

  // ── Replace ONE DATE AT A TIME ────────────────────────────────────────────────
  // This was previously a single deleteMany over every date in the chunk followed by a single
  // insertMany. A crash in between — OOM, worker kill, a lost async job — left EVERY day in the
  // chunk at $0 with no sync-log row, invisible until someone went looking. Doing it per date
  // bounds that blast radius to one day, which matters more now that a finalize can be retried.
  //
  // Same final data: the docs are grouped by date and each date's delete is immediately followed
  // by its own insert. Prove with dataParitySnapshot.
  const skuByDate = new Map();
  for (const doc of skuDocs) {
    if (!skuByDate.has(doc.date)) skuByDate.set(doc.date, []);
    skuByDate.get(doc.date).push(doc);
  }
  const overheadByDate = new Map();
  for (const doc of overheadDocs) {
    if (!overheadByDate.has(doc.date)) overheadByDate.set(doc.date, []);
    overheadByDate.get(doc.date).push(doc);
  }

  for (const dateStr of (datesToClear || [])) {
    await DailySkuFinance.deleteMany({ User: userObjectId, country, region: regionModel, date: dateStr });
    for (const chunk of chunkArray(skuByDate.get(dateStr) || [], CHUNK_INSERT_SIZE)) {
      if (chunk.length === 0) continue;
      await DailySkuFinance.insertMany(chunk, { ordered: false });
    }

    await DailyOverheadFinance.deleteMany({ User: userObjectId, country, region: regionModel, date: dateStr });
    for (const chunk of chunkArray(overheadByDate.get(dateStr) || [], CHUNK_INSERT_SIZE)) {
      if (chunk.length === 0) continue;
      await DailyOverheadFinance.insertMany(chunk, { ordered: false });
    }
  }

  logger.info(`[FinanceService] Saved ${skuDocs.length} SKU docs, ${overheadDocs.length} overhead docs across ${(datesToClear || []).length} date(s).`);
  return { skuDocCount: skuDocs.length, overheadDocCount: overheadDocs.length };
}

// ═══════════════════════════════════════════════
// STEP 1: FETCH NEW SALES + EXPENSES
//
// ★ KEY FIX: Date assignment matches Sellerboard exactly:
//
//   Shipment expenses → placed on the order's PURCHASE DATE
//                       by joining Finance API orderId to Sales Report
//
//   Refund expenses   → placed on the refund's POSTED DATE
//                       NOT on the original order's purchase date
//
//   Reimbursement     → placed on POSTED DATE
//   ServiceFee        → placed on POSTED DATE
//   Adjustment        → placed on POSTED DATE
//
// This was confirmed by matching real data against Sellerboard's actual per-day numbers
// (10/10 days exact match for FBA fees, Commission, Refund cost, and Reimbursements).
//
// ⚠️ Those days used to be Pacific days for every account; they are now the MARKETPLACE's
// local days. For a US account that is the same thing in summer, so the Sellerboard match is
// preserved if (as seems likely) it was validated on a US account — but the original commit
// does not record which marketplace was used, so treat non-US refund/reimbursement DAY
// PLACEMENT as unconfirmed until spot-checked against Seller Central. The sales figure
// itself does not depend on this.
// ═══════════════════════════════════════════════
/**
 * Marketplace-local day boundaries for the Sales Report, as the ISO instants Amazon expects.
 * Extracted so the inline path and the async adapter request a byte-identical window.
 *
 * MUST stay in lockstep with `toMarketplaceDayKey`: this decides which orders Amazon returns,
 * that decides which day they are filed under. If they disagree, the fetched window will not
 * cover the days we then bucket into and days come back partially filled.
 */
function salesReportWindowISO(startDate, endDate, country) {
  const { startISO, endISO } = marketplaceDayWindowISO(startDate, endDate, country);
  return { salesStartISO: startISO, salesEndISO: endISO };
}

/**
 * INLINE path: fetch the Sales Report (create → poll → download), then process it.
 * Behaviour is unchanged — the processing half now lives in `processSalesReportRows` so the async
 * path can share it.
 */
async function fetchNewSalesAndExpenses({ userId, country, regionModel, startDate, endDate, accessToken, refreshToken, clientId, clientSecret, tokenManager: inheritedTokenManager }) {
  const regionInternal = internalRegionFromModel(regionModel);
  const { baseUrl, marketplaceId } = resolveMarketplaceAndRegion(country.toUpperCase(), regionInternal);

  // Auto-renewing token manager: covers both the Reports API and the
  // Finance API legs. If the caller supplied one (e.g. syncFinanceData
  // chaining step1 → step2), reuse it so we don't lose lifetime tracking.
  const tokenManager = inheritedTokenManager || createTokenManager({ accessToken, refreshToken, clientId, clientSecret });

  // ── Sales Report (marketplace-local day boundaries) ──
  const { salesStartISO, salesEndISO } = salesReportWindowISO(startDate, endDate, country);

  logger.info(`[Step1] Sales Report: ${startDate} → ${endDate} (${country} local)`);
  const reportRows = await fetchSalesReport(tokenManager, baseUrl, marketplaceId, salesStartISO, salesEndISO);

  return processSalesReportRows({ userId, country, regionModel, startDate, endDate, reportRows, tokenManager });
}

/**
 * Everything from "the Sales Report rows are in hand" onwards: parse → Finance API streaming fold
 * → join → bucket build → persist → PendingExpenseOrder → FinanceSyncLog success rows.
 *
 * THIS IS THE SHARED BODY. The inline path above and the async adapter's `finalize()` both call
 * it, so the two paths write identical data by construction rather than by inspection. Every
 * side effect — including the FinanceSyncLog writes that ADVANCE THE CURSOR — happens here.
 *
 * @param {string|null} [syncRunId] Async path only. Stamped onto the FinanceSyncLog rows so a
 *   repeated finalize (BullMQ retry) can detect that it already ran and skip. Without this a
 *   re-run after Step 2 had converted estimated fees into actuals would reinstate the estimates.
 */
async function processSalesReportRows({ userId, country, regionModel, startDate, endDate, reportRows, tokenManager, syncRunId = null }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const regionInternal = internalRegionFromModel(regionModel);
  const { baseUrl, marketplaceId } = resolveMarketplaceAndRegion(country.toUpperCase(), regionInternal);
  const salesOrderMap = parseSalesReportRows(reportRows, country);

  // ── Per-day "unsettled sales" signal (for provisional sync-log marking) ──
  // Amazon withholds buyer/price data for orders in 'Pending' status, so those
  // rows arrive with an empty item-price and are summed as $0. A day that
  // contains such rows is NOT yet trustworthy and must be re-fetched later.
  // ('Unshipped' orders are confirmed and DO carry prices — not counted here;
  //  only statuses beginning with 'pending' have the empty-price problem.)
  const pendingCountByDate = new Map();
  for (const row of reportRows) {
    const status = (row['order-status'] || '').toLowerCase();
    if (!status.startsWith('pending')) continue;
    const d = toMarketplaceDayKey(row['purchase-date'], country);
    if (!d) continue;
    pendingCountByDate.set(d, (pendingCountByDate.get(d) || 0) + 1);
  }

  // DEBUG — remove after testing
  let debugTotal = 0, debugUnits = 0, debugOrders = 0;
  for (const [, skuMap] of salesOrderMap) {
    for (const [, item] of skuMap) {
      debugTotal += item.totalPrice;
      debugUnits += item.totalUnits;
      debugOrders++;
    }
  }
  logger.debug(`[DEBUG] parseSalesReportRows returned: $${Math.round(debugTotal * 100) / 100} | ${debugUnits} units | ${debugOrders} order-items | country filter: ${country}`);

  // ── Finance API window: (startDate - buffer) → (endDate + buffer), capped at now ──
  // We fetch wider than the sales report to catch Shipment fees posted slightly after the order
  // date. It used to run all the way to TODAY, which was both ruinous and pointless:
  //
  //   * Ruinous — for a chunk in mid-June that meant ~49 days of transactions, and since the sync
  //     now fetches per chunk it did so once per chunk. `fetchTransactions` retained every page, so
  //     a high-volume account exhausted a 2GB heap before writing anything.
  //   * Pointless — only `Shipment` attributes to the order's purchase date
  //     (PURCHASE_DATE_TXN_TYPES). Every other type attributes to its POSTED date and is then
  //     hard-filtered to [startDate, endDate] further down, i.e. fetched, parsed and discarded. The
  //     day such a row belongs to is covered by its own chunk/run.
  //
  // So the forward reach only needs to cover Shipment settlement lag — the same lag already applied
  // backward. Anything later falls to PendingExpenseOrder + Step 2 (chases up to
  // MAX_PENDING_AGE_DAYS), and `resyncDays` re-fetches the trailing days on every daily run.
  const buffer = SETTLEMENT_LAG[regionModel] || SETTLEMENT_LAG.NA;
  const forwardDays = FINANCE_FORWARD_BUFFER_DAYS !== null ? FINANCE_FORWARD_BUFFER_DAYS : buffer.beforeDays;
  const finStart = new Date(`${startDate}T00:00:00.000Z`);
  finStart.setUTCDate(finStart.getUTCDate() - buffer.beforeDays);
  const nowCeiling = Date.now() - 3 * 60 * 1000; // API requires postedBefore > 2 min in the past
  const endDateMs = Date.parse(`${endDate}T23:59:59.999Z`);
  // Guard the parse: callers can pass forceDates, and a non 'YYYY-MM-DD' value would otherwise
  // yield NaN → an Invalid Date → a RangeError on the log line below.
  const forwardCeiling = Number.isFinite(endDateMs)
    ? endDateMs + forwardDays * 86400000
    : nowCeiling;
  const finEnd = new Date(Math.min(nowCeiling, forwardCeiling));
  const finSpanDays = Math.max(1, Math.round((finEnd - finStart) / 86400000));

  logger.info(`[Step1] Finance API: ${finStart.toISOString()} → ${finEnd.toISOString()} (${finSpanDays}d, forward buffer ${forwardDays}d)`);

  // ── Stream the transactions straight into the index ──
  // Each page is converted to rows, folded, and dropped; the raw transaction graph is never
  // retained. That is the difference between peak memory scaling with the window and with a page.
  const financeStartedAt = Date.now();
  let financeIndex = null;
  let expenseRowCount = 0;
  let revenueRowCount = 0;

  // `tokenRefresher` lets fetchTransactions refresh mid-pagination without
  // restarting from page 1. Outer withRetry covers the rare case where the
  // token dies before pagination begins.
  await tokenManager.withRetry(async (token) => {
    // Fresh index per attempt: withRetry re-invokes this whole function, and folding into a shared
    // index would double-count every row already ingested by the failed attempt.
    financeIndex = createFinanceIndex();
    expenseRowCount = 0;
    revenueRowCount = 0;

    // From the token manager, NOT from an enclosing scope. This block used to live inside
    // fetchNewSalesAndExpenses, where refreshToken/clientId/clientSecret were parameters; they are
    // not parameters of processSalesReportRows, so reading them as free variables here threw a
    // ReferenceError on every sync — inline and async alike.
    const { refreshToken, clientId, clientSecret } = tokenManager.credentials || {};
    return fetchNewFinanceData({
      refreshToken, accessToken: token, clientId, clientSecret,
      country: country.toUpperCase(), region: regionInternal,
      postedAfter: finStart.toISOString(), postedBefore: finEnd.toISOString(),
      tokenRefresher: () => tokenManager.refresh(),
      onRows: (pageExpenses, pageRevenue) => {
        expenseRowCount += pageExpenses.length;
        revenueRowCount += pageRevenue.length;
        // Sequential by construction — the dedup keeps the first transactionId per orderId+SKU,
        // so page order must be preserved. Never parallelise this.
        addFinanceRowsToIndex(financeIndex, pageExpenses, pageRevenue);
      },
    });
  }).catch((err) => {
    // Outermost tag for the Finance-API leg of Step 1. First-tag-wins, so an inner `lwaToken` or
    // `financeTxnPage` tag survives untouched; this only labels a failure that arrived with none —
    // guaranteeing the stored note always names WHICH leg of finalize died, not just what the
    // socket did.
    throw tagHop(err, HOP_NAMES.FINANCE_WALK);
  });
  logFinanceIndexDedup(financeIndex);

  logger.info(
    `[Step1] Finance API done: ${expenseRowCount} expense / ${revenueRowCount} revenue rows over ` +
    `${finSpanDays}d in ${Date.now() - financeStartedAt}ms, ` +
    `heapUsed ${Math.round(process.memoryUsage().heapUsed / 1048576)}MB`
  );

  // ── Index Finance API rows ──
  // ★ Now returns separate postedDateExpenses/Revenue for non-Shipment types
  const {
    expensesByOrderSku, unattributedExpensesByOrder,
    revenueByOrderSku, unattributedRevenueByOrder,
    overheadExpenses, overheadRevenue,
    postedDateExpenses,     // ★ Refund, Reimbursement, ServiceFee, Adjustment expenses
    postedDateRevenue,      // ★ Refund revenue (negative product sales from refund)
  } = financeIndex;

  const consumedOrderSkuKeys = new Set();
  const consumedOrderIds = new Set();

  // ── Build SKU buckets from Sales Report + SHIPMENT expenses ──
  // (Only Shipment fees go here — joined by orderId to purchase date)
  const skuBuckets = new Map();
  const pendingOrders = [];

  for (const [orderId, skuItemMap] of salesOrderMap) {
    const skusInOrder = [...skuItemMap.keys()];
    let orderHasAnyExpense = false;

    for (const [sku, item] of skuItemMap) {
      const bucketKey = `${sku}||${item.pacificDate}`;
      if (!skuBuckets.has(bucketKey)) skuBuckets.set(bucketKey, createEmptyBucket(sku, item.asin, item.pacificDate));
      const bucket = skuBuckets.get(bucketKey);
      if (!bucket.asin && item.asin) bucket.asin = item.asin;
      if (!bucket.productName && item.productName) bucket.productName = item.productName;

    // Sales from Sales Report
      bucket.productSales += item.totalPrice;
      bucket.units += item.totalUnits;
    bucket.orderCount++;

      // Shipment expenses matched by order+sku
      const expKey = `${orderId}||${sku}`;
      const skuExpenses = expensesByOrderSku.get(expKey);
      if (skuExpenses) {
        applyExpensesToBucket(bucket, skuExpenses);
        consumedOrderSkuKeys.add(expKey);
        orderHasAnyExpense = true;
      }

      // Shipment revenue matched by order+sku (non-product-sales like shipping)
      const revKey = `${orderId}||${sku}`;
      const skuRevenue = revenueByOrderSku.get(revKey);
      if (skuRevenue) {
        applyRevenueTooBucket(bucket, skuRevenue);
        consumedOrderSkuKeys.add(revKey);
      }
    }

    // Unattributed Shipment expenses (sku=N/A) → assign to first SKU
    const unattributed = unattributedExpensesByOrder.get(orderId);
    if (unattributed && unattributed.length > 0) {
      const firstItem = skuItemMap.get(skusInOrder[0]);
      const bucketKey = `${skusInOrder[0]}||${firstItem.pacificDate}`;
      const bucket = skuBuckets.get(bucketKey);
      applyExpensesToBucket(bucket, unattributed);
      unattributedExpensesByOrder.delete(orderId);
      orderHasAnyExpense = true;
    }

    // Unattributed Shipment revenue → assign to first SKU
    const unattribRev = unattributedRevenueByOrder.get(orderId);
    if (unattribRev && unattribRev.length > 0) {
      const firstItem = skuItemMap.get(skusInOrder[0]);
      const bucketKey = `${skusInOrder[0]}||${firstItem.pacificDate}`;
      const bucket = skuBuckets.get(bucketKey);
      applyRevenueTooBucket(bucket, unattribRev);
      unattributedRevenueByOrder.delete(orderId);
    }

    consumedOrderIds.add(orderId);

    // If no Shipment expenses found for this order → mark as pending
    if (!orderHasAnyExpense) {
      for (const [sku, item] of skuItemMap) {
      pendingOrders.push({
        User: userObjectId, country: country.toUpperCase(), region: regionModel,
          orderId, purchasePacificDate: item.pacificDate,
          asin: item.asin, sku: item.sku, salesAmount: item.totalPrice, units: item.totalUnits,
        attempts: 0, firstSeenAt: new Date(),
      });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // ★ FEE ESTIMATION FOR PENDING ORDERS
  //
  // The Finance API often lags 1-14 days behind the Sales Report for
  // Shipment fees. Sellerboard shows fees immediately because it estimates
  // them from known rate cards. We do the same:
  //
  //   1. Compute average FBA fee/unit and referral % per SKU from matched orders
  //   2. Apply those rates to pending orders
  //   3. Mark as estimated (isEstimated flag on bucket)
  //   4. Step 2 backfill replaces estimated with actual when Finance API confirms
  // ═══════════════════════════════════════════════
  if (pendingOrders.length > 0) {
    // Compute per-SKU average rates from matched orders
    const skuRates = new Map(); // sku → { totalFba, totalComm, totalSales, totalUnits }
    for (const [key, expenses] of expensesByOrderSku) {
      const [oid, sku] = key.split('||');
      if (!consumedOrderSkuKeys.has(key)) continue;
      if (!skuRates.has(sku)) skuRates.set(sku, { totalFba: 0, totalComm: 0, totalSales: 0, totalUnits: 0, orderCount: 0 });
      const rates = skuRates.get(sku);
      for (const e of expenses) {
        if (e.category === 'FBA Fulfillment Fee') rates.totalFba += e.amount;
        if (e.category === 'Referral Commission') rates.totalComm += e.amount;
      }
    }
    // Get sales and units from salesOrderMap for matched orders
    for (const [orderId, skuItemMap] of salesOrderMap) {
      if (!consumedOrderIds.has(orderId)) continue;
      for (const [sku, item] of skuItemMap) {
        const expKey = `${orderId}||${sku}`;
        if (!consumedOrderSkuKeys.has(expKey)) continue;
        if (!skuRates.has(sku)) continue;
        const rates = skuRates.get(sku);
        rates.totalSales += item.totalPrice;
        rates.totalUnits += item.totalUnits;
        rates.orderCount++;
      }
    }

    // Apply estimated rates to pending orders
    let estimatedCount = 0;
    for (const po of pendingOrders) {
      const rates = skuRates.get(po.sku);
      if (!rates || rates.totalUnits === 0 || rates.totalSales === 0) continue;

      const avgFbaPerUnit = rates.totalFba / rates.totalUnits;
      const referralPct = rates.totalComm / rates.totalSales; // negative / positive = negative %

      const estFba = Math.round(avgFbaPerUnit * po.units * 100) / 100;
      const estComm = Math.round(referralPct * po.salesAmount * 100) / 100;

      const bucketKey = `${po.sku}||${po.purchasePacificDate}`;
      if (!skuBuckets.has(bucketKey)) skuBuckets.set(bucketKey, createEmptyBucket(po.sku, po.asin, po.purchasePacificDate));
      const bucket = skuBuckets.get(bucketKey);

      bucket.fbaFulfillmentFee += estFba;
      bucket.referralCommission += estComm;
      bucket.isEstimated = true;
      bucket.estimatedOrderCount = (bucket.estimatedOrderCount || 0) + 1;
      bucket.estimatedFba = (bucket.estimatedFba || 0) + estFba;
      bucket.estimatedCommission = (bucket.estimatedCommission || 0) + estComm;
      estimatedCount++;
    }

    if (estimatedCount > 0) {
      logger.debug(`[Step1] Estimated fees for ${estimatedCount} pending orders (Finance API lag). Rates derived from ${skuRates.size} SKUs.`);
      // Log sample rates for debugging
      for (const [sku, rates] of skuRates) {
        if (rates.totalUnits > 0) {
          const avgFba = (rates.totalFba / rates.totalUnits).toFixed(2);
          const refPct = ((rates.totalComm / rates.totalSales) * 100).toFixed(1);
          logger.debug(`[Step1] SKU ${sku}: avgFBA/unit=$${avgFba}, referral=${refPct}% (from ${rates.orderCount} orders)`);
        }
      }
    }
  }

  // ── Finance-only Shipment expenses (not in Sales Report) → discard ──
  let discardedFinanceOnly = 0;
  for (const [key, expenses] of expensesByOrderSku) {
    if (consumedOrderSkuKeys.has(key)) continue;
    if (expenses.length === 0) continue;
    discardedFinanceOnly += expenses.length;
  }
  if (discardedFinanceOnly > 0) {
    logger.debug(`[Step1] Discarded ${discardedFinanceOnly} Shipment expense rows (orders not in Sales Report).`);
  }

  // ═══════════════════════════════════════════════
  // ★ FIX: Place Refund/Reimbursement/ServiceFee expenses on POSTED DATE
  //
  // These transactions have an orderId but they should NOT go to the
  // original order's purchase date. Sellerboard places them on the day
  // the refund/reimbursement was processed (postedDate → marketplace-local day).
  //
  // For REFUND transactions specifically, reversed fees (Commission,
  // Promotions) must be remapped to refund-specific fields so they
  // don't inflate the forward fee totals. Sellerboard shows them as:
  //   "Refund cost" = refundedAmount + refundCommission + refundedReferralFee + refundedPromotion
  // ═══════════════════════════════════════════════
  let postedDateExpenseCount = 0;
  for (const e of postedDateExpenses) {
    const pacificDate = toMarketplaceDayKey(e.postedDate, country) || e.postedDateStr;
    if (!pacificDate) continue;
    // Only include if the date falls within our display range
    if (pacificDate < startDate || pacificDate > endDate) continue;

    const sku = (e.sku && e.sku !== 'N/A') ? e.sku : null;
    const asin = e.asin || '';

    if (sku) {
      // Per-SKU bucket on the posted date
      const bucketKey = `${sku}||${pacificDate}`;
      if (!skuBuckets.has(bucketKey)) skuBuckets.set(bucketKey, createEmptyBucket(sku, asin, pacificDate));
      const bucket = skuBuckets.get(bucketKey);
    if (!bucket.asin && asin) bucket.asin = asin;

      // ★ For Refund transactions, remap certain categories to refund-specific fields
      if (e.transactionType === 'Refund') {
        const remappedField = REFUND_CATEGORY_REMAP[e.category];
        if (remappedField) {
          bucket[remappedField] += e.amount;
        } else {
          // Non-remapped Refund expenses (RefundCommission, tax, etc.) use normal mapping
          applyExpensesToBucket(bucket, [e]);
        }
      } else {
        // Non-Refund posted-date expenses (ServiceFee, Adjustment, etc.)
        applyExpensesToBucket(bucket, [e]);
      }
      postedDateExpenseCount++;
    } else {
      // No SKU — these are account-level expenses that the Finance API does not
      // attribute to any specific ASIN. Examples:
      //   - FBADisposal: disposal fees (per-ASIN data available in FBA Removal report)
      //   - FBAStorageBilling: storage fees (per-ASIN data in FBA Monthly Storage Fee report)
      //   - FBAPostInboundTransportation: inbound shipping
      //   - ProductAdsPayment: advertising lump sum (per-ASIN in Advertising API)
      //   - Subscription: professional seller subscription
      //   - Reserve/Adjustment: account reserves
      //
      // These go to DailyOverheadFinance. For per-ASIN breakdown of storage,
      // disposal, and advertising, the seller must connect the corresponding
      // Amazon reports (FBA Storage Fee report, FBA Removal report, Advertising API).
      // Guessing the ASIN would produce inaccurate data for multi-SKU sellers.
      overheadExpenses.push(e);
    }
  }
  if (postedDateExpenseCount > 0) {
    logger.debug(`[Step1] Placed ${postedDateExpenseCount} Refund/Reimbursement/ServiceFee expense rows on posted date (Pacific).`);
  }

  // ★ FIX: Same for posted-date revenue (e.g., negative Product Sales from Refund,
  // FBAInventoryReimbursement amounts)
  let postedDateRevenueCount = 0;
  let postedDateRevenueSkipped = 0;
  for (const r of postedDateRevenue) {
    const pacificDate = toMarketplaceDayKey(r.postedDate, country) || r.postedDateStr;
    if (!pacificDate) continue;
    if (pacificDate < startDate || pacificDate > endDate) {
      postedDateRevenueSkipped++;
      continue;
    }

    const sku = (r.sku && r.sku !== 'N/A') ? r.sku : null;
    const asin = r.asin || '';

    if (sku) {
      const bucketKey = `${sku}||${pacificDate}`;
      if (!skuBuckets.has(bucketKey)) skuBuckets.set(bucketKey, createEmptyBucket(sku, asin, pacificDate));
      const bucket = skuBuckets.get(bucketKey);
      if (!bucket.asin && asin) bucket.asin = asin;

      // ★ For Refund transactions, "Product Sales" is negative (money returned to buyer)
      // → goes to refundedAmount field, NOT productSales
      if (r.transactionType === 'Refund' && r.category === 'Product Sales') {
        bucket.refundedAmount += r.amount;
      } else {
        // FBAInventoryReimbursement, Shipping Revenue, etc.
        const fieldBefore = bucket.fbaInventoryReimbursement;
        applyRevenueTooBucket(bucket, [r]);
        const fieldAfter = bucket.fbaInventoryReimbursement;
        // ★ DEBUG: Log every reimbursement placement
        if (r.category === 'FBA Inventory Reimbursement') {
          logger.debug(`[REIMB-DEBUG] ${pacificDate} ${r.sku}: category='${r.category}' amt=${r.amount} txnType=${r.transactionType} field before=${fieldBefore} after=${fieldAfter}`);
        }
      }
      postedDateRevenueCount++;
    } else {
      overheadRevenue.push(r);
    }
  }
  if (postedDateRevenueCount > 0) {
    logger.debug(`[Step1] Placed ${postedDateRevenueCount} Refund/Reimbursement revenue rows on posted date (Pacific). Skipped ${postedDateRevenueSkipped} outside range. postedDateRevenue array size: ${postedDateRevenue.length}`);
  } else {
    logger.debug(`[Step1] postedDateRevenue: ${postedDateRevenue.length} rows total, ${postedDateRevenueSkipped} skipped (outside ${startDate}→${endDate}), 0 placed.`);
  }

  // Compute totals for all buckets
  for (const bucket of skuBuckets.values()) computeBucketTotals(bucket);

  // ★ DEBUG: Log buckets with non-zero fbaInventoryReimbursement
  for (const bucket of skuBuckets.values()) {
    if (bucket.fbaInventoryReimbursement !== 0) {
      logger.debug(`[REIMB-BUCKET] ${bucket.date} ${bucket.sku}: fbaInventoryReimbursement=${bucket.fbaInventoryReimbursement} totalRevenue=${bucket.totalRevenue}`);
    }
  }

  // ── Diagnostics ──
  let diagFbaTotal = 0;
  const diagFbaByDate = {};
  const diagCommByDate = {};
  const diagRefundByDate = {};
  for (const bucket of skuBuckets.values()) {
    diagFbaTotal += bucket.fbaFulfillmentFee || 0;
    if (!diagFbaByDate[bucket.date]) { diagFbaByDate[bucket.date] = 0; diagCommByDate[bucket.date] = 0; diagRefundByDate[bucket.date] = 0; }
    diagFbaByDate[bucket.date] += bucket.fbaFulfillmentFee || 0;
    diagCommByDate[bucket.date] += bucket.referralCommission || 0;
    diagRefundByDate[bucket.date] += (bucket.refundedAmount || 0) + (bucket.refundCommission || 0) + (bucket.refundedReferralFee || 0) + (bucket.refundedPromotion || 0);
  }
  logger.debug(`[DIAG] Total FBA Fulfillment across ${skuBuckets.size} SKU buckets: $${Math.round(diagFbaTotal * 100) / 100}`);
  logger.debug(`[DIAG] Finance API returned ${expenseRowCount} expense rows total`);
  // Per-date breakdown for verification against Sellerboard
  const diagDates = Object.keys(diagFbaByDate).sort();
  for (const d of diagDates) {
    logger.debug(`[DIAG] ${d}: FBA=${diagFbaByDate[d].toFixed(2)} Comm=${diagCommByDate[d].toFixed(2)} RefundCost=${diagRefundByDate[d].toFixed(2)}`);
  }

  // Build overhead
  const overheadBuckets = buildOverheadBuckets(overheadExpenses, overheadRevenue, startDate, endDate, country);

  // ── Persist ──
  // ★ CRITICAL SAFETY (data-loss fix): datesToClear is ONLY the dates for which
  //   this run actually produced fresh buckets — NEVER the bare requested range.
  //
  //   Why: re-fetching an OLD day (via the daily 14-day re-sync, the
  //   reconciliation sweep, or the deep re-sync) frequently returns an EMPTY or
  //   partial Sales Report, because Amazon's GET_FLAT_FILE_ALL_ORDERS_DATA_
  //   BY_ORDER_DATE report stops returning data for older order dates. The old
  //   logic cleared every day in the requested range and reinserted only what
  //   the report returned — so an empty/partial re-fetch of a settled day
  //   DELETED its previously-correct data and left it at $0. (This is what wiped
  //   May 28 repeatedly.)
  //
  //   By clearing only dates we have new data for:
  //     - A day with fresh orders → cleared + reinserted (corrections, incl.
  //       partial cancellations, still apply — that day still has a bucket).
  //     - A day the report returned nothing for → left exactly as it was; its
  //       existing good data is preserved. A re-fetch can never zero it.
  //   Trade-off: a day whose orders were ALL cancelled after the fact keeps its
  //   prior (stale) value instead of dropping to $0. That is rare and FAR less
  //   harmful than destroying confirmed historical data.
  const allDates = new Set();
  for (const b of skuBuckets.values()) allDates.add(b.date);
  for (const b of overheadBuckets.values()) allDates.add(b.date);

  // `endD` is still needed by the sync-log loop below.
  const endD = new Date(`${endDate}T00:00:00.000Z`);
  const salesReportEmpty = (reportRows.length === 0);
  if (salesReportEmpty || allDates.size === 0) {
    logger.warn(`[Step1] Sales Report produced no buckets for ${startDate}→${endDate} (reportRows=${reportRows.length}). Clearing nothing — existing data for these days is preserved (re-fetch of aged-out days must never zero them).`);
  }

  const saved = await persistDailyBuckets({ userId, country: country.toUpperCase(), regionModel, marketplaceId, skuBuckets, overheadBuckets, datesToClear: [...allDates] });

  // ── ★ FIX: Clear previously-pending orders that were resolved in this sync ──
  // Without this, Step 2 (backfillPendingExpenses) would find these same orders
  // still in PendingExpenseOrder, fetch their Finance API data AGAIN, and ADD
  // the fees on top of what Step 1 already wrote — causing double-counting.
  if (consumedOrderIds.size > 0) {
    const resolvedResult = await PendingExpenseOrder.deleteMany({
      User: userObjectId, country: country.toUpperCase(), region: regionModel,
      orderId: { $in: [...consumedOrderIds] },
    });
    if (resolvedResult.deletedCount > 0) {
      logger.info(`[Step1] Cleared ${resolvedResult.deletedCount} previously-pending orders now resolved.`);
    }
  }

  // ── Save NEW pending orders (only those with NO expenses found) ──
  // Unique index is (User, country, region, orderId) — one row per order.
  // Multiple SKUs in the same order are stored as the first SKU seen;
  // the backfill (Step 2) resolves all SKUs for the order anyway.
  if (pendingOrders.length > 0) {
    const pendingByKey = new Map();
    for (const po of pendingOrders) {
      const orderKey = po.orderId;
      // Keep the first SKU seen for this orderId (dedup by orderId, not orderId+sku)
      if (!pendingByKey.has(orderKey)) {
        pendingByKey.set(orderKey, { ...po, sku: po.sku || 'N/A' });
      }
    }
    for (const po of pendingByKey.values()) {
      // ── `firstSeenAt` and `attempts` are $setOnInsert, NOT $set ──
      // This used to pass the whole `po` object as the update, which Mongoose turns into a $set of
      // every field — including `attempts: 0` and `firstSeenAt: new Date()`. So every re-upsert of
      // an already-pending order reset its age to zero.
      //
      // Step 2's give-up test is `now - firstSeenAt > MAX_PENDING_AGE_DAYS (45)`. With a catch-up
      // looping every ~3h, `firstSeenAt` was refreshed ~8x/day and NO pending order could ever
      // reach 45 days — the queue became append-only. That is the direct cause of one account's
      // pending count going 7,124 -> 13,733 in a single day: not duplicate rows (the upsert is
      // keyed per order), but a total failure to ever drain.
      const { attempts: _ignoredAttempts, firstSeenAt: _ignoredFirstSeen, ...mutable } = po;
      await PendingExpenseOrder.updateOne(
        { User: po.User, country: po.country, region: po.region, orderId: po.orderId },
        {
          $set: mutable,
          $setOnInsert: { attempts: 0, firstSeenAt: new Date() },
        },
        { upsert: true }
      );
    }
    logger.info(`[Step1] Saved ${pendingByKey.size} pending expense orders.`);
  }

  // ── Log sync ──
  const dateList = [];
  const dd = new Date(`${startDate}T00:00:00.000Z`);
  while (dd <= endD) { dateList.push(formatDateUTC(dd)); dd.setUTCDate(dd.getUTCDate() + 1); }
  // "Today" must be in the SAME calendar as the day keys above, or the provisional age math
  // drifts by a day for marketplaces far from Pacific.
  const todayPacificStr = marketplaceTodayStr(country);
  // Stamped on each day's sync log so a day bucketed on the OLD hardcoded-Pacific calendar
  // (no value) is distinguishable from one bucketed marketplace-locally. See the field's comment
  // in FinanceSyncLogModel.js for why identifying them exactly — not by date range — matters.
  const bucketTimezone = getMarketplaceTimezone(country);
  for (const dateStr of dateList) {
    const hasFreshData = allDates.has(dateStr);
    const pendingForDay = pendingCountByDate.get(dateStr) || 0;
    const ageDays = Math.round((new Date(`${todayPacificStr}T00:00:00.000Z`) - new Date(`${dateStr}T00:00:00.000Z`)) / 86400000);

    if (hasFreshData) {
      // We fetched real data for this day → write/refresh its sync log.
      // Provisional only when the day still has Pending-status orders (empty
      // item-price) and is within the settle window — those re-settle later.
      const isProvisional = pendingForDay > 0 && ageDays <= PROVISIONAL_SETTLE_DAYS;
      await FinanceSyncLog.findOneAndUpdate(
        { User: userObjectId, country: country.toUpperCase(), region: regionModel, date: dateStr },
        { User: userObjectId, country: country.toUpperCase(), region: regionModel, marketplaceId, date: dateStr, fetchedAt: new Date(), status: 'success', provisional: isProvisional, pendingOrderCount: pendingForDay, expenseRowCount, revenueRowCount, skuCount: skuBuckets.size, error: '', consecutiveFailures: 0, nextRetryAfter: null, bucketTimezone, ...(syncRunId ? { syncRunId } : {}) },
        { upsert: true, new: true }
      );
    } else {
      // ★ No data returned for this day (empty/partial report — common when
      //   re-fetching aged-out old days). NEVER overwrite an existing log row:
      //   downgrading a good 'success' day to 'provisional' is exactly what made
      //   the reconciliation sweep re-flag (and the persist layer re-wipe) the
      //   same old day every tick. Use $setOnInsert so we ONLY create a row when
      //   this day has never been logged (a brand-new day with no data → mark
      //   provisional so a genuinely-missing RECENT day is still retried, bounded
      //   by the settle window). If a row already exists, it is left untouched.
      const provisionalForNew = ageDays <= PROVISIONAL_SETTLE_DAYS;
      await FinanceSyncLog.updateOne(
        { User: userObjectId, country: country.toUpperCase(), region: regionModel, date: dateStr },
        { $setOnInsert: { User: userObjectId, country: country.toUpperCase(), region: regionModel, marketplaceId, date: dateStr, fetchedAt: new Date(), status: 'success', provisional: provisionalForNew, pendingOrderCount: 0, expenseRowCount: 0, revenueRowCount: 0, skuCount: 0, error: '', bucketTimezone, ...(syncRunId ? { syncRunId } : {}) } },
        { upsert: true }
      );
    }
  }

  logger.info(`[Step1] Done. ${saved.skuDocCount} SKU docs. ${pendingOrders.length} pending.`);
  return { salesOrders: salesOrderMap.size, skuDocs: saved.skuDocCount, overheadDocs: saved.overheadDocCount, pendingOrders: pendingOrders.length, token: tokenManager.token, tokenManager, marketplaceId, baseUrl };
}

// ═══════════════════════════════════════════════
// STEP 2: BACKFILL PENDING EXPENSES
//
// ★ FIX: Only backfills SHIPMENT expenses (purchase-date type).
// Refunds/Reimbursements are already handled in Step 1 via
// posted-date placement and don't need order-ID-based backfill.
// ═══════════════════════════════════════════════
/**
 * Choose the date slice a sliced Step 2 run should search, newest-first.
 *
 * Pure and exported for exactly the reason `resolveSyncWindow` is: every real caller reaches it
 * through a DB read and an Amazon fetch, so a unit test is the only practical way to prove the
 * boundary arithmetic — and the boundary arithmetic is where the previously-rejected window cap went
 * wrong. See FinanceBackfillCursorModel for why slicing-with-a-cursor is not that bug.
 *
 * @param {object}      args
 * @param {object|null} args.cursor       persisted cursor, or null on the first ever run
 * @param {string}      args.windowStart  `min(purchasePacificDate) - settlementLag`, YYYY-MM-DD
 * @param {string}      args.windowEnd    today's upper bound, YYYY-MM-DD
 * @param {number}      args.sliceDays
 * @returns {{sliceStart: string, sliceEnd: string, startingNewPass: boolean, passComplete: boolean}}
 *   `passComplete` describes the slice being returned: true when it reaches windowStart, i.e. this
 *   run finishes the pass. Expiry is only permitted on such a run.
 */
function resolveStep2Slice({ cursor, windowStart, windowEnd, sliceDays }) {
  const span = Math.max(1, sliceDays);

  // Start a new pass when there is no cursor, when the previous pass finished, or when the stored
  // window no longer matches the live one (orders resolved, so `min(purchasePacificDate)` moved —
  // continuing against a stale boundary could leave a gap unsearched).
  const startingNewPass =
    !cursor ||
    !cursor.coveredUntil ||
    cursor.windowStart !== windowStart ||
    cursor.coveredUntil <= cursor.windowStart;

  const sliceEnd = startingNewPass ? windowEnd : cursor.coveredUntil;
  // Newest-first: walk backwards from the end, never past windowStart.
  const candidate = addDaysStr(sliceEnd, -span);
  const sliceStart = candidate < windowStart ? windowStart : candidate;

  return {
    sliceStart,
    sliceEnd,
    startingNewPass,
    passComplete: sliceStart <= windowStart,
  };
}

/**
 * @param {boolean} [allowExpiry=true] Whether this run may give up on orders older than
 *   MAX_PENDING_AGE_DAYS. Must be false on a sliced run that has not covered the whole window —
 *   a run that searched 1/8 of the range cannot conclude a fee does not exist.
 *
 * NOTE: `server/controllers/finance/FinanceDashboardController.js` used to hold a stale duplicate
 * of this function. That duplicate was deleted when day bucketing moved to marketplace-local, so
 * this is now the single implementation. That file is read handlers only.
 */
async function backfillPendingExpenses({ userId, country, regionModel, accessToken, refreshToken, clientId, clientSecret, tokenManager: inheritedTokenManager, allowExpiry = true, slicingEnabled = false }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const regionInternal = internalRegionFromModel(regionModel);

  const pendingOrders = await PendingExpenseOrder.find({
    User: userObjectId, country: country.toUpperCase(), region: regionModel,
  }).lean();

  if (pendingOrders.length === 0) {
    logger.info('[Step2] No pending expense orders. Skipping backfill.');
    return { resolved: 0, stillPending: 0, expired: 0, token: accessToken, tokenManager: inheritedTokenManager };
  }

  logger.info(`[Step2] Backfilling ${pendingOrders.length} pending orders...`);

  const pendingDates = pendingOrders.map((p) => p.purchasePacificDate).sort();
  const earliestPurchase = pendingDates[0];

  const buffer = SETTLEMENT_LAG[regionModel] || SETTLEMENT_LAG.NA;
  const finStart = new Date(`${earliestPurchase}T00:00:00.000Z`);
  finStart.setUTCDate(finStart.getUTCDate() - buffer.beforeDays);

  // Runs to NOW deliberately, and is NOT length-capped.
  //
  // Step 2 exists to find Shipment fees that posted LATER than the sync window that created the
  // pending row, so its forward reach cannot be shortened without defeating its purpose. An earlier
  // draft of this fix capped the span at N days from the oldest pending purchase date; that was
  // wrong and actively harmful — `finStart` is derived from `min(purchasePacificDate)` over the
  // REMAINING rows with no cursor, so a single stuck order (the codebase explicitly expects these:
  // see PROVISIONAL_SETTLE_DAYS / MAX_PENDING_AGE_DAYS) pins the window at its own date for up to 45
  // days. Every newer pending row then sits permanently outside the window, is never actually
  // searched for, and expires with its estimated fee never replaced by the actual — silent, and
  // reported as `resolved: 0` rather than as an error.
  //
  // Memory here is instead bounded by the streaming fold below: the raw transaction graph (by far
  // the largest tier, and what exhausted the heap) is no longer retained at all.
  //
  // ── SLICING (opt-in) ──
  // The paragraph above still holds for the DEFAULT path: unsliced, it runs to now, uncapped.
  // What it rules out is capping the window with NO MEMORY of what was covered. With the
  // FinanceBackfillCursor the window is not shortened, it is walked in slices newest-first and the
  // progress is recorded, so every part of it is still reached — just across several runs instead of
  // one multi-hour one. See FinanceBackfillCursorModel for the full argument.
  let finEnd = new Date(Date.now() - 3 * 60 * 1000); // API requires postedBefore > 2 min in the past
  let sliceInfo = null;
  let cursor = null;
  // Captured BEFORE finStart is mutated to the slice boundary below — the cursor must record the
  // whole pass window, not the slice.
  const windowStart = formatDateUTC(finStart);
  const windowEnd = formatDateUTC(finEnd);

  if (slicingEnabled) {
    cursor = await FinanceBackfillCursor.findOne({
      User: userObjectId, country: country.toUpperCase(), region: regionModel,
    }).lean();

    sliceInfo = resolveStep2Slice({ cursor, windowStart, windowEnd, sliceDays: FINANCE_STEP2_SLICE_DAYS });

    // Re-point the fetch at just this slice. `finStart` is a Date used below, so mutate it to match.
    finStart.setTime(new Date(`${sliceInfo.sliceStart}T00:00:00.000Z`).getTime());
    // Keep the live `now - 3min` when the slice ends today, so the most recent minutes are not
    // skipped; otherwise clamp to the slice's own boundary.
    if (sliceInfo.sliceEnd < windowEnd) {
      finEnd = new Date(`${sliceInfo.sliceEnd}T23:59:59.999Z`);
    }

    // A run that has only searched part of the window cannot conclude a fee does not exist, so it
    // must not expire anything. Only the run that closes the pass may.
    allowExpiry = allowExpiry && sliceInfo.passComplete;
  }

  const finSpanDays = Math.max(1, Math.round((finEnd - finStart) / 86400000));

  const tokenManager = inheritedTokenManager || createTokenManager({ accessToken, refreshToken, clientId, clientSecret });

  logger.info(
    `[Step2] Finance API: ${finStart.toISOString()} → ${finEnd.toISOString()} (${finSpanDays}d, ${pendingOrders.length} pending orders)` +
    (sliceInfo
      ? ` [slice ${sliceInfo.sliceStart}→${sliceInfo.sliceEnd}${sliceInfo.startingNewPass ? ', new pass' : ''}${sliceInfo.passComplete ? ', completes pass' : ''}]`
      : '')
  );

  // Stream and fold, same as Step 1 — nothing raw is retained.
  const step2StartedAt = Date.now();
  let financeIndex = null;
  let expenseRowCount = 0;
  let revenueRowCount = 0;

  // Only these orders' rows are of any use here — Step 2 reads nothing but the four order-keyed
  // lookups below. Discarding the rest as it arrives is what keeps memory proportional to the
  // pending-order count rather than to the (necessarily wide) window.
  const pendingOrderIds = new Set(pendingOrders.map((p) => p.orderId).filter(Boolean));

  await tokenManager.withRetry(async (token) => {
    // Fresh per attempt: withRetry re-runs this whole function, so a shared index would double-fold.
    financeIndex = createFinanceIndex({ orderIdFilter: pendingOrderIds });
    expenseRowCount = 0;
    revenueRowCount = 0;

    return fetchNewFinanceData({
      refreshToken, accessToken: token, clientId, clientSecret,
      country: country.toUpperCase(), region: regionInternal,
      postedAfter: finStart.toISOString(), postedBefore: finEnd.toISOString(),
      tokenRefresher: () => tokenManager.refresh(),
      onRows: (pageExpenses, pageRevenue) => {
        expenseRowCount += pageExpenses.length;
        revenueRowCount += pageRevenue.length;
        addFinanceRowsToIndex(financeIndex, pageExpenses, pageRevenue);
      },
    });
  });
  logFinanceIndexDedup(financeIndex);

  logger.info(
    `[Step2] Finance API done: ${expenseRowCount} expense / ${revenueRowCount} revenue rows seen over ` +
    `${finSpanDays}d, ${financeIndex.filteredOutCount} discarded as unrelated to the ` +
    `${pendingOrderIds.size} pending orders, in ${Date.now() - step2StartedAt}ms, ` +
    `heapUsed ${Math.round(process.memoryUsage().heapUsed / 1048576)}MB`
  );

  // ★ Index separates by transaction type; built incrementally by the fold above.
  const { expensesByOrderSku, unattributedExpensesByOrder, revenueByOrderSku, unattributedRevenueByOrder } = financeIndex;

  let resolved = 0, stillPending = 0, expired = 0;
  const expiredOrderIds = [];
  const datesToUpdate = new Map();
  // Which pending orderIds fed each (date, SKU) bucket. Needed because an order is now only
  // removed from the queue once ITS bucket's write has actually landed — see the persist loop.
  const orderIdsByDateSku = new Map();

  const now = new Date();

  for (const pending of pendingOrders) {
    const sku = pending.sku || 'N/A';
    const expKey = `${pending.orderId}||${sku}`;
    // ★ Only looks at Shipment-type expenses (purchase-date rows)
    const skuExpenses = expensesByOrderSku.get(expKey);
    const unattribExpenses = unattributedExpensesByOrder.get(pending.orderId);
    const hasExpenses = (skuExpenses && skuExpenses.length > 0) || (unattribExpenses && unattribExpenses.length > 0);

    if (hasExpenses) {
      const dateKey = pending.purchasePacificDate;
      if (!datesToUpdate.has(dateKey)) datesToUpdate.set(dateKey, new Map());
      const skuMap = datesToUpdate.get(dateKey);
      if (!skuMap.has(sku)) skuMap.set(sku, { expenses: [], revenues: [] });
      if (skuExpenses) skuMap.get(sku).expenses.push(...skuExpenses);
      if (unattribExpenses) {
        skuMap.get(sku).expenses.push(...unattribExpenses);
        unattributedExpensesByOrder.delete(pending.orderId);
      }

      const revKey = `${pending.orderId}||${sku}`;
      const skuRevenue = revenueByOrderSku.get(revKey);
      if (skuRevenue) skuMap.get(sku).revenues.push(...skuRevenue);
      const unattribRevenue = unattributedRevenueByOrder.get(pending.orderId);
      if (unattribRevenue) {
        skuMap.get(sku).revenues.push(...unattribRevenue);
        unattributedRevenueByOrder.delete(pending.orderId);
      }

      // NOT counted as resolved yet, and NOT queued for deletion yet. Both happen in the persist
      // loop, once this bucket's DailySkuFinance write succeeds.
      const dsKey = `${dateKey}||${sku}`;
      if (!orderIdsByDateSku.has(dsKey)) orderIdsByDateSku.set(dsKey, []);
      orderIdsByDateSku.get(dsKey).push(pending.orderId);
    } else {
      // ── FIX: expiry is checked HERE, after the fee lookup, not before it ──
      // It used to be the first thing in this loop, which meant an order turning 46 days old on the
      // very run its fees finally arrived was expired and its ACTUAL fees thrown away — the
      // estimate then stood permanently, with the queue row gone so nothing could ever correct it.
      // Only give up on an order we genuinely could not resolve.
      //
      // `allowExpiry` is false on a sliced run that has not yet covered the whole window: a run
      // that only searched 1/8 of the range has no business concluding a fee does not exist.
      const ageDays = (now.getTime() - new Date(pending.firstSeenAt).getTime()) / (24 * 60 * 60 * 1000);
      if (allowExpiry && ageDays > MAX_PENDING_AGE_DAYS) {
        expired++;
        expiredOrderIds.push(pending.orderId);
        continue;
      }

      stillPending++;
      await PendingExpenseOrder.updateOne(
        { _id: pending._id },
        { $inc: { attempts: 1 } }
      );
    }
  }

  // ── Update DailySkuFinance for resolved orders ──
  // When Step 1 estimated fees for pending orders, the exact estimated amounts
  // are stored in estimatedFba/estimatedCommission. We subtract those precise
  // values and add actual fees from the Finance API. No rate recalculation needed.

  // Aggregated instead of logged per row — see the notes at each call site below.
  const missingDailyRows = [];
  let reversedEstimateCount = 0;

  for (const [dateKey, skuMap] of datesToUpdate) {
    for (const [sku, { expenses, revenues }] of skuMap) {
      const existing = await DailySkuFinance.findOne({
        User: userObjectId, country: country.toUpperCase(), region: regionModel,
        sku, date: dateKey,
      });

      if (!existing) {
        // Counted, not logged per row. This fires once per (date, SKU) pair and a large account has
        // thousands — enough `warn` output to feed the PM2 daemon's buffer, which is what OOM-killed
        // the box. The aggregate is reported once after the loop, which is more useful anyway: a
        // count tells you the scale of the mismatch, whereas 3,000 identical lines do not.
        //
        // ── FIX: the order STAYS QUEUED ──
        // It used to be added to the delete list before this check ran, so an order whose
        // DailySkuFinance row was missing left the queue with its fees never written — silent,
        // permanent loss, surfaced only as an aggregate count. Leaving it queued means its
        // `attempts` keeps rising and a later run (after Step 1 has created the row) can apply it.
        missingDailyRows.push(`${dateKey}/${sku}`);
        continue;
      }

      const update = {};

      // Reverse stored estimates (precise, no rounding drift)
      if (existing.isEstimated && existing.estimatedFba) {
        update.fbaFulfillmentFee = (existing.fbaFulfillmentFee || 0) - (existing.estimatedFba || 0);
        update.referralCommission = (existing.referralCommission || 0) - (existing.estimatedCommission || 0);
        update.isEstimated = false;
        update.estimatedOrderCount = 0;
        update.estimatedFba = 0;
        update.estimatedCommission = 0;
        // debug, not info: one line per resolved (date, SKU) pair reaches the thousands on a large
        // account. The count is reported once after the loop; the per-row detail stays available at
        // debug for anyone actually reconciling a specific SKU.
        reversedEstimateCount++;
        logger.debug(`[Step2] Reversed estimates for ${sku} on ${dateKey}: FBA=${existing.estimatedFba}, Comm=${existing.estimatedCommission}`);
      }

      // Add actual fees from Finance API
      for (const e of expenses) {
        const field = EXPENSE_CATEGORY_TO_FIELD[e.category];
        if (field) {
          update[field] = (update[field] ?? existing[field] ?? 0) + e.amount;
        } else {
          update.otherExpenses = (update.otherExpenses ?? existing.otherExpenses ?? 0) + e.amount;
        }
      }

      for (const r of revenues) {
        const field = REVENUE_CATEGORY_TO_FIELD[r.category];
        if (field) {
          update[field] = (update[field] || existing[field] || 0) + r.amount;
        }
      }

      const merged = { ...existing.toObject(), ...update };
      update.totalRevenue = Math.round((merged.productSales + (merged.shippingRevenue || 0) + (merged.giftWrapRevenue || 0) + (merged.fbaInventoryReimbursement || 0)) * 100) / 100;
      update.totalExpenses = Math.round(((merged.fbaFulfillmentFee || 0) + (merged.referralCommission || 0) + (merged.closingFee || 0) + (merged.technologyFee || 0) + (merged.shippingChargeback || 0) + (merged.giftWrapChargeback || 0) + (merged.refundCommission || 0) + (merged.refundedAmount || 0) + (merged.refundedReferralFee || 0) + (merged.refundedPromotion || 0) + (merged.restockingFee || 0) + (merged.promotionsDiscount || 0) + (merged.shippingDiscount || 0) + (merged.taxDiscount || 0) + (merged.shippingTaxDiscount || 0) + (merged.fbaReversedReimbursement || 0) + (merged.fbaDisposalFee || 0) + (merged.otherExpenses || 0)) * 100) / 100;
      update.totalTax = Math.round(((merged.salesTaxCollected || 0) + (merged.shippingTaxCollected || 0) + (merged.giftWrapTaxCollected || 0) + (merged.marketplaceFacilitatorTax || 0) + (merged.tdsDeducted || 0) + (merged.tcsCollected || 0)) * 100) / 100;
      update.netAmount = Math.round((update.totalRevenue + update.totalExpenses + update.totalTax) * 100) / 100;

      // ── FIX: delete this bucket's queue rows BEFORE writing its fees ──
      // The fee application above is a read-modify-write accumulate (`existing[field] + amount`)
      // while the estimate reversal is self-clearing. The old code wrote every bucket and then
      // issued ONE deleteMany at the very end of the run, so a crash in between left the queue rows
      // alive with `isEstimated` already false — and the next run added the actual fees a SECOND
      // time without subtracting the estimate again. Permanently overstated, unflagged, and
      // undetectable after the fact.
      //
      // Ordering the delete first inverts the failure mode: a crash now loses one bucket's actual
      // fees and leaves the estimate standing, which a later resync can recreate and correct.
      // Losing a fee is recoverable; silently doubling one is not. Scope is one (date, SKU) row
      // rather than the whole run.
      const bucketOrderIds = orderIdsByDateSku.get(`${dateKey}||${sku}`) || [];
      if (bucketOrderIds.length > 0) {
        await PendingExpenseOrder.deleteMany({
          User: userObjectId, country: country.toUpperCase(), region: regionModel,
          orderId: { $in: bucketOrderIds },
        });
      }

      await DailySkuFinance.updateOne({ _id: existing._id }, { $set: update });

      // Only now is the order genuinely resolved.
      resolved += bucketOrderIds.length;
    }
  }

  // ── Aggregated diagnostics, replacing what used to be one line per (date, SKU) ──
  if (reversedEstimateCount > 0) {
    logger.info(`[Step2] Reversed estimated fees on ${reversedEstimateCount} SKU-day row(s) (per-row detail at debug).`);
  }
  if (missingDailyRows.length > 0) {
    // A sample rather than the full list: the point is "how many and roughly which", and printing
    // thousands of identifiers is the behaviour being removed.
    logger.warn(
      `[Step2] ${missingDailyRows.length} SKU-day row(s) had no DailySkuFinance record and were skipped. ` +
      `First few: ${missingDailyRows.slice(0, 5).join(', ')}${missingDailyRows.length > 5 ? ', …' : ''}`
    );
  }

  // ── Remove expired pending orders ──
  // Resolved orders are already gone: each was deleted alongside its own bucket's write above, so
  // that a crash cannot leave a resolved row behind for a later run to double-apply. Only the
  // give-up cases remain to be cleared here, and their estimate stays in place by design.
  if (expiredOrderIds.length > 0) {
    await PendingExpenseOrder.deleteMany({
      User: userObjectId, country: country.toUpperCase(), region: regionModel,
      orderId: { $in: expiredOrderIds },
    });
  }

  // ── Advance the cursor, AFTER every write above has landed ──
  // Ordering matters: if this ran first and the process then died, the slice would be recorded as
  // covered while its fees were never applied — and nothing would ever look at that date range
  // again this pass. Writing it last means an interrupted slice is simply re-walked, which the
  // per-bucket delete-then-write above makes safe.
  if (slicingEnabled && sliceInfo) {
    // A new pass RESETS the per-pass counters; a continuing pass increments them. Two shapes rather
    // than one clever expression, because getting this wrong makes the observability lie about
    // whether the backlog is actually draining.
    const set = {
      windowStart,
      windowEnd: sliceInfo.startingNewPass ? windowEnd : (cursor && cursor.windowEnd) || windowEnd,
      coveredUntil: sliceInfo.sliceStart,
      lastRunAt: new Date(),
      claimedUntil: null,
    };
    const update = sliceInfo.startingNewPass
      ? {
        $set: { ...set, passStartedAt: new Date(), slicesDone: 1, resolvedThisPass: resolved },
        $inc: { passesCompleted: sliceInfo.passComplete ? 1 : 0 },
      }
      : {
        $set: set,
        $inc: { slicesDone: 1, resolvedThisPass: resolved, passesCompleted: sliceInfo.passComplete ? 1 : 0 },
        $setOnInsert: { passStartedAt: new Date() },
      };

    await FinanceBackfillCursor.updateOne(
      { User: userObjectId, country: country.toUpperCase(), region: regionModel },
      update,
      { upsert: true }
    );
    logger.info(
      `[Step2] Slice done: covered back to ${sliceInfo.sliceStart}` +
      (sliceInfo.passComplete
        ? ` — pass COMPLETE (window ${windowStart}); next run starts a fresh pass.`
        : ` — ${sliceInfo.sliceStart} > ${windowStart}, more slices remain.`)
    );
  }

  logger.info(`[Step2] Done. Resolved: ${resolved}, Still pending: ${stillPending}, Expired: ${expired}`);
  return {
    resolved, stillPending, expired,
    token: tokenManager.token, tokenManager,
    ...(sliceInfo ? { slice: { ...sliceInfo, pendingRemaining: stillPending } } : {}),
  };
}

// ═══════════════════════════════════════════════
// MAIN: SYNC FINANCE DATA
// ═══════════════════════════════════════════════
async function syncFinanceData({ userId, country, regionModel, refreshToken, accessToken, clientId = process.env.SPAPI_CLIENT_ID, clientSecret = process.env.SPAPI_CLIENT_SECRET, backfillDays = 30, forceDates = null, maxIncrementalDays = null, resyncDays = 0 }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  // One token manager for the whole sync — step1/step2/relationships share
  // a single lifetime, so a mid-sync refresh in any phase is visible to the
  // next phase without re-issuing tokens.
  const tokenManager = createTokenManager({ accessToken, refreshToken, clientId, clientSecret });

  const now = new Date();
  // Newest day Amazon has complete data for, in the MARKETPLACE's calendar — must match the
  // calendar the day keys are written in, or the sync window can skip or re-fetch a day.
  const yesterdayStr = marketplaceYesterdayStr(country, now);

  // Cursor = latest SETTLED (non-provisional) success day. Provisional days
  // (empty report / still-Pending orders) deliberately fall back inside the
  // incremental window so they get re-fetched until they settle. Pre-existing
  // rows have `provisional` undefined → `{ $ne: true }` treats them as settled,
  // so behaviour for already-synced accounts is unchanged on deploy.
  let latestSyncDate = null;
  if (!(forceDates && forceDates.length === 2)) {
    const latestSync = await FinanceSyncLog.findOne({ User: userObjectId, country: country.toUpperCase(), region: regionModel, status: 'success', provisional: { $ne: true } }).sort({ date: -1 }).lean();
    latestSyncDate = latestSync ? latestSync.date : null;
  }

  const window = resolveSyncWindow({
    yesterdayStr,
    latestSyncDate,
    backfillDays,
    maxIncrementalDays,
    resyncDays,
    forceDates,
  });

  if (window.mode === 'up_to_date') {
    logger.info(`[Sync] ${window.note}`);
    const step2 = await backfillPendingExpenses({ userId, country, regionModel, accessToken, refreshToken, clientId, clientSecret, tokenManager, slicingEnabled: financeStep2SlicingEnabledFor(userId) });
    await syncRelationshipsIfNeeded({ userId, country, regionModel, startDate: latestSyncDate, endDate: latestSyncDate, accessToken: tokenManager.token, refreshToken, clientId, clientSecret });
    return { status: 'up_to_date', latestDate: latestSyncDate, backfill: step2 };
  }

  const { startDate, endDate } = window;
  logger.info(`[Sync] ${window.note}`);

  // ─── Chunked fetch ────────────────────────────────────────────────────────────
  // One Amazon report per chunk instead of one for the whole window. A 30-day report for a
  // high-volume seller never completes inside the poll cap, so the old single-report path
  // threw before downloading anything, wrote `failed` for every date, and left the cursor
  // unmoved — the same 30 days were requested forever. Chunks complete, so the cursor advances
  // and progress is durable across runs.
  //
  // For a healthy account synced yesterday the window is 1 day → exactly one chunk → identical
  // behaviour to before. Chunking only engages on a backlog (or the resyncDays window).
  const chunks = enumerateDateChunks(startDate, endDate, FINANCE_REPORT_CHUNK_DAYS);
  // An inverted or malformed range yields no chunks. Fail loudly instead of returning
  // `status: 'completed'` having fetched nothing — a silent success here would look identical to a
  // healthy sync while writing no data and no FinanceSyncLog rows at all.
  if (chunks.length === 0) {
    throw new Error(`[Sync] Refusing to sync an invalid window: ${startDate} → ${endDate}`);
  }

  let chunksCompleted = 0;
  let stopReason = null;

  try {
    const loop = await runChunkedFetch({
      chunks,
      budgetMs: FINANCE_SYNC_RUN_BUDGET_MS,
      heapLimitBytes: FINANCE_HEAP_LIMIT_MB * 1024 * 1024,
      fetchChunk: (chunk, index) => {
        if (chunks.length > 1) {
          logger.info(`[Sync] Chunk ${index + 1}/${chunks.length}: ${chunk.startDate} → ${chunk.endDate}`);
        }
        return fetchNewSalesAndExpenses({ userId, country, regionModel, startDate: chunk.startDate, endDate: chunk.endDate, accessToken, refreshToken, clientId, clientSecret, tokenManager });
      },
      // Lets the walk step over a chunk that is already abandoned, instead of aborting the run and
      // starving every chunk behind it (see runChunkedFetch's docblock). Fails closed, so a
      // first-time backfill — where no date has a FinanceSyncLog row yet — can never skip.
      classifySkip: (chunk) => classifyChunkSkip({
        userObjectId,
        country,
        region: regionModel,
        from: chunk.startDate,
        to: chunk.endDate,
      }),
    });

    chunksCompleted = loop.chunksCompleted;
    stopReason = loop.stopReason;
    if (stopReason === 'budget') {
      logger.warn(
        `[Sync] Run budget exhausted after ${chunksCompleted}/${chunks.length} chunks; ` +
        `remaining days resume next run (cursor has advanced).`
      );
    } else if (stopReason === 'memory') {
      logger.warn(
        `[Sync] Stopped on the heap guard after ${chunksCompleted}/${chunks.length} chunks ` +
        `(heapUsed ${Math.round(process.memoryUsage().heapUsed / 1048576)}MB, limit ` +
        `${FINANCE_HEAP_LIMIT_MB}MB); remaining days resume next run (cursor has advanced).`
      );
    }

    // A skip must never be silent — the whole reason the original loop bug went unnoticed for a day
    // was a failure nothing could see. `capped` and `already_success` have very different
    // consequences, so name them separately rather than reporting a bare count.
    if (loop.skippedChunks && loop.skippedChunks.length) {
      const capped = loop.skippedChunks.filter((s) => s.reason === 'capped');
      const redundant = loop.skippedChunks.filter((s) => s.reason !== 'capped');
      if (capped.length) {
        logger.warn(
          `[Sync] SKIPPED ${capped.length} chunk(s) whose dates have all burned ` +
          `${FINANCE_MAX_DATE_RETRIES} retries, so later chunks were not starved: ` +
          `${capped.map((s) => `${s.chunk.startDate}→${s.chunk.endDate}`).join(', ')}. ` +
          `Those days are GIVEN UP ON and keep their estimated/absent fees — see ` +
          `diagnoseDailySchedule section 8, and reset consecutiveFailures once the cause is fixed. ` +
          `Newest cause: ${capped[capped.length - 1].error}`
        );
      }
      if (redundant.length) {
        logger.warn(
          `[Sync] Stepped over ${redundant.length} already-successful chunk(s) whose report failed ` +
          `(nothing lost — those dates already hold data): ` +
          `${redundant.map((s) => `${s.chunk.startDate}→${s.chunk.endDate}`).join(', ')}.`
        );
      }
    }

    const step1 = loop.aggregate;
    const step2 = await backfillPendingExpenses({ userId, country, regionModel, accessToken: tokenManager.token, refreshToken, clientId, clientSecret, tokenManager, slicingEnabled: financeStep2SlicingEnabledFor(userId) });
    await syncRelationshipsIfNeeded({ userId, country, regionModel, startDate, endDate, accessToken: tokenManager.token, refreshToken, clientId, clientSecret });

    return {
      status: 'completed', startDate, endDate,
      step1: { salesOrders: step1.salesOrders, skuDocs: step1.skuDocs, overheadDocs: step1.overheadDocs, pendingOrders: step1.pendingOrders },
      step2: { resolved: step2.resolved, stillPending: step2.stillPending, expired: step2.expired },
      // Additive detail — callers that only read status/step1/step2 are unaffected.
      chunksTotal: chunks.length,
      chunksCompleted,
      stopReason,
      skippedChunks: loop.skippedChunks || [],
    };
  } catch (err) {
    // Write a 'failed' sync log so failures are visible in the database.
    // Only write 'failed' for dates that don't already have a 'success' entry —
    // avoids overwriting good data when a resync attempt fails.
    //
    // Scope the failure to the chunk that actually failed. Marking the whole window would
    // stamp `failed` on days that were never attempted (and, once chunking is on, on days an
    // EARLIER chunk had just succeeded at — the `$ne: 'success'` filter protects those rows,
    // but the un-attempted ones would still be misreported).
    const failedChunk = err.failedChunk || null;
    const failedFrom = failedChunk ? failedChunk.startDate : startDate;
    const failedTo = failedChunk ? failedChunk.endDate : endDate;
    if (typeof err.chunksCompletedBeforeFailure === 'number') {
      chunksCompleted = err.chunksCompletedBeforeFailure;
    }

    const errorKind = classifySyncFailure(err);
    if (errorKind === 'auth_denied') {
      logger.error(`[Sync] SP-API AUTHORIZATION DENIED for ${country}-${regionModel} (user ${userId}) — the account must RE-AUTHORIZE; finance cannot be fetched until it reconnects. Window ${failedFrom}→${failedTo}.`);
    }
    // Name any chunks stepped over on the way here, or this reads as a plain stop at chunk N and
    // hides that earlier windows were abandoned in the same run.
    const skippedNote = err.skippedChunks && err.skippedChunks.length
      ? ` (after SKIPPING ${err.skippedChunks.length} abandoned chunk(s): ${err.skippedChunks.map((s) => `${s.chunk.startDate}→${s.chunk.endDate}[${s.reason}]`).join(', ')})`
      : '';
    logger.error(
      `[Sync] Finance sync failed for ${country}-${regionModel} (kind=${errorKind}) on ` +
      `${failedFrom}→${failedTo} after ${chunksCompleted}/${chunks.length} chunk(s)${skippedNote}: ${err.message}`,
      { userId, startDate, endDate, failedFrom, failedTo, errorKind, skippedChunks: err.skippedChunks || [], stack: err.stack }
    );
    try {
      await recordSyncFailure({
        FinanceSyncLogModel: FinanceSyncLog,
        userObjectId,
        country,
        region: regionModel,
        from: failedFrom,
        to: failedTo,
        err,
        errorKind,
      });
    } catch (logErr) {
      logger.error(`[Sync] Failed to write error sync log: ${logErr.message}`);
    }
    throw err;
  }
}

async function syncRelationshipsIfNeeded({ userId, country, regionModel, startDate, endDate, accessToken, refreshToken, clientId, clientSecret }) {
  try {
    const { syncAsinRelationships } = require('./AsinRelationshipService.js');
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const recentAsins = await DailySkuFinance.distinct('asin', { User: userObjectId, country: country.toUpperCase(), region: regionModel, date: { $gte: startDate, $lte: endDate }, asin: { $ne: '' } });
    if (recentAsins.length > 0) {
      logger.info(`[Sync] Syncing relationships for ${recentAsins.length} ASINs...`);
      await syncAsinRelationships({ userId, country, regionModel, asins: recentAsins, accessToken, refreshToken, clientId, clientSecret });
    }
  } catch (err) {
    logger.error(`[Sync] Relationship sync failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════
// QUERY: Sync status
// ═══════════════════════════════════════════════
async function getSyncStatus({ userId, country, regionModel }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const match = { User: userObjectId, country: country.toUpperCase(), region: regionModel };

  const [syncResult] = await FinanceSyncLog.aggregate([
    { $match: { ...match, status: 'success' } },
    { $group: { _id: null, latestDate: { $max: '$date' }, earliestDate: { $min: '$date' }, totalSyncedDays: { $sum: 1 } } },
    { $project: { _id: 0 } },
  ]);

  const pendingCount = await PendingExpenseOrder.countDocuments(match);

  return {
    latestDate: syncResult?.latestDate || null,
    earliestDate: syncResult?.earliestDate || null,
    totalSyncedDays: syncResult?.totalSyncedDays || 0,
    pendingExpenseOrders: pendingCount,
  };
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
// ═══════════════════════════════════════════════
// ASYNC ADAPTER — the same Sales Report, fetched without holding a worker
//
// The inline path polls Amazon in a loop and gives up after FINANCE_REPORT_MAX_POLL_ATTEMPTS.
// When Amazon parks a report at IN_QUEUE for 30+ minutes (which is what blocked 28 July for
// account 6a57b823571ceb9266953c30) that loop abandons the report and the next run submits a
// NEW one — piling onto the same per-seller queue and making the next attempt worse.
//
// This adapter plugs the same report into asyncReportEngine: submit, persist the reportId,
// release the worker, re-check on a delayed job. A report that sits queued for hours becomes a
// non-event instead of a failure, and is never abandoned or duplicated.
//
// It deliberately owns NO fetch/parse/persist logic — submit, download and process are the very
// functions the inline path calls, so the two paths write identical data by construction.
// ═══════════════════════════════════════════════

/** Every YYYY-MM-DD from `from` to `to`, inclusive. */
function enumerateDatesInclusive(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (d <= end) { out.push(formatDateUTC(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

/**
 * The cursor read + window resolution + chunk enumeration that `syncFinanceData` does inline,
 * as one callable step.
 *
 * The async phase calls this EXACTLY ONCE, on its first tick, and freezes the result in
 * phaseData. It must never be re-run on a poll tick: `yesterdayStr` is derived from `now`, so a
 * tick that crosses Pacific midnight would shift the window, `enumerateDateChunks` would
 * re-anchor, the chunk's `paramsKey` would change, and the persisted engine row would no longer
 * match any spec — the engine skips unmatched rows, so the phase would reschedule forever.
 * A concurrent catch-up run moving the cursor has the same effect.
 *
 * @returns {{window: object, chunks: Array, latestSyncDate: string|null, yesterdayStr: string}}
 */
async function planFinanceSync({
  userId, country, regionModel,
  backfillDays = 30, forceDates = null, maxIncrementalDays = null, resyncDays = 0,
  chunkDays = FINANCE_REPORT_CHUNK_DAYS,
}) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  // Marketplace-local, matching syncFinanceData — see the docblock note above about a shifting
  // yesterdayStr re-anchoring chunks and changing paramsKey.
  const yesterdayStr = marketplaceYesterdayStr(country);

  let latestSyncDate = null;
  if (!(forceDates && forceDates.length === 2)) {
    const latestSync = await FinanceSyncLog.findOne({
      User: userObjectId, country: country.toUpperCase(), region: regionModel,
      status: 'success', provisional: { $ne: true },
    }).sort({ date: -1 }).lean();
    latestSyncDate = latestSync ? latestSync.date : null;
  }

  const window = resolveSyncWindow({ yesterdayStr, latestSyncDate, backfillDays, maxIncrementalDays, resyncDays, forceDates });
  const chunks = window.mode === 'up_to_date'
    ? []
    : enumerateDateChunks(window.startDate, window.endDate, chunkDays);
  return { window, chunks, latestSyncDate, yesterdayStr };
}

/**
 * The once-per-sync tail: Step 2 (convert estimated fees to actuals) then ASIN relationships.
 *
 * Extracted so the async phase runs the SAME tail as `syncFinanceData`, on its last tick only.
 * Running it per chunk would re-walk every pending order each time for no benefit.
 */
async function runFinanceSyncTail({ userId, country, regionModel, startDate, endDate, refreshToken, clientId, clientSecret, tokenManager }) {
  const step2 = await backfillPendingExpenses({ userId, country, regionModel, accessToken: tokenManager.token, refreshToken, clientId, clientSecret, tokenManager, slicingEnabled: financeStep2SlicingEnabledFor(userId) });
  await syncRelationshipsIfNeeded({ userId, country, regionModel, startDate, endDate, accessToken: tokenManager.token, refreshToken, clientId, clientSecret });
  return step2;
}

const financeSalesReportAsync = {
  serviceName: 'financeSalesReport',

  /**
   * ONE spec, for ONE chunk. The phase walks chunks oldest-first with a single chunk in flight,
   * because the cursor is `max(FinanceSyncLog.date …)` — if a later chunk landed before an
   * earlier one failed, the cursor would jump the gap and strand those days at $0 forever.
   *
   * `chunk` MUST come from a window frozen at submit time. Recomputing it on a poll tick that
   * crosses marketplace midnight would shift the dates, change `paramsKey`, leave the persisted
   * row with no matching spec, and make the engine skip it — rescheduling forever.
   */
  buildSpecs({ userId, country, regionModel, tokenManager, chunk }) {
    const regionInternal = internalRegionFromModel(regionModel);
    const { baseUrl, marketplaceId } = resolveMarketplaceAndRegion(country.toUpperCase(), regionInternal);
    // Same country-aware window as the inline path, so both request byte-identical bytes.
    const { salesStartISO, salesEndISO } = salesReportWindowISO(chunk.startDate, chunk.endDate, country);
    const paramsKey = `${chunk.startDate}_${chunk.endDate}`;
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    return [{
      service: 'financeSalesReport',
      paramsKey,
      // Persisted so a later tick can reconstruct the window without recomputing it. Tokens are
      // NEVER stored here — `tokenManager` is captured in the closure, which lives only for
      // this tick.
      params: { startDate: chunk.startDate, endDate: chunk.endDate },
      marketplaceId,

      submit: () => submitSalesReport(tokenManager, baseUrl, marketplaceId, salesStartISO, salesEndISO),

      checkStatusOnce: async (reportId) =>
        checkSpApiStatusOnce(await tokenManager.getValidToken(), reportId, baseUrl),

      finalize: async (handle, row) => {
        const syncRunId = String(row._id);
        const dates = enumerateDatesInclusive(chunk.startDate, chunk.endDate);

        // ── Idempotency guard — must run BEFORE any write ──
        // The engine will not re-enter finalize, but a BullMQ retry of the whole job can, if the
        // worker died between the writes below and the row's status:'DONE'. Re-running after
        // backfillPendingExpenses has converted this chunk's ESTIMATED fees into actuals would
        // delete-and-reinsert the estimates and silently lose the actual fees. If every date in
        // the chunk already carries this run's id, the work is done.
        const alreadyWritten = await FinanceSyncLog.countDocuments({
          User: userObjectId, country: country.toUpperCase(), region: regionModel,
          date: { $in: dates }, syncRunId,
        });
        if (alreadyWritten >= dates.length) {
          logger.warn(`[FinanceAsync] finalize re-entered for ${paramsKey}; already written by run ${syncRunId} — skipping`);
          return { empty: false, result: { skipped: true } };
        }

        // DONE_NO_DATA carries no document id — Amazon's way of saying "this window has no
        // orders". There is nothing to download, but we still process, because the empty-rows
        // path is what writes the sync-log rows that ADVANCE THE CURSOR. Skipping it would
        // leave the chunk unlogged and retried forever.
        const reportRows = handle && handle.reportDocumentId
          ? (await downloadSalesReportRows(tokenManager, baseUrl, handle.reportDocumentId, paramsKey)).rows
          : [];

        const stats = await processSalesReportRows({
          userId, country, regionModel,
          startDate: chunk.startDate, endDate: chunk.endDate,
          reportRows, tokenManager, syncRunId,
        });

        // `empty` marks the row NO_DATA so the phase can allow exactly one re-submit. The data
        // has still been processed above either way.
        //
        // Copy fields explicitly: `stats` carries `token` and a live `tokenManager`, and this
        // object is persisted to Mongo.
        return {
          empty: reportRows.length === 0,
          result: {
            salesOrders: stats.salesOrders,
            skuDocs: stats.skuDocs,
            overheadDocs: stats.overheadDocs,
            pendingOrders: stats.pendingOrders,
            reportRows: reportRows.length,
          },
        };
      },
    }];
  },

  // finalize() already persisted everything. Mirrors GET_LEDGER_SUMMARY_VIEW_DATA, whose adapter
  // is likewise finalize-saves / saveFromRows-noop.
  saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = {
  syncFinanceData,
  fetchNewSalesAndExpenses,
  // The Sales Report type createReport actually requests. Exported so anything that needs to
  // recognise or query for this report (e.g. scripts/inspectReportQueue.js) reads it from here
  // instead of duplicating the literal — a duplicated copy previously drifted (missing the
  // _GENERAL suffix) and made that script query Amazon for the wrong report type entirely.
  REPORT_TYPE,
  backfillPendingExpenses,
  getSyncStatus,
  // Helpers for testing
  parseSalesReportRows,
  toMarketplaceDayKey,
  indexFinanceRowsByOrderId,
  buildOverheadBuckets,
  EXPENSE_CATEGORY_TO_FIELD,
  REVENUE_CATEGORY_TO_FIELD,
  // Token auto-renewal helpers
  createTokenManager,
  isAccessTokenExpiredError,
  isAuthorizationDeniedError,
  // Window/chunk selection — pure, and the only practical way to verify the branch that
  // produced the deadlock (every existing caller passes forceDates and bypasses it).
  resolveSyncWindow,
  enumerateDateChunks,
  runChunkedFetch,
  recordSyncFailure,
  classifySyncFailure,
  // Retry-state reading. Exported so the sweeper, the chunk walk and diagnoseDailySchedule all
  // agree on when a date is capped vs backed off vs due — the cap constant was already duplicated
  // in freshnessSweeper.js, and a third copy is how the three start disagreeing.
  classifyFinanceRetryState,
  classifyChunkSkip,
  FINANCE_MAX_DATE_RETRIES,
  addDaysStr,
  daysBetweenInclusive,
  // Incremental finance index — exported so the page-by-page fold can be proven equivalent to the
  // one-shot indexFinanceRowsByOrderId above.
  createFinanceIndex,
  addFinanceRowsToIndex,
  logFinanceIndexDedup,
  // Step 2 slice selection — pure, and the only practical way to verify the boundary arithmetic,
  // which is precisely where the previously-rejected window cap went wrong.
  resolveStep2Slice,
  FINANCE_STEP2_SLICE_DAYS,
  // Control-plane request helper. Exported for tests only: the verb-aware retry policy (replay
  // idempotent GETs, never replay the non-idempotent createReport POST) is the whole point of the
  // helper, and driving it through submitSalesReport/downloadSalesReportRows would drag in the S3
  // document download, which cannot be mocked independently of the same `https` module.
  httpsRequest,
  isTransientNetworkError,
  // Async path: the shared halves of the inline fetch, plus the engine adapter that reuses them.
  submitSalesReport,
  downloadSalesReportRows,
  // Submit → poll → download with the retry-on-empty loop, but WITHOUT any parse/persist.
  // Exported so scripts/verifyMarketplaceBucketing.js can inspect a real report read-only.
  fetchSalesReport,
  processSalesReportRows,
  salesReportWindowISO,
  enumerateDatesInclusive,
  financeSalesReportAsync,
  planFinanceSync,
  runFinanceSyncTail,
  PROVISIONAL_SETTLE_DAYS,
  FINANCE_REPORT_CHUNK_DAYS,
};
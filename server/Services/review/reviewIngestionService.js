const {
  fetchOrders,
  fetchOrdersStreaming,
  getDateRange,
  enumerateSlices,
  ORDER_CONFIG,
} = require("./orders");
const { getProductDetailsByOrderId } = require("./ordered_product_details");
const { SpApiAuthDeniedError } = require("../../utils/spApiErrors.js");
const ReviewOrder = require("../../models/review/ReviewOrderModel");
const ReviewOrderItem = require("../../models/review/ReviewOrderItemModel");
const ReviewIngestSlice = require("../../models/review/ReviewIngestSliceModel");

// ─── CAPS (env-overridable, matching the idiom in AmazonAds/GetPPCMetrics.js:132) ──────────
// These exist so a run on a very large account exits cleanly with recorded progress instead
// of being killed mid-flight or running past its credential lifetime.

/**
 * Read a positive integer from the environment, falling back to `fallback` on anything
 * unusable. A bare parseInt would turn a typo into NaN, which propagates into date maths and
 * throws — leaving the flag apparently enabled but the path permanently broken.
 */
function envInt(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    if (process.env[name] !== undefined) {
      console.warn(
        `[reviewIngestion] ignoring invalid ${name}="${process.env[name]}", using ${fallback}`
      );
    }
    return fallback;
  }
  return parsed;
}

// Slice granularity. 24h ≈ 80 pages ≈ 4 min for an 8k-orders/day account, so at most one
// partial slice is wasted per run. Lower it (e.g. 6) for extreme accounts.
const SLICE_HOURS = envInt("REVIEW_INGEST_SLICE_HOURS", 24);
// Ingestion window in days. Wider than the 5-30 day solicitation window on purpose — see
// getDateRange() in orders.js.
const WINDOW_DAYS = envInt("REVIEW_INGEST_WINDOW_DAYS", 15);
// ~3s/page pacing means 400 pages ≈ 20 min of pure pagination.
const MAX_PAGES_PER_RUN = envInt("REVIEW_INGEST_MAX_PAGES_PER_RUN", 400);
// Per-slice ceiling, deliberately well below the per-run ceiling. Without this a single
// pathologically large slice would consume the whole run budget, and because slices are walked
// oldest-first it would do so again on every subsequent run — starving every later slice
// forever. Bounding each slice guarantees the run always has pages left for the others.
// ~150 pages ≈ 15k orders, comfortably above a normal day for even a large seller.
const MAX_PAGES_PER_SLICE = envInt("REVIEW_INGEST_MAX_PAGES_PER_SLICE", 150);
const MAX_ORDERS_PER_RUN = envInt("REVIEW_INGEST_MAX_ORDERS_PER_RUN", 40000);
// 40 min — deliberately under the ~60 min LWA/STS lifetime, so the run is bounded even if
// credential refresh were to regress.
const RUN_BUDGET_MS = envInt("REVIEW_INGEST_RUN_BUDGET_MS", 2400000);
// Items are one API call + one sleep per order, so this is best-effort per run by design.
const MAX_ITEM_FETCHES = envInt("REVIEW_INGEST_MAX_ITEM_FETCHES_PER_RUN", 500);
// Allowed to be 0 in tests, so this one is read directly rather than through envInt.
const ITEM_DELAY_MS = (() => {
  const parsed = parseInt(process.env.REVIEW_INGEST_ITEM_DELAY_MS, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2000;
})();
const UPSERT_BATCH = envInt("REVIEW_INGEST_ORDER_UPSERT_BATCH", 200);

/**
 * LEGACY ingestion path — the original implementation, unchanged apart from threading the
 * optional credentialProvider through.
 *
 * Buffers every order in memory and fetches items for ALL of them at ~2s each, so it cannot
 * complete for very large accounts. Retained verbatim as the fallback behind
 * REVIEW_INGEST_STREAMING so enabling the new path is instantly reversible.
 *
 * @param {Object} params
 * @param {ObjectId} params.userId
 * @param {string}   params.country
 * @param {string}   params.region
 * @param {string}   params.accessToken  - LWA access token
 * @param {Object}   params.awsConfig    - SP-API + AWS SigV4 config
 * @param {Object}   [params.credentialProvider] - utils/spApiCredentials.js provider. When
 *   supplied, the LWA token and STS credentials are kept fresh for the whole run, which is
 *   required for accounts whose order volume takes longer than the ~60 min credential life
 *   to walk. Omit it and behaviour is exactly as before.
 * @returns {Promise<{ totalOrders: number, ingested: number, failed: number }>}
 */
async function ingestReviewOrdersLegacy({
  userId,
  country,
  region,
  accessToken,
  awsConfig,
  credentialProvider = null,
}) {
  const { marketplaceId } = awsConfig;
  const fetchBatchId = new Date().toISOString();

  const orders = await fetchOrders(accessToken, awsConfig, credentialProvider);

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
        awsConfig,
        credentialProvider
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
        // This path just fetched the items, so record that. Without it the streaming path's
        // backfill (which selects `itemsFetchedAt: null`, and missing matches null) would
        // spend its entire per-run budget re-pulling items for orders the legacy path had
        // already enriched, starving the orders that genuinely need them.
        itemsFetchedAt: new Date(),
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
      // An authorization denial is not a per-order problem — it applies to every remaining
      // order. Abort so the run surfaces one actionable error, instead of quietly counting
      // thousands of orders as `failed` while hammering a doomed endpoint.
      if (err instanceof SpApiAuthDeniedError) throw err;

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

// ─── STREAMING PATH ────────────────────────────────────────────────────────────

/**
 * Build the bulkWrite op for one order.
 *
 * Three constraints this encodes, each a real trap:
 *  1. A field may NEVER appear in both $set and $setOnInsert — Mongo rejects the update. That
 *     is why `itemCount` is $setOnInsert-only: the separate items pass owns it afterwards, and
 *     putting it in $set here would reset it to 0 on every re-walk of a slice.
 *  2. `reviewRequestStatus` / `canRequestReview` are $setOnInsert-only so a re-walk can never
 *     resurrect an already-sent order back to "not_requested".
 *  3. bulkWrite bypasses Mongoose validation and defaults, so required fields must be explicit
 *     and `undefined` must be omitted rather than written as null.
 */
function buildOrderUpsertOp({ order, orderId, userId, country, region, marketplaceId, fetchBatchId }) {
  const set = {
    User: userId,
    country,
    region,
    marketplaceId,
    amazonOrderId: orderId,
    fetchBatchId,
  };

  // Only assign fields Amazon actually gave us — never overwrite a good stored value with null.
  if (order.PurchaseDate) set.purchaseDate = new Date(order.PurchaseDate);
  if (order.OrderStatus) set.orderStatus = order.OrderStatus;
  if (order.BuyerInfo?.BuyerEmail) set.buyerEmail = order.BuyerInfo.BuyerEmail;
  if (order.BuyerInfo?.BuyerName) set.buyerName = order.BuyerInfo.BuyerName;
  if (order.OrderTotal?.Amount !== undefined && order.OrderTotal?.Amount !== null) {
    set.orderTotalAmount = Number(order.OrderTotal.Amount);
  }
  if (order.OrderTotal?.CurrencyCode) set.orderTotalCurrencyCode = order.OrderTotal.CurrencyCode;
  if (order) set.rawOrder = order;

  return {
    updateOne: {
      filter: { marketplaceId, amazonOrderId: orderId },
      update: {
        $set: set,
        $setOnInsert: {
          reviewRequestStatus: "not_requested",
          canRequestReview: null,
          itemCount: 0,
          itemsFetchedAt: null,
        },
      },
      upsert: true,
    },
  };
}

/**
 * Persist one page of orders. Returns how many ops were written.
 */
async function persistOrderPage({ orders, userId, country, region, marketplaceId, fetchBatchId }) {
  // bulkWrite skips schema validation, so guard the required fields ourselves rather than
  // silently inserting documents that violate the schema.
  if (!userId || !country || !region || !marketplaceId) {
    throw new Error(
      "[reviewIngestion] userId, country, region and marketplaceId are all required to persist orders"
    );
  }

  const ops = [];
  let skipped = 0;

  for (const order of orders) {
    const orderId =
      order.AmazonOrderId || order.AmazonOrderID || order.OrderId || order.orderId;
    if (!orderId) {
      skipped++;
      continue;
    }
    ops.push(
      buildOrderUpsertOp({
        order,
        orderId,
        userId,
        country,
        region,
        marketplaceId,
        fetchBatchId,
      })
    );
  }

  if (!ops.length) return { written: 0, skipped };

  for (let i = 0; i < ops.length; i += UPSERT_BATCH) {
    await ReviewOrder.bulkWrite(ops.slice(i, i + UPSERT_BATCH), { ordered: false });
  }

  return { written: ops.length, skipped };
}

/**
 * Second pass: fetch per-item detail for orders inside the 5–30 day solicitation window whose
 * items have not been pulled yet, oldest first.
 *
 * Hard-capped, and honestly so: one SP-API call plus a rate-limit sleep per order means a
 * 120k-order account could never be enriched exhaustively. Prioritising the solicitation
 * window and capping per run keeps the run bounded while still populating the orders a user
 * would actually act on. ReviewOrderItem's only consumer is the on-demand drill-down.
 */
async function backfillOrderItems({
  userId,
  country,
  region,
  marketplaceId,
  accessToken,
  awsConfig,
  credentialProvider,
  deadlineAt,
}) {
  const now = new Date();
  const minPurchase = new Date(now.getTime() - ORDER_CONFIG.maxOrderAgeDays * 86400000);
  const maxPurchase = new Date(now.getTime() - ORDER_CONFIG.minOrderAgeDays * 86400000);

  const candidates = await ReviewOrder.find({
    User: userId,
    country,
    region,
    marketplaceId,
    itemsFetchedAt: null,
    purchaseDate: { $gte: minPurchase, $lte: maxPurchase },
  })
    .sort({ purchaseDate: 1 })
    .limit(MAX_ITEM_FETCHES)
    .select({ _id: 1, amazonOrderId: 1 })
    .lean();

  let fetched = 0;
  let failed = 0;
  let stopReason = null;

  for (const doc of candidates) {
    if (Date.now() >= deadlineAt) {
      stopReason = "budget";
      break;
    }

    try {
      const { itemCount, items } = await getProductDetailsByOrderId(
        doc.amazonOrderId,
        accessToken,
        awsConfig,
        credentialProvider
      );

      if (items.length) {
        await ReviewOrderItem.bulkWrite(
          items.map((itm) => ({
            updateOne: {
              filter: {
                reviewOrder: doc._id,
                User: userId,
                marketplaceId,
                amazonOrderId: doc.amazonOrderId,
                asin: itm.asin || null,
                sellerSKU: itm.sellerSKU || null,
              },
              update: {
                $set: {
                  reviewOrder: doc._id,
                  User: userId,
                  marketplaceId,
                  amazonOrderId: doc.amazonOrderId,
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
          })),
          { ordered: false }
        );
      }

      await ReviewOrder.updateOne(
        { _id: doc._id },
        { $set: { itemCount, itemsFetchedAt: new Date() } }
      );
      fetched++;
    } catch (err) {
      if (err instanceof SpApiAuthDeniedError) throw err;
      console.error(
        `[reviewIngestion] items fetch failed for ${doc.amazonOrderId}: ${err.message}`
      );
      failed++;
    }

    await sleep(ITEM_DELAY_MS);
  }

  return { fetched, failed, candidates: candidates.length, stopReason };
}

/**
 * STREAMING ingestion path.
 *
 * Walks the window as independent date slices, persisting each page as it arrives and
 * recording completed slices so the next run resumes rather than restarting. Then runs a
 * bounded items backfill with whatever time budget is left.
 */
async function ingestReviewOrdersStreaming({
  userId,
  country,
  region,
  accessToken,
  awsConfig,
  credentialProvider = null,
  // Lets the dispatcher see whether this path did any real work before it threw, so it can
  // decide against a legacy retry that would duplicate hours of effort.
  progressRef = null,
}) {
  const { marketplaceId } = awsConfig;
  const fetchBatchId = new Date().toISOString();
  const startedAt = Date.now();
  const deadlineAt = startedAt + RUN_BUDGET_MS;

  const { createdAfter, createdBefore } = getDateRange(WINDOW_DAYS);
  const allSlices = enumerateSlices(createdAfter, createdBefore, SLICE_HOURS);
  const alreadyDone = await ReviewIngestSlice.completedKeys({
    User: userId,
    country,
    region,
    marketplaceId,
  });
  const pending = allSlices.filter((s) => !alreadyDone.has(s.sliceKey));

  console.log(
    `[reviewIngestion] ${country}/${region} window ${createdAfter} → ${createdBefore}: ` +
    `${allSlices.length} slices, ${alreadyDone.size} already complete, ${pending.length} to do`
  );

  let pagesFetched = 0;
  let ordersUpserted = 0;
  let skippedNoId = 0;
  let slicesCompleted = 0;
  let stopReason = null;
  // Slices too large to walk within one run's page cap; surfaced in the result so the
  // condition is visible rather than looking like the queue simply ended.
  const oversizedSlices = [];

  for (const slice of pending) {
    if (Date.now() >= deadlineAt || pagesFetched >= MAX_PAGES_PER_RUN) {
      stopReason = Date.now() >= deadlineAt ? "budget" : "maxPages";
      break;
    }
    if (ordersUpserted >= MAX_ORDERS_PER_RUN) {
      stopReason = "maxOrders";
      break;
    }

    const claim = await ReviewIngestSlice.claimSlice({
      User: userId,
      country,
      region,
      marketplaceId,
      slice,
    });
    // null means another run owns this slice (or it completed a moment ago) — skip it.
    if (!claim) continue;

    let slicePages = 0;
    let sliceOrders = 0;

    // Cap this slice by whichever bites first: its own ceiling, or what the run has left.
    // Knowing which one applied is what lets us tell "this slice is too big" (skip it) from
    // "the run is out of pages" (stop and resume next run).
    const remainingRunPages = MAX_PAGES_PER_RUN - pagesFetched;
    const sliceCap = Math.min(MAX_PAGES_PER_SLICE, remainingRunPages);
    const cappedBySlice = MAX_PAGES_PER_SLICE <= remainingRunPages;

    try {
      const summary = await fetchOrdersStreaming(accessToken, awsConfig, {
        createdAfter: slice.createdAfter,
        createdBefore: slice.createdBefore,
        credentialProvider,
        quiet: true,
        maxPages: sliceCap,
        // Checked once per page, so a run stops at a page boundary instead of being killed
        // mid-slice by the worker.
        shouldStop: () => (Date.now() >= deadlineAt ? "budget" : null),
        onPage: async (orders) => {
          const { written, skipped } = await persistOrderPage({
            orders,
            userId,
            country,
            region,
            marketplaceId,
            fetchBatchId,
          });
          sliceOrders += written;
          skippedNoId += skipped;
        },
      });

      slicePages = summary.pages;
      pagesFetched += summary.pages;
      ordersUpserted += sliceOrders;
      if (progressRef) {
        progressRef.pagesFetched = pagesFetched;
        progressRef.ordersUpserted = ordersUpserted;
      }

      if (summary.completed) {
        await ReviewIngestSlice.markComplete(claim._id, {
          pagesFetched: slicePages,
          ordersUpserted: sliceOrders,
        });
        slicesCompleted++;
      } else {
        // Partial: deliberately NOT marked complete, so the whole slice is re-walked next
        // run. Re-walking is safe because upserts key on {marketplaceId, amazonOrderId}.
        await ReviewIngestSlice.markFailed(claim._id, `partial: ${summary.stopReason}`, {
          pagesFetched: slicePages,
          ordersUpserted: sliceOrders,
        });
        stopReason = summary.stopReason;

        // A slice that hit its OWN ceiling (rather than the run running dry) is larger than a
        // single slice is allowed to be. Do NOT stop here: slices are walked oldest-first, so
        // stopping would let one oversized slice starve every later slice on every run —
        // permanent zero progress, indistinguishable from the bug this path exists to fix.
        // Skip past it and spend the remaining budget on slices that can finish.
        if (summary.stopReason === "maxPages" && cappedBySlice && Date.now() < deadlineAt) {
          oversizedSlices.push(slice.sliceKey);
          console.warn(
            `[reviewIngestion] slice ${slice.sliceKey} exceeds ` +
            `REVIEW_INGEST_MAX_PAGES_PER_SLICE (${MAX_PAGES_PER_SLICE} pages) and cannot ` +
            `complete at REVIEW_INGEST_SLICE_HOURS=${SLICE_HOURS}. Its orders so far ARE ` +
            `persisted, but the slice stays incomplete. Skipping it so later slices are not ` +
            `starved — lower REVIEW_INGEST_SLICE_HOURS (e.g. 6) for this account to split it.`
          );
          continue;
        }

        // Otherwise the run itself is out of budget/pages — stop cleanly and let the next run
        // resume from this same slice with a full budget.
        break;
      }
    } catch (err) {
      await ReviewIngestSlice.markFailed(claim._id, err.message, {
        pagesFetched: slicePages,
        ordersUpserted: sliceOrders,
      });
      throw err;
    }
  }

  const items = await backfillOrderItems({
    userId,
    country,
    region,
    marketplaceId,
    accessToken,
    awsConfig,
    credentialProvider,
    deadlineAt,
  });

  const result = {
    // Kept for backward compatibility with the legacy return shape.
    totalOrders: ordersUpserted,
    ingested: ordersUpserted,
    failed: items.failed + skippedNoId,
    // Additive detail — safe through ScheduledIntegration's passthrough.
    mode: "streaming",
    slicesTotal: allSlices.length,
    slicesCompleted,
    // `pending` is already filtered to the current window, so this can never go negative
    // (completedKeys covers 90 days of history, which is wider than the 15-day window).
    slicesRemaining: Math.max(0, pending.length - slicesCompleted),
    pagesFetched,
    itemsFetched: items.fetched,
    itemsCandidates: items.candidates,
    oversizedSlices,
    stopReason: stopReason || items.stopReason || null,
    elapsedMs: Date.now() - startedAt,
  };

  console.log(
    `[reviewIngestion] streaming done — orders=${result.ingested} pages=${pagesFetched} ` +
    `slices=${slicesCompleted}/${result.slicesTotal} items=${items.fetched} ` +
    `stop=${result.stopReason || "none"} in ${Math.round(result.elapsedMs / 1000)}s`
  );

  return result;
}

/**
 * Entry point. Dispatches to the streaming path only when REVIEW_INGEST_STREAMING is
 * explicitly enabled, and falls back to the legacy path if it throws for any reason other
 * than an authorization denial (which must surface so the account can be reconnected).
 *
 * Read here rather than in the callers so all three entry points
 * (scheduledReviewIngestionProcessor, Services/main/Integration, ReviewOrdersTestController)
 * inherit the same behaviour.
 */
async function ingestReviewOrders(params) {
  if (process.env.REVIEW_INGEST_STREAMING === "true") {
    const progressRef = { pagesFetched: 0, ordersUpserted: 0 };
    try {
      return await ingestReviewOrdersStreaming({ ...params, progressRef });
    } catch (err) {
      if (err instanceof SpApiAuthDeniedError) throw err;

      // Only retry on the legacy path if streaming failed BEFORE doing real work (e.g. a
      // setup/DB error). Once pages have been fetched, the legacy path would re-walk the whole
      // window from scratch and then fetch items for every order at ~2s each — for a large
      // account that is many hours of duplicated effort, i.e. exactly the unbounded behaviour
      // this path replaces. Better to surface the failure and let the next run resume from the
      // slices already recorded.
      if (progressRef.pagesFetched > 0) {
        console.error(
          `[reviewIngestion] streaming failed after ${progressRef.pagesFetched} pages ` +
          `(${progressRef.ordersUpserted} orders persisted) — NOT falling back to legacy; ` +
          `the next run will resume from the recorded slices. Cause: ${err.message}`
        );
        throw err;
      }

      console.error(
        `[reviewIngestion] streaming path failed before doing any work, falling back to legacy: ${err.message}`
      );
    }
  }

  return ingestReviewOrdersLegacy(params);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  ingestReviewOrders,
  // Exported for tests and for callers that want to pin a specific path.
  ingestReviewOrdersLegacy,
  ingestReviewOrdersStreaming,
  buildOrderUpsertOp,
  persistOrderPage,
  backfillOrderItems,
};

/**
 * Tests for the streaming review-ingestion path.
 *
 * Focus is on the invariants that are easy to get silently wrong:
 *  - `reviewRequestStatus` / `canRequestReview` / `itemCount` must be $setOnInsert-ONLY, so
 *    re-walking a slice can never resurrect an already-sent order or zero out item counts.
 *  - No field may appear in both $set and $setOnInsert (Mongo rejects the whole update).
 *  - bulkWrite skips Mongoose validation, so required fields must be guarded explicitly.
 *  - The feature flag must default OFF and fall back to the legacy path on error.
 */

jest.mock('../../../models/review/ReviewOrderModel', () => ({
  bulkWrite: jest.fn(),
  find: jest.fn(),
  updateOne: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
}));
jest.mock('../../../models/review/ReviewOrderItemModel', () => ({
  bulkWrite: jest.fn(),
}));
jest.mock('../../../models/review/ReviewIngestSliceModel', () => ({
  claimSlice: jest.fn(),
  markComplete: jest.fn(),
  markFailed: jest.fn(),
  completedKeys: jest.fn(),
}));
jest.mock('../../../Services/review/orders', () => {
  const actual = jest.requireActual('../../../Services/review/orders');
  return {
    ...actual,
    fetchOrders: jest.fn(),
    fetchOrdersStreaming: jest.fn(),
  };
});
jest.mock('../../../Services/review/ordered_product_details', () => ({
  getProductDetailsByOrderId: jest.fn(),
}));

const ReviewOrder = require('../../../models/review/ReviewOrderModel');
const ReviewOrderItem = require('../../../models/review/ReviewOrderItemModel');
const ReviewIngestSlice = require('../../../models/review/ReviewIngestSliceModel');
const { fetchOrders, fetchOrdersStreaming } = require('../../../Services/review/orders');
const { getProductDetailsByOrderId } = require('../../../Services/review/ordered_product_details');
const {
  ingestReviewOrders,
  ingestReviewOrdersStreaming,
  buildOrderUpsertOp,
  persistOrderPage,
} = require('../../../Services/review/reviewIngestionService');

const USER = 'user-1';
const AWS_CONFIG = {
  marketplaceId: 'ATVPDKIKX0DER',
  endpoint: 'https://sellingpartnerapi-na.amazon.com',
  awsAccessKeyId: 'AK',
  awsSecretAccessKey: 'SK',
  awsRegion: 'us-east-1',
  awsSessionToken: 'ST',
};

const BASE = {
  userId: USER,
  country: 'US',
  region: 'NA',
  accessToken: 'tok',
  awsConfig: AWS_CONFIG,
};

function amazonOrder(id, extra = {}) {
  return {
    AmazonOrderId: id,
    OrderStatus: 'Shipped',
    PurchaseDate: '2026-07-10T00:00:00.000Z',
    OrderTotal: { Amount: '25.00', CurrencyCode: 'USD' },
    ...extra,
  };
}

// Emptying the items backfill keeps the ingestion tests focused on order persistence.
function noItemsToBackfill() {
  ReviewOrder.find.mockReturnValue({
    sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [] }) }) }),
  });
}

beforeEach(() => {
  delete process.env.REVIEW_INGEST_STREAMING;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  ReviewOrder.bulkWrite.mockResolvedValue({});
  ReviewOrder.updateOne.mockResolvedValue({});
  ReviewOrderItem.bulkWrite.mockResolvedValue({});
  ReviewIngestSlice.completedKeys.mockResolvedValue(new Set());
  ReviewIngestSlice.markComplete.mockResolvedValue({});
  ReviewIngestSlice.markFailed.mockResolvedValue({});
  ReviewIngestSlice.claimSlice.mockImplementation(async ({ slice }) => ({
    _id: `claim-${slice.sliceKey}`,
  }));
  noItemsToBackfill();
});

describe('buildOrderUpsertOp — write invariants', () => {
  const args = {
    order: amazonOrder('111-1'),
    orderId: '111-1',
    userId: USER,
    country: 'US',
    region: 'NA',
    marketplaceId: 'ATVPDKIKX0DER',
    fetchBatchId: 'batch-1',
  };

  test('no field appears in both $set and $setOnInsert', () => {
    const { update } = buildOrderUpsertOp(args).updateOne;

    const overlap = Object.keys(update.$set).filter((k) => k in update.$setOnInsert);
    // Mongo rejects the entire update if this is non-empty — a runtime-only failure that
    // would otherwise surface as every page silently failing to persist.
    expect(overlap).toEqual([]);
  });

  test('review state is $setOnInsert-only so a re-walk cannot un-send an order', () => {
    const { update } = buildOrderUpsertOp(args).updateOne;

    expect(update.$setOnInsert).toMatchObject({
      reviewRequestStatus: 'not_requested',
      canRequestReview: null,
    });
    expect(update.$set).not.toHaveProperty('reviewRequestStatus');
    expect(update.$set).not.toHaveProperty('canRequestReview');
  });

  test('itemCount is $setOnInsert-only so the items pass is not clobbered', () => {
    const { update } = buildOrderUpsertOp(args).updateOne;

    expect(update.$setOnInsert).toHaveProperty('itemCount', 0);
    expect(update.$set).not.toHaveProperty('itemCount');
    expect(update.$set).not.toHaveProperty('itemsFetchedAt');
  });

  test('upserts key on {marketplaceId, amazonOrderId} — the idempotency guarantee', () => {
    const op = buildOrderUpsertOp(args).updateOne;

    expect(op.filter).toEqual({ marketplaceId: 'ATVPDKIKX0DER', amazonOrderId: '111-1' });
    expect(op.upsert).toBe(true);
  });

  test('absent Amazon fields are omitted, never written as null', () => {
    const { update } = buildOrderUpsertOp({
      ...args,
      order: { AmazonOrderId: '111-1' }, // no dates, totals or buyer info
    }).updateOne;

    expect(update.$set).not.toHaveProperty('purchaseDate');
    expect(update.$set).not.toHaveProperty('orderStatus');
    expect(update.$set).not.toHaveProperty('buyerEmail');
    expect(update.$set).not.toHaveProperty('orderTotalAmount');
  });

  test('a zero order total is still written (not treated as missing)', () => {
    const { update } = buildOrderUpsertOp({
      ...args,
      order: amazonOrder('111-1', { OrderTotal: { Amount: '0', CurrencyCode: 'USD' } }),
    }).updateOne;

    expect(update.$set.orderTotalAmount).toBe(0);
  });
});

describe('persistOrderPage', () => {
  test('guards required fields because bulkWrite skips validation', async () => {
    await expect(
      persistOrderPage({
        orders: [amazonOrder('1')],
        userId: null,
        country: 'US',
        region: 'NA',
        marketplaceId: 'M',
        fetchBatchId: 'b',
      })
    ).rejects.toThrow(/required to persist orders/);

    expect(ReviewOrder.bulkWrite).not.toHaveBeenCalled();
  });

  test('writes one unordered bulkWrite for the page', async () => {
    const res = await persistOrderPage({
      orders: [amazonOrder('1'), amazonOrder('2')],
      userId: USER,
      country: 'US',
      region: 'NA',
      marketplaceId: 'M',
      fetchBatchId: 'b',
    });

    expect(res).toEqual({ written: 2, skipped: 0 });
    expect(ReviewOrder.bulkWrite).toHaveBeenCalledTimes(1);
    expect(ReviewOrder.bulkWrite.mock.calls[0][1]).toEqual({ ordered: false });
  });

  test('orders with no id are skipped, not written', async () => {
    const res = await persistOrderPage({
      orders: [amazonOrder('1'), { OrderStatus: 'Shipped' }],
      userId: USER,
      country: 'US',
      region: 'NA',
      marketplaceId: 'M',
      fetchBatchId: 'b',
    });

    expect(res).toEqual({ written: 1, skipped: 1 });
  });

  test('an empty page performs no write at all', async () => {
    const res = await persistOrderPage({
      orders: [],
      userId: USER,
      country: 'US',
      region: 'NA',
      marketplaceId: 'M',
      fetchBatchId: 'b',
    });

    expect(res).toEqual({ written: 0, skipped: 0 });
    expect(ReviewOrder.bulkWrite).not.toHaveBeenCalled();
  });

  test('a large page is chunked into batches', async () => {
    process.env.REVIEW_INGEST_ORDER_UPSERT_BATCH = '200';
    const orders = Array.from({ length: 450 }, (_, i) => amazonOrder(`o-${i}`));

    await persistOrderPage({
      orders,
      userId: USER,
      country: 'US',
      region: 'NA',
      marketplaceId: 'M',
      fetchBatchId: 'b',
    });

    // 450 ops at the default batch of 200 → 3 calls.
    expect(ReviewOrder.bulkWrite).toHaveBeenCalledTimes(3);
    delete process.env.REVIEW_INGEST_ORDER_UPSERT_BATCH;
  });
});

describe('feature flag dispatch', () => {
  test('defaults to the legacy path when the flag is unset', async () => {
    fetchOrders.mockResolvedValue([]);

    await ingestReviewOrders(BASE);

    expect(fetchOrders).toHaveBeenCalled();
    expect(fetchOrdersStreaming).not.toHaveBeenCalled();
  });

  test("a value other than 'true' does not enable streaming", async () => {
    process.env.REVIEW_INGEST_STREAMING = '1';
    fetchOrders.mockResolvedValue([]);

    await ingestReviewOrders(BASE);

    expect(fetchOrders).toHaveBeenCalled();
    expect(fetchOrdersStreaming).not.toHaveBeenCalled();
  });

  test("'true' uses the streaming path", async () => {
    process.env.REVIEW_INGEST_STREAMING = 'true';
    fetchOrdersStreaming.mockResolvedValue({
      pages: 1,
      totalOrders: 0,
      completed: true,
      stopReason: null,
    });

    const result = await ingestReviewOrders(BASE);

    expect(fetchOrdersStreaming).toHaveBeenCalled();
    expect(fetchOrders).not.toHaveBeenCalled();
    expect(result.mode).toBe('streaming');
  });

  test('falls back to legacy if streaming throws BEFORE doing any work', async () => {
    process.env.REVIEW_INGEST_STREAMING = 'true';
    ReviewIngestSlice.completedKeys.mockRejectedValue(new Error('mongo exploded'));
    fetchOrders.mockResolvedValue([]);

    const result = await ingestReviewOrders(BASE);

    // Safety valve: a setup bug in the new path degrades to the old behaviour rather than
    // failing the account's run outright.
    expect(fetchOrders).toHaveBeenCalled();
    expect(result.mode).toBeUndefined();
  });

  test('does NOT fall back to legacy once pages have been fetched', async () => {
    // Falling back after real work would re-walk the whole window and then fetch items for
    // every order at ~2s each — for a large account, hours of duplicated effort, which is the
    // unbounded behaviour this path exists to replace.
    process.env.REVIEW_INGEST_STREAMING = 'true';
    fetchOrdersStreaming
      .mockResolvedValueOnce({ pages: 5, totalOrders: 500, completed: true, stopReason: null })
      .mockRejectedValueOnce(new Error('died mid-run'));

    await expect(ingestReviewOrders(BASE)).rejects.toThrow('died mid-run');
    expect(fetchOrders).not.toHaveBeenCalled();
  });

  test('an authorization denial is NOT swallowed by the fallback', async () => {
    const { SpApiAuthDeniedError } = require('../../../utils/spApiErrors.js');
    process.env.REVIEW_INGEST_STREAMING = 'true';
    ReviewIngestSlice.completedKeys.mockRejectedValue(new SpApiAuthDeniedError('denied'));

    await expect(ingestReviewOrders(BASE)).rejects.toBeInstanceOf(SpApiAuthDeniedError);
    // Retrying on the legacy path would just fail the same way, slowly.
    expect(fetchOrders).not.toHaveBeenCalled();
  });
});

describe('slice orchestration', () => {
  beforeEach(() => {
    process.env.REVIEW_INGEST_STREAMING = 'true';
  });

  test('already-complete slices are skipped', async () => {
    const { getDateRange, enumerateSlices } = jest.requireActual(
      '../../../Services/review/orders'
    );
    const { createdAfter, createdBefore } = getDateRange(15);
    const all = enumerateSlices(createdAfter, createdBefore, 24);
    // Mark everything except the last slice as done.
    ReviewIngestSlice.completedKeys.mockResolvedValue(
      new Set(all.slice(0, -1).map((s) => s.sliceKey))
    );
    fetchOrdersStreaming.mockResolvedValue({
      pages: 1,
      totalOrders: 5,
      completed: true,
      stopReason: null,
    });

    const result = await ingestReviewOrdersStreaming(BASE);

    expect(fetchOrdersStreaming).toHaveBeenCalledTimes(1);
    expect(result.slicesCompleted).toBe(1);
    expect(result.slicesTotal).toBe(all.length);
  });

  test('a slice claimed by another run is skipped without fetching', async () => {
    ReviewIngestSlice.claimSlice.mockResolvedValue(null);

    const result = await ingestReviewOrdersStreaming(BASE);

    expect(fetchOrdersStreaming).not.toHaveBeenCalled();
    expect(result.slicesCompleted).toBe(0);
  });

  test('a completed slice is marked complete with its stats', async () => {
    ReviewIngestSlice.completedKeys.mockResolvedValue(new Set());
    fetchOrdersStreaming.mockImplementation(async (_t, _c, opts) => {
      await opts.onPage([amazonOrder('a'), amazonOrder('b')], { page: 1, nextToken: null });
      return { pages: 1, totalOrders: 2, completed: true, stopReason: null };
    });

    await ingestReviewOrdersStreaming(BASE);

    expect(ReviewIngestSlice.markComplete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ pagesFetched: 1, ordersUpserted: 2 })
    );
  });

  test('a partial slice is marked failed (never complete) and stops the run', async () => {
    fetchOrdersStreaming.mockResolvedValue({
      pages: 3,
      totalOrders: 300,
      completed: false,
      stopReason: 'budget',
    });

    const result = await ingestReviewOrdersStreaming(BASE);

    expect(ReviewIngestSlice.markComplete).not.toHaveBeenCalled();
    expect(ReviewIngestSlice.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('partial'),
      expect.any(Object)
    );
    // Stops rather than burning budget on further slices.
    expect(fetchOrdersStreaming).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('budget');
  });

  test('orders are persisted per page as they arrive, not buffered to the end', async () => {
    // Restrict the run to ONE slice so the write counter reflects a single walk.
    const { getDateRange, enumerateSlices } = jest.requireActual(
      '../../../Services/review/orders'
    );
    const { createdAfter, createdBefore } = getDateRange(15);
    const all = enumerateSlices(createdAfter, createdBefore, 24);
    ReviewIngestSlice.completedKeys.mockResolvedValue(
      new Set(all.slice(0, -1).map((s) => s.sliceKey))
    );

    let writesAfterFirstPage = 0;
    fetchOrdersStreaming.mockImplementation(async (_t, _c, opts) => {
      await opts.onPage([amazonOrder('p1')], { page: 1, nextToken: 'T' });
      writesAfterFirstPage = ReviewOrder.bulkWrite.mock.calls.length;
      await opts.onPage([amazonOrder('p2')], { page: 2, nextToken: null });
      return { pages: 2, totalOrders: 2, completed: true, stopReason: null };
    });

    await ingestReviewOrdersStreaming(BASE);

    // The whole point of the fix: page 1 was durable before page 2 was even requested.
    // Under the old buffered path this would have been 0.
    expect(writesAfterFirstPage).toBe(1);
    expect(ReviewOrder.bulkWrite).toHaveBeenCalledTimes(2);
  });

  test('an oversized slice is SKIPPED so it cannot starve later slices', async () => {
    // Regression guard. Slices run oldest-first. If the oldest slice alone exceeds the run's
    // page cap and we stopped there, every later slice would be starved on every run —
    // permanent zero progress, i.e. the original bug wearing a different hat.
    const { getDateRange, enumerateSlices } = jest.requireActual(
      '../../../Services/review/orders'
    );
    const { createdAfter, createdBefore } = getDateRange(15);
    const all = enumerateSlices(createdAfter, createdBefore, 24);
    // Leave three slices pending; the first is oversized.
    ReviewIngestSlice.completedKeys.mockResolvedValue(
      new Set(all.slice(0, -3).map((s) => s.sliceKey))
    );

    // Hits the per-slice ceiling (150), which leaves plenty of the 400-page run budget for
    // the remaining slices — that separation is what prevents the starvation.
    fetchOrdersStreaming
      .mockResolvedValueOnce({ pages: 150, totalOrders: 15000, completed: false, stopReason: 'maxPages' })
      .mockResolvedValue({ pages: 2, totalOrders: 20, completed: true, stopReason: null });

    const result = await ingestReviewOrdersStreaming(BASE);

    // Moved past the oversized slice and completed the other two.
    expect(fetchOrdersStreaming).toHaveBeenCalledTimes(3);
    expect(result.slicesCompleted).toBe(2);
    expect(result.oversizedSlices).toEqual([all[all.length - 3].sliceKey]);
    // Never marked complete — its orders are not silently considered ingested.
    expect(ReviewIngestSlice.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      'partial: maxPages',
      expect.any(Object)
    );
  });

  test('an oversized slice does not consume the whole run budget', async () => {
    // The per-slice ceiling must be strictly below the per-run ceiling, otherwise one huge
    // slice exhausts the run and the "skip" above achieves nothing.
    const { getDateRange, enumerateSlices } = jest.requireActual(
      '../../../Services/review/orders'
    );
    const { createdAfter, createdBefore } = getDateRange(15);
    const all = enumerateSlices(createdAfter, createdBefore, 24);
    ReviewIngestSlice.completedKeys.mockResolvedValue(
      new Set(all.slice(0, -2).map((s) => s.sliceKey))
    );

    let capForFirstSlice = null;
    fetchOrdersStreaming.mockImplementation(async (_t, _c, opts) => {
      if (capForFirstSlice === null) {
        capForFirstSlice = opts.maxPages;
        return { pages: opts.maxPages, totalOrders: 1, completed: false, stopReason: 'maxPages' };
      }
      return { pages: 1, totalOrders: 1, completed: true, stopReason: null };
    });

    const result = await ingestReviewOrdersStreaming(BASE);

    expect(capForFirstSlice).toBe(150);
    expect(capForFirstSlice).toBeLessThan(400);
    // Real progress was still made after the oversized slice.
    expect(result.slicesCompleted).toBe(1);
  });

  test('slicesRemaining never goes negative when history exceeds the window', async () => {
    // completedKeys spans 90 days of retention while the window is 15 days, so a naive
    // subtraction would report a negative remainder.
    const { getDateRange, enumerateSlices } = jest.requireActual(
      '../../../Services/review/orders'
    );
    const { createdAfter, createdBefore } = getDateRange(60);
    ReviewIngestSlice.completedKeys.mockResolvedValue(
      new Set(enumerateSlices(createdAfter, createdBefore, 24).map((s) => s.sliceKey))
    );

    const result = await ingestReviewOrdersStreaming(BASE);

    expect(result.slicesRemaining).toBeGreaterThanOrEqual(0);
  });

  test('a slice error marks the slice failed and rethrows', async () => {
    fetchOrdersStreaming.mockRejectedValue(new Error('network down'));

    await expect(ingestReviewOrdersStreaming(BASE)).rejects.toThrow('network down');
    expect(ReviewIngestSlice.markFailed).toHaveBeenCalledWith(
      expect.any(String),
      'network down',
      expect.any(Object)
    );
  });

  test('reports a backward-compatible result shape plus additive detail', async () => {
    fetchOrdersStreaming.mockImplementation(async (_t, _c, opts) => {
      await opts.onPage([amazonOrder('a')], { page: 1, nextToken: null });
      return { pages: 1, totalOrders: 1, completed: true, stopReason: null };
    });

    const result = await ingestReviewOrdersStreaming(BASE);

    // Legacy consumers read these three.
    expect(result).toHaveProperty('totalOrders');
    expect(result).toHaveProperty('ingested');
    expect(result).toHaveProperty('failed');
    // New observability fields.
    expect(result).toMatchObject({ mode: 'streaming' });
    expect(result).toHaveProperty('slicesTotal');
    expect(result).toHaveProperty('pagesFetched');
    expect(result).toHaveProperty('itemsFetched');
  });
});

describe('items backfill', () => {
  beforeEach(() => {
    process.env.REVIEW_INGEST_STREAMING = 'true';
    process.env.REVIEW_INGEST_ITEM_DELAY_MS = '0';
    fetchOrdersStreaming.mockResolvedValue({
      pages: 0,
      totalOrders: 0,
      completed: true,
      stopReason: null,
    });
    ReviewIngestSlice.completedKeys.mockImplementation(async () => {
      const { getDateRange, enumerateSlices } = jest.requireActual(
        '../../../Services/review/orders'
      );
      const { createdAfter, createdBefore } = getDateRange(15);
      return new Set(enumerateSlices(createdAfter, createdBefore, 24).map((s) => s.sliceKey));
    });
  });

  afterEach(() => {
    delete process.env.REVIEW_INGEST_ITEM_DELAY_MS;
  });

  test('only queries orders whose items are missing, oldest first', async () => {
    const lean = jest.fn(async () => []);
    const select = jest.fn(() => ({ lean }));
    const limit = jest.fn(() => ({ select }));
    const sort = jest.fn(() => ({ limit }));
    ReviewOrder.find.mockReturnValue({ sort });

    await ingestReviewOrdersStreaming(BASE);

    expect(ReviewOrder.find).toHaveBeenCalledWith(
      expect.objectContaining({ User: USER, itemsFetchedAt: null })
    );
    expect(sort).toHaveBeenCalledWith({ purchaseDate: 1 });
  });

  test('marks itemsFetchedAt so an order is not re-fetched next run', async () => {
    ReviewOrder.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: async () => [{ _id: 'oid-1', amazonOrderId: '111-1' }],
          }),
        }),
      }),
    });
    getProductDetailsByOrderId.mockResolvedValue({
      itemCount: 2,
      items: [{ asin: 'A1', sellerSKU: 'S1' }],
    });

    const result = await ingestReviewOrdersStreaming(BASE);

    expect(result.itemsFetched).toBe(1);
    expect(ReviewOrder.updateOne).toHaveBeenCalledWith(
      { _id: 'oid-1' },
      { $set: { itemCount: 2, itemsFetchedAt: expect.any(Date) } }
    );
  });

  test('a per-order items failure is counted, not fatal', async () => {
    ReviewOrder.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: async () => [
              { _id: 'oid-1', amazonOrderId: '1' },
              { _id: 'oid-2', amazonOrderId: '2' },
            ],
          }),
        }),
      }),
    });
    getProductDetailsByOrderId
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ itemCount: 1, items: [] });

    const result = await ingestReviewOrdersStreaming(BASE);

    expect(result.itemsFetched).toBe(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  test('an authorization denial during items aborts the whole pass', async () => {
    const { SpApiAuthDeniedError } = require('../../../utils/spApiErrors.js');
    ReviewOrder.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: async () => [{ _id: 'oid-1', amazonOrderId: '1' }],
          }),
        }),
      }),
    });
    getProductDetailsByOrderId.mockRejectedValue(new SpApiAuthDeniedError('denied'));

    await expect(ingestReviewOrdersStreaming(BASE)).rejects.toBeInstanceOf(SpApiAuthDeniedError);
  });
});

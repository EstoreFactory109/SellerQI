/**
 * Tests for the slice-claim concurrency primitive.
 *
 * Two runs for the same account can overlap (a retry firing while the previous attempt is
 * still draining). Claiming must be atomic and must never hand the same slice to both, and a
 * `complete` slice must never be re-claimable — otherwise a large account could ping-pong
 * forever re-walking work it already finished.
 */

const mongoose = require('mongoose');
const ReviewIngestSlice = require('../../models/review/ReviewIngestSliceModel');

const KEY = {
  User: new mongoose.Types.ObjectId(),
  country: 'US',
  region: 'NA',
  marketplaceId: 'ATVPDKIKX0DER',
};

const SLICE = {
  sliceKey: '2026-07-13T00',
  createdAfter: '2026-07-13T00:00:00.000Z',
  createdBefore: '2026-07-14T00:00:00.000Z',
};

describe('schema shape', () => {
  test('the unique key is what makes claiming safe', () => {
    const indexes = ReviewIngestSlice.schema.indexes();
    const unique = indexes.find(([, opts]) => opts && opts.unique);

    expect(unique).toBeDefined();
    expect(Object.keys(unique[0])).toEqual([
      'User',
      'country',
      'region',
      'marketplaceId',
      'sliceKey',
    ]);
  });

  test('retention outlives the 15-day ingestion window', () => {
    const indexes = ReviewIngestSlice.schema.indexes();
    const ttl = indexes.find(([, opts]) => opts && opts.expireAfterSeconds);

    expect(ttl).toBeDefined();
    const days = ttl[1].expireAfterSeconds / 86400;
    // FinanceSyncLogModel's 30-day default would be long enough to delete a checkpoint that
    // is still inside the active window during a slow backfill.
    expect(days).toBeGreaterThanOrEqual(45);
  });

  test('status is constrained to the known lifecycle values', () => {
    expect(ReviewIngestSlice.schema.path('status').enumValues).toEqual([
      'pending',
      'in_progress',
      'complete',
      'failed',
    ]);
  });

  test('there is a query path for "unfinished slices, oldest first"', () => {
    const indexes = ReviewIngestSlice.schema.indexes();
    const found = indexes.some(([fields]) => 'status' in fields && 'sliceStart' in fields);

    expect(found).toBe(true);
  });
});

describe('claimSlice', () => {
  let findOneAndUpdate;

  beforeEach(() => {
    findOneAndUpdate = jest
      .spyOn(ReviewIngestSlice, 'findOneAndUpdate')
      .mockResolvedValue({ _id: 'claimed' });
  });

  test('claims pending, failed, or stale-in_progress slices — never complete ones', async () => {
    await ReviewIngestSlice.claimSlice({ ...KEY, slice: SLICE });

    const [filter] = findOneAndUpdate.mock.calls[0];
    const statuses = filter.$or.map((c) => c.status);

    expect(statuses).toContainEqual({ $in: ['pending', 'failed'] });
    expect(statuses).toContain('in_progress');
    // 'complete' must not appear in any branch of the $or.
    expect(JSON.stringify(filter.$or)).not.toContain('complete');
  });

  test('an in_progress slice is only claimable once its claim is stale', async () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    await ReviewIngestSlice.claimSlice({ ...KEY, slice: SLICE, now });

    const [filter] = findOneAndUpdate.mock.calls[0];
    const staleBranch = filter.$or.find((c) => c.claimedAt && c.claimedAt.$lt);

    expect(staleBranch).toBeDefined();
    const staleMs = now.getTime() - staleBranch.claimedAt.$lt.getTime();
    expect(staleMs).toBe(ReviewIngestSlice.STALE_CLAIM_MS);
  });

  test('claiming marks in_progress and stamps claimedAt', async () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    await ReviewIngestSlice.claimSlice({ ...KEY, slice: SLICE, now });

    const [, update, opts] = findOneAndUpdate.mock.calls[0];

    expect(update.$set).toMatchObject({ status: 'in_progress', claimedAt: now });
    expect(opts).toMatchObject({ upsert: true, new: true });
  });

  test('slice bounds are $setOnInsert-only so a re-claim cannot rewrite them', async () => {
    await ReviewIngestSlice.claimSlice({ ...KEY, slice: SLICE });

    const [, update] = findOneAndUpdate.mock.calls[0];

    expect(update.$setOnInsert).toEqual({
      sliceStart: new Date(SLICE.createdAfter),
      sliceEnd: new Date(SLICE.createdBefore),
    });
    // Same Mongo constraint as the order upserts: no field in both operators.
    const overlap = Object.keys(update.$set).filter((k) => k in update.$setOnInsert);
    expect(overlap).toEqual([]);
  });

  test('a duplicate-key race returns null instead of throwing', async () => {
    // Happens when the filter misses (slice already complete, or another run just claimed it)
    // so the upsert attempts an insert that collides with the unique index.
    const dup = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    findOneAndUpdate.mockRejectedValue(dup);

    await expect(ReviewIngestSlice.claimSlice({ ...KEY, slice: SLICE })).resolves.toBeNull();
  });

  test('a genuine error still propagates', async () => {
    findOneAndUpdate.mockRejectedValue(new Error('connection lost'));

    await expect(ReviewIngestSlice.claimSlice({ ...KEY, slice: SLICE }))
      .rejects.toThrow('connection lost');
  });

  test('null from the driver (no match, no insert) is treated as "not ours"', async () => {
    findOneAndUpdate.mockResolvedValue(null);

    await expect(ReviewIngestSlice.claimSlice({ ...KEY, slice: SLICE })).resolves.toBeNull();
  });
});

describe('markComplete / markFailed', () => {
  let updateOne;

  beforeEach(() => {
    updateOne = jest.spyOn(ReviewIngestSlice, 'updateOne').mockResolvedValue({});
  });

  test('markComplete records stats and clears any previous error', async () => {
    await ReviewIngestSlice.markComplete('id-1', { pagesFetched: 12, ordersUpserted: 1150 });

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({
      status: 'complete',
      pagesFetched: 12,
      ordersUpserted: 1150,
      error: '',
    });
    expect(update.$set.completedAt).toBeInstanceOf(Date);
  });

  test('markFailed keeps partial progress visible but does NOT mark complete', async () => {
    await ReviewIngestSlice.markFailed('id-1', 'partial: budget', {
      pagesFetched: 7,
      ordersUpserted: 700,
    });

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.status).toBe('failed');
    expect(update.$set.pagesFetched).toBe(7);
    // pagesFetched is observability only — the slice is re-walked in full next run.
    expect(update.$set.status).not.toBe('complete');
  });

  test('a long error message is truncated so one failure cannot bloat the document', async () => {
    await ReviewIngestSlice.markFailed('id-1', 'x'.repeat(5000));

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.error.length).toBeLessThanOrEqual(500);
  });
});

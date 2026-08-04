/**
 * Tests for the chunked fetch loop and failure recording used by syncFinanceData.
 *
 * These target `runChunkedFetch` and `recordSyncFailure` directly rather than driving
 * `syncFinanceData`. That is deliberate: in CommonJS, `syncFinanceData` calls
 * `fetchNewSalesAndExpenses` through an internal binding, so a `jest.spyOn` on the export cannot
 * intercept it and the real SP-API stack would run. Extracting the loop made its semantics —
 * ordering, aggregation, budget handling, and which chunk failed — directly assertable.
 *
 * The behaviours under test:
 *  - a backlog is fetched as several small reports instead of one oversized one (the deadlock fix)
 *  - chunks run OLDEST FIRST, because an aged-out empty day becomes a settled cursor point, so a
 *    mid-loop failure must leave the cursor behind rather than ahead
 *  - a failure is recorded against only the FAILING chunk's dates, never days never attempted
 */

const {
  runChunkedFetch,
  recordSyncFailure,
  enumerateDateChunks,
  resolveSyncWindow,
} = require('../../../Services/Sp_API/FinanceService.js');

const CHUNKS_9_DAYS = enumerateDateChunks('2026-06-15', '2026-06-23', 3);
const STATS = { salesOrders: 10, skuDocs: 5, overheadDocs: 2, pendingOrders: 1 };

function rangeOf(chunk) {
  return `${chunk.startDate}→${chunk.endDate}`;
}

describe('runChunkedFetch — ordering and aggregation', () => {
  test('visits every chunk oldest-first', async () => {
    const seen = [];
    const result = await runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 60000,
      fetchChunk: async (chunk) => { seen.push(rangeOf(chunk)); return STATS; },
    });

    expect(seen).toEqual([
      '2026-06-15→2026-06-17',
      '2026-06-18→2026-06-20',
      '2026-06-21→2026-06-23',
    ]);
    expect(result.chunksCompleted).toBe(3);
    expect(result.stopReason).toBeNull();
  });

  test('passes a zero-based index alongside each chunk', async () => {
    const indices = [];
    await runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 60000,
      fetchChunk: async (_chunk, i) => { indices.push(i); return STATS; },
    });

    expect(indices).toEqual([0, 1, 2]);
  });

  test('sums per-chunk stats', async () => {
    const result = await runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 60000,
      fetchChunk: async () => STATS,
    });

    expect(result.aggregate).toEqual({
      salesOrders: 30,
      skuDocs: 15,
      overheadDocs: 6,
      pendingOrders: 3,
    });
  });

  test('tolerates a chunk returning nothing', async () => {
    const result = await runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 60000,
      fetchChunk: async () => undefined,
    });

    expect(result.aggregate).toEqual({
      salesOrders: 0, skuDocs: 0, overheadDocs: 0, pendingOrders: 0,
    });
    expect(result.chunksCompleted).toBe(3);
  });

  test('a single chunk is the healthy-account path (chunking inert)', async () => {
    const oneDay = enumerateDateChunks('2026-07-27', '2026-07-27', 3);
    const seen = [];

    await runChunkedFetch({
      chunks: oneDay,
      budgetMs: 60000,
      fetchChunk: async (c) => { seen.push(rangeOf(c)); return STATS; },
    });

    expect(seen).toEqual(['2026-07-27→2026-07-27']);
  });

  test('an empty chunk list does nothing and does not throw', async () => {
    const result = await runChunkedFetch({ chunks: [], budgetMs: 60000, fetchChunk: async () => STATS });

    expect(result.chunksCompleted).toBe(0);
    expect(result.stopReason).toBeNull();
  });
});

describe('runChunkedFetch — run budget', () => {
  test('stops between chunks once the budget is spent', async () => {
    jest.useFakeTimers();
    try {
      const seen = [];
      const result = await runChunkedFetch({
        chunks: CHUNKS_9_DAYS,
        budgetMs: 1000,
        fetchChunk: async (c) => {
          seen.push(rangeOf(c));
          jest.advanceTimersByTime(1200); // one chunk alone overruns the 1s budget
          return STATS;
        },
      });

      // Chunk 1 runs to completion, then chunk 2 sees the budget spent.
      expect(seen).toEqual(['2026-06-15→2026-06-17']);
      expect(result.chunksCompleted).toBe(1);
      expect(result.stopReason).toBe('budget');
    } finally {
      jest.useRealTimers();
    }
  });

  test('always completes at least one chunk so a backlog can never stall', async () => {
    // Budget already exhausted on entry: forward progress is still required, otherwise the
    // account would make zero progress forever — the very failure mode being fixed.
    const seen = [];
    const result = await runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 0,
      fetchChunk: async (c) => { seen.push(rangeOf(c)); return STATS; },
    });

    expect(seen).toHaveLength(1);
    expect(result.chunksCompleted).toBe(1);
    expect(result.stopReason).toBe('budget');
  });

  test('a generous budget completes everything', async () => {
    const result = await runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 10 * 60 * 1000,
      fetchChunk: async () => STATS,
    });

    expect(result.chunksCompleted).toBe(3);
    expect(result.stopReason).toBeNull();
  });
});

describe('runChunkedFetch — failure handling', () => {
  test('stops at the failing chunk and does not continue past the gap', async () => {
    const seen = [];
    const failing = runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 60000,
      fetchChunk: async (c, i) => {
        seen.push(rangeOf(c));
        if (i === 1) throw new Error('Report did not complete within 600s');
        return STATS;
      },
    });

    await expect(failing).rejects.toThrow('Report did not complete within 600s');
    // Chunk 3 must NOT run: continuing would let the cursor advance past unfetched days.
    expect(seen).toEqual(['2026-06-15→2026-06-17', '2026-06-18→2026-06-20']);
  });

  test('attaches the failing chunk to the error for scoped bookkeeping', async () => {
    const err = await runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 60000,
      fetchChunk: async (c, i) => {
        if (i === 1) throw new Error('boom');
        return STATS;
      },
    }).catch((e) => e);

    expect(err.failedChunk).toEqual({ startDate: '2026-06-18', endDate: '2026-06-20' });
    expect(err.chunksCompletedBeforeFailure).toBe(1);
  });

  test('a first-chunk failure reports zero completed', async () => {
    const err = await runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 60000,
      fetchChunk: async () => { throw new Error('boom'); },
    }).catch((e) => e);

    expect(err.chunksCompletedBeforeFailure).toBe(0);
    expect(err.failedChunk.startDate).toBe('2026-06-15');
  });

  test('the original error is preserved, not wrapped', async () => {
    const original = new Error('Report did not complete within 600s');
    const err = await runChunkedFetch({
      chunks: CHUNKS_9_DAYS,
      budgetMs: 60000,
      fetchChunk: async () => { throw original; },
    }).catch((e) => e);

    expect(err).toBe(original);
  });
});

describe('recordSyncFailure', () => {
  // A mock that ENFORCES the real unique index (User, country, region, date).
  //
  // This matters: the previous mock was `{ findOneAndUpdate: jest.fn() }`, which cannot express a
  // unique constraint — so these tests passed while production threw
  // `E11000 duplicate key error ... User_1_country_1_region_1_date_1` on every single failure.
  // The old code combined `status: { $ne: 'success' }` in the filter with `upsert: true`; when a
  // 'success' row existed the filter missed, Mongo fell through to INSERT, and the index rejected
  // it. The failure was therefore never recorded, which is what let one account loop on the same
  // chunk ~8x/day for a full day with nothing downstream able to notice.
  let rows;
  let model;

  const keyOf = (d) => `${d.User}|${d.country}|${d.region}|${d.date}`;
  const matches = (row, filter) => Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$ne' in v) return row[k] !== v.$ne;
    return row[k] === v;
  });

  beforeEach(() => {
    rows = [];
    model = {
      _rows: rows,
      async updateOne(filter, update) {
        const row = rows.find((r) => matches(r, filter));
        if (!row) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(row, update.$set || {});
        for (const [k, n] of Object.entries(update.$inc || {})) row[k] = (row[k] || 0) + n;
        return { matchedCount: 1, modifiedCount: 1 };
      },
      async exists(filter) {
        const row = rows.find((r) => matches(r, filter));
        return row ? { _id: keyOf(row) } : null;
      },
      async create(doc) {
        if (rows.some((r) => keyOf(r) === keyOf(doc))) {
          throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
        }
        rows.push({ ...doc });
        return doc;
      },
      async findOne(filter) {
        const row = rows.find((r) => matches(r, filter));
        return { lean: async () => (row ? { ...row } : null) };
      },
    };
    // findOne(...).lean() shape
    model.findOne = (filter) => ({ lean: async () => {
      const row = rows.find((r) => matches(r, filter));
      return row ? { ...row } : null;
    } });
  });

  const base = {
    userObjectId: 'uid',
    country: 'us',
    region: 'NA',
    err: new Error('Report did not complete within 600s'),
    errorKind: 'timeout',
  };
  const call = (over = {}) => recordSyncFailure({ ...base, FinanceSyncLogModel: model, from: '2026-06-18', to: '2026-06-18', ...over });

  test('writes one row per date in the given range, inclusive', async () => {
    const dates = await call({ from: '2026-06-18', to: '2026-06-20' });
    expect(dates).toEqual(['2026-06-18', '2026-06-19', '2026-06-20']);
    expect(rows.map((r) => r.date).sort()).toEqual(['2026-06-18', '2026-06-19', '2026-06-20']);
  });

  test('scopes to the failing chunk only — never days that were not attempted', async () => {
    await call({ from: '2026-06-18', to: '2026-06-20' });
    const written = rows.map((r) => r.date);
    expect(written).not.toContain('2026-06-15'); // earlier chunk succeeded
    expect(written).not.toContain('2026-06-21'); // later chunk never ran
  });

  test('an existing SUCCESS row is left untouched and does NOT throw', async () => {
    // THE production bug. Previously this threw E11000 and aborted the whole chunk.
    rows.push({ User: 'uid', country: 'US', region: 'NA', date: '2026-06-18', status: 'success', provisional: false });
    await expect(call()).resolves.toEqual(['2026-06-18']);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('success');   // never downgraded — the original intent, preserved
  });

  test('one date with a success row does not stop the other dates being recorded', async () => {
    // The old code had no per-date try/catch, so the first date's throw lost the whole chunk.
    rows.push({ User: 'uid', country: 'US', region: 'NA', date: '2026-06-18', status: 'success' });
    await call({ from: '2026-06-18', to: '2026-06-20' });
    const failed = rows.filter((r) => r.status === 'failed').map((r) => r.date);
    expect(failed).toEqual(['2026-06-19', '2026-06-20']);
  });

  test('an existing FAILED row is updated and its failure count increments', async () => {
    rows.push({ User: 'uid', country: 'US', region: 'NA', date: '2026-06-18', status: 'failed', consecutiveFailures: 2 });
    await call();
    expect(rows[0].consecutiveFailures).toBe(3);
    expect(rows[0].status).toBe('failed');
  });

  test('a first failure inserts a row with consecutiveFailures = 1', async () => {
    await call();
    expect(rows[0].consecutiveFailures).toBe(1);
    expect(rows[0].status).toBe('failed');
  });

  test('a concurrent insert (E11000) is swallowed, not propagated', async () => {
    // A racing run inserted first. Its row is as good as ours; this is the only legitimate E11000.
    model.create = async () => { throw Object.assign(new Error('E11000 dup'), { code: 11000 }); };
    await expect(call()).resolves.toEqual(['2026-06-18']);
  });

  test('a NON-E11000 write error is contained, never thrown to the caller', async () => {
    // Recording a failure must never itself fail the run — being blind is how this went unnoticed.
    model.updateOne = async () => { throw new Error('mongo exploded'); };
    await expect(call({ from: '2026-06-18', to: '2026-06-19' })).resolves.toEqual(['2026-06-18', '2026-06-19']);
  });

  test('records errorKind and upper-cases the country', async () => {
    await call();
    expect(rows[0].country).toBe('US');
    expect(rows[0].errorKind).toBe('timeout');
    expect(rows[0].status).toBe('failed');
  });

  test('truncates a very long error message', async () => {
    await call({ err: new Error('x'.repeat(2000)) });
    expect(rows[0].error.length).toBe(500);
  });

  test('backs off: early failures stay on the normal cadence, later ones do not', async () => {
    // The sweeper runs every 3h and re-enqueues any `failed` day, so without a backoff a window
    // that cannot succeed is retried ~8x/day forever.
    rows.push({ User: 'uid', country: 'US', region: 'NA', date: '2026-06-18', status: 'failed', consecutiveFailures: 0 });
    await call();
    expect(rows[0].nextRetryAfter == null).toBe(true);          // attempt 1 — no backoff yet

    rows[0].consecutiveFailures = 4;
    await call();
    expect(rows[0].nextRetryAfter).toBeInstanceOf(Date);        // attempt 5 — backed off
    expect(rows[0].nextRetryAfter.getTime()).toBeGreaterThan(Date.now());
  });

  test('a single-day range writes exactly one row', async () => {
    const dates = await call();
    expect(dates).toEqual(['2026-06-18']);
    expect(rows).toHaveLength(1);
  });
});

describe('end-to-end: a 43-day backlog drains across runs without gaps', () => {
  test('successive runs resume where the previous one stopped', async () => {
    // Models the real account: no sync history, a long backlog, and a budget that only permits a
    // few chunks per run. The cursor is the MAX success date, so the property that matters is that
    // successive runs cover every day exactly once with no gap — a gap would let the cursor jump
    // past unfetched days and settle them at $0 permanently.
    const YESTERDAY = '2026-07-27';
    const CHUNK_DAYS = 3;
    const CHUNKS_PER_RUN = 4;

    let cursor = null; // no history
    const fetchedDays = [];
    const runSummaries = [];

    for (let run = 0; run < 12; run++) {
      const w = resolveSyncWindow({
        yesterdayStr: YESTERDAY,
        latestSyncDate: cursor,
        backfillDays: 30,
        maxIncrementalDays: 14,
        resyncDays: 0,
      });
      if (w.mode === 'up_to_date') break;

      const chunks = enumerateDateChunks(w.startDate, w.endDate, CHUNK_DAYS);
      let n = 0;
      const result = await runChunkedFetch({
        chunks,
        budgetMs: 60000,
        fetchChunk: async (chunk) => {
          if (n >= CHUNKS_PER_RUN) {
            // Force the loop to stop as a real budget exhaustion would.
            const e = new Error('__stop__');
            e.__synthetic = true;
            throw e;
          }
          n++;
          let d = chunk.startDate;
          while (d <= chunk.endDate) { fetchedDays.push(d); d = addDaysStrLocal(d, 1); }
          // The cursor advances to the newest day this chunk filled.
          cursor = chunk.endDate;
          return STATS;
        },
      }).catch((e) => {
        if (e.__synthetic) return { chunksCompleted: n, stopReason: 'budget', aggregate: {} };
        throw e;
      });

      runSummaries.push(result.chunksCompleted);
      if (result.chunksCompleted === 0) break; // no progress — would be a stall bug
    }

    // Progress was made on every run (no stall).
    expect(runSummaries.every((c) => c > 0)).toBe(true);
    // The backlog was fully drained up to yesterday.
    expect(fetchedDays[fetchedDays.length - 1]).toBe(YESTERDAY);
    // And crucially: no day fetched twice, no day skipped.
    expect(new Set(fetchedDays).size).toBe(fetchedDays.length);
    for (let i = 1; i < fetchedDays.length; i++) {
      expect(fetchedDays[i]).toBe(addDaysStrLocal(fetchedDays[i - 1], 1));
    }
  });
});

// Local copy so this test does not depend on the module's own date helper being correct.
function addDaysStrLocal(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

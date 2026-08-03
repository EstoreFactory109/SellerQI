/**
 * Tests for the finance sync's date-window selection and report chunking.
 *
 * Why these matter more than usual:
 *  - `FinanceService.js` had NO test coverage, yet 55 accounts depend on this window logic. The
 *    truth table below pins the behaviour that was previously inline, so the extraction is
 *    provably a refactor and not a change.
 *  - The no-history branch is unreachable from every existing script (they all pass
 *    `forceDates`, which bypasses the cursor), so a unit test is the only practical way to
 *    verify the branch that actually caused the outage.
 *
 * Style follows __tests__/shared/financeCalculations.test.js: real module, literal fixtures,
 * zero mocks.
 */

const {
  resolveSyncWindow,
  enumerateDateChunks,
  classifySyncFailure,
  addDaysStr,
  daysBetweenInclusive,
  buildOverheadBuckets,
} = require('../../../Services/Sp_API/FinanceService.js');

const YESTERDAY = '2026-07-27';

describe('date helpers', () => {
  test('addDaysStr moves whole days in UTC', () => {
    expect(addDaysStr('2026-07-27', 1)).toBe('2026-07-28');
    expect(addDaysStr('2026-07-27', -1)).toBe('2026-07-26');
    expect(addDaysStr('2026-07-27', 0)).toBe('2026-07-27');
  });

  test('addDaysStr crosses month and year boundaries', () => {
    expect(addDaysStr('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDaysStr('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysStr('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('addDaysStr handles a leap day', () => {
    expect(addDaysStr('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysStr('2028-03-01', -1)).toBe('2028-02-29');
  });

  test('daysBetweenInclusive counts both endpoints', () => {
    expect(daysBetweenInclusive('2026-07-27', '2026-07-27')).toBe(1);
    expect(daysBetweenInclusive('2026-07-01', '2026-07-03')).toBe(3);
    expect(daysBetweenInclusive('2026-06-28', '2026-07-02')).toBe(5);
  });

  test('the extracted backfill start matches the old millisecond arithmetic', () => {
    // The inline version computed `yesterdayPacificMs - (backfillDays-1)*86400000` and sliced
    // the ISO string. Prove the string-based version agrees for a full year of dates and a
    // range of window sizes, so the refactor cannot have shifted anyone's window by a day.
    const PACIFIC_OFFSET_HOURS = 7;
    for (let dayOffset = 0; dayOffset < 365; dayOffset++) {
      const now = new Date(Date.UTC(2026, 0, 1, 9, 30, 0) + dayOffset * 86400000);
      const yesterdayPacificMs =
        now.getTime() - PACIFIC_OFFSET_HOURS * 3600000 - 86400000;
      const yesterdayStr = new Date(yesterdayPacificMs).toISOString().substring(0, 10);

      for (const backfillDays of [1, 3, 7, 14, 30, 60]) {
        const legacy = new Date(yesterdayPacificMs - (backfillDays - 1) * 86400000)
          .toISOString()
          .substring(0, 10);
        expect(addDaysStr(yesterdayStr, -(backfillDays - 1))).toBe(legacy);
      }
    }
  });
});

describe('resolveSyncWindow — forceDates', () => {
  test('uses the supplied range verbatim and never consults the cursor', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: '2026-01-01',
      forceDates: ['2026-06-15', '2026-06-23'],
      backfillDays: 30,
      maxIncrementalDays: 14,
      resyncDays: 14,
    });

    expect(w.mode).toBe('forced');
    expect(w.startDate).toBe('2026-06-15');
    expect(w.endDate).toBe('2026-06-23');
  });

  test('a malformed forceDates array falls through to the cursor logic', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: null,
      forceDates: ['2026-06-15'],
      backfillDays: 30,
    });

    expect(w.mode).toBe('backfill');
  });
});

describe('resolveSyncWindow — no history (the branch that deadlocked)', () => {
  test('requests backfillDays ending yesterday', () => {
    const w = resolveSyncWindow({ yesterdayStr: YESTERDAY, latestSyncDate: null, backfillDays: 30 });

    expect(w.mode).toBe('backfill');
    expect(w.endDate).toBe(YESTERDAY);
    expect(w.startDate).toBe('2026-06-28');
    expect(daysBetweenInclusive(w.startDate, w.endDate)).toBe(30);
  });

  test('maxIncrementalDays does NOT clamp this branch — the window stays 30 days', () => {
    // This is the documented pre-existing behaviour and the reason the account stalled: a
    // 30-day report was requested no matter what. The fix is chunking, not clamping, so the
    // resolved window is intentionally unchanged here.
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: null,
      backfillDays: 30,
      maxIncrementalDays: 14,
    });

    expect(daysBetweenInclusive(w.startDate, w.endDate)).toBe(30);
  });

  test('a 1-day backfill is a single day, not an empty range', () => {
    const w = resolveSyncWindow({ yesterdayStr: YESTERDAY, latestSyncDate: null, backfillDays: 1 });

    expect(w.startDate).toBe(YESTERDAY);
    expect(w.endDate).toBe(YESTERDAY);
  });
});

describe('resolveSyncWindow — caught up', () => {
  test('with no resyncDays it reports up_to_date and no window', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: YESTERDAY,
      resyncDays: 0,
    });

    expect(w.mode).toBe('up_to_date');
    expect(w.startDate).toBeNull();
    expect(w.endDate).toBeNull();
  });

  test('a cursor ahead of yesterday is still up_to_date', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: '2026-07-28',
      resyncDays: 0,
    });

    expect(w.mode).toBe('up_to_date');
  });

  test('with resyncDays it re-fetches the trailing window to catch cancellations', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: YESTERDAY,
      resyncDays: 14,
    });

    expect(w.mode).toBe('resync');
    expect(w.endDate).toBe(YESTERDAY);
    expect(w.startDate).toBe('2026-07-14');
    expect(daysBetweenInclusive(w.startDate, w.endDate)).toBe(14);
  });
});

describe('resolveSyncWindow — incremental', () => {
  test('starts the day after the cursor and ends yesterday', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: '2026-07-25',
      maxIncrementalDays: 14,
      resyncDays: 0,
    });

    expect(w.mode).toBe('incremental');
    expect(w.startDate).toBe('2026-07-26');
    expect(w.endDate).toBe(YESTERDAY);
  });

  test('a healthy daily account gets a ONE day window (so chunking is a no-op)', () => {
    // This is the key blast-radius property: 3-day chunking cannot change behaviour for an
    // account that synced yesterday.
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: '2026-07-26',
      maxIncrementalDays: 14,
      resyncDays: 0,
    });

    expect(daysBetweenInclusive(w.startDate, w.endDate)).toBe(1);
    expect(enumerateDateChunks(w.startDate, w.endDate, 3)).toHaveLength(1);
  });

  test('resyncDays extends the start backward when it reaches further back', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: '2026-07-26',
      maxIncrementalDays: 30,
      resyncDays: 14,
    });

    expect(w.startDate).toBe('2026-07-14');
    expect(w.endDate).toBe(YESTERDAY);
  });

  test('resyncDays never pulls the start forward', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: '2026-07-01',
      maxIncrementalDays: 60,
      resyncDays: 3,
    });

    expect(w.startDate).toBe('2026-07-02'); // cursor+1, not yesterday-2
  });

  test('clamps the END forward from the oldest day, never the start backward', () => {
    // Clamping the start would skip the oldest days permanently: the cursor is the MAX success
    // date, so it would jump past them and they would never be re-requested.
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: '2026-06-01',
      maxIncrementalDays: 14,
      resyncDays: 0,
    });

    expect(w.startDate).toBe('2026-06-02'); // oldest unfilled day preserved
    expect(w.endDate).toBe('2026-06-15'); // start + 13
    expect(daysBetweenInclusive(w.startDate, w.endDate)).toBe(14);
  });

  test('a gap smaller than the cap is not clamped', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: '2026-07-20',
      maxIncrementalDays: 14,
      resyncDays: 0,
    });

    expect(w.endDate).toBe(YESTERDAY);
  });

  test('no cap means the full gap is requested', () => {
    const w = resolveSyncWindow({
      yesterdayStr: YESTERDAY,
      latestSyncDate: '2026-05-01',
      maxIncrementalDays: null,
      resyncDays: 0,
    });

    expect(w.startDate).toBe('2026-05-02');
    expect(w.endDate).toBe(YESTERDAY);
  });

  test('repeated runs drain a long gap oldest-first with no skipped days', () => {
    // Simulates the scheduler: each run fills its window, the cursor advances to that window's
    // end, and the next run continues. Every day must be covered exactly once.
    let cursor = '2026-06-01';
    const covered = [];
    for (let run = 0; run < 10; run++) {
      const w = resolveSyncWindow({
        yesterdayStr: YESTERDAY,
        latestSyncDate: cursor,
        maxIncrementalDays: 14,
        resyncDays: 0,
      });
      if (w.mode === 'up_to_date') break;
      let d = w.startDate;
      while (d <= w.endDate) { covered.push(d); d = addDaysStr(d, 1); }
      cursor = w.endDate;
    }

    // Contiguous from cursor+1 through yesterday, no duplicates, no gaps.
    expect(covered[0]).toBe('2026-06-02');
    expect(covered[covered.length - 1]).toBe(YESTERDAY);
    expect(new Set(covered).size).toBe(covered.length);
    for (let i = 1; i < covered.length; i++) {
      expect(covered[i]).toBe(addDaysStr(covered[i - 1], 1));
    }
  });
});

describe('enumerateDateChunks', () => {
  test('splits a window into contiguous chunks, oldest first', () => {
    const chunks = enumerateDateChunks('2026-06-15', '2026-06-23', 3);

    expect(chunks).toEqual([
      { startDate: '2026-06-15', endDate: '2026-06-17' },
      { startDate: '2026-06-18', endDate: '2026-06-20' },
      { startDate: '2026-06-21', endDate: '2026-06-23' },
    ]);
  });

  test('chunks are contiguous with no gaps or overlaps', () => {
    const chunks = enumerateDateChunks('2026-06-28', '2026-07-27', 3);

    expect(chunks[0].startDate).toBe('2026-06-28');
    expect(chunks[chunks.length - 1].endDate).toBe('2026-07-27');
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startDate).toBe(addDaysStr(chunks[i - 1].endDate, 1));
    }
  });

  test('the final chunk is clamped to endDate, never past it', () => {
    const chunks = enumerateDateChunks('2026-06-15', '2026-06-22', 3); // 8 days / 3

    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toEqual({ startDate: '2026-06-21', endDate: '2026-06-22' });
  });

  test('every day in the window is covered exactly once', () => {
    const chunks = enumerateDateChunks('2026-06-28', '2026-07-27', 3);
    const days = [];
    for (const c of chunks) {
      let d = c.startDate;
      while (d <= c.endDate) { days.push(d); d = addDaysStr(d, 1); }
    }

    expect(days).toHaveLength(30);
    expect(new Set(days).size).toBe(30);
  });

  test('a single-day window is one chunk', () => {
    expect(enumerateDateChunks('2026-07-27', '2026-07-27', 3)).toEqual([
      { startDate: '2026-07-27', endDate: '2026-07-27' },
    ]);
  });

  test('a window shorter than the chunk size is one chunk', () => {
    expect(enumerateDateChunks('2026-07-26', '2026-07-27', 3)).toEqual([
      { startDate: '2026-07-26', endDate: '2026-07-27' },
    ]);
  });

  test('chunkDays 0 disables chunking — the rollback path', () => {
    expect(enumerateDateChunks('2026-06-28', '2026-07-27', 0)).toEqual([
      { startDate: '2026-06-28', endDate: '2026-07-27' },
    ]);
  });

  test('an inverted or missing range yields no chunks', () => {
    expect(enumerateDateChunks('2026-07-27', '2026-06-15', 3)).toEqual([]);
    expect(enumerateDateChunks(null, '2026-06-15', 3)).toEqual([]);
    expect(enumerateDateChunks('2026-06-15', null, 3)).toEqual([]);
  });

  test('a 30-day backfill becomes 10 three-day reports', () => {
    // The concrete shape of the fix for the affected account.
    const w = resolveSyncWindow({ yesterdayStr: YESTERDAY, latestSyncDate: null, backfillDays: 30 });
    expect(enumerateDateChunks(w.startDate, w.endDate, 3)).toHaveLength(10);
  });
});

describe('buildOverheadBuckets — range filtering (chunk cross-contamination guard)', () => {
  // Why this matters: every overhead bucket's date lands in `datesToClear`, and that drives a
  // deleteMany against DailySkuFinance as well. An out-of-range date therefore DELETES that day's
  // sales rows without reinserting them. Once the sync fetches in chunks, a later chunk could wipe
  // sales an earlier chunk had just written and already stamped `success` — a settled $0 for a day
  // with real revenue, i.e. the dashboard-at-zero symptom returning silently.
  //
  // The Finance API window per fetch reaches several days BEFORE the sales window (settlement lag),
  // and events like Reserve Release / Disbursement post daily, so out-of-range dates are routine.
  const RANGE_START = '2026-07-10';
  const RANGE_END = '2026-07-12';

  const revenue = (postedDateStr, category = 'Reserve Release') => ({
    category,
    postedDateStr,
    postedDate: null,
    amount: 100,
  });
  const expense = (postedDateStr, category = 'Storage Fee') => ({
    category,
    postedDateStr,
    postedDate: null,
    amount: -5,
    sku: 'N/A',
  });

  test('overhead REVENUE outside the range is excluded', () => {
    const buckets = buildOverheadBuckets(
      [],
      [revenue('2026-07-07'), revenue('2026-07-11')],
      RANGE_START,
      RANGE_END
    );

    const dates = [...buckets.values()].map((b) => b.date);
    expect(dates).toEqual(['2026-07-11']);
    // 07-07 belongs to an earlier chunk; including it here would clear that chunk's SKU rows.
    expect(dates).not.toContain('2026-07-07');
  });

  test('overhead EXPENSES outside the range are excluded (pre-existing behaviour)', () => {
    const buckets = buildOverheadBuckets(
      [expense('2026-07-07'), expense('2026-07-11')],
      [],
      RANGE_START,
      RANGE_END
    );

    expect([...buckets.values()].map((b) => b.date)).toEqual(['2026-07-11']);
  });

  test('in-range revenue and expenses are both kept', () => {
    const buckets = buildOverheadBuckets(
      [expense('2026-07-10')],
      [revenue('2026-07-12')],
      RANGE_START,
      RANGE_END
    );

    expect([...buckets.values()].map((b) => b.date).sort()).toEqual(['2026-07-10', '2026-07-12']);
  });

  test('with no range supplied nothing is filtered (callers that pass no bounds)', () => {
    const buckets = buildOverheadBuckets([], [revenue('2026-07-07')], null, null);

    expect([...buckets.values()].map((b) => b.date)).toEqual(['2026-07-07']);
  });

  test('no bucket date can fall outside the requested chunk window', () => {
    // The invariant that makes chunking safe: datesToClear ⊆ [chunk.start, chunk.end].
    const buckets = buildOverheadBuckets(
      [expense('2026-07-01'), expense('2026-07-11')],
      [revenue('2026-07-02'), revenue('2026-07-12'), revenue('2026-07-20')],
      RANGE_START,
      RANGE_END
    );

    for (const b of buckets.values()) {
      expect(b.date >= RANGE_START && b.date <= RANGE_END).toBe(true);
    }
  });
});

describe('classifySyncFailure', () => {
  test('the report poll cap is a timeout', () => {
    expect(classifySyncFailure(new Error('Report did not complete within 600s'))).toBe('timeout');
  });

  test('the new download failures are timeouts', () => {
    expect(classifySyncFailure(new Error('[sales] download stalled — no data for 60s after 12 bytes'))).toBe('timeout');
    expect(classifySyncFailure(new Error('[sales] download exceeded 300s (received 5 bytes)'))).toBe('timeout');
    expect(classifySyncFailure(new Error('[sales] no response within 60s'))).toBe('timeout');
  });

  test('a revoked grant is auth_denied, not a timeout', () => {
    const err = new Error('createReport failed: [{"code":"Unauthorized","message":"Access to requested resource is denied."}]');
    expect(classifySyncFailure(err)).toBe('auth_denied');
  });

  test('auth_denied wins over timeout wording', () => {
    expect(classifySyncFailure(new Error('Access to requested resource is denied (timeout)'))).toBe('auth_denied');
  });

  test('socket-level drops are classified, not lumped into other', () => {
    // Amazon resets the connection during long report polls. This surfaced as a bare
    // `Error: socket hang up` that fell through to 'other', hiding a distinctly retryable cause
    // and making a transient blip look like a permanent data problem in FinanceSyncLog.
    expect(classifySyncFailure(new Error('socket hang up'))).toBe('timeout');
    expect(classifySyncFailure(new Error('read ECONNRESET'))).toBe('timeout');
    expect(classifySyncFailure(new Error('write EPIPE'))).toBe('timeout');
    expect(classifySyncFailure(new Error('[FinanceService] request timed out after 30000ms'))).toBe('timeout');
  });

  test('anything else is other', () => {
    expect(classifySyncFailure(new Error('E11000 duplicate key'))).toBe('other');
    expect(classifySyncFailure(new Error('parsed 0 rows'))).toBe('other');
    expect(classifySyncFailure(null)).toBe('other');
  });
});

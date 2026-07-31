/**
 * Tests for the incremental (page-by-page) finance index fold.
 *
 * WHY THIS MATTERS
 * The Finance API transactions leg OOM'd a 2GB heap because every page's parsed transaction graph
 * was retained for the whole window. The fix converts each page to rows, folds them into a shared
 * index, and drops the page. That is only safe if folding page-by-page produces EXACTLY what a
 * single pass over the concatenation produced — and it is not obviously so, because the dedup keeps
 * the FIRST transactionId seen per orderId+SKU, which makes the fold order-dependent.
 *
 * The equivalence tests below are therefore the core correctness guarantee for this change, not a
 * nice-to-have. They are what stands between "uses less memory" and "silently attributes different
 * fees to different days".
 */

const {
  createFinanceIndex,
  addFinanceRowsToIndex,
  indexFinanceRowsByOrderId,
  classifySyncFailure,
  runChunkedFetch,
  enumerateDateChunks,
} = require('../../../Services/Sp_API/FinanceService.js');

// ── fixtures ────────────────────────────────────────────────────────────────────
const expense = (over = {}) => ({
  orderId: 'O1',
  sku: 'S1',
  asin: 'A1',
  category: 'FBA Fulfillment Fee',
  transactionType: 'Shipment',
  transactionId: 'T1',
  amount: -3.5,
  postedDateStr: '2026-07-01',
  postedDate: null,
  isAmazonFee: true,
  ...over,
});

const revenue = (over = {}) => ({
  orderId: 'O1',
  sku: 'S1',
  asin: 'A1',
  category: 'Product Sales',
  transactionType: 'Shipment',
  transactionId: 'T1',
  amount: 25,
  quantity: 1,
  postedDateStr: '2026-07-01',
  postedDate: null,
  ...over,
});

/** Canonical, comparable form of an index — Maps are not deep-equal friendly. */
function snapshot(index) {
  const mapOf = (m) => [...m.entries()]
    .map(([k, v]) => [k, v.map((row) => `${row.transactionId}|${row.category}|${row.amount}`)])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  // transactionId is included deliberately: without it these comparisons could not detect a row
  // carrying the wrong transaction into the right bucket.
  const listOf = (l) => l.map((row) => `${row.orderId}|${row.sku}|${row.category}|${row.amount}|${row.transactionId}`);

  return {
    expensesByOrderSku: mapOf(index.expensesByOrderSku),
    unattributedExpensesByOrder: mapOf(index.unattributedExpensesByOrder),
    revenueByOrderSku: mapOf(index.revenueByOrderSku),
    unattributedRevenueByOrder: mapOf(index.unattributedRevenueByOrder),
    overheadExpenses: listOf(index.overheadExpenses),
    overheadRevenue: listOf(index.overheadRevenue),
    postedDateExpenses: listOf(index.postedDateExpenses),
    postedDateRevenue: listOf(index.postedDateRevenue),
    dedupCount: index.dedupCount,
    dedupRevCount: index.dedupRevCount,
    firstTxnByOrderSku: [...index._firstTxnByOrderSku.entries()].sort(),
    firstTxnRevByOrderSku: [...index._firstTxnRevByOrderSku.entries()].sort(),
  };
}

/** Fold rows in pages of the given sizes. */
function foldInPages(expenseRows, revenueRows, pageSizes) {
  const index = createFinanceIndex();
  let ei = 0;
  let ri = 0;
  for (const size of pageSizes) {
    addFinanceRowsToIndex(index, expenseRows.slice(ei, ei + size), revenueRows.slice(ri, ri + size));
    ei += size;
    ri += size;
  }
  // Anything left over (uneven split) goes in a final page.
  if (ei < expenseRows.length || ri < revenueRows.length) {
    addFinanceRowsToIndex(index, expenseRows.slice(ei), revenueRows.slice(ri));
  }
  return index;
}

describe('fold equivalence — the core guarantee', () => {
  // A deliberately awkward fixture: duplicate transactions, N/A SKUs, missing orderIds,
  // posted-date types, overhead, and per-ASIN rows with a SKU but no orderId.
  const EXPENSES = [
    expense({ orderId: 'O1', sku: 'S1', transactionId: 'T1' }),
    expense({ orderId: 'O1', sku: 'S1', transactionId: 'T1', category: 'Commission', amount: -2 }), // same txn, kept
    expense({ orderId: 'O1', sku: 'S1', transactionId: 'T9', amount: -3.5 }),                        // dup txn, dropped
    expense({ orderId: 'O2', sku: 'N/A', transactionId: 'T2' }),                                     // unattributed
    expense({ orderId: 'O3', sku: 'S2', transactionId: 'T3', transactionType: 'Refund' }),            // posted-date
    expense({ orderId: null, sku: 'N/A', category: 'Storage Fee', transactionType: 'ServiceFee' }),   // overhead
    expense({ orderId: null, sku: 'S5', category: 'Clawback', transactionType: 'Adjustment' }),       // per-ASIN
    expense({ orderId: 'O4', sku: 'S3', transactionId: 'T4' }),
    expense({ orderId: 'O4', sku: 'S3', transactionId: 'T8' }),                                      // dup txn, dropped
  ];

  const REVENUE = [
    revenue({ orderId: 'O1', sku: 'S1', transactionId: 'T1' }),                                   // Product Sales/Shipment → skipped
    revenue({ orderId: 'O3', sku: 'S2', transactionId: 'T3', transactionType: 'Refund', amount: -25 }),
    revenue({ orderId: 'O5', sku: 'N/A', transactionId: 'T5', category: 'Reserve Release', amount: 10 }),
    revenue({ orderId: null, sku: 'N/A', category: 'Reserve Release', transactionType: 'Other', amount: 7 }),
    revenue({ orderId: null, sku: 'S6', category: 'Warehouse Lost', transactionType: 'Other', amount: 4 }),
    revenue({ orderId: 'O6', sku: 'S4', transactionId: 'T6' }),
    revenue({ orderId: 'O6', sku: 'S4', transactionId: 'T7' }),                                   // Product Sales/Shipment → skipped
  ];

  const oneShot = () => snapshot(indexFinanceRowsByOrderId(EXPENSES, REVENUE));

  test.each([
    ['one page (degenerate)', [99]],
    ['pages of 1', [1, 1, 1, 1, 1, 1, 1, 1, 1]],
    ['pages of 2', [2, 2, 2, 2, 2]],
    ['pages of 3', [3, 3, 3]],
    ['uneven pages', [1, 4, 2, 1]],
    ['a leading empty page', [0, 5, 4]],
    ['trailing empty pages', [5, 4, 0, 0]],
  ])('folding in %s equals a single pass', (_name, pageSizes) => {
    expect(snapshot(foldInPages(EXPENSES, REVENUE, pageSizes))).toEqual(oneShot());
  });

  test('the dedup winner is the FIRST transactionId, even across a page boundary', () => {
    // T1 and T9 for O1||S1 land in different pages; T1 arrives first so T1 must win and T9 drop.
    const folded = foldInPages(EXPENSES, REVENUE, [2, 7]);

    expect(folded._firstTxnByOrderSku.get('O1||S1')).toBe('T1');
    expect(folded.dedupCount).toBe(2); // T9 for O1||S1 and T8 for O4||S3
    expect(snapshot(folded).dedupCount).toBe(oneShot().dedupCount);
  });

  test('a fresh index is genuinely empty', () => {
    const index = createFinanceIndex();

    expect(index.expensesByOrderSku.size).toBe(0);
    expect(index.overheadExpenses).toEqual([]);
    expect(index.postedDateRevenue).toEqual([]);
    expect(index.dedupCount).toBe(0);
    expect(index.dedupRevCount).toBe(0);
  });

  test('folding nothing is a no-op', () => {
    const index = createFinanceIndex();
    addFinanceRowsToIndex(index, [], []);
    addFinanceRowsToIndex(index);

    expect(snapshot(index)).toEqual(snapshot(createFinanceIndex()));
  });

  test('two independent indexes do not share state', () => {
    // Guards against the maps being hoisted to module scope by a careless refactor, which would
    // leak one account's finance rows into another's.
    const a = createFinanceIndex();
    const b = createFinanceIndex();
    addFinanceRowsToIndex(a, [expense({ orderId: 'OA', sku: 'SA', transactionId: 'TA' })], []);

    expect(a.expensesByOrderSku.size).toBe(1);
    expect(b.expensesByOrderSku.size).toBe(0);
  });

  test('routing is unchanged: Shipment→purchase-date, others→posted-date, no orderId→overhead', () => {
    const snap = oneShot();

    // O1||S1 keeps the two same-transaction rows; O4||S3 keeps one.
    expect(snap.expensesByOrderSku.map(([k]) => k)).toEqual(['O1||S1', 'O4||S3']);
    // N/A SKU with an orderId is unattributed, not overhead.
    expect(snap.unattributedExpensesByOrder.map(([k]) => k)).toEqual(['O2']);
    // Refund (non-Shipment) goes to posted-date, plus the per-ASIN no-orderId row.
    expect(snap.postedDateExpenses).toHaveLength(2);
    // Only the no-orderId, no-SKU row is overhead.
    expect(snap.overheadExpenses).toHaveLength(1);
  });
});

describe('heap guard in runChunkedFetch', () => {
  const CHUNKS = enumerateDateChunks('2026-06-15', '2026-06-23', 3); // 3 chunks

  test('stops with stopReason "memory" once the limit is crossed', async () => {
    const seen = [];
    const result = await runChunkedFetch({
      chunks: CHUNKS,
      budgetMs: 60000,
      heapLimitBytes: 1, // effectively always over
      fetchChunk: async (c) => { seen.push(c.startDate); return {}; },
    });

    // One chunk still runs — forward progress is mandatory, or a large account stalls forever.
    expect(seen).toHaveLength(1);
    expect(result.chunksCompleted).toBe(1);
    expect(result.stopReason).toBe('memory');
  });

  test('a limit of 0 disables the guard', async () => {
    const result = await runChunkedFetch({
      chunks: CHUNKS,
      budgetMs: 60000,
      heapLimitBytes: 0,
      fetchChunk: async () => ({}),
    });

    expect(result.chunksCompleted).toBe(3);
    expect(result.stopReason).toBeNull();
  });

  test('a realistic limit lets everything through', async () => {
    const result = await runChunkedFetch({
      chunks: CHUNKS,
      budgetMs: 60000,
      heapLimitBytes: 8 * 1024 * 1024 * 1024, // 8GB — never reached in a test
      fetchChunk: async () => ({}),
    });

    expect(result.chunksCompleted).toBe(3);
    expect(result.stopReason).toBeNull();
  });

  test('the guard never prevents the first chunk from running', async () => {
    // Deliberate: a run must always attempt one chunk even on an already-warm worker, or a large
    // account could make zero progress indefinitely — the exact failure this work exists to remove.
    let called = 0;
    await runChunkedFetch({
      chunks: CHUNKS,
      budgetMs: 60000,
      heapLimitBytes: 1,
      fetchChunk: async () => { called++; return {}; },
    });

    expect(called).toBe(1);
  });

  test('a chunk error still propagates normally with the guard armed', async () => {
    const failing = runChunkedFetch({
      chunks: CHUNKS,
      budgetMs: 60000,
      heapLimitBytes: 1,
      fetchChunk: async () => { throw new Error('boom'); },
    });

    await expect(failing).rejects.toThrow('boom');
  });

  test('budget still takes precedence when both would trip', async () => {
    const result = await runChunkedFetch({
      chunks: CHUNKS,
      budgetMs: 0,
      heapLimitBytes: 1,
      fetchChunk: async () => ({}),
    });

    expect(result.stopReason).toBe('budget');
    expect(result.chunksCompleted).toBe(1);
  });
});

describe('orderId filter (Step 2 memory bound)', () => {
  // Step 2 searches a window that must run to `now` (fees post late), but it only wants the fees of
  // a known list of pending orders. A measured run showed ~88k expense rows per DAY for a large
  // seller, so a 49-day window is ~4.3M rows of which a few thousand match. Filtering as rows arrive
  // makes memory a function of the pending-order count instead of the window length.
  const ROWS = [
    expense({ orderId: 'WANTED-1', sku: 'S1', transactionId: 'T1' }),
    expense({ orderId: 'WANTED-1', sku: 'S1', transactionId: 'T1', category: 'Commission', amount: -2 }),
    expense({ orderId: 'OTHER-1', sku: 'S2', transactionId: 'T2' }),
    expense({ orderId: 'WANTED-2', sku: 'N/A', transactionId: 'T3' }),
    expense({ orderId: 'OTHER-2', sku: 'S3', transactionId: 'T4' }),
    expense({ orderId: null, sku: 'N/A', category: 'Storage Fee', transactionType: 'ServiceFee' }),
    expense({ orderId: 'OTHER-3', sku: 'S4', transactionId: 'T5', transactionType: 'Refund' }),
  ];
  const REVS = [
    revenue({ orderId: 'WANTED-1', sku: 'S1', transactionId: 'T6', transactionType: 'Refund', amount: -5 }),
    revenue({ orderId: 'OTHER-1', sku: 'S2', transactionId: 'T7', transactionType: 'Refund', amount: -6 }),
    revenue({ orderId: null, sku: 'N/A', category: 'Reserve Release', transactionType: 'Other', amount: 9 }),
  ];
  const WANTED = new Set(['WANTED-1', 'WANTED-2']);

  test('keeps only rows belonging to the wanted orders', () => {
    const index = createFinanceIndex({ orderIdFilter: WANTED });
    addFinanceRowsToIndex(index, ROWS, REVS);

    expect([...index.expensesByOrderSku.keys()]).toEqual(['WANTED-1||S1']);
    expect([...index.unattributedExpensesByOrder.keys()]).toEqual(['WANTED-2']);
    expect([...index.revenueByOrderSku.keys()]).toEqual([]); // Refund revenue is posted-date
  });

  test('discards unrelated rows and rows with no orderId, and counts them', () => {
    const index = createFinanceIndex({ orderIdFilter: WANTED });
    addFinanceRowsToIndex(index, ROWS, REVS);

    // OTHER-1/2/3 + the no-orderId overhead row, plus OTHER-1 revenue + the no-orderId revenue.
    expect(index.filteredOutCount).toBe(6);
    expect(index.overheadExpenses).toEqual([]);
    expect(index.overheadRevenue).toEqual([]);
  });

  test('the four lookups Step 2 actually reads are still correct', () => {
    // Guards the premise of the whole optimisation: filtering must not starve Step 2 of the data
    // it consults (expensesByOrderSku / unattributedExpensesByOrder + revenue equivalents).
    const filtered = createFinanceIndex({ orderIdFilter: WANTED });
    addFinanceRowsToIndex(filtered, ROWS, REVS);
    const unfiltered = indexFinanceRowsByOrderId(ROWS, REVS);

    for (const key of ['expensesByOrderSku', 'unattributedExpensesByOrder', 'revenueByOrderSku', 'unattributedRevenueByOrder']) {
      for (const orderId of WANTED) {
        const matching = [...unfiltered[key].keys()].filter((k) => k.startsWith(orderId));
        for (const k of matching) {
          expect(filtered[key].get(k)).toEqual(unfiltered[key].get(k));
        }
      }
    }
  });

  test('dedup still resolves identically for a kept order', () => {
    // Filtering is by ORDER, never by SKU, so every row of a kept order is still seen in arrival
    // order — otherwise "first transactionId wins" could pick a different winner.
    const rows = [
      expense({ orderId: 'WANTED-1', sku: 'S1', transactionId: 'FIRST' }),
      expense({ orderId: 'OTHER-9', sku: 'S1', transactionId: 'NOISE' }),
      expense({ orderId: 'WANTED-1', sku: 'S1', transactionId: 'SECOND' }), // duplicate txn → dropped
    ];
    const filtered = createFinanceIndex({ orderIdFilter: WANTED });
    addFinanceRowsToIndex(filtered, rows, []);
    const unfiltered = indexFinanceRowsByOrderId(rows, []);

    expect(filtered._firstTxnByOrderSku.get('WANTED-1||S1')).toBe('FIRST');
    expect(unfiltered._firstTxnByOrderSku.get('WANTED-1||S1')).toBe('FIRST');
    expect(filtered.dedupCount).toBe(1);
    expect(filtered.expensesByOrderSku.get('WANTED-1||S1')).toEqual(
      unfiltered.expensesByOrderSku.get('WANTED-1||S1')
    );
  });

  test('the filter survives page-by-page folding', () => {
    const inOnePass = createFinanceIndex({ orderIdFilter: WANTED });
    addFinanceRowsToIndex(inOnePass, ROWS, REVS);

    const inPages = createFinanceIndex({ orderIdFilter: WANTED });
    addFinanceRowsToIndex(inPages, ROWS.slice(0, 3), REVS.slice(0, 1));
    addFinanceRowsToIndex(inPages, ROWS.slice(3, 5), REVS.slice(1, 2));
    addFinanceRowsToIndex(inPages, ROWS.slice(5), REVS.slice(2));

    expect(snapshot(inPages)).toEqual(snapshot(inOnePass));
    expect(inPages.filteredOutCount).toBe(inOnePass.filteredOutCount);
  });

  test('an empty filter set keeps nothing (but does not throw)', () => {
    const index = createFinanceIndex({ orderIdFilter: new Set() });
    addFinanceRowsToIndex(index, ROWS, REVS);

    expect(index.expensesByOrderSku.size).toBe(0);
    expect(index.filteredOutCount).toBe(ROWS.length + REVS.length);
  });

  test('NO filter behaves exactly as before — Step 1 must be unaffected', () => {
    // The regression guard for the path that already works for 55 accounts.
    const explicitNull = createFinanceIndex({ orderIdFilter: null });
    addFinanceRowsToIndex(explicitNull, ROWS, REVS);
    const noArgs = createFinanceIndex();
    addFinanceRowsToIndex(noArgs, ROWS, REVS);
    const oneShot = indexFinanceRowsByOrderId(ROWS, REVS);

    expect(snapshot(explicitNull)).toEqual(snapshot(oneShot));
    expect(snapshot(noArgs)).toEqual(snapshot(oneShot));
    expect(noArgs.filteredOutCount).toBe(0);
    // Overhead and posted-date buckets are populated when unfiltered.
    expect(noArgs.overheadExpenses).toHaveLength(1);
    expect(noArgs.overheadRevenue).toHaveLength(1);
  });
});

describe('a row routed to the wrong bucket is detectable', () => {
  // Guards the snapshot helper itself: if it could not tell these apart, every equivalence test
  // above would pass vacuously.
  test('same amounts, different transactions, are not conflated', () => {
    const a = indexFinanceRowsByOrderId(
      [expense({ orderId: null, sku: 'N/A', transactionType: 'ServiceFee', transactionId: 'TX-A' })], []
    );
    const b = indexFinanceRowsByOrderId(
      [expense({ orderId: null, sku: 'N/A', transactionType: 'ServiceFee', transactionId: 'TX-B' })], []
    );

    expect(snapshot(a)).not.toEqual(snapshot(b));
  });

  test('overhead vs posted-date routing is distinguishable', () => {
    const overhead = indexFinanceRowsByOrderId(
      [expense({ orderId: null, sku: 'N/A', transactionType: 'ServiceFee' })], []
    );
    const perAsin = indexFinanceRowsByOrderId(
      [expense({ orderId: null, sku: 'S9', transactionType: 'ServiceFee' })], []
    );

    expect(snapshot(overhead).overheadExpenses).toHaveLength(1);
    expect(snapshot(overhead).postedDateExpenses).toHaveLength(0);
    expect(snapshot(perAsin).overheadExpenses).toHaveLength(0);
    expect(snapshot(perAsin).postedDateExpenses).toHaveLength(1);
  });
});

describe('classifySyncFailure — memory bucket', () => {
  test('a V8 OOM message classifies as memory', () => {
    expect(classifySyncFailure(new Error('Reached heap limit Allocation failed - JavaScript heap out of memory')))
      .toBe('memory');
  });

  test('memory is not confused with timeout or auth', () => {
    expect(classifySyncFailure(new Error('Report did not complete within 600s'))).toBe('timeout');
    expect(classifySyncFailure(new Error('Access to requested resource is denied'))).toBe('auth_denied');
  });
});

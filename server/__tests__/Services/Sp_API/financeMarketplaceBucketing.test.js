/**
 * Tests that the finance sync files each order under the MARKETPLACE's calendar day.
 *
 * Why these matter more than usual:
 *  - This is the reported bug. Account 6a40e42712ce56d674f734a0 (AU/FE) showed $703.48 of
 *    sales for 2026-07-12 where Seller Central showed $900.56, because the day key came from a
 *    hardcoded UTC-7 and AU is UTC+10 — a 17-hour skew that moved most of the day's orders into
 *    the previous bucket.
 *  - `parseSalesReportRows` produces the `date` on DailySkuFinance, i.e. the number a seller
 *    reads as their daily sales, so an untested regression here misstates money silently.
 *  - `salesReportWindowISO` decides which orders Amazon returns AT ALL. It must stay in lockstep
 *    with the bucketing or days come back partly filled, which looks like missing sales.
 *
 * Style follows financeSyncWindow.test.js: real module, literal fixtures, zero mocks.
 */

const {
  parseSalesReportRows,
  toMarketplaceDayKey,
  buildOverheadBuckets,
  salesReportWindowISO,
} = require('../../../Services/Sp_API/FinanceService.js');

/** One Sales Report row. Defaults are a valid AU order. */
const row = (overrides = {}) => ({
  'amazon-order-id': 'AU-ORDER-1',
  'purchase-date': '2026-07-11T20:00:00Z', // 06:00 AEST on Jul 12
  'sales-channel': 'Amazon.com.au',
  'order-status': 'Shipped',
  'item-price': '100.00',
  quantity: '1',
  sku: 'SKU-A',
  asin: 'B00TEST',
  currency: 'AUD',
  'product-name': 'Widget',
  ...overrides,
});

/** Flatten the nested orderId → sku → item map that parseSalesReportRows returns. */
const items = (orderMap) => [...orderMap.values()].flatMap((skuMap) => [...skuMap.values()]);

describe('parseSalesReportRows — the AU bug', () => {
  test('an order placed in the AU morning lands on the AU calendar day', () => {
    // 2026-07-11T20:00Z is 06:00 AEST Jul 12. The old hardcoded UTC-7 filed this under Jul 11.
    const parsed = parseSalesReportRows([row()], 'AU');
    expect(items(parsed).map((i) => i.pacificDate)).toEqual(['2026-07-12']);
  });

  test('a full AU day of orders all land on the same AU day', () => {
    // Spans 00:30 → 23:30 AEST on Jul 12. Under the old offset the first 17 hours of these
    // would have been split off into Jul 11 — this is exactly the reported shortfall.
    const auDayInstants = [
      '2026-07-11T14:30:00Z', // 00:30 AEST Jul 12
      '2026-07-11T22:00:00Z', // 08:00 AEST Jul 12
      '2026-07-12T02:00:00Z', // 12:00 AEST Jul 12
      '2026-07-12T06:30:00Z', // 16:30 AEST Jul 12  ← last instant the old code mislabelled
      '2026-07-12T09:00:00Z', // 19:00 AEST Jul 12
      '2026-07-12T13:30:00Z', // 23:30 AEST Jul 12
    ];
    const rows = auDayInstants.map((d, i) => row({ 'purchase-date': d, 'amazon-order-id': `AU-${i}` }));

    const dates = new Set(items(parseSalesReportRows(rows, 'AU')).map((i) => i.pacificDate));
    expect([...dates]).toEqual(['2026-07-12']);
  });

  test('the whole AU day\'s revenue is attributed to that day', () => {
    const rows = [
      row({ 'amazon-order-id': 'A', 'purchase-date': '2026-07-11T20:00:00Z', 'item-price': '600.56' }),
      row({ 'amazon-order-id': 'B', 'purchase-date': '2026-07-12T09:00:00Z', 'item-price': '300.00' }),
    ];
    const byDate = {};
    for (const i of items(parseSalesReportRows(rows, 'AU'))) {
      byDate[i.pacificDate] = (byDate[i.pacificDate] || 0) + i.totalPrice;
    }
    // Both orders belong to AU Jul 12; neither leaks into Jul 11.
    expect(byDate).toEqual({ '2026-07-12': 900.56 });
  });

  test('the same instants bucket differently for a US account, as they should', () => {
    // Not a bug — 2026-07-11T20:00Z genuinely IS Jul 11 in Los Angeles (13:00 PDT).
    const parsed = parseSalesReportRows([row({ 'sales-channel': 'Amazon.com' })], 'US');
    expect(items(parsed).map((i) => i.pacificDate)).toEqual(['2026-07-11']);
  });

  test('JP and UK bucket in their own calendars too', () => {
    const jp = parseSalesReportRows(
      [row({ 'sales-channel': 'Amazon.co.jp', 'purchase-date': '2026-07-11T16:00:00Z' })], // 01:00 JST Jul 12
      'JP'
    );
    expect(items(jp).map((i) => i.pacificDate)).toEqual(['2026-07-12']);

    const uk = parseSalesReportRows(
      [row({ 'sales-channel': 'Amazon.co.uk', 'purchase-date': '2026-07-11T23:30:00Z' })], // 00:30 BST Jul 12
      'UK'
    );
    expect(items(uk).map((i) => i.pacificDate)).toEqual(['2026-07-12']);
  });

  test('winter dates use the real offset, not a summer-only one', () => {
    // 2026-01-12T07:30Z is 23:30 PST on Jan 11. The old fixed UTC-7 called it Jan 12.
    const parsed = parseSalesReportRows(
      [row({ 'sales-channel': 'Amazon.com', 'purchase-date': '2026-01-12T07:30:00Z' })],
      'US'
    );
    expect(items(parsed).map((i) => i.pacificDate)).toEqual(['2026-01-11']);
  });
});

describe('parseSalesReportRows — filters still behave', () => {
  test('cancelled and non-amazon rows are still excluded', () => {
    const rows = [
      row({ 'amazon-order-id': 'KEEP' }),
      row({ 'amazon-order-id': 'CANCELLED', 'order-status': 'Cancelled' }),
      row({ 'amazon-order-id': 'OFFSITE', 'sales-channel': 'Non-Amazon' }),
    ];
    expect(items(parseSalesReportRows(rows, 'AU')).map((i) => i.orderId)).toEqual(['KEEP']);
  });

  test('rows from another marketplace in the same region file are excluded', () => {
    // The NA report returns US+CA+MX+BR mixed, each in its own currency.
    const rows = [
      row({ 'amazon-order-id': 'US-1', 'sales-channel': 'Amazon.com' }),
      row({ 'amazon-order-id': 'CA-1', 'sales-channel': 'Amazon.ca' }),
    ];
    expect(items(parseSalesReportRows(rows, 'US')).map((i) => i.orderId)).toEqual(['US-1']);
  });

  test('IE and ZA now filter by channel instead of silently accepting everything', () => {
    // These two were missing from COUNTRY_TO_SALES_CHANNEL, which made `salesChannel`
    // undefined and skipped the `if (salesChannel && ...)` filter entirely — so a foreign
    // marketplace's rows (in a foreign currency) were summed into the total.
    const ieRows = [
      row({ 'amazon-order-id': 'IE-1', 'sales-channel': 'Amazon.ie' }),
      row({ 'amazon-order-id': 'DE-1', 'sales-channel': 'Amazon.de' }),
    ];
    expect(items(parseSalesReportRows(ieRows, 'IE')).map((i) => i.orderId)).toEqual(['IE-1']);

    const zaRows = [
      row({ 'amazon-order-id': 'ZA-1', 'sales-channel': 'Amazon.co.za' }),
      row({ 'amazon-order-id': 'UK-1', 'sales-channel': 'Amazon.co.uk' }),
    ];
    expect(items(parseSalesReportRows(zaRows, 'ZA')).map((i) => i.orderId)).toEqual(['ZA-1']);
  });

  test('multiple rows for one order+SKU still aggregate', () => {
    const rows = [
      row({ 'item-price': '50.00', quantity: '1' }),
      row({ 'item-price': '25.50', quantity: '2' }),
    ];
    const parsed = items(parseSalesReportRows(rows, 'AU'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].totalPrice).toBeCloseTo(75.5, 2);
    expect(parsed[0].totalUnits).toBe(3);
  });

  test('a row with an unparseable purchase-date is skipped, not bucketed as today', () => {
    const rows = [row({ 'purchase-date': 'not-a-date' }), row({ 'amazon-order-id': 'GOOD' })];
    expect(items(parseSalesReportRows(rows, 'AU')).map((i) => i.orderId)).toEqual(['GOOD']);
  });
});

describe('salesReportWindowISO — must match the bucketing', () => {
  test('US summer window is byte-identical to the old hardcoded strings', () => {
    // The guarantee that made it safe to ship this to all accounts at once.
    expect(salesReportWindowISO('2026-07-12', '2026-07-12', 'US')).toEqual({
      salesStartISO: '2026-07-12T07:00:00.000Z',
      salesEndISO: '2026-07-13T06:59:59.999Z',
    });
  });

  test('AU window covers the AU calendar day, not the Pacific one', () => {
    expect(salesReportWindowISO('2026-07-12', '2026-07-12', 'AU')).toEqual({
      salesStartISO: '2026-07-11T14:00:00.000Z',
      salesEndISO: '2026-07-12T13:59:59.999Z',
    });
  });

  test('every order inside the requested window buckets inside the requested range', () => {
    // The lockstep invariant. If this fails, days come back partially filled — which reads as
    // missing sales rather than as a bug.
    for (const country of ['US', 'AU', 'JP', 'UK', 'IN', 'BR']) {
      const { salesStartISO, salesEndISO } = salesReportWindowISO('2026-07-01', '2026-07-14', country);
      for (const instant of [salesStartISO, salesEndISO]) {
        const day = toMarketplaceDayKey(instant, country);
        expect(day >= '2026-07-01' && day <= '2026-07-14').toBe(true);
      }
      // And the boundaries are tight: 1ms outside falls outside the range.
      expect(toMarketplaceDayKey(new Date(Date.parse(salesStartISO) - 1), country)).toBe('2026-06-30');
      expect(toMarketplaceDayKey(new Date(Date.parse(salesEndISO) + 1), country)).toBe('2026-07-15');
    }
  });
});

describe('parseSalesReportRows — Seller Central sales reconciliation', () => {
  // Real 2026-07-12 shape for account 6a40e42712ce56d674f734a0: 23 promoted units at 24.99 with
  // item-promotion-discount 10.91 (GST charged on the discounted amount, so item-tax is 1.18
  // rather than 2.27). A raw item-price sum gave 925.63 where Seller Central said 900.56.
  const promoted = (i) => row({
    'amazon-order-id': `P-${i}`, 'item-price': '24.99', 'item-tax': '1.18',
    'item-promotion-discount': '10.91',
  });
  const plain = (i) => row({
    'amazon-order-id': `N-${i}`, 'item-price': '24.99', 'item-tax': '2.27',
    'item-promotion-discount': '0',
  });
  const sum = (orderMap) => Math.round(items(orderMap).reduce((t, i) => t + i.totalPrice, 0) * 100) / 100;

  test('the uncollected GST on promoted units is removed', () => {
    const rows = [...Array.from({ length: 23 }, (_, i) => promoted(i)), ...Array.from({ length: 10 }, (_, i) => plain(i))];
    // Raw would be 33 * 24.99 = 824.67; each promoted unit loses exactly 1.09.
    expect(sum(parseSalesReportRows(rows, 'AU'))).toBeCloseTo(824.67 - 23 * 1.09, 2);
  });

  test('undiscounted AU rows are completely unaffected', () => {
    const rows = Array.from({ length: 10 }, (_, i) => plain(i));
    expect(sum(parseSalesReportRows(rows, 'AU'))).toBeCloseTo(249.90, 2);
  });

  test('★ US rows are never corrected — their prices are tax-exclusive', () => {
    // The guard that makes this safe to ship fleet-wide. A US promoted row must keep item-price.
    const usRows = [
      row({ 'amazon-order-id': 'U1', 'sales-channel': 'Amazon.com', 'item-price': '24.99', 'item-tax': '2.06', 'item-promotion-discount': '0' }),
      row({ 'amazon-order-id': 'U2', 'sales-channel': 'Amazon.com', 'item-price': '30.00', 'item-tax': '1.00', 'item-promotion-discount': '5.00' }),
    ];
    expect(sum(parseSalesReportRows(usRows, 'US'))).toBeCloseTo(54.99, 2);
  });

  test('★ a tiny batch is corrected exactly like a large one (chunk independence)', () => {
    // THE regression guard. The first version of this correction inferred the tax rate from the
    // current report batch. Production fetches in 3-day chunks (FINANCE_REPORT_CHUNK_DAYS), so
    // batches were small, the inferred rate moved with the chunk boundaries, and the same day
    // produced different totals — 2026-07-22 was stored as 269.71 against Seller Central's 269.51.
    // A row's correction must depend on that row alone.
    const perRow = 24.99 - 1.09;
    expect(sum(parseSalesReportRows([promoted(1)], 'AU'))).toBeCloseTo(perRow, 2);
    expect(sum(parseSalesReportRows([promoted(1), promoted(2)], 'AU'))).toBeCloseTo(2 * perRow, 2);

    // Splitting a batch any which way must not change the total.
    const all = Array.from({ length: 9 }, (_, i) => promoted(i));
    const whole = sum(parseSalesReportRows(all, 'AU'));
    for (const size of [1, 2, 3, 4, 5]) {
      let split = 0;
      for (let i = 0; i < all.length; i += size) split += sum(parseSalesReportRows(all.slice(i, i + size), 'AU'));
      expect(Math.round(split * 100) / 100).toBeCloseTo(Math.round(whole * 100) / 100, 2);
    }
  });

  test('zero-tax rows keep their full price even amid corrected ones', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => plain(i)),
      row({ 'amazon-order-id': 'Z1', 'item-price': '19.99', 'item-tax': '0', 'item-promotion-discount': '0' }),
    ];
    expect(sum(parseSalesReportRows(rows, 'AU'))).toBeCloseTo(249.90 + 19.99, 2);
  });

  test('★ a promoted multi-quantity ES line matches Amazon via per-LINE rounding', () => {
    // Found auditing a real ES account: raw sum already matched Data Kiosk on 23/28 days, but the
    // tax correction (working correctly for AU, where every promoted row happened to be quantity 1)
    // broke 5 of them. item-promotion-discount is a line total; dividing it into per-unit shares
    // before rounding lost 2 cents on this 5-unit line. Fixed 4 of the 5 real mismatches; day
    // remains its own describe block below since it needs day-level rather than row-level framing.
    const esRow = row({
      'amazon-order-id': 'ES-1', 'sales-channel': 'Amazon.es', 'item-price': '99.50',
      'item-tax': '15.54', 'item-promotion-discount': '8.22', quantity: '5',
    });
    expect(sum(parseSalesReportRows([esRow], 'ES'))).toBeCloseTo(97.77, 2);
  });

  test('per-line rounding for promoted rows is still chunk-independent', () => {
    // The determinism guarantee must survive the per-line/per-unit split: evaluating the ES line
    // alone or alongside other rows must not change its value.
    const esRow = row({
      'amazon-order-id': 'ES-1', 'sales-channel': 'Amazon.es', 'item-price': '99.50',
      'item-tax': '15.54', 'item-promotion-discount': '8.22', quantity: '5',
    });
    const alone = sum(parseSalesReportRows([esRow], 'ES'));
    const withNeighbours = sum(parseSalesReportRows(
      [esRow, ...Array.from({ length: 5 }, (_, i) => row({ 'amazon-order-id': `N-${i}`, 'sales-channel': 'Amazon.es', 'item-price': '19.90', 'item-tax': '3.45', 'item-promotion-discount': '0' }))],
      'ES'
    ));
    expect(alone).toBeCloseTo(97.77, 2);
    expect(withNeighbours).toBeCloseTo(97.77 + 5 * 19.90, 2);
  });
});

describe('buildOverheadBuckets — posted dates use the same calendar', () => {
  test('a posted date buckets in the marketplace calendar', () => {
    // Refunds/reimbursements/fees now share the sales calendar, so an order's revenue and its
    // fees land on coherent days rather than up to a day apart.
    const buckets = buildOverheadBuckets(
      [{ category: 'Storage Fee', postedDate: new Date('2026-07-11T20:00:00Z'), postedDateStr: '', amount: -5, sku: 'N/A' }],
      [],
      '2026-07-01',
      '2026-07-14',
      'AU'
    );
    expect([...buckets.values()].map((b) => b.date)).toEqual(['2026-07-12']);
  });

  test('the same posted instant buckets a day earlier for US, correctly', () => {
    const buckets = buildOverheadBuckets(
      [{ category: 'Storage Fee', postedDate: new Date('2026-07-11T20:00:00Z'), postedDateStr: '', amount: -5, sku: 'N/A' }],
      [],
      '2026-07-01',
      '2026-07-14',
      'US'
    );
    expect([...buckets.values()].map((b) => b.date)).toEqual(['2026-07-11']);
  });

  test('the chunk-safety invariant still holds: no bucket escapes the requested range', () => {
    // datesToClear ⊆ [rangeStart, rangeEnd] is what stops one chunk's clear from deleting
    // another chunk's freshly-written sales rows.
    const buckets = buildOverheadBuckets(
      [
        { category: 'Storage Fee', postedDate: new Date('2026-06-20T20:00:00Z'), postedDateStr: '', amount: -5, sku: 'N/A' },
        { category: 'Storage Fee', postedDate: new Date('2026-07-05T20:00:00Z'), postedDateStr: '', amount: -5, sku: 'N/A' },
      ],
      [
        { category: 'Reserve Release', postedDate: new Date('2026-08-01T20:00:00Z'), postedDateStr: '', amount: 100 },
        { category: 'Reserve Release', postedDate: new Date('2026-07-06T20:00:00Z'), postedDateStr: '', amount: 100 },
      ],
      '2026-07-01',
      '2026-07-14',
      'AU'
    );
    for (const b of buckets.values()) {
      expect(b.date >= '2026-07-01' && b.date <= '2026-07-14').toBe(true);
    }
    expect(buckets.size).toBe(2);
  });
});

describe('resolveDatesToClear — a fully-cancelled day must drop to $0', () => {
  const { resolveDatesToClear } = require('../../../Services/Sp_API/FinanceService.js');
  const START = '2026-07-10';
  const END = '2026-07-13';
  // Real shape from account 69b420ad2b222b2a74b99fa2 (US): 2026-07-11's single order was
  // cancelled after we first recorded it. The report now returns only that Cancelled row, which
  // parseSalesReportRows correctly drops — so the day produced no bucket. Before this, the day was
  // therefore never cleared and kept a stale 20.73 against Seller Central's 0.00, permanently.
  const cancelledJul11 = {
    'purchase-date': '2026-07-11T18:00:00Z', 'order-status': 'Cancelled', 'item-status': 'Cancelled',
    'item-price': '0.00', quantity: '0', sku: 'S', 'sales-channel': 'Amazon.com',
  };
  const shippedJul12 = {
    'purchase-date': '2026-07-12T18:00:00Z', 'order-status': 'Shipped', 'item-status': 'Shipped',
    'item-price': '20.73', quantity: '1', sku: 'S', 'sales-channel': 'Amazon.com',
  };

  test('★ a day covered by the report with no surviving order IS cleared', () => {
    const { datesToClear, zeroedDays } = resolveDatesToClear({
      reportRows: [cancelledJul11, shippedJul12], country: 'US',
      startDate: START, endDate: END, bucketDates: new Set(['2026-07-12']),
    });
    expect(datesToClear).toContain('2026-07-11');
    expect(zeroedDays).toEqual(['2026-07-11']);
  });

  test('a day the report says NOTHING about is left alone (the May-28 wipe guard)', () => {
    // 07-10 and 07-13 appear in no row, so they must not be cleared — an aged-out report that
    // omits a settled day must never zero it.
    const { datesToClear } = resolveDatesToClear({
      reportRows: [cancelledJul11, shippedJul12], country: 'US',
      startDate: START, endDate: END, bucketDates: new Set(['2026-07-12']),
    });
    expect(datesToClear).not.toContain('2026-07-10');
    expect(datesToClear).not.toContain('2026-07-13');
  });

  test('an entirely empty report clears nothing', () => {
    const { datesToClear, zeroedDays } = resolveDatesToClear({
      reportRows: [], country: 'US', startDate: START, endDate: END, bucketDates: new Set(),
    });
    expect(datesToClear).toEqual([]);
    expect(zeroedDays).toEqual([]);
  });

  test('★ the chunk-safety invariant holds: nothing outside the requested range', () => {
    // Clearing a neighbouring chunk's day would delete rows it had already written and stamped
    // success. Rows outside the window must be ignored entirely.
    const outside = { ...shippedJul12, 'purchase-date': '2026-06-01T18:00:00Z' };
    const later = { ...shippedJul12, 'purchase-date': '2026-09-01T18:00:00Z' };
    const { datesToClear } = resolveDatesToClear({
      reportRows: [outside, later, cancelledJul11], country: 'US',
      startDate: START, endDate: END, bucketDates: new Set(),
    });
    for (const d of datesToClear) expect(d >= START && d <= END).toBe(true);
    expect(datesToClear).toEqual(['2026-07-11']);
  });

  test('days that produced buckets are not reported as zeroed', () => {
    const { zeroedDays } = resolveDatesToClear({
      reportRows: [shippedJul12], country: 'US',
      startDate: START, endDate: END, bucketDates: new Set(['2026-07-12']),
    });
    expect(zeroedDays).toEqual([]);
  });

  test('bucket dates are always preserved, even with no report rows', () => {
    const { datesToClear } = resolveDatesToClear({
      reportRows: [], country: 'US', startDate: START, endDate: END,
      bucketDates: new Set(['2026-07-12', '2026-07-13']),
    });
    expect(datesToClear.sort()).toEqual(['2026-07-12', '2026-07-13']);
  });

  test('the day key is marketplace-local, so a boundary row lands on the right day', () => {
    // 2026-07-12T02:00Z is still 2026-07-11 in Los Angeles.
    const { zeroedDays } = resolveDatesToClear({
      reportRows: [{ ...cancelledJul11, 'purchase-date': '2026-07-12T02:00:00Z' }], country: 'US',
      startDate: START, endDate: END, bucketDates: new Set(),
    });
    expect(zeroedDays).toEqual(['2026-07-11']);
  });
});

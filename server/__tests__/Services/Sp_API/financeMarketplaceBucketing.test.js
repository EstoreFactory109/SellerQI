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

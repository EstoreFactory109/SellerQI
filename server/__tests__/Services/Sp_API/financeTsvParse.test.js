/**
 * Equivalence proof for the Sales-Report TSV memory change.
 *
 * WHAT CHANGED AND WHY
 * `parseTsv` ran on the full decompressed report (tens of MB) and held ~2.5-3x of it live:
 * `rawData.split('\n')` produced an array of V8 SlicedStrings that pinned the entire raw text for
 * the whole parse, while zipping all ~50 headers into every row built a second independent copy
 * of the same characters. Only TEN of those columns are ever read. Separately, the row array was
 * kept alive across the Finance API walk (1000+ pages, tens of minutes) purely so `.length` could
 * be read at the end.
 *
 * WHY THESE TESTS EXIST IN THIS FORM
 * The constraint on the change was that every persisted finance figure stays identical. Memory
 * work is exactly the kind of change that looks safe and silently shifts a number, so the proof
 * cannot be "it still runs". This file keeps a VERBATIM copy of the pre-change implementation and
 * asserts the new one against it, the same technique financeStreamingFold.test.js uses for the
 * previous memory change (its header calls that "the core correctness guarantee").
 *
 * The reference copies below must NOT be refactored to share code with the implementation — the
 * whole point is that they are independent.
 */

const {
    parseTsv,
    parseSalesReportRows,
    foldSalesReportRows,
    SALES_REPORT_COLUMNS,
} = require('../../../Services/Sp_API/FinanceService.js');
const { toMarketplaceDateStr } = require('../../../utils/marketplaceTimezone.js');

// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE IMPLEMENTATIONS — verbatim pre-change code. Do not "improve".
// ─────────────────────────────────────────────────────────────────────────────

function parseTsvLegacy(rawData) {
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

/**
 * The pending-count loop exactly as it was inline in processSalesReportRows, held here as an
 * independent reference — deliberately not calling foldSalesReportRows or parseSalesReportRows.
 *
 * Uses `toMarketplaceDateStr`, not the old Pacific-only bucketing: the memory refactor this file
 * proves (fold vs. two/three separate passes) is orthogonal to the marketplace-local day-bucketing
 * fix, and this reference must hold the SHARED baseline behaviour constant, not resurrect the
 * pre-fix one.
 */
function pendingCountLegacy(reportRows, country) {
    const pendingCountByDate = new Map();
    for (const row of reportRows) {
        const status = (row['order-status'] || '').toLowerCase();
        if (!status.startsWith('pending')) continue;
        const d = toMarketplaceDateStr(row['purchase-date'], country);
        if (!d) continue;
        pendingCountByDate.set(d, (pendingCountByDate.get(d) || 0) + 1);
    }
    return pendingCountByDate;
}

/** Project legacy rows to the retained columns, so old and new are comparable. */
function projectToKeptColumns(rows) {
    return rows.map((row) => {
        const out = {};
        for (const key of Object.keys(row)) {
            if (SALES_REPORT_COLUMNS.has(key)) out[key] = row[key];
        }
        return out;
    });
}

/** Map<orderId, Map<sku, item>> -> plain sorted object, so deep-equality is meaningful. */
function canonicaliseOrderMap(orderMap) {
    const out = {};
    for (const [orderId, skuMap] of [...orderMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        out[orderId] = {};
        for (const [sku, item] of [...skuMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            out[orderId][sku] = { ...item };
        }
    }
    return out;
}

function canonicaliseCountMap(m) {
    return Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE — a realistic report. Header carries the full ~50-column set Amazon
// actually sends for GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL so the
// projection is exercised against real column names, not a toy subset.
// ─────────────────────────────────────────────────────────────────────────────

const ALL_COLUMNS = [
    'amazon-order-id', 'merchant-order-id', 'purchase-date', 'last-updated-date', 'order-status',
    'fulfillment-channel', 'sales-channel', 'order-channel', 'url', 'ship-service-level',
    'product-name', 'sku', 'asin', 'item-status', 'quantity', 'currency', 'item-price', 'item-tax',
    'shipping-price', 'shipping-tax', 'gift-wrap-price', 'gift-wrap-tax', 'item-promotion-discount',
    'ship-promotion-discount', 'ship-city', 'ship-state', 'ship-postal-code', 'ship-country',
    'promotion-ids', 'is-business-order', 'purchase-order-number', 'price-designation',
    'signature-confirmation-recommended', 'buyer-company-name', 'licensee-name', 'license-number',
    'license-state', 'license-expiration-date', 'is-replacement-order', 'original-order-id',
    'is-exchange-order', 'original-order-id-exchange', 'is-transparency', 'ioss-number',
    'store-chain-store-id', 'delivery-start-date', 'delivery-end-date', 'delivery-time-zone',
    'delivery-Instructions', 'is-buyer-requested-cancellation',
];

function tsvRow(overrides = {}) {
    const base = {
        'amazon-order-id': '111-0000000-0000000',
        'purchase-date': '2026-08-14T18:30:00+00:00',
        'order-status': 'Shipped',
        'sales-channel': 'Amazon.com',
        'product-name': 'Widget, Large',
        'sku': 'SKU-1',
        'asin': 'B000000001',
        'quantity': '1',
        'currency': 'USD',
        'item-price': '10.00',
    };
    const merged = { ...base, ...overrides };
    return ALL_COLUMNS.map((c) => (merged[c] !== undefined ? merged[c] : 'filler')).join('\t');
}

function buildTsv(rows, { eol = '\n', header = ALL_COLUMNS.join('\t') } = {}) {
    return [header, ...rows].join(eol);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('parseTsv — identical rows to the pre-change implementation', () => {
    // The core regression test: against the old code these two disagree only by the ~40 dropped
    // columns, so projecting the legacy output makes them exactly equal.
    test('a normal multi-row report parses to the same retained values', () => {
        const tsv = buildTsv([
            tsvRow(),
            tsvRow({ 'amazon-order-id': '111-0000000-0000001', 'sku': 'SKU-2', 'item-price': '25.50', 'quantity': '3' }),
            tsvRow({ 'amazon-order-id': '111-0000000-0000002', 'order-status': 'Pending', 'item-price': '' }),
        ]);

        expect(parseTsv(tsv)).toEqual(projectToKeptColumns(parseTsvLegacy(tsv)));
    });

    test('CRLF line endings produce identical values (\\r stripped, as before)', () => {
        const tsv = buildTsv([tsvRow(), tsvRow({ sku: 'SKU-2' })], { eol: '\r\n' });

        const out = parseTsv(tsv);
        expect(out).toEqual(projectToKeptColumns(parseTsvLegacy(tsv)));
        // Explicit: no stray carriage returns survived into a retained value.
        expect(JSON.stringify(out)).not.toContain('\\r');
    });

    test('blank lines mid-file and trailing do not shift or truncate rows', () => {
        // The old code filtered blank lines across the WHOLE file, not just the tail, so a blank
        // line in the middle did not end parsing. That behaviour is load-bearing and preserved.
        const tsv = [
            ALL_COLUMNS.join('\t'),
            tsvRow(),
            '',
            '   ',
            tsvRow({ sku: 'SKU-2' }),
            '',
        ].join('\n');

        expect(parseTsv(tsv)).toEqual(projectToKeptColumns(parseTsvLegacy(tsv)));
        expect(parseTsv(tsv)).toHaveLength(2);
    });

    test('ragged rows (missing trailing cells) fill with empty string, as before', () => {
        const tsv = [
            ALL_COLUMNS.join('\t'),
            '111-0000000-0000000\tmo-1\t2026-08-14T18:30:00+00:00', // truncated well before the end
        ].join('\n');

        expect(parseTsv(tsv)).toEqual(projectToKeptColumns(parseTsvLegacy(tsv)));
    });

    test('header-only body yields [] — the "no orders" case, distinct from an unusable payload', () => {
        const tsv = ALL_COLUMNS.join('\t');
        expect(parseTsv(tsv)).toEqual([]);
        expect(parseTsvLegacy(tsv)).toEqual([]);
    });

    test('empty and whitespace-only input yield []', () => {
        for (const input of ['', '\n', '   \n  \n']) {
            expect(parseTsv(input)).toEqual([]);
            expect(parseTsvLegacy(input)).toEqual([]);
        }
    });

    test('a falsy cell stays an empty string, and "0" is preserved', () => {
        // Guards the old `values[idx] || ''`: '0' is falsy-adjacent in sloppy code but is a real
        // quantity/price value and must survive.
        const tsv = buildTsv([tsvRow({ quantity: '0', 'item-price': '0.00', asin: '' })]);

        const [row] = parseTsv(tsv);
        expect(row.quantity).toBe('0');
        expect(row['item-price']).toBe('0.00');
        expect(row.asin).toBe('');
        expect(parseTsv(tsv)).toEqual(projectToKeptColumns(parseTsvLegacy(tsv)));
    });

    test('values are trimmed exactly as before', () => {
        const tsv = buildTsv([tsvRow({ sku: '  SKU-PAD  ', 'product-name': '  Padded Name  ' })]);

        const [row] = parseTsv(tsv);
        expect(row.sku).toBe('SKU-PAD');
        expect(row['product-name']).toBe('Padded Name');
        expect(parseTsv(tsv)).toEqual(projectToKeptColumns(parseTsvLegacy(tsv)));
    });

    test('only the ten consumed columns are retained — nothing downstream reads the rest', () => {
        const [row] = parseTsv(buildTsv([tsvRow()]));

        expect(new Set(Object.keys(row))).toEqual(SALES_REPORT_COLUMNS);
        expect(row).not.toHaveProperty('ship-postal-code');
        expect(row).not.toHaveProperty('buyer-company-name');
    });

    test('an unknown/renamed column is simply absent rather than throwing', () => {
        // If Amazon renames a column, the field reads as undefined downstream (same as before,
        // where a renamed column produced a key nothing looked for). It must not crash the parse.
        const header = ALL_COLUMNS.map((c) => (c === 'item-price' ? 'item-price-v2' : c)).join('\t');
        const tsv = buildTsv([tsvRow()], { header });

        const [row] = parseTsv(tsv);
        expect(row['item-price']).toBeUndefined();
        expect(row.sku).toBe('SKU-1');
        expect(parseTsv(tsv)).toEqual(projectToKeptColumns(parseTsvLegacy(tsv)));
    });
});

describe('foldSalesReportRows — identical output to the two separate passes', () => {
    const COUNTRY = 'US';

    // A row set that exercises every filter branch plus the asymmetry between the two passes.
    const MIXED_ROWS = () => parseTsv(buildTsv([
        tsvRow({ 'amazon-order-id': 'A-1', sku: 'S1', 'item-price': '10.00', quantity: '1' }),
        // second line of the same order+sku -> accumulates
        tsvRow({ 'amazon-order-id': 'A-1', sku: 'S1', 'item-price': '5.25', quantity: '2' }),
        // same order, different sku
        tsvRow({ 'amazon-order-id': 'A-1', sku: 'S2', 'item-price': '7.00', quantity: '1', asin: 'B000000002' }),
        // cancelled -> excluded from sales
        tsvRow({ 'amazon-order-id': 'A-2', 'order-status': 'Cancelled', 'item-price': '99.00' }),
        // non-amazon channel -> excluded from sales
        tsvRow({ 'amazon-order-id': 'A-3', 'sales-channel': 'Non-Amazon', 'item-price': '50.00' }),
        // other marketplace -> excluded from sales by the channel filter
        tsvRow({ 'amazon-order-id': 'A-4', 'sales-channel': 'Amazon.ca', 'item-price': '15.00' }),
        // pending on THIS marketplace
        tsvRow({ 'amazon-order-id': 'A-5', 'order-status': 'Pending', 'item-price': '' }),
        // pending on ANOTHER marketplace — counted as pending, excluded from sales
        tsvRow({ 'amazon-order-id': 'A-6', 'order-status': 'Pending', 'sales-channel': 'Amazon.ca', 'item-price': '' }),
        // pending availability (also starts with "pending")
        tsvRow({ 'amazon-order-id': 'A-7', 'order-status': 'PendingAvailability', 'item-price': '' }),
        // missing order id -> skipped by the sales pass
        tsvRow({ 'amazon-order-id': '', sku: 'S9', 'item-price': '1.00' }),
        // unparseable purchase date -> skipped by both
        tsvRow({ 'amazon-order-id': 'A-8', 'purchase-date': 'not-a-date' }),
        // missing sku -> becomes 'N/A'
        tsvRow({ 'amazon-order-id': 'A-9', sku: '', 'item-price': '3.00' }),
        // a genuinely different PACIFIC day, to exercise per-date grouping.
        // NB 2026-08-15T02:00Z would NOT work here: that is 2026-08-14 19:00 Pacific, i.e. the
        // same bucket as the rows above. Dates are grouped after conversion, not as sent.
        tsvRow({ 'amazon-order-id': 'A-10', 'purchase-date': '2026-08-16T18:30:00+00:00', 'order-status': 'Pending', 'item-price': '' }),
    ]));

    test('salesOrderMap matches parseSalesReportRows exactly', () => {
        const rows = MIXED_ROWS();

        const folded = foldSalesReportRows(rows, COUNTRY);
        const reference = parseSalesReportRows(rows, COUNTRY);

        expect(canonicaliseOrderMap(folded.salesOrderMap)).toEqual(canonicaliseOrderMap(reference));
    });

    test('pendingCountByDate matches the old inline loop exactly', () => {
        const rows = MIXED_ROWS();

        const folded = foldSalesReportRows(rows, COUNTRY);

        expect(canonicaliseCountMap(folded.pendingCountByDate))
            .toEqual(canonicaliseCountMap(pendingCountLegacy(rows, COUNTRY)));
    });

    // The subtle one. Fusing two loops invites "hoist the filters" — which would silently
    // under-count pending days and let them settle early at $0.
    test('pending count is NOT reduced by the sales filters', () => {
        const rows = MIXED_ROWS();

        const folded = foldSalesReportRows(rows, COUNTRY);
        const counts = canonicaliseCountMap(folded.pendingCountByDate);

        // A-5, A-6 (other marketplace) and A-7 (PendingAvailability) share one Pacific day and
        // all three count — including A-6, which the sales pass excludes.
        const day = toMarketplaceDateStr('2026-08-14T18:30:00+00:00', COUNTRY);
        expect(counts[day]).toBe(3);
        // ...while that same order is absent from sales.
        expect(folded.salesOrderMap.has('A-6')).toBe(false);
        // And a genuinely different Pacific day is its own bucket.
        expect(counts[toMarketplaceDateStr('2026-08-16T18:30:00+00:00', COUNTRY)]).toBe(1);
    });

    test('rowCount equals the input length, including rows both passes skip', () => {
        const rows = MIXED_ROWS();
        expect(foldSalesReportRows(rows, COUNTRY).rowCount).toBe(rows.length);
    });

    test('empty input yields empty structures and a zero count', () => {
        const folded = foldSalesReportRows([], COUNTRY);

        expect(folded.rowCount).toBe(0);
        expect(folded.salesOrderMap.size).toBe(0);
        expect(folded.pendingCountByDate.size).toBe(0);
        expect(canonicaliseOrderMap(folded.salesOrderMap))
            .toEqual(canonicaliseOrderMap(parseSalesReportRows([], COUNTRY)));
    });

    test('with no country the channel filter is skipped, matching the reference', () => {
        const rows = MIXED_ROWS();

        const folded = foldSalesReportRows(rows, null);
        const reference = parseSalesReportRows(rows, null);

        expect(canonicaliseOrderMap(folded.salesOrderMap)).toEqual(canonicaliseOrderMap(reference));
        // Amazon.ca is no longer filtered out when no country is supplied.
        expect(folded.salesOrderMap.has('A-4')).toBe(true);
    });

    test('end-to-end: raw TSV through the new path equals raw TSV through the old path', () => {
        // The composed proof — new parseTsv + fold vs legacy parseTsv + the two original passes.
        const tsv = buildTsv([
            tsvRow({ 'amazon-order-id': 'Z-1', sku: 'S1', 'item-price': '12.34', quantity: '2' }),
            tsvRow({ 'amazon-order-id': 'Z-1', sku: 'S1', 'item-price': '7.66', quantity: '1' }),
            tsvRow({ 'amazon-order-id': 'Z-2', 'order-status': 'Pending', 'item-price': '' }),
            tsvRow({ 'amazon-order-id': 'Z-3', 'order-status': 'Cancelled', 'item-price': '5.00' }),
        ], { eol: '\r\n' });

        const newFold = foldSalesReportRows(parseTsv(tsv), COUNTRY);

        const legacyRows = parseTsvLegacy(tsv);
        const legacyMap = parseSalesReportRows(legacyRows, COUNTRY);
        const legacyPending = pendingCountLegacy(legacyRows, COUNTRY);

        expect(canonicaliseOrderMap(newFold.salesOrderMap)).toEqual(canonicaliseOrderMap(legacyMap));
        expect(canonicaliseCountMap(newFold.pendingCountByDate)).toEqual(canonicaliseCountMap(legacyPending));
        expect(newFold.rowCount).toBe(legacyRows.length);
    });
});

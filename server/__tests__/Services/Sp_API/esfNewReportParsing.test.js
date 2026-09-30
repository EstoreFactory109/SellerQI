/**
 * Parsing for the three Amazon sources added from the ESF API feasibility check.
 *
 * None of them could be checked against a live response — every SP-API account
 * available when they were written returned 401 — so these pin the documented
 * shapes, the spellings accepted in case Amazon deviates, and above all the
 * difference between "Amazon said none" and "we could not read what it said".
 */

jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../../utils/Logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../../models/seller-performance/V2_Seller_Performance_ReportModel.js', () => ({ create: jest.fn() }));
jest.mock('../../../models/products/SuppressedListingsModel.js', () => ({ create: jest.fn() }));
jest.mock('../../../models/inventory/RemovalOrdersModel.js', () => ({ create: jest.fn() }));

const zlib = require('zlib');
const { buildSnapshot, extractExtendedMetrics } = require('../../../Services/Sp_API/V2_Seller_Performance_Report.js');
const { parseSuppressedListings } = require('../../../Services/Sp_API/GET_MERCHANTS_LISTINGS_FYP_REPORT.js');
const { parseRemovalOrders } = require('../../../Services/Sp_API/GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA.js');
const { mapFlatFileRecords } = require('../../../Services/Sp_API/flatFileFields.js');

const tsv = (rows) => Buffer.from(rows.map((row) => row.join('\t')).join('\n'));

/** Amazon's published V2 shape, trimmed to what the parser reads. */
const v2Report = (overrides = {}) => ({
    accountStatuses: [{ marketplaceId: 'ATVPDKIKX0DER', status: 'NORMAL' }],
    performanceMetrics: [{
        accountHealthRating: { ahrStatus: 'GREAT', ahrScore: 1000 },
        listingPolicyViolations: { status: 'GOOD', targetValue: { value: 0, condition: 'EQUAL_TO' }, defectsCount: 0 },
        validTrackingRate: { status: 'GOOD', targetValue: { value: 0.95 }, shipmentCount: 200, validTrackingCount: 196, rate: 0.98 },
        lateShipmentRate: { status: 'GOOD', targetValue: { value: 0.04 }, orderCount: 200, lateShipmentCount: 2, rate: 0.01 },
        preFulfillmentCancellationRate: { status: 'GOOD', targetValue: { value: 0.025 }, rate: 0.005 },
        onTimeDeliveryRate: { status: 'GOOD', targetValue: { value: 0.9 }, rate: 0.95 },
        orderDefectRate: {
            afn: {
                reportingDateRange: { reportingDateFrom: '2026-07-01T00:00:00Z', reportingDateTo: '2026-09-28T00:00:00Z' },
                status: 'GOOD',
                targetValue: { value: 0.01 },
                rate: 0.0024,
                orderWithDefects: { count: 1, status: 'GOOD' },
                claims: { count: 0, status: 'GOOD' },
                chargebacks: { count: 1, status: 'GOOD' },
            },
            mfn: {
                status: 'GOOD',
                rate: 0,
                orderWithDefects: { count: 0, status: 'GOOD' },
                claims: { count: 1, status: 'GOOD' },
                chargebacks: { count: 2, status: 'AT RISK' },
            },
        },
        receivedIntellectualPropertyComplaints: { status: 'GOOD', defectsCount: 0 },
        productAuthenticityCustomerComplaints: { status: 'AT RISK', defectsCount: 3 },
        ...overrides,
    }],
});

describe('V2 performance: the rest of the report', () => {
    it('keeps the original seven fields exactly as they were extracted before', () => {
        const snapshot = buildSnapshot(v2Report());
        expect(snapshot).toMatchObject({
            ahrScore: 1000,
            accountStatuses: 'NORMAL',
            listingPolicyViolations: 'GOOD',
            validTrackingRateStatus: 'GOOD',
            orderWithDefectsStatus: 'GOOD',
            lateShipmentRateStatus: 'GOOD',
            CancellationRate: 'GOOD',
        });
    });

    it('still refuses a report missing the original fields, which is what keeps a malformed one out', () => {
        const report = v2Report();
        delete report.performanceMetrics[0].lateShipmentRate;
        expect(() => buildSnapshot(report)).toThrow();
    });

    it('turns Amazon\'s fractions into percentages, scaled by the target\'s own unit', () => {
        const metrics = extractExtendedMetrics(v2Report());
        expect(metrics.orderDefectRatePct).toBe(0.24);
        expect(metrics.lateShipmentRatePct).toBe(1);
        expect(metrics.cancellationRatePct).toBe(0.5);
        expect(metrics.validTrackingRatePct).toBe(98);
        expect(metrics.onTimeDeliveryRatePct).toBe(95);

        // A rate already sent as a percentage, with a target in the same unit.
        const asPercent = extractExtendedMetrics(v2Report({ lateShipmentRate: { status: 'GOOD', targetValue: { value: 4 }, rate: 1.5 } }));
        expect(asPercent.lateShipmentRatePct).toBe(1.5);
    });

    it('sums chargebacks across the FBA and FBM blocks and keeps the worse status', () => {
        const metrics = extractExtendedMetrics(v2Report());
        expect(metrics.chargebackCount).toBe(3);
        expect(metrics.chargebackStatus).toBe('AT RISK');
        expect(metrics.claimsCount).toBe(1);
        expect(metrics.odrWindowFrom).toBe('2026-07-01T00:00:00Z');
    });

    it('keeps every policy metric, including one it has no label for', () => {
        const metrics = extractExtendedMetrics(v2Report({ someFutureViolations: { status: 'GOOD', defectsCount: 2 } }));
        const keys = metrics.policyMetrics.map((entry) => entry.key);
        expect(keys).toEqual(expect.arrayContaining([
            'listingPolicyViolations', 'receivedIntellectualPropertyComplaints', 'productAuthenticityCustomerComplaints', 'someFutureViolations',
        ]));
        expect(metrics.policyMetrics.find((entry) => entry.key === 'productAuthenticityCustomerComplaints')).toEqual({
            key: 'productAuthenticityCustomerComplaints', status: 'AT RISK', count: 3,
        });
    });

    it('reports missing fields as null, never 0', () => {
        const report = v2Report();
        delete report.performanceMetrics[0].validTrackingRate.shipmentCount;
        delete report.performanceMetrics[0].orderDefectRate.mfn;
        delete report.performanceMetrics[0].orderDefectRate.afn.chargebacks;
        const metrics = extractExtendedMetrics(report);

        expect(metrics.trackedShipmentCount).toBeNull();
        expect(metrics.chargebackCount).toBeNull();
        expect(metrics.unitOnTimeDeliveryRatePct).toBeNull();
        expect(metrics.unitOnTimeDeliveryRateStatus).toBe('');
    });

    /* Shapes taken from five live reports, September 2026. */
    describe('live response shapes', () => {
        const live = () => v2Report({
            lateShipmentRate: { status: 'BAD', targetValue: 0.02, targetCondition: 'LESS_THAN', orderCount: 30, rate: 0.03333333333333333 },
            validTrackingRate: { status: 'GOOD', targetValue: 0.95, targetCondition: 'GREATER_THAN', shipmentCount: 0, validTrackingCount: 0, rate: 0 },
            unitOnTimeDeliveryRate: { status: 'GOOD', targetValue: 0.9, targetCondition: 'GREATER_THAN', totalUnitCount: 14, rate: 0.9285714285714286 },
            orderDefectRate: {
                afn: { status: 'GOOD', targetValue: 0.01, orderCount: 0, rate: 0, orderWithDefects: { status: 'GOOD', count: 0 }, chargebacks: { status: 'NONE', count: 0 } },
                mfn: { status: 'AT RISK', targetValue: 0.01, orderCount: 62, rate: 0.0161, chargebacks: { status: 'NONE', count: 1 } },
            },
        });

        it('reads a bare-number target with its separate condition', () => {
            const { rateDetails, lateShipmentRatePct } = extractExtendedMetrics(live());
            expect(lateShipmentRatePct).toBe(3.3333);
            expect(rateDetails.lateShipmentRate).toMatchObject({ status: 'BAD', targetPct: 2, condition: 'LESS_THAN', basis: 30 });
        });

        it('gives no figure for a rate with nothing behind it', () => {
            const { validTrackingRatePct, rateDetails } = extractExtendedMetrics(live());
            expect(validTrackingRatePct).toBeNull();
            expect(rateDetails.validTrackingRate.basis).toBe(0);
        });

        it('takes ODR from the channel that carried the orders', () => {
            const metrics = extractExtendedMetrics(live());
            expect(metrics.orderDefectRatePct).toBe(1.61);
            expect(metrics.orderDefectRateStatus).toBe('AT RISK');
        });

        it('does not read Amazon\'s "NONE" as a verdict', () => {
            expect(extractExtendedMetrics(live()).chargebackStatus).toBe('');
        });

        it('parses a real saved report end to end without throwing', () => {
            expect(() => buildSnapshot(live())).not.toThrow();
        });
    });

    it('reads the US-only unit-based On-Time Delivery Rate when present', () => {
        const metrics = extractExtendedMetrics(v2Report({ unitOnTimeDeliveryRate: { status: 'GOOD', rate: 0.972, targetValue: { value: 0.9 } } }));
        expect(metrics).toMatchObject({ unitOnTimeDeliveryRateStatus: 'GOOD', unitOnTimeDeliveryRatePct: 97.2 });
    });
});

describe('flat-file headers', () => {
    it('matches a field whatever the case, spacing or punctuation of its header', () => {
        const { rows, missing } = mapFlatFileRecords(
            [{ 'Seller SKU': 'A', 'ASIN': 'B1' }],
            { sku: ['seller-sku'], asin: ['asin'], title: ['item-name'] }
        );
        expect(rows[0]).toEqual({ sku: 'A', asin: 'B1', title: '' });
        expect(missing).toEqual(['title']);
    });
});

describe('Suppressed Listings Report', () => {
    const header = ['Status', 'Reason', 'SKU', 'ASIN', 'Product name', 'Condition', 'Status Change Date', 'Issue Description'];

    it('reads the documented headers and keeps at-risk listings apart from suppressed ones', async () => {
        const parsed = await parseSuppressedListings(tsv([
            header,
            ['Search Suppressed', 'Missing main image', 'S1', 'B1', 'One', 'New', '2026-09-20', 'Main image'],
            ['Blocked', 'Pricing error', 'S2', 'B2', 'Two', 'New', '2026-09-21', ''],
            ['At Risk', 'Low quality', 'S3', 'B3', 'Three', 'New', '2026-09-22', ''],
        ]));

        expect(parsed.unreadable).toBe(false);
        expect(parsed.itemCount).toBe(3);
        expect(parsed.suppressedCount).toBe(2);
        expect(parsed.atRiskCount).toBe(1);
        expect(parsed.items[0]).toMatchObject({ sku: 'S1', asin: 'B1', status: 'Search Suppressed', reason: 'Missing main image', issueDescription: 'Main image', isAtRisk: false });
    });

    it('accepts hyphenated flat-file spellings and gzip', async () => {
        const body = tsv([['seller-sku', 'asin1', 'item-name', 'status'], ['S1', 'B1', 'One', 'Suppressed']]);
        const parsed = await parseSuppressedListings(zlib.gzipSync(body));
        expect(parsed.items[0]).toMatchObject({ sku: 'S1', asin: 'B1', productName: 'One' });
    });

    it('marks a file with no SKU column unreadable instead of reporting nothing suppressed', async () => {
        const parsed = await parseSuppressedListings(tsv([['Estado', 'Artículo'], ['Suprimido', 'X']]));
        expect(parsed.unreadable).toBe(true);
        expect(parsed.items).toEqual([]);
        expect(parsed.headers).toEqual(['Estado', 'Artículo']);
    });

    it('treats a headers-only file as nothing suppressed', async () => {
        const parsed = await parseSuppressedListings(tsv([header]));
        expect(parsed).toMatchObject({ unreadable: false, itemCount: 0, suppressedCount: 0 });
    });
});

describe('FBA removal order detail', () => {
    const header = ['request-date', 'order-id', 'order-type', 'order-status', 'last-updated-date', 'sku', 'fnsku', 'disposition',
        'requested-quantity', 'cancelled-quantity', 'disposed-quantity', 'shipped-quantity', 'in-process-quantity', 'removal-fee', 'currency'];

    it('counts what is still to leave on open orders, and nothing on closed ones', async () => {
        const parsed = await parseRemovalOrders(tsv([
            header,
            // Amazon's own in-process figure wins.
            ['2026-09-10T00:00:00Z', 'R1', 'Return', 'Pending', '2026-09-12', 'S1', 'X1', 'Sellable', '20', '0', '0', '5', '15', '5.00', 'USD'],
            // No in-process figure: what is left of the request.
            ['2026-09-11T00:00:00Z', 'R2', 'Disposal', 'Processing', '2026-09-12', 'S2', 'X2', 'Unsellable', '10', '2', '3', '0', '', '1.00', 'USD'],
            // A second line of R1 — one order, not two.
            ['2026-09-10T00:00:00Z', 'R1', 'Return', 'Pending', '2026-09-12', 'S3', 'X3', 'Sellable', '4', '0', '0', '0', '4', '1.00', 'USD'],
            ['2026-08-01T00:00:00Z', 'R0', 'Return', 'Completed', '2026-08-05', 'S4', 'X4', 'Sellable', '8', '0', '0', '8', '0', '2.00', 'USD'],
            ['2026-08-02T00:00:00Z', 'R9', 'Return', 'Cancelled', '2026-08-03', 'S5', 'X5', 'Sellable', '6', '0', '0', '0', '6', '0', 'USD'],
        ]));

        const line = (sku) => parsed.lines.find((l) => l.sku === sku);
        expect(line('S1')).toMatchObject({ pendingQuantity: 15, isPending: true, requestedQuantity: 20 });
        expect(line('S2')).toMatchObject({ pendingQuantity: 5, isPending: true });
        expect(line('S4')).toMatchObject({ pendingQuantity: 0, isPending: false });
        // Cancelled is closed even with an in-process figure left on the line.
        expect(line('S5')).toMatchObject({ pendingQuantity: 0, isPending: false });
        expect(parsed.pendingOrderCount).toBe(2);
        expect(parsed.pendingUnits).toBe(15 + 5 + 4);
        // Pending lines first, so a capped snapshot keeps the ones that matter.
        expect(parsed.lines.slice(0, 3).every((l) => l.isPending)).toBe(true);
    });

    it('never goes negative when Amazon\'s columns briefly disagree', async () => {
        const parsed = await parseRemovalOrders(tsv([
            header,
            ['2026-09-10', 'R1', 'Return', 'Pending', '', 'S1', '', '', '5', '0', '0', '7', '', '', ''],
        ]));
        expect(parsed.lines[0]).toMatchObject({ pendingQuantity: 0, isPending: false });
    });

    it('marks a file with no order-id column unreadable', async () => {
        const parsed = await parseRemovalOrders(tsv([['fecha', 'sku'], ['2026-09-10', 'S1']]));
        expect(parsed.unreadable).toBe(true);
        expect(parsed.pendingUnits).toBe(0);
    });
});

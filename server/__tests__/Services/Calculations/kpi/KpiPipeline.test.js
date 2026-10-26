/**
 * The plumbing around the tasks-logics.xlsx detectors: the per-account gate, the
 * compact inputs Analyse builds, the runner DashboardCalculation calls, and the
 * coverage keys task reconcile reads.
 */
jest.mock('../../../../models/products/SuppressedListingsModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../../models/inventory/RemovalOrdersModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../../models/inventory/RemovalReceiptModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../../Services/Finance/AsinFinanceWindowService.js', () => ({ getAsinFinanceForWindow: jest.fn() }));
jest.mock('../../../../Services/Finance/FBAReimbursementsService.js', () => ({ getFBAReimbursementsData: jest.fn() }));
// No ledger fetch and no shipment doc: both inputs read as "not arrived".
jest.mock('../../../../models/finance/LedgerDetailViewItemModel.js', () => ({
    findOne: () => ({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) })
}));
jest.mock('../../../../models/inventory/ShipmentModel.js', () => ({
    findOne: () => ({ sort: () => ({ lean: () => Promise.resolve(null) }) })
}));

const { kpiWaveEnabledFor, enabledKpiWaves } = require('../../../../Services/Calculations/kpi/kpiGate.js');
const KpiInputs = require('../../../../Services/Calculations/kpi/KpiInputs.js');
const { runKpiDetectors, windowDaysOf, windowIsRecent, KPI_SOURCES } = require('../../../../Services/Calculations/kpi/index.js');
const { coverageSourceFor } = require('../../../../Services/Calculations/TaskReconcilePlanner.js');

const USER = '6a57b823571ceb9266953c30';
const OTHER = '6a57b823571ceb9266953c31';
const NOW = new Date('2026-10-24T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5).toISOString();

describe('kpiGate', () => {
    it('is off unless the wave flag is exactly "true"', () => {
        expect(kpiWaveEnabledFor(1, USER, {})).toBe(false);
        expect(kpiWaveEnabledFor(1, USER, { KPI_TASKS_WAVE1: 'on' })).toBe(false);
        expect(kpiWaveEnabledFor(1, USER, { KPI_TASKS_WAVE1: 'true' })).toBe(true);
    });

    it('honours the allowlist, and fails closed on a list with no valid id', () => {
        const env = { KPI_TASKS_WAVE1: 'true', KPI_TASKS_USER_IDS: USER };
        expect(kpiWaveEnabledFor(1, USER, env)).toBe(true);
        expect(kpiWaveEnabledFor(1, OTHER, env)).toBe(false);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        expect(kpiWaveEnabledFor(1, USER, { KPI_TASKS_WAVE1: 'true', KPI_TASKS_USER_IDS: 'typo' })).toBe(false);
        warn.mockRestore();
    });

    it('knows no wave it has no detectors for', () => {
        expect(kpiWaveEnabledFor(4, USER, { KPI_TASKS_WAVE4: 'true' })).toBe(false);
        expect(enabledKpiWaves(USER, { KPI_TASKS_WAVE1: 'true' })).toEqual([1]);
        expect(enabledKpiWaves(USER, { KPI_TASKS_WAVE2: 'true', KPI_TASKS_WAVE3: 'true' })).toEqual([2, 3]);
    });
});

describe('KpiInputs', () => {
    it('sums FBA stock per ASIN across SKUs and keeps the newest fetch time', () => {
        const stock = KpiInputs.buildStock([
            { asin: 'A1', sellerSku: 'S1', fulfillableQuantity: 0, inboundShippedQuantity: 2, totalQuantity: 2, fetchedAt: new Date(daysAgo(1)) },
            { asin: 'A1', sellerSku: 'S1-B', fulfillableQuantity: 3, inboundWorkingQuantity: 1, totalQuantity: 4, fetchedAt: new Date(daysAgo(0)) }
        ]);
        expect(stock.byAsin.A1).toEqual({ fulfillable: 3, inbound: 3, total: 6, skus: ['S1', 'S1-B'] });
        expect(stock.fetchedAt).toBe(daysAgo(0));
        expect(KpiInputs.buildStock([])).toBeNull();
    });

    it('treats a zero or blank cost as no cost, and an unreadable COGS lookup as unknown', () => {
        expect(KpiInputs.buildCogsAsins({ success: true, data: { cogsValues: { A1: 4.5, A2: 0, A3: '' } } })).toEqual(['A1']);
        expect(KpiInputs.buildCogsAsins({ success: false })).toBeNull();
    });

    it('orders AHR history oldest first and keeps a missing score as null', () => {
        const h = KpiInputs.buildAhrHistory([
            { createdAt: new Date(daysAgo(0)), ahrScore: null },
            { createdAt: new Date(daysAgo(2)), ahrScore: 410 }
        ]);
        expect(h).toEqual([{ at: daysAgo(2), score: 410 }, { at: daysAgo(0), score: null }]);
    });

    it('drops at-risk suppressed rows, and an unreadable report is no report', () => {
        const s = KpiInputs.buildSuppressed({
            createdAt: new Date(daysAgo(0)),
            items: [{ sku: 'S1', asin: 'A1', status: 'Blocked' }, { sku: 'S2', asin: 'A2', isAtRisk: true }]
        });
        expect(s.items.map(i => i.asin)).toEqual(['A1']);
        expect(KpiInputs.buildSuppressed({ unreadable: true, items: [] })).toBeNull();
        expect(KpiInputs.buildRemovals({ unreadable: true, lines: [] })).toBeNull();
    });

    it('keeps only ASINs that sold in the sales lookback, null when none did', () => {
        expect(KpiInputs.buildSalesLookback({ A1: { sales: 10, unitsSold: 1 }, A2: { sales: 0, unitsSold: 0 } }))
            .toEqual({ A1: { sales: 10, unitsSold: 1 } });
        expect(KpiInputs.buildSalesLookback({})).toBeNull();
    });

    it('keeps reimbursements for removal orders only, per order then SKU, netting reversals', () => {
        const r = KpiInputs.buildRemovalReimbursements({ data: [
            { amazon_order_id: 'R1', reason: 'Lost_Outbound', sku: 'S1', quantity_reimbursed_total: '3' },
            { amazon_order_id: 'R1', reason: 'Reimbursement_Reversal', sku: 'S1', quantity_reimbursed_total: '-1' },
            { amazon_order_id: 'R1', reason: 'Damaged_Outbound', sku: '', quantity_reimbursed_total: '2' },
            { amazon_order_id: '111-2223334-5556667', reason: 'CustomerReturn', sku: 'S1', quantity_reimbursed_total: '9' },
            { amazon_order_id: '', reason: 'Lost_Warehouse', sku: 'S1', quantity_reimbursed_total: '9' }
        ] }, new Set(['R1']));
        expect(r).toEqual({ R1: { S1: 2, '': 2 } });
        expect(KpiInputs.buildRemovalReimbursements(null)).toBeNull();
    });

    it('buildKpiInputs matches reimbursements to the removal report\'s own order ids', () => {
        const inputs = KpiInputs.buildKpiInputs({
            removalDoc: { createdAt: new Date(daysAgo(1)), lines: [{ orderId: 'R1', sku: 'S1', requestedQuantity: 5 }] },
            reimbursementsDoc: { data: [
                { amazon_order_id: 'R1', sku: 'S1', quantity_reimbursed_total: '2' },
                { amazon_order_id: 'R2', sku: 'S1', quantity_reimbursed_total: '4' }
            ] }
        });
        expect(inputs.removalReimbursements).toEqual({ R1: { S1: 2 } });
    });

    it('loadKpiInputs reads the extra sources and survives a failed read', async () => {
        const Suppressed = require('../../../../models/products/SuppressedListingsModel.js');
        const Removals = require('../../../../models/inventory/RemovalOrdersModel.js');
        const { getAsinFinanceForWindow } = require('../../../../Services/Finance/AsinFinanceWindowService.js');
        const { getFBAReimbursementsData } = require('../../../../Services/Finance/FBAReimbursementsService.js');
        const chain = (value) => ({ sort: () => ({ lean: () => value }) });
        Suppressed.findOne.mockReturnValue(chain(Promise.resolve({ createdAt: new Date(daysAgo(0)), items: [] })));
        Removals.findOne.mockReturnValue(chain(Promise.reject(new Error('boom'))));
        getAsinFinanceForWindow.mockResolvedValue({ A1: { sales: 50, unitsSold: 2 } });
        getFBAReimbursementsData.mockRejectedValue(new Error('down'));
        const RemovalReceipt = require('../../../../models/inventory/RemovalReceiptModel.js');
        RemovalReceipt.find.mockReturnValue({ lean: () => Promise.resolve([{ orderId: 'R1', sku: 'S1', shippedQuantity: 10, receivedQuantity: 7 }]) });

        const inputs = await KpiInputs.loadKpiInputs({ userId: USER, country: 'US', region: 'NA', waves: [1], allData: {}, now: NOW });
        expect(inputs.waves).toEqual([1]);
        expect(inputs.suppressed).toEqual({ createdAt: daysAgo(0), items: [] });
        expect(inputs.removals).toBeNull();
        expect(inputs.salesLookback).toEqual({ A1: { sales: 50, unitsSold: 2 } });
        expect(inputs.removalReimbursements).toBeNull();
        expect(inputs.removalReceipts).toEqual([{ orderId: 'R1', sku: 'S1', shippedQuantity: 10, receivedQuantity: 7 }]);
        expect(inputs.lostDamaged).toBeNull();
        expect(inputs.inboundShortage).toBeNull();
        // 60 days ending yesterday (UTC).
        const [, , , start, end] = getAsinFinanceForWindow.mock.calls[0];
        expect(end.toISOString().slice(0, 10)).toBe('2026-10-23');
        expect(start.toISOString().slice(0, 10)).toBe('2026-08-25');
    });
});

describe('runKpiDetectors', () => {
    const baseData = (over = {}) => ({
        startDate: '2026-09-24',
        endDate: '2026-10-23',
        TotalProducts: [{ asin: 'A1', sku: 'S1', itemName: 'Garlic Press', status: 'Inactive', quantity: 0, listingIssues: [] }],
        ProductWiseSponsoredAds: [{ asin: 'A1', date: '2026-10-22', spend: 7 }],
        BuyBoxData: { asinBuyBoxData: [] },
        KpiInputs: {
            waves: [1],
            stock: { fetchedAt: daysAgo(0), byAsin: { A1: { fulfillable: 0, inbound: 0, total: 0, skus: ['S1'] } } },
            cogsAsins: [],
            ahrHistory: [{ at: daysAgo(0), score: 700 }],
            suppressed: { createdAt: daysAgo(0), items: [] },
            removals: { createdAt: daysAgo(1), lines: [] },
            removalReceipts: [],
            lostDamaged: { fetchedAt: daysAgo(1), events: [] },
            inboundShortage: { fetchedAt: daysAgo(1), shipments: [], reimbursedByFnsku: {}, reimbursementsRead: true }
        },
        ...over
    });

    it('runs only the always-on alignment check without any wave', () => {
        const none = { tasks: [], coverage: { 'kpi.listingErrors': false, 'kpi.productAcos': false }, staleSources: [], dataFaults: [] };
        expect(runKpiDetectors({}, { now: NOW })).toEqual(none);
        expect(runKpiDetectors({ KpiInputs: { waves: [] } }, { now: NOW })).toEqual(none);
        // Amazon's ERROR flags on a listing are a task whether or not a wave is on.
        const r = runKpiDetectors({ TotalProducts: [{ asin: 'A1', sku: 'S1', listingIssues: [{ severity: 'ERROR', message: 'Missing brand' }] }] }, { now: NOW });
        expect(r.tasks.map(t => [t.errorCategory, t.errorType])).toEqual([['ranking', 'listing_errors']]);
        expect(r.coverage['kpi.listingErrors']).toBe(true);
    });

    it('chains out-of-stock into ads-on-unbuyable and reports every source covered', () => {
        const r = runKpiDetectors(baseData(), {
            salesByAsin: { A1: { sales: 300, unitsSold: 30 } }, financeFresh: true, country: 'US', now: NOW
        });
        expect(r.tasks.map(t => t.errorType).sort()).toEqual(['ads_on_unbuyable', 'cogs_missing', 'out_of_stock']);
        expect(Object.values(r.coverage).every(Boolean)).toBe(true);
        expect(r.tasks.find(t => t.errorType === 'out_of_stock').renderData.windowDays).toBe(30);
    });

    it('holds finance-based sources when finance is stale', () => {
        const r = runKpiDetectors(baseData(), { salesByAsin: {}, financeFresh: false, country: 'US', now: NOW });
        expect(r.coverage['kpi.outOfStock']).toBe(false);
        expect(r.coverage['kpi.cogsMissing']).toBe(false);
        expect(r.coverage['kpi.adsOnUnbuyable']).toBe(false);
        expect(r.coverage['kpi.ahrEarlyWarning']).toBe(true);
    });

    it('a detector that throws is uncovered, the rest still run', () => {
        const data = baseData();
        data.KpiInputs.removals = { createdAt: daysAgo(1), get lines() { throw new Error('bad doc'); } };
        const r = runKpiDetectors(data, { salesByAsin: {}, financeFresh: true, country: 'US', now: NOW });
        expect(r.coverage['kpi.removalShortfall']).toBe(false);
        expect(r.coverage['kpi.suppressed']).toBe(true);
    });

    // Seen in production: a stalled account's window was 3 Aug - 1 Sep, read on 24 Oct,
    // with finance still "fresh" because it had rows for that window.
    it('does not call an old window "recent": out of stock held, COGS text names the dates', () => {
        const data = baseData({ startDate: '2026-08-03', endDate: '2026-09-01' });
        const r = runKpiDetectors(data, {
            salesByAsin: { A1: { sales: 300, unitsSold: 30 } }, financeFresh: true, country: 'US', now: NOW
        });
        expect(r.coverage['kpi.outOfStock']).toBe(false);
        expect(r.coverage['kpi.adsOnUnbuyable']).toBe(false);
        expect(r.tasks.map(t => t.errorType)).toEqual(['cogs_missing']);
        expect(r.tasks[0].error).toContain('sold between Aug 3 and Sep 1 has no product cost');
    });

    it('an old window cannot qualify a suppressed listing, the 60-day lookback still can', () => {
        const data = baseData({ startDate: '2026-08-03', endDate: '2026-09-01' });
        data.KpiInputs.stock = null;
        data.KpiInputs.suppressed = { createdAt: daysAgo(0), items: [{ sku: 'S1', asin: 'A1', status: 'Blocked', reason: 'x' }] };
        const ctx = { salesByAsin: { A1: { sales: 300, unitsSold: 30 } }, financeFresh: true, country: 'US', now: NOW };
        expect(runKpiDetectors(data, ctx).tasks.some(t => t.errorType === 'listing_suppressed')).toBe(false);
        data.KpiInputs.salesLookback = { A1: { sales: 40, unitsSold: 2 } };
        expect(runKpiDetectors(data, ctx).tasks.some(t => t.errorType === 'listing_suppressed')).toBe(true);
    });

    it('wave 2 alone adds only its own tasks and coverage, using wave 1\'s verdicts to skip', () => {
        const data = baseData();
        data.KpiInputs.waves = [2];
        // A1 is out of stock (wave 1 verdict), so its sales drop belongs to that task.
        data.KpiInputs.traffic = {
            newestDate: daysAgo(2).slice(0, 10), recent14Days: 14, baselineDays: 60, recent7Days: 7, prior28Days: 28,
            byAsin: { A1: { rs: 50, ru: 0, bs: 200, bu: 0, u7: 0, u28: 200 }, A2: { rs: 50, ru: 0, bs: 200, bu: 0, u7: 0, u28: 200 } }
        };
        const r = runKpiDetectors(data, { salesByAsin: { A1: { sales: 300, unitsSold: 30 } }, financeFresh: true, country: 'US', now: NOW });
        expect(r.tasks.map(t => [t.asin, t.errorType])).toEqual([['A2', 'sales_drop']]);
        expect(Object.keys(r.coverage)).not.toContain('kpi.outOfStock');
        expect(r.coverage['kpi.salesDrop']).toBe(true);
        expect(r.coverage['kpi.tacos']).toBe(false);
    });

    it('wave 3 alone reads listing warnings from the catalogue rows', () => {
        const data = baseData({ TotalProducts: [{ asin: 'A1', sku: 'S1', status: 'Active', quantity: 5, listingIssues: [{ severity: 'WARNING', message: 'Add a color' }] }] });
        data.KpiInputs.waves = [3];
        const r = runKpiDetectors(data, { salesByAsin: {}, financeFresh: true, country: 'US', now: NOW });
        expect(r.tasks.map(t => t.errorType)).toEqual(['listing_warnings']);
        expect(r.coverage['kpi.listingWarnings']).toBe(true);
        expect(r.coverage['kpi.fbaFeeIncrease']).toBe(false);
    });

    it('windowIsRecent allows a window whose last day ended within the last week', () => {
        // NOW is Oct 24 12:00 UTC; a window "ends" at the end of its last day.
        expect(windowIsRecent('2026-10-23', NOW)).toBe(true);
        expect(windowIsRecent('2026-10-17', NOW)).toBe(true);   // ended 6.5 days ago
        expect(windowIsRecent('2026-10-16', NOW)).toBe(false);  // ended 7.5 days ago
        expect(windowIsRecent(null, NOW)).toBe(false);
    });

    it('windowDaysOf counts both ends and falls back to 30', () => {
        expect(windowDaysOf('2026-09-24', '2026-10-23')).toBe(30);
        expect(windowDaysOf(null, '2026-10-23')).toBe(30);
    });
});

describe('reconcile coverage keys', () => {
    it.each(Object.entries(KPI_SOURCES))('%s resolves only on its own source %s', (key, source) => {
        const [category, errorType] = key.split(':');
        expect(coverageSourceFor(category, errorType)).toBe(source);
    });
});

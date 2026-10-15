/**
 * Account-wide ESF reports: one report per type, covering every marketplace.
 *
 * Pinned here because each would go wrong quietly:
 *
 *  - money must NEVER be added across currencies. "$383 + ₹9,488" is not a
 *    number anyone can use; only counts are summed.
 *  - each comparison row and each section is in its OWN currency.
 *  - the primary marketplace is ranked on value, not on the raw number — ₹9,488
 *    is smaller than $383, and a raw compare gets that backwards.
 *  - a single-marketplace account must get exactly the report it always did.
 *  - a marketplace named in a request is honoured only if it is the user's own.
 */
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/MCP/SalesOnlyMetricsModel.js', () => ({ aggregate: jest.fn(), findOne: jest.fn() }));
jest.mock('../../../utils/Logger.js', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const SalesOnlyMetrics = require('../../../models/MCP/SalesOnlyMetricsModel.js');
const {
    combine, formatStat, pickPrimary, listMarketplaces, ownsMarketplace,
} = require('../../../Services/Calculations/EsfAccountReportsService.js');

const US = { country: 'US', region: 'NA', currency: '$' };
const IN = { country: 'IN', region: 'EU', currency: '₹' };

const monthly = (overrides) => ({
    key: 'monthly-performance',
    name: 'Monthly Performance Report',
    cadence: 'MONTHLY',
    tableTitle: 'Month on month',
    available: true,
    date: 'September 2026',
    tone: 'good',
    insight: 'Sales up',
    summary: {
        headline: 'September against August',
        stats: [
            { label: 'Total sales', value: 383, format: 'currency', delta: 636.49, deltaFormat: 'percent' },
            { label: 'Sessions', value: 129, previous: 100 },
            { label: 'Units sold', value: 4, previous: 2 },
            { label: 'ACOS', value: 116.36, format: 'percent' },
        ],
        columns: [{ key: 'metric', label: 'Metric' }],
        rows: Array.from({ length: 30 }, (_, i) => ({ metric: `m${i}` })),
    },
    highlights: [{ text: 'Sales grew.', tone: 'good' }, { text: '[Actions]', tone: 'fill' }],
    caveats: ['Shared caveat.'],
    ...overrides,
});

const inReport = monthly({
    tone: 'watch',
    summary: {
        ...monthly().summary,
        stats: [
            { label: 'Total sales', value: 9488, format: 'currency', delta: null, deltaFormat: 'percent' },
            { label: 'Sessions', value: 177, previous: 50 },
            { label: 'Units sold', value: 5, previous: 5 },
            { label: 'ACOS', value: 91.28, format: 'percent' },
        ],
    },
    highlights: [{ text: 'ACOS is high.', tone: 'watch' }, { text: '[Actions]', tone: 'fill' }],
    caveats: ['Shared caveat.', 'IN only caveat.'],
});

describe('combine', () => {
    const built = () => combine('monthly-performance', [
        { marketplace: IN, report: inReport },
        { marketplace: US, report: monthly() },
    ], US, 10);

    it('leaves a single-marketplace account exactly as it was', () => {
        const report = combine('monthly-performance', [{ marketplace: US, report: monthly() }], US, 10);
        expect(report.multi).toBe(false);
        expect(report.sections).toBeUndefined();
        expect(report.summary.stats).toEqual(monthly().summary.stats);
        expect(report.summary.rows).toHaveLength(10);
    });

    it('leads with the primary, whatever order the marketplaces were connected in', () => {
        const report = built();
        expect(report.marketplace).toEqual(US);
        expect(report.isPrimary).toBe(true);
        expect(report.sections.map((s) => s.marketplace.country)).toEqual(['US', 'IN']);
    });

    it('sums counts across marketplaces, with a change built from the summed previous figures', () => {
        const tiles = built().overview.stats;
        const sessions = tiles.find((t) => t.label === 'Sessions · All marketplaces');
        expect(sessions.value).toBe(129 + 177);
        expect(sessions.delta).toBe(104); // (306 - 150) / 150
        expect(tiles.find((t) => t.label === 'Units sold · All marketplaces').value).toBe(9);
    });

    it('never adds money across currencies', () => {
        const tiles = built().overview.stats;
        expect(tiles.some((t) => /Total sales · All marketplaces/.test(t.label))).toBe(false);
        // The primary's own sales, named as its own.
        expect(tiles.find((t) => t.label === 'Total sales · Amazon US').value).toBe(383);
    });

    it('puts each market in its own currency in the comparison', () => {
        const { comparison } = built();
        const col = comparison.columns.find((c) => c.label === 'Total sales').key;
        expect(comparison.rows.find((r) => r.market === 'US')[col]).toBe('$383');
        expect(comparison.rows.find((r) => r.market === 'IN')[col]).toBe('₹9,488');
        // The reference report's Sales Δ, "New" where there is no baseline.
        expect(comparison.rows.find((r) => r.market === 'IN').salesChange).toBe('New');
        expect(comparison.rows.find((r) => r.market === 'US').salesChange).toBe('+636.49%');
    });

    it('keeps every section, trimmed to the requested depth', () => {
        const report = combine('monthly-performance', [
            { marketplace: US, report: monthly() },
            { marketplace: IN, report: inReport },
        ], US, 40);
        expect(report.sections.every((s) => s.summary.rows.length === 30)).toBe(true);
        expect(report.sections.every((s) => s.summary.totalRows === 30)).toBe(true);
    });

    it('names the market on every highlight, and the placeholder only once', () => {
        const { highlights } = built();
        expect(highlights.map((h) => h.text)).toEqual(['Amazon US: Sales grew.', 'Amazon IN: ACOS is high.', '[Actions]']);
    });

    it('says a shared caveat once, and prefixes one that applies to some markets', () => {
        expect(built().caveats).toEqual(['Shared caveat.', 'Amazon IN: IN only caveat.']);
    });

    it('carries a marketplace with no data as a section with its reason', () => {
        const report = combine('monthly-performance', [
            { marketplace: US, report: monthly() },
            { marketplace: IN, report: { available: false, reason: 'No sales recorded.' } },
        ], US, 10);
        expect(report.sections[1]).toMatchObject({ available: false, reason: 'No sales recorded.' });
        expect(report.caveats).toContain('Amazon IN: No sales recorded.');
        expect(report.comparison.rows[1]).toMatchObject({ market: 'IN' });
    });

    it('is led by the first marketplace with data when the primary has none', () => {
        const report = combine('monthly-performance', [
            { marketplace: US, report: { available: false, reason: 'dormant' } },
            { marketplace: IN, report: inReport },
        ], US, 10);
        expect(report.marketplace).toEqual(IN);
        expect(report.isPrimary).toBe(false);
    });

    it('is unavailable only when no marketplace has data', () => {
        const report = combine('monthly-performance', [
            { marketplace: US, report: { available: false, reason: 'dormant' } },
            { marketplace: IN, report: { available: false, reason: 'no data' } },
        ], US, 10);
        expect(report.available).toBe(false);
        expect(report.reason).toBe('Amazon US: dormant Amazon IN: no data');
    });

    it('flags the report when any marketplace needs attention', () => {
        expect(built().tone).toBe('watch');
    });
});

describe('formatStat', () => {
    it('formats a figure in the currency it was given', () => {
        expect(formatStat({ value: 9488, format: 'currency' }, '₹')).toBe('₹9,488');
        expect(formatStat({ value: -17, format: 'money' }, '$')).toBe('-$17.00');
        expect(formatStat({ value: 91.28, format: 'percent' }, '$')).toBe('91.28%');
        expect(formatStat(null, '$')).toBe('-');
    });
});

describe('pickPrimary', () => {
    it('ranks by value, not by the raw number', async () => {
        // ₹9,488 is about $114: the smaller market despite the bigger number.
        SalesOnlyMetrics.aggregate.mockResolvedValue([
            { _id: { country: 'IN', region: 'EU' }, sales: 9488 },
            { _id: { country: 'US', region: 'NA' }, sales: 383 },
        ]);
        expect(await pickPrimary('507f1f77bcf86cd799439011', [IN, US])).toEqual(US);
    });

    it('falls back to the first connected when nothing has sold', async () => {
        SalesOnlyMetrics.aggregate.mockResolvedValue([]);
        expect(await pickPrimary('507f1f77bcf86cd799439011', [IN, US])).toEqual(IN);
    });

    it('does not rank a single marketplace at all', async () => {
        expect(await pickPrimary('507f1f77bcf86cd799439011', [US])).toEqual(US);
        expect(SalesOnlyMetrics.aggregate).not.toHaveBeenCalled();
    });
});

describe('marketplace ownership', () => {
    beforeEach(() => {
        Seller.findOne.mockReturnValue({
            select: () => ({ lean: () => Promise.resolve({ sellerAccount: [
                { country: 'US', region: 'NA' }, { country: 'US', region: 'NA' }, { country: 'IN', region: 'EU' }, { region: 'EU' },
            ] }) }),
        });
    });

    it('lists each connected marketplace once, with its currency', async () => {
        expect(await listMarketplaces('u1')).toEqual([
            { country: 'US', region: 'NA', currency: '$' },
            { country: 'IN', region: 'EU', currency: '₹' },
        ]);
    });

    it("honours only the user's own marketplace", async () => {
        expect(await ownsMarketplace('u1', 'IN', 'EU')).toBe(true);
        expect(await ownsMarketplace('u1', 'UK', 'EU')).toBe(false);
        expect(await ownsMarketplace('u1', 'IN', 'NA')).toBe(false);
    });
});

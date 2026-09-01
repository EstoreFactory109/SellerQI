/**
 * Tests for buildLtsfAmountMap — the age guard that stops a long-dead sync's
 * storage-fee snapshot from being presented as money recoverable today.
 */

const {
    buildLtsfAmountMap,
    LTSF_MAX_SNAPSHOT_AGE_DAYS
} = require('../../../Services/Calculations/RecoverableAmountUtils.js');
const logger = require('../../../utils/Logger.js');

const NOW = new Date('2026-08-14T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('buildLtsfAmountMap', () => {
    it('returns an empty map for a missing, empty or malformed document', () => {
        expect(buildLtsfAmountMap(null, NOW)).toEqual({});
        expect(buildLtsfAmountMap(undefined, NOW)).toEqual({});
        expect(buildLtsfAmountMap({}, NOW)).toEqual({});
        expect(buildLtsfAmountMap({ data: [] }, NOW)).toEqual({});
        expect(buildLtsfAmountMap({ data: 'not-an-array' }, NOW)).toEqual({});
    });

    it('sums fresh rows per ASIN across aging buckets', () => {
        const doc = {
            data: [
                { asin: 'B001', amount: '10.50', snapShotDate: daysAgo(5) },
                { asin: 'B001', amount: '4.50', snapShotDate: daysAgo(5) },
                { asin: 'B002', amount: '7.25', snapShotDate: daysAgo(30) }
            ]
        };
        expect(buildLtsfAmountMap(doc, NOW)).toEqual({ B001: 15, B002: 7.25 });
    });

    it('excludes rows older than the age window', () => {
        const doc = {
            data: [
                { asin: 'B001', amount: '10.00', snapShotDate: daysAgo(5) },
                { asin: 'B002', amount: '999.00', snapShotDate: daysAgo(LTSF_MAX_SNAPSHOT_AGE_DAYS + 1) }
            ]
        };
        expect(buildLtsfAmountMap(doc, NOW)).toEqual({ B001: 10 });
    });

    it('drops the whole map when every row is stale (the real production case)', () => {
        // Mirrors the 4 real documents: Aug-2025 snapshots still being read in Aug 2026.
        const doc = {
            createdAt: new Date('2025-09-09T00:00:00Z'),
            data: [
                { asin: 'B00L4SIVNU', amount: '4586.79', snapShotDate: '2025-08-15T09:00:00+00:00' }
            ]
        };
        expect(buildLtsfAmountMap(doc, NOW)).toEqual({});
    });

    it('falls back to the document createdAt when a row snapshot date is unparseable', () => {
        const fresh = { createdAt: daysAgo(3), data: [{ asin: 'B001', amount: '12.00', snapShotDate: 'not-a-date' }] };
        expect(buildLtsfAmountMap(fresh, NOW)).toEqual({ B001: 12 });

        const stale = { createdAt: daysAgo(400), data: [{ asin: 'B001', amount: '12.00', snapShotDate: 'not-a-date' }] };
        expect(buildLtsfAmountMap(stale, NOW)).toEqual({});
    });

    it('drops rows that cannot be dated at all rather than trusting them', () => {
        const doc = { data: [{ asin: 'B001', amount: '12.00' }] };
        expect(buildLtsfAmountMap(doc, NOW)).toEqual({});
    });

    it('ignores rows with no asin, and treats a non-numeric amount as 0', () => {
        const doc = {
            data: [
                { amount: '10.00', snapShotDate: daysAgo(1) },
                { asin: 'B001', amount: 'n/a', snapShotDate: daysAgo(1) }
            ]
        };
        expect(buildLtsfAmountMap(doc, NOW)).toEqual({ B001: 0 });
    });

    it('warns when rows are dropped, so a silent zero is never mistaken for "owes nothing"', () => {
        buildLtsfAmountMap(
            { data: [{ asin: 'B001', amount: '5.00', snapShotDate: daysAgo(400) }] },
            NOW
        );
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('LTSF rows ignored'),
            expect.objectContaining({ staleRows: 1 })
        );
    });

    it('does not warn when every row is fresh', () => {
        buildLtsfAmountMap({ data: [{ asin: 'B001', amount: '5.00', snapShotDate: daysAgo(2) }] }, NOW);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('honours an explicit window override', () => {
        const doc = { data: [{ asin: 'B001', amount: '5.00', snapShotDate: daysAgo(10) }] };
        expect(buildLtsfAmountMap(doc, NOW, 30)).toEqual({ B001: 5 });
        expect(buildLtsfAmountMap(doc, NOW, 7)).toEqual({});
    });
});

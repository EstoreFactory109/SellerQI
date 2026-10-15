/**
 * Read-time guards for the daily inventory reports: a newest document older
 * than a week is not presented as current, and inbound issues are re-limited
 * to the 30-day window at read time.
 */

const logger = require('../../../utils/Logger.js');
const {
    freshInventoryReportOrNull,
    filterInboundIssuesToWindow,
    INVENTORY_REPORT_MAX_AGE_DAYS,
} = require('../../../Services/Calculations/InventoryReportFreshness.js');

const NOW = new Date('2026-10-15T12:00:00Z');
const daysBefore = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('freshInventoryReportOrNull', () => {
    it('is 7 days', () => {
        expect(INVENTORY_REPORT_MAX_AGE_DAYS).toBe(7);
    });

    it('keeps a fresh document', () => {
        const doc = { createdAt: daysBefore(1) };
        expect(freshInventoryReportOrNull(doc, 'X', {}, NOW)).toBe(doc);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('drops a document older than 7 days and warns with its age', () => {
        expect(freshInventoryReportOrNull({ createdAt: daysBefore(30) }, 'Stranded inventory', { country: 'US' }, NOW)).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Stranded inventory'),
            expect.objectContaining({ country: 'US', ageDays: 30, maxAgeDays: 7 })
        );
    });

    it('drops an undatable document rather than trusting it', () => {
        expect(freshInventoryReportOrNull({ ErrorData: [] }, 'X', {}, NOW)).toBeNull();
    });

    it('passes null through without logging', () => {
        expect(freshInventoryReportOrNull(null, 'X', {}, NOW)).toBeNull();
        expect(logger.warn).not.toHaveBeenCalled();
    });
});

describe('filterInboundIssuesToWindow', () => {
    it('drops issues reported more than 30 days ago and undatable ones', () => {
        const rows = [
            { asin: 'NEW', issueReportedDate: '2026-10-10' },
            { asin: 'EDGE', issueReportedDate: '2026-09-15' },
            { asin: 'OLD', issueReportedDate: '2026-09-01' },
            { asin: 'NODATE', issueReportedDate: '' },
        ];
        expect(filterInboundIssuesToWindow(rows, NOW).map((r) => r.asin)).toEqual(['NEW', 'EDGE']);
    });

    it('returns [] for a missing array', () => {
        expect(filterInboundIssuesToWindow(undefined, NOW)).toEqual([]);
    });
});

/**
 * Tests for the seller document-size monitor.
 *
 * WHY THIS EXISTS
 * MongoDB's 16MB per-document limit is HARD: past it `sellerDetails.save()` throws and
 * every write that touches the seller document — products, issues, B2B pricing, issue
 * counts — fails at once. The seller document embeds `sellerAccount[].products`, so it
 * grows with catalogue size with no natural bound.
 *
 * Measured 2026-08-20: exactly ONE of 301 seller documents exceeds 4MB (8.21MB, on a
 * CANCELLED account that has been flat at 27,263 products since 2026-07-08); the next
 * largest is 3.00MB. Nothing is close and nothing is trending, so the proportionate
 * action was a warning, not a migration of `products[]` out of the document.
 *
 * The band logic is what these tests pin: the sweep itself only runs an aggregation and
 * logs, so classification is the only place a mistake can hide.
 */

jest.mock('../../../models/system/DataFetchTrackingModel.js', () => ({
    aggregate: jest.fn(), findOne: jest.fn(), updateMany: jest.fn(),
}));
jest.mock('../../../models/system/JobStatusModel.js', () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock('../../../models/user-auth/userModel.js', () => ({ find: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({
    find: jest.fn(), findOne: jest.fn(), aggregate: jest.fn(),
}));
jest.mock('../../../models/amazon-ads/PPCMetricsModel.js', () => ({}));
jest.mock('../../../models/finance/FinanceSyncLogModel.js', () => ({}));
jest.mock('../../../models/finance/DailySkuFinanceModel.js', () => ({}));
jest.mock('../../../models/system/ErrorLogs.js', () => ({
    find: jest.fn(), updateMany: jest.fn(), countDocuments: jest.fn(),
}));
jest.mock('../../../Services/BackgroundJobs/UserSchedulingService.js', () => ({
    UserSchedulingService: { shouldAttemptAccountUpdate: jest.fn() },
}));
jest.mock('../../../Services/BackgroundJobs/producer.js', () => ({ enqueueScheduledAccountJob: jest.fn() }));
jest.mock('../../../Services/BackgroundJobs/queue.js', () => ({ getQueue: () => ({ getJob: jest.fn(), add: jest.fn() }) }));

const {
    classifyDocumentSizes,
    sweepDocumentSizes,
    DOC_SIZE_WARN_BYTES,
    DOC_SIZE_CRITICAL_BYTES,
} = require('../../../Services/BackgroundJobs/freshnessSweeper.js');

const Seller = require('../../../models/user-auth/sellerCentralModel.js');

const MB = 1024 * 1024;
const row = (id, sizeMB, productCount = 0) => ({
    _id: id, User: id, sizeBytes: Math.round(sizeMB * MB), productCount,
});

describe('document-size thresholds', () => {
    test('defaults sit at half and three-quarters of the 16MB ceiling', () => {
        expect(DOC_SIZE_WARN_BYTES).toBe(8 * MB);
        expect(DOC_SIZE_CRITICAL_BYTES).toBe(12 * MB);
        expect(DOC_SIZE_CRITICAL_BYTES).toBeGreaterThan(DOC_SIZE_WARN_BYTES);
    });
});

describe('classifyDocumentSizes', () => {
    const opts = { warnBytes: 8 * MB, criticalBytes: 12 * MB };

    test('bands are exclusive, so a document is counted once', () => {
        const { warn, critical } = classifyDocumentSizes(
            [row('a', 9), row('b', 13), row('c', 3)],
            opts
        );
        expect(warn.map((r) => r._id)).toEqual(['a']);
        expect(critical.map((r) => r._id)).toEqual(['b']);
        // The production shape: 8.21MB warns, and nothing is critical.
        expect(warn.length + critical.length).toBe(2);
    });

    test('thresholds are inclusive at the boundary', () => {
        const { warn, critical } = classifyDocumentSizes([row('at-warn', 8), row('at-crit', 12)], opts);
        expect(warn.map((r) => r._id)).toEqual(['at-warn']);
        expect(critical.map((r) => r._id)).toEqual(['at-crit']);
    });

    test('a document just under the warn threshold is silent', () => {
        const { warn, critical } = classifyDocumentSizes(
            [{ _id: 'x', User: 'x', sizeBytes: 8 * MB - 1, productCount: 100 }],
            opts
        );
        expect(warn).toHaveLength(0);
        expect(critical).toHaveLength(0);
    });

    test('worst is the single largest, and carries its product count', () => {
        const { worst } = classifyDocumentSizes([row('a', 9, 1000), row('b', 13, 27263), row('c', 3, 50)], opts);
        expect(worst._id).toBe('b');
        expect(worst.productCount).toBe(27263);
    });

    test('non-numeric sizes are ignored rather than treated as zero', () => {
        const { warn, critical, worst } = classifyDocumentSizes(
            [{ _id: 'bad', sizeBytes: null }, row('a', 9)],
            opts
        );
        expect(warn.map((r) => r._id)).toEqual(['a']);
        expect(critical).toHaveLength(0);
        expect(worst._id).toBe('a');
    });

    test('empty and non-array input are safe', () => {
        expect(classifyDocumentSizes([], opts)).toEqual({ warn: [], critical: [], worst: null });
        expect(classifyDocumentSizes(undefined, opts)).toEqual({ warn: [], critical: [], worst: null });
    });
});

describe('sweepDocumentSizes', () => {
    beforeEach(() => {
        Seller.aggregate.mockReset();
    });

    // The whole point is that this is a monitor. If it ever starts writing, that is a bug.
    test('reports the worst offender and writes nothing', async () => {
        Seller.aggregate.mockReturnValue({
            allowDiskUse: () => Promise.resolve([row('u1', 8.21, 27263)]),
        });

        const summary = await sweepDocumentSizes();

        expect(summary.enabled).toBe(true);
        expect(summary.scanned).toBe(1);
        expect(summary.warned).toBe(1);
        expect(summary.critical).toBe(0);
        expect(summary.worstProductCount).toBe(27263);
        expect(summary.errors).toBe(0);
        expect(Seller.findOne).not.toHaveBeenCalled();
        expect(Seller.find).not.toHaveBeenCalled();
    });

    test('an aggregation failure is counted, not thrown', async () => {
        Seller.aggregate.mockReturnValue({
            allowDiskUse: () => Promise.reject(new Error('boom')),
        });

        const summary = await sweepDocumentSizes();

        expect(summary.errors).toBe(1);
        expect(summary.warned).toBe(0);
    });
});

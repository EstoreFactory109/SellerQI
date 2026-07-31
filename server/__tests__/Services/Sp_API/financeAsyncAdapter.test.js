/**
 * Tests for financeSalesReportAsync — the engine adapter around the finance Sales Report.
 *
 * Two properties here are correctness-critical and silent when broken:
 *
 *   - The finalize IDEMPOTENCY GUARD. The engine will not re-enter finalize, but the worker
 *     re-enqueues rescheduled jobs with `attempts: 3`, so a BullMQ retry can. If that retry lands
 *     AFTER Step 2 has converted this chunk's estimated fees into actuals, the delete-then-insert
 *     would reinstate the ESTIMATES and lose the actual fees — wrong numbers, no error.
 *
 *   - An EMPTY report must still be processed. Amazon reports a window with no orders as a
 *     header-only body (or DONE_NO_DATA, which carries no document id at all). It is the
 *     empty-rows path through processSalesReportRows that writes the FinanceSyncLog rows which
 *     ADVANCE THE CURSOR. Short-circuiting on empty leaves the chunk unlogged and retried forever.
 */

const mockCountDocuments = jest.fn();
const mockSyncLogFindOneAndUpdate = jest.fn();
const mockSyncLogUpdateOne = jest.fn();
jest.mock('../../../models/finance/FinanceSyncLogModel.js', () => ({
    countDocuments: (...a) => mockCountDocuments(...a),
    findOneAndUpdate: (...a) => mockSyncLogFindOneAndUpdate(...a),
    updateOne: (...a) => mockSyncLogUpdateOne(...a),
    findOne: () => ({ sort: () => ({ lean: async () => null }) }),
}));

const emptyModel = () => ({
    deleteMany: jest.fn().mockResolvedValue({}),
    insertMany: jest.fn().mockResolvedValue([]),
    find: () => ({ lean: async () => [] }),
    distinct: async () => [],
    bulkWrite: jest.fn().mockResolvedValue({}),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
});
jest.mock('../../../models/finance/DailySkuFinanceModel.js', () => emptyModel());
jest.mock('../../../models/finance/DailyOverheadFinanceModel.js', () => emptyModel());
jest.mock('../../../models/finance/PendingExpenseOrderModel.js', () => emptyModel());

// Amazon transport. If the guard or the null-document handling is wrong, these get called and the
// assertions below catch it.
const mockDownloadReportContent = jest.fn();
jest.mock('../../../utils/spApiReportDownload.js', () => ({
    downloadReportContent: (...a) => mockDownloadReportContent(...a),
    isUnusableReportPayload: () => false,
    countNonEmptyLines: () => 0,
    HEADER_ONLY_MAX_BYTES: 1024,
}));

// FinanceService talks to the Reports API through node `https` directly, not axios — so without
// this the document-URL lookup would make a real network call to Amazon.
const mockHttpsBody = { value: { url: 'https://s3.example/doc', compressionAlgorithm: null } };
jest.mock('https', () => ({
    request: (options, cb) => {
        const res = {
            statusCode: 200,
            headers: {},
            on: (evt, fn) => {
                if (evt === 'data') fn(Buffer.from(JSON.stringify(mockHttpsBody.value)));
                if (evt === 'end') fn();
                return res;
            },
        };
        setImmediate(() => cb(res));
        return { on: () => {}, write: () => {}, end: () => {} };
    },
}));

const mockFetchNewFinanceData = jest.fn();
jest.mock('../../../Services/Sp_API/Expences.js', () => ({
    fetchNewFinanceData: (...a) => mockFetchNewFinanceData(...a),
    parseTransactionsV2024: () => ({ expenses: [], revenues: [] }),
    extractRevenueFromTransactions: () => [],
    getAccessToken: async () => 'tok',
    resolveMarketplaceAndRegion: () => ({ baseUrl: 'sellingpartnerapi-na.amazon.com', marketplaceId: 'ATVPDKIKX0DER' }),
}));

const { financeSalesReportAsync, enumerateDatesInclusive } = require('../../../Services/Sp_API/FinanceService.js');

const USER = '507f1f77bcf86cd799439011';
const CHUNK = { startDate: '2026-07-01', endDate: '2026-07-03' };

function buildSpec(chunk = CHUNK) {
    const tokenManager = { token: 'tok', getValidToken: async () => 'tok', withRetry: async (fn) => fn('tok') };
    const specs = financeSalesReportAsync.buildSpecs({
        userId: USER, country: 'US', regionModel: 'NA', tokenManager, chunk,
    });
    return specs[0];
}

beforeEach(() => {
    mockCountDocuments.mockReset().mockResolvedValue(0);
    mockSyncLogFindOneAndUpdate.mockReset().mockResolvedValue({});
    mockSyncLogUpdateOne.mockReset().mockResolvedValue({});
    mockDownloadReportContent.mockReset().mockResolvedValue({ text: '', decompressedBytes: 0, compressedBytes: 0, durationMs: 1 });
    mockFetchNewFinanceData.mockReset().mockResolvedValue({ expenses: [], revenues: [], transactions: [] });
});

describe('enumerateDatesInclusive', () => {
    test('covers both endpoints', () => {
        expect(enumerateDatesInclusive('2026-07-01', '2026-07-03'))
            .toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    });

    test('a single-day range yields that day', () => {
        expect(enumerateDatesInclusive('2026-07-01', '2026-07-01')).toEqual(['2026-07-01']);
    });

    test('crosses a month boundary', () => {
        expect(enumerateDatesInclusive('2026-06-30', '2026-07-01')).toEqual(['2026-06-30', '2026-07-01']);
    });
});

describe('buildSpecs', () => {
    test('emits exactly one spec — one chunk in flight at a time', () => {
        const specs = financeSalesReportAsync.buildSpecs({
            userId: USER, country: 'US', regionModel: 'NA',
            tokenManager: { getValidToken: async () => 't' }, chunk: CHUNK,
        });
        expect(specs).toHaveLength(1);
    });

    test('paramsKey is derived only from the chunk dates, so it is stable across ticks', () => {
        expect(buildSpec().paramsKey).toBe('2026-07-01_2026-07-03');
        expect(buildSpec().paramsKey).toBe(buildSpec().paramsKey);
    });

    test('params carry the window forward and contain NO credentials', () => {
        const spec = buildSpec();
        expect(spec.params).toEqual({ startDate: '2026-07-01', endDate: '2026-07-03' });
        const serialized = JSON.stringify(spec.params);
        expect(serialized).not.toMatch(/tok/);
    });
});

describe('finalize — idempotency guard', () => {
    test('skips entirely when every date in the chunk already carries this syncRunId', async () => {
        mockCountDocuments.mockResolvedValue(3);   // all 3 dates already written by this run

        const res = await buildSpec().finalize({ reportDocumentId: 'doc-1' }, { _id: 'run-abc' });

        expect(res).toEqual({ empty: false, result: { skipped: true } });
        // The whole point: no re-download and no re-persist, so Step 2's actual fees survive.
        expect(mockDownloadReportContent).not.toHaveBeenCalled();
        expect(mockSyncLogFindOneAndUpdate).not.toHaveBeenCalled();
        expect(mockSyncLogUpdateOne).not.toHaveBeenCalled();
    });

    test('queries with the engine row id as syncRunId, scoped to the chunk dates', async () => {
        mockCountDocuments.mockResolvedValue(3);
        await buildSpec().finalize({ reportDocumentId: 'doc-1' }, { _id: 'run-abc' });

        const filter = mockCountDocuments.mock.calls[0][0];
        expect(filter.syncRunId).toBe('run-abc');
        expect(filter.date.$in).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    });

    test('proceeds when only SOME dates were written — a partial run must finish', async () => {
        mockCountDocuments.mockResolvedValue(1);   // 1 of 3
        await buildSpec().finalize({ reportDocumentId: 'doc-1' }, { _id: 'run-abc' });
        expect(mockDownloadReportContent).toHaveBeenCalled();
    });
});

describe('finalize — empty reports still advance the cursor', () => {
    test('DONE_NO_DATA (no document id) skips the download but STILL processes', async () => {
        const res = await buildSpec().finalize({ reportDocumentId: null }, { _id: 'run-1' });

        expect(mockDownloadReportContent).not.toHaveBeenCalled();
        // Sync-log rows were written for the chunk — this is what moves the cursor. Without it the
        // chunk is re-requested forever.
        expect(mockSyncLogUpdateOne).toHaveBeenCalled();
        expect(res.empty).toBe(true);
    });

    test('a header-only report is reported as empty but is likewise processed', async () => {
        mockDownloadReportContent.mockResolvedValue({
            text: 'order-id\tsku\n', decompressedBytes: 14, compressedBytes: 10, durationMs: 1,
        });
        const res = await buildSpec().finalize({ reportDocumentId: 'doc-1' }, { _id: 'run-1' });

        expect(res.empty).toBe(true);
        expect(mockSyncLogUpdateOne).toHaveBeenCalled();
    });

    test('the sync-log rows are stamped with the syncRunId that wrote them', async () => {
        await buildSpec().finalize({ reportDocumentId: null }, { _id: 'run-xyz' });
        const update = mockSyncLogUpdateOne.mock.calls[0][1];
        expect(update.$setOnInsert.syncRunId).toBe('run-xyz');
    });
});

describe('finalize — the persisted result never leaks credentials', () => {
    test('result carries counts only, not the token or the live tokenManager', async () => {
        const res = await buildSpec().finalize({ reportDocumentId: null }, { _id: 'run-1' });

        // processSalesReportRows returns `token` and `tokenManager`; this object is written to
        // Mongo, so copying it wholesale would persist a live SP-API access token.
        expect(res.result).not.toHaveProperty('token');
        expect(res.result).not.toHaveProperty('tokenManager');
        expect(Object.keys(res.result).sort())
            .toEqual(['overheadDocs', 'pendingOrders', 'reportRows', 'salesOrders', 'skuDocs']);
    });
});

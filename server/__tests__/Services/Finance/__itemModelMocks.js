/**
 * Shared item-model mocks for ledgerAndReimbursementItems.test.js.
 *
 * In its own module because `jest.mock` factories are hoisted above the test file's own
 * declarations, so they cannot close over anything defined there. Each mock exposes `__store` so
 * the test can inspect what was inserted and stage what a read should return.
 */

function makeItemModelMock() {
    const store = { docs: [], inserted: [], deletedOld: null };

    const model = {
        __store: store,
        findLatestByUserCountryRegion: jest.fn(),
        deleteOldBatches: jest.fn(),
        deleteMany: jest.fn(),
        insertMany: jest.fn(),
        findByBatchId: jest.fn(),
        deleteByBatchId: jest.fn(),
    };

    /**
     * (Re)install the behaviours and clear the store.
     *
     * Must be called from the suite's `beforeEach`: the shared jest config sets `resetMocks: true`,
     * which strips every implementation before each test, so behaviour declared once at module load
     * would silently become `undefined` and every assertion would fail on a destructure rather than
     * on the thing under test.
     */
    model.__reset = () => {
        store.docs = [];
        store.inserted = [];
        store.deletedOld = null;

        model.findLatestByUserCountryRegion.mockImplementation(async () => {
            if (!store.docs.length) return { items: [], createdAt: null, batchId: null };
            return { items: store.docs, createdAt: new Date('2026-08-15T00:00:00Z'), batchId: 'batch-1' };
        });
        model.deleteOldBatches.mockImplementation(async (...args) => {
            store.deletedOld = args;
            return { deletedCount: 0 };
        });
        model.deleteMany.mockResolvedValue({ deletedCount: 0 });
        // insertManyChunked calls insertMany once per chunk and sums the returned lengths.
        model.insertMany.mockImplementation(async (rows) => { store.inserted.push(...rows); return rows; });
        model.findByBatchId.mockImplementation(async () => store.docs);
        model.deleteByBatchId.mockResolvedValue({ deletedCount: 0 });
    };

    model.__reset();
    return model;
}

module.exports = {
    ledger: makeItemModelMock(),
    reimb: makeItemModelMock(),
};

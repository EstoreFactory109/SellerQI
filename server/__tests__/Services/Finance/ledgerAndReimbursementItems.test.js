/**
 * Tests for the ledger-detail and FBA-reimbursement item-collection migrations.
 *
 * WHY THIS EXISTS
 * Both reports used to be written as one document with the whole report in an embedded `data[]`
 * array. Measured 2026-08-21, `ledgerdetailviews` was 2,975MB with a largest document of 14.91MB /
 * 32,175 rows and 3 of 157 accounts within ~1MB of MongoDB's hard 16MB ceiling; past it the write
 * dies with a driver-level ERR_OUT_OF_RANGE. Two accounts were already failing, and FBA
 * reimbursements failed for the largest account on 2026-08-15.
 *
 * It mattered more than a failed write usually does: both feed the reimbursement calculators, and
 * `calculateDamagedInventoryReimbursement` / `calculateDisposedInventoryReimbursement` treat an
 * EMPTY read as "fall back to the summary report" rather than an error. So a broken save quietly
 * downgraded the seller's recoverable-money figures instead of surfacing.
 *
 * That is why the round-trip tests below matter more than the write tests: the whole promise of
 * this migration is that `save` then `get` reproduces the legacy document shape exactly, so none of
 * the seven read sites had to change.
 */

const mongoose = require('mongoose');

// The mocks live in their own module because jest.mock factories are hoisted above this file's
// declarations and so cannot close over anything defined here.
jest.mock('../../../models/finance/LedgerDetailViewItemModel.js', () => require('./__itemModelMocks.js').ledger);
jest.mock('../../../models/finance/FBAReimbursementsItemModel.js', () => require('./__itemModelMocks.js').reimb);
// The legacy parents are read only as a fallback, for accounts whose last successful write predates
// the migration. Behaviour is installed in beforeEach for the same resetMocks reason as above.
jest.mock('../../../models/finance/LedgerDetailViewModel.js', () => ({ findOne: jest.fn(), deleteMany: jest.fn() }));
jest.mock('../../../models/finance/FBAReimbursementsModel.js', () => ({ findOne: jest.fn(), deleteMany: jest.fn() }));

const { saveLedgerDetailViewData, getLedgerDetailViewData } =
    require('../../../Services/Finance/LedgerDetailViewService.js');
const { saveFBAReimbursementsData, getFBAReimbursementsData } =
    require('../../../Services/Finance/FBAReimbursementsService.js');
const LedgerItem = require('../../../models/finance/LedgerDetailViewItemModel.js');
const ReimbItem = require('../../../models/finance/FBAReimbursementsItemModel.js');
const LedgerParent = require('../../../models/finance/LedgerDetailViewModel.js');
const ReimbParent = require('../../../models/finance/FBAReimbursementsModel.js');

const USER = '507f1f77bcf86cd799439011';

/** What the legacy-document fallback should return for this test. */
let legacyLedgerDoc = null;
let legacyReimbDoc = null;

beforeEach(() => {
    legacyLedgerDoc = null;
    legacyReimbDoc = null;
    // Re-installs the mock behaviours as well as clearing the stores — the shared jest config uses
    // `resetMocks: true`, which strips every implementation before each test.
    LedgerItem.__reset();
    ReimbItem.__reset();
    LedgerParent.findOne.mockImplementation(() => ({ sort: () => ({ lean: async () => legacyLedgerDoc }) }));
    ReimbParent.findOne.mockImplementation(() => ({ sort: () => ({ lean: async () => legacyReimbDoc }) }));
    LedgerParent.deleteMany.mockResolvedValue({ deletedCount: 0 });
    ReimbParent.deleteMany.mockResolvedValue({ deletedCount: 0 });
});

/** A ledger-detail row as the writer's blind TSV header normalization produces it. */
const ledgerRow = (over = {}) => ({
    date_and_time: '2026-08-01T00:00:00Z',
    reference_id: 'r1',
    fnsku: 'X001',
    asin: 'B001',
    msku: 's1',
    title: 'A widget',
    event_type: 'Adjustments',
    fulfillment_center: 'ABC1',
    quantity: '-3',
    unreconciled_quantity: '2',
    reason: 'E',
    disposition: 'SELLABLE',
    country: 'DE',          // the TRANSACTION's marketplace — collides with the account scope
    reconciled: 'no',
    store: 'MyStore',
    ...over,
});

const reimbRow = (over = {}) => ({
    approval_date: '2026-08-01',
    reimbursement_id: 'rb1',
    case_id: 'c1',
    amazon_order_id: 'o1',
    reason: 'Lost_Warehouse',
    sku: 's1',
    fnsku: 'X001',
    asin: 'B001',
    product_name: 'A widget',
    condition: 'Sellable',
    currency_unit: 'USD',
    amount_per_unit: '5.50',
    amount_total: '11.00',
    quantity_reimbursed_cash: '2',
    quantity_reimbursed_inventory: '0',
    quantity_reimbursed_total: '2',
    original_reimbursement_id: '',
    original_reimbursement_type: '',
    store: 'MyStore',
    ...over,
});

describe('ledger detail — save', () => {
    test('every row of a fetch shares one batchId and carries the account scope', async () => {
        const res = await saveLedgerDetailViewData(USER, 'US', 'NA', [ledgerRow(), ledgerRow({ asin: 'B002' })]);
        const rows = LedgerItem.__store.inserted;
        expect(rows).toHaveLength(2);
        const batchIds = new Set(rows.map((r) => String(r.batchId)));
        expect(batchIds.size).toBe(1);
        expect(String(res.batchId)).toBe([...batchIds][0]);
        rows.forEach((r) => {
            expect(r.country).toBe('US');
            expect(r.region).toBe('NA');
            expect(String(r.User)).toBe(USER);
        });
    });

    // THE TRAP. The report has its own `country` column — the transaction's marketplace — and the
    // account scope also needs `country`. A blind flatten silently overwrites one with the other.
    test('the row country is stored separately from the account country', async () => {
        await saveLedgerDetailViewData(USER, 'US', 'NA', [ledgerRow({ country: 'DE' })]);
        const row = LedgerItem.__store.inserted[0];
        expect(row.country).toBe('US');      // account scope
        expect(row.rowCountry).toBe('DE');   // the report's own column, intact
    });

    // THE REGRESSION A PARITY CHECK CAUGHT, and the reason to prefer `??` over `||`.
    //
    // The legacy schema applied `default: "0"` only when a column was ABSENT. A first draft of the
    // mapper used `item[f] || '0'`, which also rewrote a stored EMPTY STRING to '0' — measured
    // against production, that changed 111,982 of 115,576 real ledger rows. Numerically harmless
    // downstream (both '' and '0' compare as 0), but a silent rewrite of stored data, and enough to
    // make any later parity check untrustworthy.
    test('an empty-string column stays empty, and only an absent one gets the default', async () => {
        await saveLedgerDetailViewData(USER, 'US', 'NA', [
            ledgerRow({ unreconciled_quantity: '', quantity: undefined }),
        ]);
        const row = LedgerItem.__store.inserted[0];
        expect(row.unreconciled_quantity).toBe('');   // stored empty => stays empty
        expect(row.quantity).toBe('0');               // absent => schema default
    });

    test('an absent string column is not invented as an empty string', async () => {
        await saveLedgerDetailViewData(USER, 'US', 'NA', [ledgerRow({ title: undefined })]);
        expect(LedgerItem.__store.inserted[0].title).toBeUndefined();
    });

    test('recordId is the batchId, so callers keep a stable identifier', async () => {
        const res = await saveLedgerDetailViewData(USER, 'US', 'NA', [ledgerRow()]);
        expect(res.recordId).toBe(res.batchId);
        expect(mongoose.Types.ObjectId.isValid(res.recordId)).toBe(true);
    });

    test('retention keeps the newest 3 batches', async () => {
        await saveLedgerDetailViewData(USER, 'US', 'NA', [ledgerRow()]);
        expect(LedgerItem.__store.deletedOld).toEqual([expect.anything(), 'US', 'NA', 3]);
    });

    // A zero-row fetch must NOT delete anything: blanking the report would make the reimbursement
    // calculators silently fall back to the summary source.
    test('an empty fetch writes nothing and deletes nothing', async () => {
        const res = await saveLedgerDetailViewData(USER, 'US', 'NA', []);
        expect(res.itemCount).toBe(0);
        expect(LedgerItem.insertMany).not.toHaveBeenCalled();
        expect(LedgerItem.deleteMany).not.toHaveBeenCalled();
    });

    // A silently-empty save does not surface downstream — the readers just fall back — so it has to
    // be loud here.
    test('inserting nothing when there were rows throws', async () => {
        LedgerItem.insertMany.mockImplementationOnce(async () => []);
        await expect(saveLedgerDetailViewData(USER, 'US', 'NA', [ledgerRow()]))
            .rejects.toThrow(/returned 0 documents/);
    });

    test('a bad user id is rejected before any write', async () => {
        await expect(saveLedgerDetailViewData('not-an-id', 'US', 'NA', [ledgerRow()]))
            .rejects.toThrow(/Invalid User ID/);
        expect(LedgerItem.insertMany).not.toHaveBeenCalled();
    });

    test('country and region are required', async () => {
        await expect(saveLedgerDetailViewData(USER, '', 'NA', [ledgerRow()])).rejects.toThrow(/Country and region/);
    });
});

describe('ledger detail — read', () => {
    // THE POINT OF THE MIGRATION: none of the seven read sites changed, so `get` must reproduce the
    // legacy document shape exactly.
    test('round-trips a row back to its original shape, including country', async () => {
        const original = ledgerRow();
        await saveLedgerDetailViewData(USER, 'US', 'NA', [original]);
        LedgerItem.__store.docs = LedgerItem.__store.inserted;

        const doc = await getLedgerDetailViewData(USER, 'US', 'NA');
        expect(doc.data).toHaveLength(1);
        expect(doc.data[0]).toEqual(original);
        // And it is not exposing the internal column name.
        expect(doc.data[0].rowCountry).toBeUndefined();
    });

    test('returns the legacy document envelope callers expect', async () => {
        await saveLedgerDetailViewData(USER, 'US', 'NA', [ledgerRow()]);
        LedgerItem.__store.docs = LedgerItem.__store.inserted;

        const doc = await getLedgerDetailViewData(USER, 'US', 'NA');
        expect(doc).toEqual(expect.objectContaining({
            _id: 'batch-1', country: 'US', region: 'NA', data: expect.any(Array),
            createdAt: expect.any(Date), updatedAt: expect.any(Date),
        }));
    });

    // Accounts whose last successful write predates the migration must keep working.
    test('falls back to the legacy embedded document when there are no items', async () => {
        legacyLedgerDoc = { _id: 'old', data: [ledgerRow({ asin: 'LEGACY' })] };
        const doc = await getLedgerDetailViewData(USER, 'US', 'NA');
        expect(doc._id).toBe('old');
        expect(doc.data[0].asin).toBe('LEGACY');
    });

    test('returns null when neither format has rows', async () => {
        expect(await getLedgerDetailViewData(USER, 'US', 'NA')).toBeNull();
    });

    test('an empty legacy document is not mistaken for data', async () => {
        legacyLedgerDoc = { _id: 'old', data: [] };
        expect(await getLedgerDetailViewData(USER, 'US', 'NA')).toBeNull();
    });
});

describe('FBA reimbursements — save and read', () => {
    test('every row shares one batchId and carries the account scope', async () => {
        await saveFBAReimbursementsData(USER, 'US', 'NA', [reimbRow(), reimbRow({ asin: 'B002' })]);
        const rows = ReimbItem.__store.inserted;
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map((r) => String(r.batchId))).size).toBe(1);
        rows.forEach((r) => expect(r.country).toBe('US'));
    });

    test('round-trips a row back to its original shape', async () => {
        const original = reimbRow();
        await saveFBAReimbursementsData(USER, 'US', 'NA', [original]);
        ReimbItem.__store.docs = ReimbItem.__store.inserted;

        const doc = await getFBAReimbursementsData(USER, 'US', 'NA');
        expect(doc.data[0]).toEqual(original);
    });

    // One QMate reader does `reimbursementData.data[0]?.currency_unit`, so the first element has to
    // be a real row, not just the right array length.
    test('the first element is usable, because a reader indexes positionally', async () => {
        await saveFBAReimbursementsData(USER, 'US', 'NA', [reimbRow({ currency_unit: 'GBP' })]);
        ReimbItem.__store.docs = ReimbItem.__store.inserted;

        const doc = await getFBAReimbursementsData(USER, 'US', 'NA');
        expect(doc.data[0].currency_unit).toBe('GBP');
    });

    test('numeric-ish columns keep their "0" default rather than becoming empty strings', async () => {
        await saveFBAReimbursementsData(USER, 'US', 'NA', [reimbRow({ amount_total: undefined })]);
        expect(ReimbItem.__store.inserted[0].amount_total).toBe('0');
    });

    test('inserting nothing when there were rows throws', async () => {
        ReimbItem.insertMany.mockImplementationOnce(async () => []);
        await expect(saveFBAReimbursementsData(USER, 'US', 'NA', [reimbRow()]))
            .rejects.toThrow(/returned 0 documents/);
    });

    test('falls back to the legacy embedded document', async () => {
        legacyReimbDoc = { _id: 'old', data: [reimbRow({ asin: 'LEGACY' })] };
        const doc = await getFBAReimbursementsData(USER, 'US', 'NA');
        expect(doc.data[0].asin).toBe('LEGACY');
    });

    test('retention keeps the newest 3 batches', async () => {
        await saveFBAReimbursementsData(USER, 'US', 'NA', [reimbRow()]);
        expect(ReimbItem.__store.deletedOld).toEqual([expect.anything(), 'US', 'NA', 3]);
    });
});

describe('batchedItemModel factory', () => {
    const { buildBatchedItemSchema } = require('../../../models/finance/batchedItemModel.js');

    test('declares the scope keys, the batch key, and the three indexes', () => {
        const schema = buildBatchedItemSchema({ foo: { type: String } });
        expect(schema.path('User')).toBeTruthy();
        expect(schema.path('country')).toBeTruthy();
        expect(schema.path('region')).toBeTruthy();
        expect(schema.path('batchId')).toBeTruthy();
        expect(schema.path('foo')).toBeTruthy();

        const indexKeys = schema.indexes().map(([fields]) => Object.keys(fields).join(','));
        expect(indexKeys).toContain('User,country,region,createdAt');
        expect(indexKeys).toContain('User,country,region,batchId');
        expect(indexKeys).toContain('batchId,createdAt');
    });

    // batchId must NOT be required: the service generates it, and requiring it would turn a
    // programming slip into a validation error mid-insert.
    test('batchId is not required', () => {
        const schema = buildBatchedItemSchema({ foo: { type: String } });
        expect(schema.path('batchId').isRequired).toBeFalsy();
    });

    test('all four statics are attached', () => {
        const schema = buildBatchedItemSchema({ foo: { type: String } });
        for (const name of ['findLatestByUserCountryRegion', 'findByBatchId', 'deleteByBatchId', 'deleteOldBatches']) {
            expect(typeof schema.statics[name]).toBe('function');
        }
    });
});

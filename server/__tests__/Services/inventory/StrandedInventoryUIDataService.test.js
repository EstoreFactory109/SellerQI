/**
 * A clean stranded-inventory report is saved as a one-row empty-snapshot
 * marker batch, and the reader must treat that batch as "nothing stranded" —
 * never as "no data", which used to fall through to the legacy collection or
 * leave the last problem-filled batch standing as current.
 */

jest.mock('../../../models/inventory/StrandedInventoryUIDataItemModel', () => ({
    insertMany: jest.fn(),
    deleteOldBatches: jest.fn(),
    findLatestByUserCountryRegion: jest.fn(),
}));
jest.mock('../../../models/inventory/GET_STRANDED_INVENTORY_UI_DATA_MODEL', () => ({ findOne: jest.fn() }));

const ItemModel = require('../../../models/inventory/StrandedInventoryUIDataItemModel');
const LegacyModel = require('../../../models/inventory/GET_STRANDED_INVENTORY_UI_DATA_MODEL');
const { saveStrandedInventoryUIData, getStrandedInventoryUIData } = require('../../../Services/inventory/StrandedInventoryUIDataService');

const USER = '64b000000000000000000001';

beforeEach(() => {
    ItemModel.insertMany.mockResolvedValue([]);
    ItemModel.deleteOldBatches.mockResolvedValue({ deletedCount: 0 });
    LegacyModel.findOne.mockReturnValue({
        sort: () => ({ lean: async () => ({ strandedUIData: [[{ asin: 'OLD', status_primary: 'x', stranded_reason: 'y' }]] }) }),
    });
});

describe('saveStrandedInventoryUIData', () => {
    it('writes one empty-snapshot marker row when there are no items', async () => {
        const result = await saveStrandedInventoryUIData(USER, 'US', 'NA', []);

        expect(ItemModel.insertMany).toHaveBeenCalledTimes(1);
        const [rows] = ItemModel.insertMany.mock.calls[0];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ country: 'US', region: 'NA', isEmptyMarker: true });
        expect(rows[0].User.toString()).toBe(USER);
        expect(rows[0].batchId).toBeDefined();
        expect(rows[0].asin).toBeUndefined();
        expect(result).toMatchObject({ success: true, itemCount: 0 });
    });

    it('still prunes old batches after an empty snapshot', async () => {
        await saveStrandedInventoryUIData(USER, 'US', 'NA', []);
        expect(ItemModel.deleteOldBatches).toHaveBeenCalledWith(expect.anything(), 'US', 'NA', 3);
    });

    it('writes item rows (no marker) when there are items', async () => {
        await saveStrandedInventoryUIData(USER, 'US', 'NA', [{ asin: 'B1', status_primary: 's', stranded_reason: 'r' }]);

        const [rows] = ItemModel.insertMany.mock.calls[0];
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ asin: 'B1', status_primary: 's', stranded_reason: 'r' });
        expect(rows[0].isEmptyMarker).toBeUndefined();
    });
});

describe('getStrandedInventoryUIData', () => {
    it('returns an empty result for a marker batch and does not fall back to the legacy collection', async () => {
        const createdAt = new Date('2026-10-14T00:00:00Z');
        ItemModel.findLatestByUserCountryRegion.mockResolvedValue({ items: [], createdAt, batchId: 'b1', isEmpty: true });

        const doc = await getStrandedInventoryUIData(USER, 'US', 'NA');

        expect(doc).toMatchObject({ _id: 'b1', country: 'US', region: 'NA', strandedUIData: [[]], createdAt });
        expect(LegacyModel.findOne).not.toHaveBeenCalled();
    });

    it('returns items of a populated batch in the nested legacy shape', async () => {
        ItemModel.findLatestByUserCountryRegion.mockResolvedValue({
            items: [{ asin: 'B1', status_primary: 's', stranded_reason: 'r', _id: 'x' }],
            createdAt: new Date(), batchId: 'b2', isEmpty: false,
        });

        const doc = await getStrandedInventoryUIData(USER, 'US', 'NA');

        expect(doc.strandedUIData).toEqual([[{ asin: 'B1', status_primary: 's', stranded_reason: 'r' }]]);
        expect(LegacyModel.findOne).not.toHaveBeenCalled();
    });

    it('falls back to the legacy collection only when no new-format batch exists', async () => {
        ItemModel.findLatestByUserCountryRegion.mockResolvedValue({ items: [], createdAt: null, batchId: null, isEmpty: false });

        const doc = await getStrandedInventoryUIData(USER, 'US', 'NA');

        expect(LegacyModel.findOne).toHaveBeenCalled();
        expect(doc.strandedUIData[0][0].asin).toBe('OLD');
    });
});

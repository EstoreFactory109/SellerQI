/**
 * Schema + statics of the stranded item collection, exercised without a
 * database: validation runs in-process, and the statics are called against a
 * stub `this` so the exact queries they issue can be asserted.
 */

const mongoose = require('mongoose');
const Item = require('../../../models/inventory/StrandedInventoryUIDataItemModel');

const base = () => ({
    User: new mongoose.Types.ObjectId(),
    country: 'US',
    region: 'NA',
    batchId: new mongoose.Types.ObjectId(),
});

describe('validation', () => {
    it('accepts an empty-snapshot marker with no item fields', () => {
        expect(new Item({ ...base(), isEmptyMarker: true }).validateSync()).toBeUndefined();
    });

    it('still requires asin / status_primary / stranded_reason on a real item', () => {
        const err = new Item(base()).validateSync();
        expect(Object.keys(err.errors).sort()).toEqual(['asin', 'status_primary', 'stranded_reason']);
    });
});

describe('findLatestByUserCountryRegion', () => {
    const stub = (latest, items) => {
        const find = jest.fn(() => ({ lean: async () => items }));
        const findOne = jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => latest }) }) }));
        return { find, findOne };
    };

    it('reports a marker batch as empty and never returns the marker as an item', async () => {
        const createdAt = new Date();
        const self = stub({ batchId: 'b1', createdAt }, []);

        const out = await Item.findLatestByUserCountryRegion.call(self, 'u', 'US', 'NA');

        expect(self.find).toHaveBeenCalledWith({ batchId: 'b1', isEmptyMarker: { $ne: true } });
        expect(out).toEqual({ items: [], createdAt, batchId: 'b1', isEmpty: true });
    });

    it('returns no batch when nothing has been saved', async () => {
        const out = await Item.findLatestByUserCountryRegion.call(stub(null, []), 'u', 'US', 'NA');
        expect(out).toEqual({ items: [], createdAt: null, batchId: null, isEmpty: false });
    });
});

describe('deleteOldBatches', () => {
    it('groups every row by batch, so marker batches are pruned like any other', async () => {
        const self = {
            aggregate: jest.fn().mockResolvedValue([{ _id: 'old-marker-batch' }]),
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
        };

        await Item.deleteOldBatches.call(self, new mongoose.Types.ObjectId().toString(), 'US', 'NA', 3);

        const match = self.aggregate.mock.calls[0][0][0].$match;
        expect(match).not.toHaveProperty('isEmptyMarker');
        expect(self.deleteMany).toHaveBeenCalledWith({ batchId: { $in: ['old-marker-batch'] } });
    });
});

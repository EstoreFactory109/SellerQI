/**
 * The seller's "what arrived from this removal order" answers: what the form
 * lists, and what is accepted when it is submitted.
 */
jest.mock('../../../models/inventory/RemovalOrdersModel.js', () => ({ findOne: jest.fn() }));
jest.mock('../../../models/inventory/RemovalReceiptModel.js', () => ({ find: jest.fn(), bulkWrite: jest.fn() }));
jest.mock('../../../models/user-auth/sellerCentralModel.js', () => ({ findOne: jest.fn() }));

const RemovalOrders = require('../../../models/inventory/RemovalOrdersModel.js');
const RemovalReceipt = require('../../../models/inventory/RemovalReceiptModel.js');
const Seller = require('../../../models/user-auth/sellerCentralModel.js');
const { getPendingReceipts, saveReceipts } = require('../../../Services/inventory/RemovalReceiptService.js');

const USER = '6a57b823571ceb9266953c30';
const NOW = new Date('2026-10-24T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 864e5).toISOString();

const line = (over) => ({
    orderId: 'R1', orderType: 'Return', orderStatus: 'Completed', lastUpdatedDate: daysAgo(10), requestDate: daysAgo(20),
    sku: 'S1', requestedQuantity: 10, shippedQuantity: 10, disposedQuantity: 0, cancelledQuantity: 0, ...over
});
const chain = (value) => ({ sort: () => ({ lean: () => Promise.resolve(value) }) });
const lean = (value) => ({ lean: () => Promise.resolve(value) });

beforeEach(() => {
    RemovalOrders.findOne.mockReturnValue(chain({
        createdAt: new Date(daysAgo(2)),
        lines: [line(), line({ orderId: 'R2', sku: 'S2', shippedQuantity: 4 }), line({ orderId: 'R3', orderType: 'Disposal' })]
    }));
    RemovalReceipt.find.mockReturnValue(lean([{ orderId: 'R2', sku: 'S2', receivedQuantity: 4, shippedQuantity: 4 }]));
    RemovalReceipt.bulkWrite.mockResolvedValue({});
    Seller.findOne.mockReturnValue({ select: () => lean({
        sellerAccount: [{ country: 'US', region: 'NA', products: [{ sku: 'S1', asin: 'A1', itemName: 'Garlic Press' }] }]
    }) });
});

describe('getPendingReceipts', () => {
    it('lists returned lines not yet answered, with the product they belong to', async () => {
        const pending = await getPendingReceipts(USER, 'US', 'NA', NOW);
        expect(pending).toEqual([{
            orderId: 'R1', sku: 'S1', asin: 'A1', productName: 'Garlic Press',
            requestDate: daysAgo(20), lastUpdatedDate: daysAgo(10), shippedQuantity: 10
        }]);
    });

    it('is empty when there is no removal report', async () => {
        RemovalOrders.findOne.mockReturnValue(chain(null));
        expect(await getPendingReceipts(USER, 'US', 'NA', NOW)).toEqual([]);
    });
});

describe('saveReceipts', () => {
    it('saves a valid answer with the shipped count it was given against', async () => {
        const r = await saveReceipts(USER, 'US', 'NA', [{ orderId: 'R1', sku: 'S1', receivedQuantity: 7 }], NOW);
        expect(r).toEqual({ saved: 1, rejected: [] });
        const [op] = RemovalReceipt.bulkWrite.mock.calls[0][0];
        expect(op.updateOne.filter).toMatchObject({ country: 'US', region: 'NA', orderId: 'R1', sku: 'S1' });
        expect(op.updateOne.update.$set).toMatchObject({ shippedQuantity: 10, receivedQuantity: 7 });
        expect(op.updateOne.upsert).toBe(true);
    });

    it('lets a seller correct an earlier answer (the line stays eligible)', async () => {
        const r = await saveReceipts(USER, 'US', 'NA', [{ orderId: 'R2', sku: 'S2', receivedQuantity: 3 }], NOW);
        expect(r.saved).toBe(1);
    });

    it('rejects, with a reason, lines that are not returned stock and counts out of range', async () => {
        const r = await saveReceipts(USER, 'US', 'NA', [
            { orderId: 'R3', sku: 'S1', receivedQuantity: 1 },     // disposal: never comes back
            { orderId: 'NOPE', sku: 'S1', receivedQuantity: 1 },
            { orderId: 'R1', sku: 'S1', receivedQuantity: 11 },
            { orderId: 'R1', sku: 'S1', receivedQuantity: 2.5 },
            { orderId: 'R1', sku: 'S1', receivedQuantity: -1 }
        ], NOW);
        expect(r.saved).toBe(0);
        expect(r.rejected.map(x => x.reason)).toEqual([
            'Not a returned removal order line from the last 60 days',
            'Not a returned removal order line from the last 60 days',
            'Received must be a whole number from 0 to 10',
            'Received must be a whole number from 0 to 10',
            'Received must be a whole number from 0 to 10'
        ]);
        expect(RemovalReceipt.bulkWrite).not.toHaveBeenCalled();
    });
});

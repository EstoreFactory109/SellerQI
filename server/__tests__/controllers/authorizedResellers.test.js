/**
 * Authorised resellers: what a seller may add to their whitelist.
 */
jest.mock('../../models/products/AuthorizedResellerModel.js', () => ({ bulkWrite: jest.fn(), find: jest.fn(), deleteOne: jest.fn() }));
const AuthorizedReseller = require('../../models/products/AuthorizedResellerModel.js');
const { add } = require('../../controllers/inventory/AuthorizedResellerController.js');

const res = () => {
    const r = {};
    r.status = jest.fn(() => r);
    r.json = jest.fn(() => r);
    return r;
};
const req = (sellerIds) => ({ userId: '6a57b823571ceb9266953c30', country: 'US', region: 'NA', body: { sellerIds } });

describe('POST /api/authorized-resellers', () => {
    beforeEach(() => AuthorizedReseller.bulkWrite.mockResolvedValue({}));

    it('saves valid Amazon seller IDs, upper-cased and de-duplicated', async () => {
        const r = res();
        await add(req(['a2euq1wtgctbg2', 'A2EUQ1WTGCTBG2']), r);
        expect(r.status).toHaveBeenCalledWith(200);
        expect(r.json.mock.calls[0][0].data.added).toEqual(['A2EUQ1WTGCTBG2']);
        const [op] = AuthorizedReseller.bulkWrite.mock.calls[0][0];
        expect(op.updateOne.filter).toMatchObject({ country: 'US', region: 'NA', sellerId: 'A2EUQ1WTGCTBG2' });
        expect(op.updateOne.upsert).toBe(true);
    });

    it('rejects an empty list or anything that is not a seller ID', async () => {
        for (const ids of [[], ['not a seller'], ['A1'], undefined]) {
            const r = res();
            await add(req(ids), r);
            expect(r.status).toHaveBeenCalledWith(400);
        }
        expect(AuthorizedReseller.bulkWrite).not.toHaveBeenCalled();
    });
});

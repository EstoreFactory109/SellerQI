/**
 * Tests for the COGS marketplace-key lookup.
 *
 * The write path (CogsController) keys on `sellerAccount.countryCode`, which
 * holds a CURRENCY code ('AUD'), while the calculation read paths (Analyse.js,
 * QMateService) use the marketplace COUNTRY code ('AU'). Matching only one of
 * them made getCogs return {} for every calculation caller, zeroing out all
 * COGS-derived recoverable amounts.
 */

jest.mock('../../../models/finance/CogsModel', () => ({
    findOne: jest.fn()
}));

const Cogs = require('../../../models/finance/CogsModel');
const CogsService = require('../../../Services/Finance/CogsService.js');

const DOC = {
    country: 'AU',
    countryCode: 'AUD',
    region: 'FE',
    cogsEntries: [
        { asin: 'B001', cogs: 4.5 },
        { asin: 'B002', cogs: 12 }
    ]
};

describe('CogsService.getCogs marketplace key', () => {
    it('queries on either the country or the currency-style key', async () => {
        Cogs.findOne.mockResolvedValue(DOC);
        await CogsService.getCogs('u1', 'AU');

        expect(Cogs.findOne).toHaveBeenCalledWith({
            userId: 'u1',
            $or: [{ country: 'AU' }, { countryCode: 'AU' }]
        });
    });

    it('resolves costs when called with the marketplace country (Analyse.js path)', async () => {
        Cogs.findOne.mockResolvedValue(DOC);
        const res = await CogsService.getCogs('u1', 'AU');
        expect(res.data.cogsValues).toEqual({ B001: 4.5, B002: 12 });
    });

    it('resolves costs when called with the stored currency-style code (settings UI path)', async () => {
        Cogs.findOne.mockResolvedValue(DOC);
        const res = await CogsService.getCogs('u1', 'AUD');
        expect(res.data.cogsValues).toEqual({ B001: 4.5, B002: 12 });
    });

    it('returns an empty map without querying when no key is supplied', async () => {
        const res = await CogsService.getCogs('u1', undefined);
        expect(Cogs.findOne).not.toHaveBeenCalled();
        expect(res.success).toBe(true);
        expect(res.data.cogsValues).toEqual({});
    });

    it('returns an empty map when the account has no COGS document', async () => {
        Cogs.findOne.mockResolvedValue(null);
        const res = await CogsService.getCogs('u1', 'US');
        expect(res.data.cogsValues).toEqual({});
    });

    it('skips entries with no asin', async () => {
        Cogs.findOne.mockResolvedValue({ ...DOC, cogsEntries: [{ cogs: 9 }, { asin: 'B003', cogs: 3 }] });
        const res = await CogsService.getCogs('u1', 'AU');
        expect(res.data.cogsValues).toEqual({ B003: 3 });
    });
});

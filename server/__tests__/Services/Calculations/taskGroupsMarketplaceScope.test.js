/**
 * The AI views must read ONE marketplace's tasks.
 *
 * "Top things to fix" and "Top products to fix" are stored per marketplace, but
 * both were built from `TaskItem.find({ userId })` — every marketplace of a
 * multi-marketplace seller was ranked from the same combined pool. On live data
 * one account's 10,091 task ASINs were 10,090 UK-EU while its US-NA view was
 * generated from them, and another account's tasks spanned all four of its
 * marketplaces. These tests pin the query down.
 */

let capturedFilter = null;
jest.mock('../../../models/MCP/TaskItemModel.js', () => {
    const scopeFilter = (userId, country = null, region = null) => {
        const f = { userId };
        if (country) f.country = country;
        if (region) f.region = region;
        return f;
    };
    return {
        scopeFilter,
        find: (filter) => {
            capturedFilter = filter;
            return { select: () => ({ lean: async () => [] }) };
        }
    };
});

jest.mock('../../../Services/Calculations/AdsProductAttributionService.js', () => ({
    loadCampaignAsinIndex: jest.fn().mockResolvedValue(new Map()),
    attributeAdsTasksToAsins: jest.fn().mockReturnValue({ attributed: [], unattributableAmount: 0 }),
}));

const {
    getTaskOpportunityGroups,
    getTopProductsToFix,
} = require('../../../Services/Calculations/TaskOpportunityGroupsService.js');

describe('AI views read one marketplace', () => {
    beforeEach(() => { capturedFilter = null; });

    it('getTaskOpportunityGroups filters by the marketplace it was asked about', async () => {
        await getTaskOpportunityGroups('u1', 'US', 'NA');

        expect(capturedFilter).toEqual({ userId: 'u1', country: 'US', region: 'NA' });
    });

    it('getTopProductsToFix filters by the marketplace it was asked about', async () => {
        await getTopProductsToFix('u1', 'UK', 'EU');

        expect(capturedFilter).toEqual({ userId: 'u1', country: 'UK', region: 'EU' });
    });

    it('two marketplaces of the same seller issue different queries', async () => {
        await getTaskOpportunityGroups('u1', 'US', 'NA');
        const first = capturedFilter;
        await getTaskOpportunityGroups('u1', 'UK', 'EU');

        // The whole bug in one assertion: these used to be the identical query.
        expect(first).not.toEqual(capturedFilter);
    });

    it('stays user-wide when no marketplace is given, rather than matching nothing', async () => {
        await getTaskOpportunityGroups('u1');

        expect(capturedFilter).toEqual({ userId: 'u1' });
    });
});

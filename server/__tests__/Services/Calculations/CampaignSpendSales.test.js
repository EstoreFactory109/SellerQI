/**
 * One definition of a campaign's spend and sales, shared by the PPC page and the
 * high-ACOS tasks. They used to read different collections, attribution windows and
 * dates, and disagreed in 34 of 44 marketplaces that had any high-ACOS campaign.
 */
jest.mock('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel', () => ({
    countDocuments: jest.fn(),
    findOne: jest.fn(),
    aggregate: jest.fn(),
}));

const Item = require('../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel');
const {
    getCampaignSpendSales,
    resolveCampaignWindowMatch,
    getHighAcosCampaigns,
} = require('../../../Services/Calculations/PPCCampaignAnalysisService.js');

const USER = '6a57b823571ceb9266953c30';
const chain = (value) => ({ sort: () => ({ select: () => ({ lean: async () => value }) }) });

describe('resolveCampaignWindowMatch', () => {
    it('uses the default report window when it has data', async () => {
        Item.countDocuments.mockResolvedValue(12);
        const m = await resolveCampaignWindowMatch(USER, 'US', 'NA');
        expect(m.date).toEqual({ $gte: expect.any(String), $lte: expect.any(String) });
        expect(m.batchId).toBeUndefined();
    });

    it('falls back to the latest batch when the window is empty', async () => {
        Item.countDocuments.mockResolvedValue(0);
        Item.findOne.mockReturnValue(chain({ batchId: 'b1' }));
        const m = await resolveCampaignWindowMatch(USER, 'US', 'NA');
        expect(m).toMatchObject({ batchId: 'b1' });
        expect(m.date).toBeUndefined();
    });

    it('is null when the marketplace has no ads data at all', async () => {
        Item.countDocuments.mockResolvedValue(0);
        Item.findOne.mockReturnValue(chain(null));
        expect(await resolveCampaignWindowMatch(USER, 'US', 'NA')).toBeNull();
    });
});

describe('getCampaignSpendSales', () => {
    it('returns per-campaign totals shaped for the high-ACOS task check', async () => {
        Item.countDocuments.mockResolvedValue(5);
        Item.aggregate.mockResolvedValue([
            { _id: 'c1', campaignName: 'Brand', totalSpend: 120.004, totalSales: 200 },
            { _id: 'c2', campaignName: null, totalSpend: 0, totalSales: 0 },
        ]);
        expect(await getCampaignSpendSales(USER, 'US', 'NA')).toEqual([
            { campaignId: 'c1', campaignName: 'Brand', totalSpend: 120, totalSales: 200 },
            { campaignId: 'c2', campaignName: 'Unknown Campaign', totalSpend: 0, totalSales: 0 },
        ]);
    });

    it('groups with the same stage the PPC page uses', async () => {
        Item.countDocuments.mockResolvedValue(5);
        Item.aggregate.mockResolvedValue([]);
        await getCampaignSpendSales(USER, 'US', 'NA');
        const tasksPipeline = Item.aggregate.mock.calls[0][0];

        Item.aggregate.mockReset();
        Item.aggregate.mockResolvedValue([]);
        Item.countDocuments.mockResolvedValue(5);
        await getHighAcosCampaigns(USER, 'US', 'NA', 1, 10).catch(() => {});
        const pagePipeline = Item.aggregate.mock.calls[0][0];

        expect(pagePipeline[0]).toEqual(tasksPipeline[0]); // same $match (window)
        expect(pagePipeline[1]).toEqual(tasksPipeline[1]); // same $group
    });

    it('is null without ads data, so the tasks fall back instead of judging nothing', async () => {
        Item.countDocuments.mockResolvedValue(0);
        Item.findOne.mockReturnValue(chain(null));
        expect(await getCampaignSpendSales(USER, 'US', 'NA')).toBeNull();
        expect(Item.aggregate).not.toHaveBeenCalled();
    });
});

/**
 * QMate campaign overview always returned success:false.
 *
 * Commit e3b0ed5 dropped the Campaign require from QMatePPCService, so
 * getCampaignOverview threw a ReferenceError inside its own try/catch. It also
 * read the newest doc by createdAt (not the newest metricDate snapshot, and not
 * reassembling chunked snapshots) and matched campaign types only in their
 * spaced form, so stored 'sponsoredProducts' campaigns counted as no type.
 */

const path = require('path');

jest.mock('../../../utils/ppcSnapshotLoader.js', () => {
    const actual = jest.requireActual('../../../utils/ppcSnapshotLoader.js');
    return { ...actual, loadLatestSnapshotDoc: jest.fn() };
});

const { loadLatestSnapshotDoc } = require('../../../utils/ppcSnapshotLoader.js');
const Campaign = require('../../../models/amazon-ads/CampaignModel.js');
const CampaignChunk = require('../../../models/amazon-ads/campaignChunkModel.js');
const PPCMetrics = require('../../../models/amazon-ads/PPCMetricsModel.js');
const { getCampaignOverview, normalizeCampaignType } = require('../../../Services/AI/QMatePPCService.js');
const { findUndefinedIdentifiers } = require('../../helpers/findUndefinedIdentifiers.js');

const USER = '6a40e42712ce56d674f734a0';

const campaign = (campaignId, campaignType, state, dailyBudget) => ({
    campaignId, name: `C${campaignId}`, campaignType, targetingType: 'MANUAL', state, dailyBudget, startDate: '2026-01-01',
});

// What the loader hands back for a chunked snapshot: the primary doc flagged
// isChunked with the rows of every chunk merged in chunkIndex order.
const chunkOne = [
    campaign('1', 'sponsoredProducts', 'ENABLED', 50),
    campaign('2', 'SPONSORED_PRODUCTS', 'PAUSED', 10),
    campaign('3', 'Sponsored Products', 'enabled', 20),
];
const chunkTwo = [
    campaign('4', 'sponsoredBrands', 'ENABLED', 30),
    campaign('5', 'SB', 'ARCHIVED', 5),
    campaign('6', 'sponsored-display', 'ENABLED', 15),
    campaign('7', 'sd', 'PAUSED', 0),
    campaign('8', 'somethingElse', 'ENABLED', 1),
];
const chunkedSnapshot = {
    userId: USER, country: 'US', region: 'NA', metricDate: '2026-10-20', isChunked: true,
    campaignData: [...chunkOne, ...chunkTwo],
};

beforeEach(() => {
    jest.spyOn(PPCMetrics, 'rollupLastDays').mockResolvedValue({ found: true, summary: { totalSpend: 123.45 } });
});

describe('getCampaignOverview', () => {
    test('reads the latest snapshot through the shared loader and counts by normalised type', async () => {
        loadLatestSnapshotDoc.mockResolvedValue(chunkedSnapshot);

        const result = await getCampaignOverview(USER, 'US', 'NA');

        expect(loadLatestSnapshotDoc).toHaveBeenCalledWith(Campaign, USER, 'US', 'NA');
        expect(result.success).toBe(true);
        expect(result.data.typeCounts).toEqual({ sponsoredProducts: 3, sponsoredBrands: 2, sponsoredDisplay: 2 });
        expect(result.data.stateCounts).toEqual({ enabled: 5, paused: 2, archived: 1, total: 8 });
        // Enabled campaigns only, by budget, across both chunks.
        expect(result.data.campaigns.map((c) => c.campaignId)).toEqual(['1', '4', '3', '6', '8']);
        expect(result.data.totalDailyBudget).toBe(116);
        expect(result.data.ppcSummary).toEqual({ totalSpend: 123.45 });
    });

    test('reassembles a chunked snapshot end to end (real loader, mocked queries)', async () => {
        const actual = jest.requireActual('../../../utils/ppcSnapshotLoader.js');
        loadLatestSnapshotDoc.mockImplementation(actual.loadLatestSnapshotDoc);
        const chain = (value) => ({ sort: () => ({ lean: async () => value }) });
        jest.spyOn(Campaign, 'findOne').mockReturnValue(chain({ ...chunkedSnapshot, campaignData: [] }));
        jest.spyOn(CampaignChunk, 'find').mockReturnValue(chain([
            { chunkIndex: 0, campaignData: chunkOne },
            { chunkIndex: 1, campaignData: chunkTwo },
        ]));

        const result = await getCampaignOverview(USER, 'US', 'NA');

        expect(result.success).toBe(true);
        expect(result.data.stateCounts.total).toBe(8);
        expect(result.data.typeCounts).toEqual({ sponsoredProducts: 3, sponsoredBrands: 2, sponsoredDisplay: 2 });
    });

    test('no snapshot -> success:false with a "no data" error, not a crash', async () => {
        loadLatestSnapshotDoc.mockResolvedValue(null);
        const result = await getCampaignOverview(USER, 'US', 'NA');
        expect(result).toEqual(expect.objectContaining({ success: false, error: 'No campaign data found', data: null }));
    });
});

describe('normalizeCampaignType', () => {
    test.each([
        ['sponsoredProducts', 'sponsoredProducts'],
        ['SPONSORED_PRODUCTS', 'sponsoredProducts'],
        ['Sponsored Products', 'sponsoredProducts'],
        ['sp', 'sponsoredProducts'],
        ['sponsoredBrands', 'sponsoredBrands'],
        ['SB', 'sponsoredBrands'],
        ['sponsored-display', 'sponsoredDisplay'],
        ['sd', 'sponsoredDisplay'],
        ['video', null],
        [undefined, null],
    ])('%s -> %s', (input, expected) => {
        expect(normalizeCampaignType(input)).toBe(expected);
    });
});

describe('QMatePPCService.js has no undefined identifiers', () => {
    test('every referenced identifier is declared, required or a Node global', () => {
        const file = path.join(__dirname, '../../../Services/AI/QMatePPCService.js');
        expect(findUndefinedIdentifiers(file)).toEqual([]);
    });
});

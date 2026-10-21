/**
 * The PPC page's wasted-spend and zero-sale tabs apply the same rules as the tasks
 * (AdsSignals), so a task never points at a page that does not list it.
 */
jest.mock('../../../models/amazon-ads/adsKeywordsPerformanceModel', () => ({ exists: jest.fn(), findOne: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../../models/amazon-ads/SearchTermsModel', () => ({ exists: jest.fn(), findOne: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../../utils/ppcSnapshotLoader', () => ({ loadLatestSnapshotDoc: jest.fn(), loadKeywordSnapshot: jest.fn() }));

const Keywords = require('../../../models/amazon-ads/adsKeywordsPerformanceModel');
const SearchTerms = require('../../../models/amazon-ads/SearchTermsModel');
const { loadLatestSnapshotDoc } = require('../../../utils/ppcSnapshotLoader');
const { getWastedSpendKeywords, getSearchTermsZeroSales } = require('../../../Services/Calculations/PPCCampaignAnalysisService.js');
const { KEYWORD_MIN_CLICKS, SEARCH_TERM_MIN_CLICKS } = require('../../../Services/Calculations/TaskRules.js');

const USER = '6a57b823571ceb9266953c30';
const findStage = (pipeline, pred) => pipeline.find(pred);

beforeEach(() => {
    for (const M of [Keywords, SearchTerms]) {
        M.exists.mockResolvedValue(true);
        M.aggregate.mockResolvedValue([{ total: [], totalSpend: [], data: [] }]);
    }
});

describe('wasted-spend tab', () => {
    it('filters on the latest status, the click floor, settled spend and no sales — after grouping', async () => {
        await getWastedSpendKeywords(USER, 'US', 'NA');
        const pipeline = Keywords.aggregate.mock.calls[0][0];
        // No per-row status filter before grouping (it summed only pre-pause rows).
        const groupIdx = pipeline.findIndex(s => s.$group);
        expect(pipeline.slice(0, groupIdx).some(s => s.$match && s.$match['keywordsData.adKeywordStatus'])).toBe(false);
        const post = findStage(pipeline.slice(groupIdx), s => s.$match && s.$match.status);
        expect(post.$match).toEqual({
            status: 'ENABLED',
            clicks: { $gte: KEYWORD_MIN_CLICKS },
            settledSpend: { $gt: 0 },
            sales: { $lt: 0.01 },
        });
        expect(pipeline[groupIdx].$group.settledSpend).toBeDefined();
    });
});

describe('zero-sale search-term tab', () => {
    it('uses the shared click floor and excludes terms already negated', async () => {
        loadLatestSnapshotDoc.mockResolvedValue({
            negativeKeywordsData: [
                { campaignId: 'c1', adGroupId: 'ag1', keywordText: 'Cheap Widget', state: 'enabled' },
                { campaignId: 'c2', adGroupId: '', keywordText: 'free widget' },
            ],
        });
        await getSearchTermsZeroSales(USER, 'US', 'NA');
        const pipeline = SearchTerms.aggregate.mock.calls[0][0];
        expect(findStage(pipeline, s => s.$match && s.$match.clicks).$match.clicks).toEqual({ $gte: SEARCH_TERM_MIN_CLICKS });
        const neg = findStage(pipeline, s => s.$match && s.$match._negAdGroupKey);
        expect(neg.$match._negAdGroupKey.$nin.sort()).toEqual(['c1|ag1|cheap widget', 'c2||free widget']);
        expect(neg.$match._negCampaignKey.$nin).toEqual(neg.$match._negAdGroupKey.$nin);
    });
});

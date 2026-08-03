/**
 * Tests for the chunked negative-keywords fetch.
 *
 * Two distinct risks are covered, both introduced by chunking a single request into many:
 *
 * 1. EQUIVALENCE. The ad-group-level request used to send `campaignIdFilter` AND `adGroupIdFilter`
 *    together. Both are capped at 100 members, so chunking one while sending the other whole would
 *    still 400. The implementation chunks `campaignIdFilter` and reproduces `adGroupIdFilter` as a
 *    client-side Set test. These tests pin that the visible result is unchanged.
 *
 * 2. ALL-OR-NOTHING PER LEVEL. The caller `$set`s the returned array, replacing the stored
 *    snapshot. If one chunk of 52 failed and we still returned the rest, a complete snapshot would
 *    be silently overwritten with a partial one. A failure must zero that whole level instead —
 *    matching the pre-chunking contract — while leaving the other level intact.
 */

jest.mock('axios');
jest.mock('../../../models/amazon-ads/NegetiveKeywords.js', () => ({
    findOneAndUpdate: jest.fn(),
}));
// Chunk pacing exists to avoid 429s in production; zero it so tests don't sleep. Must be set
// before the require below (read into a module-level const at load time), and restored in afterAll
// so it cannot leak into other suites — jest workers share one process and do not reset env.
const ORIGINAL_CHUNK_DELAY = process.env.ADS_ID_FILTER_CHUNK_DELAY_MS;
process.env.ADS_ID_FILTER_CHUNK_DELAY_MS = '0';

const axios = require('axios');
const NegativeKeywords = require('../../../models/amazon-ads/NegetiveKeywords.js');
const { getNegativeKeywords } = require('../../../Services/AmazonAds/NegetiveKeywords.js');

const AD_GROUP_URL = '/sp/negativeKeywords/list';
const CAMPAIGN_URL = '/sp/campaignNegativeKeywords/list';

const campaignIds = Array.from({ length: 250 }, (_, i) => `c${i + 1}`);

const savedData = () => NegativeKeywords.findOneAndUpdate.mock.calls[0][1].$set.negativeKeywordsData;
const callsTo = (urlFragment) => axios.post.mock.calls.filter(([url]) => url.includes(urlFragment));

afterAll(() => {
    if (ORIGINAL_CHUNK_DELAY === undefined) delete process.env.ADS_ID_FILTER_CHUNK_DELAY_MS;
    else process.env.ADS_ID_FILTER_CHUNK_DELAY_MS = ORIGINAL_CHUNK_DELAY;
});

beforeEach(() => {
    NegativeKeywords.findOneAndUpdate.mockImplementation((_q, update) => Promise.resolve(update.$set));
});

describe('chunking and filter equivalence', () => {
    test('no request exceeds the 100-member include cap on either endpoint', async () => {
        axios.post.mockResolvedValue({ data: {} });

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', campaignIds, []);

        expect(axios.post).toHaveBeenCalled();
        for (const [, body] of axios.post.mock.calls) {
            for (const key of ['campaignIdFilter', 'adGroupIdFilter']) {
                if (body[key]) expect(body[key].include.length).toBeLessThanOrEqual(100);
            }
        }
    });

    test('ad-group filtering is reproduced client-side and yields the same rows', async () => {
        // Amazon is asked only about campaigns, so it returns ad groups we did NOT ask for.
        // Those must be dropped exactly as a server-side adGroupIdFilter would have dropped them.
        axios.post.mockImplementation((url) => Promise.resolve({
            data: url.includes(AD_GROUP_URL)
                ? {
                    negativeKeywords: [
                        { keywordId: 'k-wanted', adGroupId: 'ag-1', campaignId: 'c1', keywordText: 'a' },
                        { keywordId: 'k-unwanted', adGroupId: 'ag-999', campaignId: 'c1', keywordText: 'b' },
                    ],
                }
                : {},
        }));

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', ['c1'], ['ag-1']);

        const ids = savedData().map((r) => r.keywordId);
        expect(ids).toContain('k-wanted');
        expect(ids).not.toContain('k-unwanted');
    });

    test('numeric ad group ids still match despite String() normalisation', async () => {
        axios.post.mockImplementation((url) => Promise.resolve({
            data: url.includes(AD_GROUP_URL)
                ? { negativeKeywords: [{ keywordId: 'k1', adGroupId: 12345, campaignId: 'c1' }] }
                : {},
        }));

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', ['c1'], [12345]);

        expect(savedData().map((r) => r.keywordId)).toEqual(['k1']);
    });

    test('with no campaign ids it chunks by ad group and filters server-side instead', async () => {
        axios.post.mockResolvedValue({ data: {} });
        const adGroupIds = Array.from({ length: 150 }, (_, i) => `ag${i + 1}`);

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', [], adGroupIds);

        const adGroupCalls = callsTo(AD_GROUP_URL);
        expect(adGroupCalls).toHaveLength(2); // 150 -> 100 + 50
        for (const [, body] of adGroupCalls) {
            expect(body.adGroupIdFilter.include.length).toBeLessThanOrEqual(100);
            expect(body.campaignIdFilter).toBeUndefined();
        }
    });

    test('duplicate keywordIds across chunks are de-duplicated, keeping first occurrence', async () => {
        axios.post.mockImplementation((url) => Promise.resolve({
            data: url.includes(AD_GROUP_URL)
                ? { negativeKeywords: [{ keywordId: 'dupe', adGroupId: 'ag-1', keywordText: 'first' }] }
                : { campaignNegativeKeywords: [{ keywordId: 'dupe', keywordText: 'second' }] },
        }));

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', ['c1'], []);

        const rows = savedData().filter((r) => r.keywordId === 'dupe');
        expect(rows).toHaveLength(1);
        expect(rows[0].keywordText).toBe('first');
    });
});

describe('a failed chunk must not publish a partial level', () => {
    test('one failing ad-group chunk zeroes that level entirely, not partially', async () => {
        // 250 campaign ids => 3 ad-group chunks. Chunk 1 succeeds, chunk 2 throws.
        let adGroupCall = 0;
        axios.post.mockImplementation((url) => {
            if (url.includes(AD_GROUP_URL)) {
                adGroupCall++;
                if (adGroupCall === 2) return Promise.reject(new Error('429 Too Many Requests'));
                return Promise.resolve({
                    data: { negativeKeywords: [{ keywordId: `ag-k${adGroupCall}`, adGroupId: 'ag-1' }] },
                });
            }
            return Promise.resolve({ data: {} });
        });

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', campaignIds, []);

        // The row from the successful chunk 1 must NOT survive — publishing it would let a
        // 1-of-3 failure overwrite a complete stored snapshot with a partial one.
        expect(savedData().filter((r) => r._level === 'adGroup')).toHaveLength(0);
    });

    test('an ad-group failure still leaves the campaign level intact (per-level independence)', async () => {
        axios.post.mockImplementation((url) => {
            if (url.includes(AD_GROUP_URL)) return Promise.reject(new Error('boom'));
            return Promise.resolve({
                data: { campaignNegativeKeywords: [{ keywordId: 'camp-k1', campaignId: 'c1' }] },
            });
        });

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', ['c1'], []);

        const saved = savedData();
        expect(saved.filter((r) => r._level === 'adGroup')).toHaveLength(0);
        expect(saved.map((r) => r.keywordId)).toEqual(['camp-k1']);
    });

    test('a malformed page zeroes the level instead of publishing a truncated set', async () => {
        // `{negativeKeywords: null}` used to `break` pagination and return NORMALLY, so whatever
        // pages had arrived were published as a success and $set over the complete snapshot.
        let call = 0;
        axios.post.mockImplementation((url) => {
            if (url.includes(AD_GROUP_URL)) {
                call++;
                if (call === 1) {
                    return Promise.resolve({
                        data: { negativeKeywords: [{ keywordId: 'k1', adGroupId: 'ag-1' }], nextToken: 'more' },
                    });
                }
                return Promise.resolve({ data: { negativeKeywords: null } }); // malformed page 2
            }
            return Promise.resolve({ data: {} });
        });

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', ['c1'], []);

        expect(savedData().filter((r) => r._level === 'adGroup')).toHaveLength(0);
    });

    test('an ABSENT key is treated as "no results", not as malformed', async () => {
        // Amazon omits the key when there is nothing to return; that must stay a clean empty
        // result rather than failing the level.
        axios.post.mockResolvedValue({ data: {} });

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', ['c1'], []);

        expect(NegativeKeywords.findOneAndUpdate).toHaveBeenCalledTimes(1);
        expect(savedData()).toEqual([]);
    });

    test('a campaign-level failure zeroes only that level', async () => {
        axios.post.mockImplementation((url) => {
            if (url.includes(CAMPAIGN_URL)) return Promise.reject(new Error('boom'));
            return Promise.resolve({
                data: { negativeKeywords: [{ keywordId: 'ag-k1', adGroupId: 'ag-1' }] },
            });
        });

        await getNegativeKeywords('tok', 'prof', 'user-1', 'US', 'NA', ['c1'], []);

        const saved = savedData();
        expect(saved.filter((r) => r._level === 'campaign')).toHaveLength(0);
        expect(saved.map((r) => r.keywordId)).toEqual(['ag-k1']);
    });
});

/**
 * Regression test for the `adGroupsData` 400 INVALID_ARGUMENT bug.
 *
 * `getAdGroups` used to put EVERY campaign ID into a single `campaignIdFilter.include`, which
 * Amazon SP v3 rejects above 100 members. On the account that surfaced this (5,102 ENABLED
 * campaigns) the call failed on every scheduled run, so `adsGroupData` stayed empty — which in
 * turn starved `adGroupIdArray` for the downstream negative-keywords fetch.
 *
 * These assertions pin the two properties that matter: no request may exceed the cap, and
 * chunking must not lose ad groups.
 */

jest.mock('axios');
jest.mock('../../../models/amazon-ads/adsgroupModel.js', () => ({
    findOneAndUpdate: jest.fn(),
}));
// The snapshot is now written through persistChunkedSnapshot, which ALWAYS clears stale
// overflow chunks first, making AdsGroupChunk a real collaborator of this service. Left
// unmocked, `deleteMany` buffers against a connection that does not exist in unit tests and
// every case here times out. Assertions below are unchanged: these fixtures are far under
// SNAPSHOT_CHUNK_SIZE, so the write still takes the inline `findOneAndUpdate` path.
jest.mock('../../../models/amazon-ads/adsGroupChunkModel.js', () => ({
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    updateOne: jest.fn().mockResolvedValue({}),
}));
// Chunk pacing exists to avoid 429s in production; zero it so tests don't sleep (52 chunks at the
// 250ms default would be ~13s, past the 10s per-test timeout). Must be set before the require
// below, since the value is read into a module-level const at load time. Restored in afterAll so
// it cannot leak into other suites — jest workers share one process and do not reset env.
const ORIGINAL_CHUNK_DELAY = process.env.ADS_ID_FILTER_CHUNK_DELAY_MS;
process.env.ADS_ID_FILTER_CHUNK_DELAY_MS = '0';
jest.mock('../../../utils/Logger.js', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const axios = require('axios');
const AdsGroup = require('../../../models/amazon-ads/adsgroupModel.js');
const { getAdGroups } = require('../../../Services/AmazonAds/AdGroups.js');
const { ADS_ID_FILTER_MAX } = require('../../../utils/adsIdFilter.js');

afterAll(() => {
    if (ORIGINAL_CHUNK_DELAY === undefined) delete process.env.ADS_ID_FILTER_CHUNK_DELAY_MS;
    else process.env.ADS_ID_FILTER_CHUNK_DELAY_MS = ORIGINAL_CHUNK_DELAY;
});

const CAMPAIGN_COUNT = 5102;
const campaignIds = Array.from({ length: CAMPAIGN_COUNT }, (_, i) => String(i + 1));

beforeEach(() => {
    process.env.AMAZON_ADS_CLIENT_ID = 'test-client-id';
    // Echo back one ad group per request so we can prove nothing is dropped across chunks.
    axios.post.mockImplementation((url, body) => Promise.resolve({
        data: {
            adGroups: [{
                adGroupId: `ag-${body.campaignIdFilter.include[0]}`,
                campaignId: body.campaignIdFilter.include[0],
                state: 'ENABLED',
            }],
        },
    }));
    AdsGroup.findOneAndUpdate.mockImplementation((_q, update) => Promise.resolve(update.$set));
});

describe('getAdGroups campaignIdFilter chunking', () => {
    test('never exceeds the SP v3 include[] cap on any request', async () => {
        await getAdGroups('token', 'profile-1', 'NA', 'user-1', 'US', campaignIds);

        expect(axios.post).toHaveBeenCalled();
        for (const [, body] of axios.post.mock.calls) {
            expect(body.campaignIdFilter.include.length).toBeLessThanOrEqual(ADS_ID_FILTER_MAX);
        }
    });

    test('issues ceil(n / cap) requests and covers every campaign id exactly once', async () => {
        await getAdGroups('token', 'profile-1', 'NA', 'user-1', 'US', campaignIds);

        const expectedChunks = Math.ceil(CAMPAIGN_COUNT / ADS_ID_FILTER_MAX);
        expect(axios.post).toHaveBeenCalledTimes(expectedChunks);

        const sent = axios.post.mock.calls.flatMap(([, body]) => body.campaignIdFilter.include);
        expect(sent).toEqual(campaignIds);
    });

    test('accumulates ad groups across all chunks into one saved snapshot', async () => {
        await getAdGroups('token', 'profile-1', 'NA', 'user-1', 'US', campaignIds);

        expect(AdsGroup.findOneAndUpdate).toHaveBeenCalledTimes(1);
        const saved = AdsGroup.findOneAndUpdate.mock.calls[0][1].$set;
        expect(saved.adsGroupData).toHaveLength(Math.ceil(CAMPAIGN_COUNT / ADS_ID_FILTER_MAX));
        expect(saved.adsGroupData[0]).toMatchObject({ _v3Original: true, stateLower: 'enabled' });
    });

    test('paginates within a chunk without leaking nextToken into the next chunk', async () => {
        // First call for each chunk returns a nextToken; the follow-up must reuse that chunk's
        // filter, and a fresh chunk must start with no nextToken.
        let call = 0;
        axios.post.mockImplementation((url, body) => {
            call++;
            const isFirstPage = !body.nextToken;
            return Promise.resolve({
                data: {
                    adGroups: [{ adGroupId: `ag-${call}`, state: 'PAUSED' }],
                    nextToken: isFirstPage ? 'tok' : null,
                },
            });
        });

        await getAdGroups('token', 'profile-1', 'NA', 'user-1', 'US', campaignIds.slice(0, 250));

        // 3 chunks (100/100/50), 2 pages each.
        expect(axios.post).toHaveBeenCalledTimes(6);
        const firstPagesOfChunks = axios.post.mock.calls.filter(([, b]) => !b.nextToken);
        expect(firstPagesOfChunks).toHaveLength(3);
    });

    test('refuses to overwrite the stored snapshot when a chunk returns a malformed response', async () => {
        // The upsert is a $set that REPLACES adsGroupData. Pre-chunking, a malformed response ended
        // the single request loop; now it would end only one chunk of 52 and still save, silently
        // publishing a short ad-group list that then starves adGroupIdArray downstream.
        let call = 0;
        axios.post.mockImplementation((url, body) => {
            call++;
            if (call === 2) return Promise.resolve({ data: { adGroups: 'not-an-array' } });
            return Promise.resolve({
                data: { adGroups: [{ adGroupId: `ag-${body.campaignIdFilter.include[0]}`, state: 'ENABLED' }] },
            });
        });

        await expect(
            getAdGroups('token', 'profile-1', 'NA', 'user-1', 'US', campaignIds.slice(0, 250))
        ).rejects.toThrow(/incomplete/i);

        // Nothing written — yesterday's complete snapshot survives.
        expect(AdsGroup.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('a chunk with NO ad groups (absent key) is normal, not a malformed failure', async () => {
        // Amazon omits `adGroups` when a chunk of campaigns has none. That must not be mistaken
        // for a truncated response, or a legitimately-empty chunk would block the whole write.
        axios.post.mockImplementation((url, body) => Promise.resolve({
            data: body.campaignIdFilter.include.includes('1')
                ? { adGroups: [{ adGroupId: 'ag-1', state: 'ENABLED' }] }
                : {}, // no ad groups for these campaigns
        }));

        await getAdGroups('token', 'profile-1', 'NA', 'user-1', 'US', campaignIds.slice(0, 250));

        expect(AdsGroup.findOneAndUpdate).toHaveBeenCalledTimes(1);
        expect(AdsGroup.findOneAndUpdate.mock.calls[0][1].$set.adsGroupData).toHaveLength(1);
    });

    test('a mid-chunk throw writes nothing rather than a partial snapshot', async () => {
        let call = 0;
        axios.post.mockImplementation((url, body) => {
            call++;
            if (call === 3) return Promise.reject(new Error('429 Too Many Requests'));
            return Promise.resolve({
                data: { adGroups: [{ adGroupId: `ag-${body.campaignIdFilter.include[0]}`, state: 'ENABLED' }] },
            });
        });

        await expect(
            getAdGroups('token', 'profile-1', 'NA', 'user-1', 'US', campaignIds.slice(0, 250))
        ).rejects.toThrow('429');

        expect(AdsGroup.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('empty campaign list still short-circuits to an empty snapshot (unchanged behaviour)', async () => {
        await getAdGroups('token', 'profile-1', 'NA', 'user-1', 'US', []);

        expect(axios.post).not.toHaveBeenCalled();
        expect(AdsGroup.findOneAndUpdate).toHaveBeenCalledTimes(1);
        expect(AdsGroup.findOneAndUpdate.mock.calls[0][1].$set.adsGroupData).toEqual([]);
    });
});

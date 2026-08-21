/**
 * Tests for the READ side of snapshot chunking — utils/ppcSnapshotLoader.js.
 *
 * WHY THIS MATTERS MORE THAN THE WRITE SIDE
 * Reassembly lives in `loadLatestSnapshotDoc` precisely so no caller has to know chunking
 * exists. That means a bug here is invisible at ~8 call sites at once, and it does not throw
 * — it silently returns fewer rows. Two of those callers make that dangerous:
 *
 *   - Analyse.js flattens `doc.negativeKeywordsData` straight into the dashboard payload.
 *   - PPCCampaignAnalysisService.getCampaignsWithoutNegatives builds a Set of "campaigns
 *     that HAVE negatives" from it, so a truncated read reports campaigns as having NO
 *     negatives — a false positive shown to the seller as an issue to fix.
 *
 * So the properties pinned here are: legacy/inline docs pass through untouched, chunked docs
 * reassemble in index order, and anything unexpected degrades to the unreassembled document
 * rather than to an empty set.
 */

const mockChunkFind = jest.fn();
jest.mock('../../models/amazon-ads/negativeKeywordChunkModel.js', () => ({
    find: (...a) => mockChunkFind(...a),
}));
jest.mock('../../models/amazon-ads/keywordChunkModel.js', () => ({ find: jest.fn() }));
jest.mock('../../models/amazon-ads/campaignChunkModel.js', () => ({ find: jest.fn() }));
jest.mock('../../models/amazon-ads/adsGroupChunkModel.js', () => ({ find: jest.fn() }));
jest.mock('../../models/amazon-ads/keywordModel.js', () => ({ modelName: 'Keyword', findOne: jest.fn() }));

const { loadLatestSnapshotDoc, CHUNKED_SNAPSHOTS } = require('../../utils/ppcSnapshotLoader.js');

/** Model stub whose first findOne (per-day) and second (legacy fallback) can differ. */
function makeModel(modelName, perDayDoc, legacyDoc = null) {
    const chain = (doc) => ({ sort: () => ({ lean: async () => doc }) });
    let call = 0;
    return {
        modelName,
        findOne: jest.fn(() => chain(call++ === 0 ? perDayDoc : legacyDoc)),
    };
}

const chunkResult = (docs) => ({ sort: () => ({ lean: async () => docs }) });

beforeEach(() => mockChunkFind.mockReset());

describe('non-chunked documents pass straight through', () => {
    test('an inline per-day document is returned unchanged', async () => {
        const doc = { metricDate: '2026-08-20', isChunked: false, negativeKeywordsData: [{ keywordId: 'a' }] };
        const Model = makeModel('NegativeKeywords', doc);

        expect(await loadLatestSnapshotDoc(Model, 'u1', 'US', 'NA')).toBe(doc);
        expect(mockChunkFind).not.toHaveBeenCalled();
    });

    // Legacy documents predate the flag entirely, so `isChunked` is undefined — that must
    // read as "not chunked", not as "unknown, go looking for chunks".
    test('a legacy document with no isChunked field is returned unchanged', async () => {
        const legacy = { negativeKeywordsData: [{ keywordId: 'old' }] };
        const Model = makeModel('NegativeKeywords', null, legacy);

        expect(await loadLatestSnapshotDoc(Model, 'u1', 'US', 'NA')).toBe(legacy);
        expect(mockChunkFind).not.toHaveBeenCalled();
    });

    test('no document at all returns null', async () => {
        const Model = makeModel('NegativeKeywords', null, null);
        expect(await loadLatestSnapshotDoc(Model, 'u1', 'US', 'NA')).toBeNull();
    });

    test('the per-day document wins over the legacy fallback', async () => {
        const perDay = { metricDate: '2026-08-20', negativeKeywordsData: [{ keywordId: 'new' }] };
        const legacy = { negativeKeywordsData: [{ keywordId: 'old' }] };
        const Model = makeModel('NegativeKeywords', perDay, legacy);

        expect(await loadLatestSnapshotDoc(Model, 'u1', 'US', 'NA')).toBe(perDay);
        expect(Model.findOne).toHaveBeenCalledTimes(1);
    });
});

describe('chunked documents are reassembled', () => {
    test('chunks are merged and the header array replaced', async () => {
        const Model = makeModel('NegativeKeywords', {
            metricDate: '2026-08-20', isChunked: true, totalChunks: 2, negativeKeywordsData: [],
        });
        mockChunkFind.mockReturnValue(chunkResult([
            { chunkIndex: 0, negativeKeywordsData: [{ keywordId: 'a' }, { keywordId: 'b' }] },
            { chunkIndex: 1, negativeKeywordsData: [{ keywordId: 'c' }] },
        ]));

        const out = await loadLatestSnapshotDoc(Model, 'u1', 'US', 'NA');
        expect(out.negativeKeywordsData.map((r) => r.keywordId)).toEqual(['a', 'b', 'c']);
        // header metadata survives the merge
        expect(out.isChunked).toBe(true);
        expect(out.totalChunks).toBe(2);
    });

    test('chunks are queried by the header metricDate and sorted by chunkIndex', async () => {
        const Model = makeModel('NegativeKeywords', {
            metricDate: '2026-08-20', isChunked: true, negativeKeywordsData: [],
        });
        const sort = jest.fn(() => ({ lean: async () => [] }));
        mockChunkFind.mockReturnValue({ sort });

        await loadLatestSnapshotDoc(Model, 'u1', 'US', 'NA');
        expect(mockChunkFind).toHaveBeenCalledWith({
            userId: 'u1', country: 'US', region: 'NA', metricDate: '2026-08-20',
        });
        expect(sort).toHaveBeenCalledWith({ chunkIndex: 1 });
    });

    test('a chunk with a missing or non-array payload is skipped, not fatal', async () => {
        const Model = makeModel('NegativeKeywords', {
            metricDate: '2026-08-20', isChunked: true, negativeKeywordsData: [],
        });
        mockChunkFind.mockReturnValue(chunkResult([
            { chunkIndex: 0, negativeKeywordsData: [{ keywordId: 'a' }] },
            { chunkIndex: 1 },
            { chunkIndex: 2, negativeKeywordsData: null },
            { chunkIndex: 3, negativeKeywordsData: [{ keywordId: 'd' }] },
        ]));

        const out = await loadLatestSnapshotDoc(Model, 'u1', 'US', 'NA');
        expect(out.negativeKeywordsData.map((r) => r.keywordId)).toEqual(['a', 'd']);
    });

    test('a flagged header whose chunks are all gone yields an empty set, not a throw', async () => {
        const Model = makeModel('NegativeKeywords', {
            metricDate: '2026-08-20', isChunked: true, negativeKeywordsData: [],
        });
        mockChunkFind.mockReturnValue(chunkResult([]));

        const out = await loadLatestSnapshotDoc(Model, 'u1', 'US', 'NA');
        expect(out.negativeKeywordsData).toEqual([]);
    });
});

describe('unregistered models degrade safely', () => {
    // If a model is flagged chunked but has no registry entry, returning the header as-is is
    // the honest outcome. Inventing an empty array would look like "this account has no
    // negatives", which is exactly the false positive we are trying to avoid.
    test('a flagged model absent from the registry returns the document unchanged', async () => {
        const doc = { metricDate: '2026-08-20', isChunked: true, someData: [{ id: 1 }] };
        const Model = makeModel('NotRegistered', doc);

        expect(await loadLatestSnapshotDoc(Model, 'u1', 'US', 'NA')).toBe(doc);
        expect(mockChunkFind).not.toHaveBeenCalled();
    });
});

describe('registry', () => {
    test('covers every snapshot model that can chunk, with the right array field', () => {
        expect(Object.keys(CHUNKED_SNAPSHOTS).sort()).toEqual(
            ['AdsGroup', 'Campaign', 'Keyword', 'NegativeKeywords']
        );
        expect(CHUNKED_SNAPSHOTS.Keyword.dataField).toBe('keywordData');
        expect(CHUNKED_SNAPSHOTS.NegativeKeywords.dataField).toBe('negativeKeywordsData');
        expect(CHUNKED_SNAPSHOTS.Campaign.dataField).toBe('campaignData');
        expect(CHUNKED_SNAPSHOTS.AdsGroup.dataField).toBe('adsGroupData');
    });

    test('every entry resolves to a chunk model', () => {
        const unresolved = Object.entries(CHUNKED_SNAPSHOTS)
            .filter(([, entry]) => typeof entry.chunkModel !== 'function' || !entry.chunkModel())
            .map(([name]) => name);
        expect(unresolved).toEqual([]);
    });
});

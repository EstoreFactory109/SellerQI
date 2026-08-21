/**
 * Tests for overflow chunking of entity snapshots — the write side
 * (utils/snapshotChunkStore.js) and the read side (utils/ppcSnapshotLoader.js).
 *
 * WHY THIS EXISTS
 * These collections put a whole entity set in one array field on one document. Past a
 * certain account size that document exceeds MongoDB's hard 16MB ceiling, and the failure is
 * genuinely hard to read because the bson driver's own 17MB serialization buffer overflows
 * first:
 *
 *     RangeError [ERR_OUT_OF_RANGE]: The value of "offset" is out of range.
 *     It must be >= 0 && <= 17825792. Received 17825807
 *
 * Production, 2026-08-21: `negativeKeywords` had not saved since 2026-08-09 for the largest
 * account, failing with exactly that on every run.
 *
 * The three properties worth pinning, because each has a silent failure mode:
 *   1. BELOW the threshold nothing changes. If the inline write ever stops being a plain
 *      `$set` of the rows, every existing caller and suite that reads
 *      `$set.<dataField>` breaks — and the point of the design is that they don't.
 *   2. Stale chunks are cleared FIRST. A set that shrinks (or drops back inline) must not
 *      leave orphaned higher-index chunks for the reader to glue onto the end. That would
 *      silently RESURRECT deleted rows.
 *   3. The header is written LAST. Until it says `isChunked: true`, readers must keep using
 *      the previous inline rows rather than a half-written chunk set.
 */

const { persistChunkedSnapshot, SNAPSHOT_CHUNK_SIZE } = require('../../utils/snapshotChunkStore.js');

const rows = (n, prefix = 'k') =>
    Array.from({ length: n }, (_, i) => ({ campaignId: 'c1', keywordId: `${prefix}${i}`, keywordText: `t${i}` }));

function makeModels() {
    const calls = [];
    const Model = {
        modelName: 'NegativeKeywords',
        findOneAndUpdate: jest.fn((q, u) => { calls.push(['header', u]); return Promise.resolve({ ...u.$set }); }),
    };
    const ChunkModel = {
        deleteMany: jest.fn(() => { calls.push(['deleteMany']); return Promise.resolve({ deletedCount: 0 }); }),
        updateOne: jest.fn((q, u) => { calls.push(['chunk', u.$set.chunkIndex]); return Promise.resolve({}); }),
    };
    return { Model, ChunkModel, calls };
}

const persist = (Model, ChunkModel, data, chunkSize) => persistChunkedSnapshot({
    Model, ChunkModel,
    dataField: 'negativeKeywordsData',
    userId: 'u1', country: 'US', region: 'NA', metricDate: '2026-08-20',
    rows: data,
    ...(chunkSize ? { chunkSize } : {}),
});

describe('below the threshold: inline, unchanged', () => {
    test('writes rows inline with isChunked false and no chunk documents', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, rows(10), 100);

        expect(ChunkModel.updateOne).not.toHaveBeenCalled();
        expect(Model.findOneAndUpdate).toHaveBeenCalledTimes(1);
        const update = Model.findOneAndUpdate.mock.calls[0][1];
        expect(update.$set.negativeKeywordsData).toHaveLength(10);
        expect(update.$set.isChunked).toBe(false);
        expect(update.$set.totalChunks).toBe(1);
    });

    // The inline path must keep running validators — that is where the schema's `required`
    // fields are actually enforced.
    test('inline write upserts with validators on', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, rows(5), 100);
        expect(Model.findOneAndUpdate.mock.calls[0][2]).toEqual(
            expect.objectContaining({ upsert: true, new: true, runValidators: true })
        );
    });

    test('exactly at the threshold stays inline', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, rows(100), 100);
        expect(ChunkModel.updateOne).not.toHaveBeenCalled();
        expect(Model.findOneAndUpdate.mock.calls[0][1].$set.isChunked).toBe(false);
    });

    test('an empty set still writes a header, and still clears chunks', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, [], 100);
        expect(ChunkModel.deleteMany).toHaveBeenCalledTimes(1);
        expect(Model.findOneAndUpdate.mock.calls[0][1].$set.negativeKeywordsData).toEqual([]);
    });

    test('a non-array rows value is treated as empty rather than thrown', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, undefined, 100);
        expect(Model.findOneAndUpdate.mock.calls[0][1].$set.negativeKeywordsData).toEqual([]);
    });
});

describe('above the threshold: chunked', () => {
    test('one chunk per slice, contiguous zero-based indexes, correct totalChunks', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, rows(250), 100);

        expect(ChunkModel.updateOne).toHaveBeenCalledTimes(3);
        const indexes = ChunkModel.updateOne.mock.calls.map(([, u]) => u.$set.chunkIndex);
        expect(indexes).toEqual([0, 1, 2]);
        ChunkModel.updateOne.mock.calls.forEach(([, u]) => expect(u.$set.totalChunks).toBe(3));
    });

    test('every row lands in exactly one chunk, in order', async () => {
        const { Model, ChunkModel } = makeModels();
        const data = rows(250);
        await persist(Model, ChunkModel, data, 100);

        const reassembled = ChunkModel.updateOne.mock.calls
            .sort(([, a], [, b]) => a.$set.chunkIndex - b.$set.chunkIndex)
            .flatMap(([, u]) => u.$set.negativeKeywordsData);
        expect(reassembled).toEqual(data);
    });

    test('the primary document becomes an empty flagged header', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, rows(250), 100);

        const update = Model.findOneAndUpdate.mock.calls[0][1];
        expect(update.$set.negativeKeywordsData).toEqual([]);
        expect(update.$set.isChunked).toBe(true);
        expect(update.$set.totalChunks).toBe(3);
    });

    test('a ragged final chunk holds the remainder', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, rows(205), 100);
        const sizes = ChunkModel.updateOne.mock.calls.map(([, u]) => u.$set.negativeKeywordsData.length);
        expect(sizes).toEqual([100, 100, 5]);
    });
});

describe('ordering guarantees', () => {
    // THE regression test for resurrected rows: if chunks were cleared AFTER writing, a
    // shrinking set would keep the old higher-index chunks and the reader would glue
    // deleted rows back on.
    test('stale chunks are cleared before anything is written', async () => {
        const { Model, ChunkModel, calls } = makeModels();
        await persist(Model, ChunkModel, rows(250), 100);
        expect(calls[0][0]).toBe('deleteMany');
    });

    test('the header is written after every chunk', async () => {
        const { Model, ChunkModel, calls } = makeModels();
        await persist(Model, ChunkModel, rows(250), 100);
        const kinds = calls.map((c) => c[0]);
        expect(kinds).toEqual(['deleteMany', 'chunk', 'chunk', 'chunk', 'header']);
    });

    test('dropping back below the threshold still clears the old chunks', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, rows(3), 100);
        expect(ChunkModel.deleteMany).toHaveBeenCalledTimes(1);
        expect(ChunkModel.updateOne).not.toHaveBeenCalled();
        // and the header goes back to inline, so readers stop consulting chunks at all
        expect(Model.findOneAndUpdate.mock.calls[0][1].$set.isChunked).toBe(false);
    });
});

describe('guards and defaults', () => {
    test('the default chunk size matches the keyword precedent', () => {
        expect(SNAPSHOT_CHUNK_SIZE).toBe(10000);
    });

    test('missing Model, ChunkModel or dataField throws rather than half-writing', async () => {
        const { Model, ChunkModel } = makeModels();
        await expect(persistChunkedSnapshot({ ChunkModel, dataField: 'x', rows: [] })).rejects.toThrow(/requires Model/);
        await expect(persistChunkedSnapshot({ Model, dataField: 'x', rows: [] })).rejects.toThrow(/requires Model/);
        await expect(persistChunkedSnapshot({ Model, ChunkModel, rows: [] })).rejects.toThrow(/requires Model/);
    });

    test('the key is carried onto every chunk and the header', async () => {
        const { Model, ChunkModel } = makeModels();
        await persist(Model, ChunkModel, rows(150), 100);
        const key = { userId: 'u1', country: 'US', region: 'NA', metricDate: '2026-08-20' };
        expect(ChunkModel.deleteMany).toHaveBeenCalledWith(key);
        ChunkModel.updateOne.mock.calls.forEach(([q]) => expect(q).toEqual(expect.objectContaining(key)));
        expect(Model.findOneAndUpdate.mock.calls[0][0]).toEqual(key);
    });
});

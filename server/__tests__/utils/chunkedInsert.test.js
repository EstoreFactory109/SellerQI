/**
 * Tests for chunked bulk inserts.
 *
 * WHY THIS EXISTS
 * `insertMany(N)` holds the inputs, N hydrated Documents and N serialised POJOs live at once —
 * roughly three copies of the payload at peak, on workers PM2 recycles at 2GB. Chunking bounds that.
 *
 * THE PROPERTY THAT MATTERS: chunking must be invisible in the data. Every document still goes
 * through `new Model(doc)`, so casting, defaults, validation, timestamps and `__v` all happen exactly
 * as before. That is the entire reason this is batching and not `{ lean: true }` — lean skips
 * document construction, which skips `initializeTimestamps()` and `__v`, and several of these
 * collections sort their read paths on `createdAt`. A test below pins that we pass plain objects
 * through to the model rather than bypassing it.
 */

const { insertManyChunked, DEFAULT_INSERT_CHUNK_SIZE } = require('../../utils/chunkedInsert.js');

/** A model stub that records each insertMany call. */
function makeModel({ returnsDocs = true } = {}) {
    const calls = [];
    return {
        calls,
        insertMany: jest.fn(async (docs, opts) => {
            calls.push({ docs, opts });
            return returnsDocs ? docs : undefined;
        }),
    };
}

const docs = (n) => Array.from({ length: n }, (_, i) => ({ i, sku: `SKU-${i}` }));

describe('insertManyChunked', () => {
    test('splits into ceil(N / chunkSize) calls', () => {
        expect(DEFAULT_INSERT_CHUNK_SIZE).toBe(500);
    });

    test('a sub-chunk-size array is a single call', async () => {
        const model = makeModel();

        const n = await insertManyChunked(model, docs(10));

        expect(model.insertMany).toHaveBeenCalledTimes(1);
        expect(n).toBe(10);
    });

    test('an exact multiple does not produce a trailing empty call', async () => {
        const model = makeModel();

        await insertManyChunked(model, docs(1000));

        expect(model.insertMany).toHaveBeenCalledTimes(2);
        expect(model.calls.every((c) => c.docs.length === 500)).toBe(true);
    });

    test('a remainder lands in a final short chunk', async () => {
        const model = makeModel();

        await insertManyChunked(model, docs(1250));

        expect(model.insertMany).toHaveBeenCalledTimes(3);
        expect(model.calls.map((c) => c.docs.length)).toEqual([500, 500, 250]);
    });

    // The core equivalence property: chunking must neither drop, duplicate nor reorder anything.
    test('every document is inserted exactly once, in the original order', async () => {
        const model = makeModel();
        const input = docs(1201);

        await insertManyChunked(model, input);

        const flat = model.calls.flatMap((c) => c.docs);
        expect(flat).toHaveLength(1201);
        expect(flat.map((d) => d.i)).toEqual(input.map((d) => d.i));
        expect(new Set(flat.map((d) => d.i)).size).toBe(1201);
    });

    test('the ordered flag is passed through unchanged', async () => {
        const unordered = makeModel();
        await insertManyChunked(unordered, docs(600));
        expect(unordered.calls.every((c) => c.opts.ordered === false)).toBe(true);

        const ordered = makeModel();
        await insertManyChunked(ordered, docs(600), { ordered: true });
        expect(ordered.calls.every((c) => c.opts.ordered === true)).toBe(true);
    });

    test('ordered:true still receives chunks in sequence, so relative order survives', async () => {
        // IssuesDataChunks relies on this — chunks are built in chunkIndex order and reconstruction
        // depends on it.
        const model = makeModel();

        await insertManyChunked(model, docs(60), { ordered: true, chunkSize: 25 });

        expect(model.calls.map((c) => c.docs[0].i)).toEqual([0, 25, 50]);
    });

    test('an explicit chunkSize is honoured', async () => {
        const model = makeModel();

        await insertManyChunked(model, docs(60), { chunkSize: 25 });

        expect(model.calls.map((c) => c.docs.length)).toEqual([25, 25, 10]);
    });

    // Guards the "inserted 0 documents" check in ProductWiseSponsoredAdsService: if the count came
    // back short, that caller would throw on a perfectly good save.
    test('the count falls back to chunk length when insertMany returns nothing useful', async () => {
        const model = makeModel({ returnsDocs: false });

        expect(await insertManyChunked(model, docs(1250))).toBe(1250);
    });

    test('empty and non-array inputs are a no-op, not a crash', async () => {
        const model = makeModel();

        expect(await insertManyChunked(model, [])).toBe(0);
        expect(await insertManyChunked(model, null)).toBe(0);
        expect(await insertManyChunked(model, undefined)).toBe(0);
        expect(model.insertMany).not.toHaveBeenCalled();
    });

    test('a nonsensical chunkSize falls back to the default rather than looping forever', async () => {
        for (const bad of [0, -5, NaN, 'many', null]) {
            const model = makeModel();
            await insertManyChunked(model, docs(600), { chunkSize: bad });
            expect(model.calls.map((c) => c.docs.length)).toEqual([500, 100]);
        }
    });

    // This is what makes the change safe: documents reach the MODEL, so Mongoose still hydrates them
    // (cast/defaults/validate/timestamps/__v). `lean` would bypass exactly this.
    test('plain objects are handed to the model — hydration is not bypassed', async () => {
        const model = makeModel();

        await insertManyChunked(model, docs(3));

        const passed = model.calls[0].docs;
        expect(passed[0]).toEqual({ i: 0, sku: 'SKU-0' });
        // No lean flag is ever set; that would skip timestamps and __v.
        expect(model.calls[0].opts).not.toHaveProperty('lean');
    });

    test('a rejecting insertMany propagates rather than silently truncating', async () => {
        const model = makeModel();
        model.insertMany.mockRejectedValueOnce(new Error('duplicate key'));

        await expect(insertManyChunked(model, docs(600))).rejects.toThrow('duplicate key');
    });
});

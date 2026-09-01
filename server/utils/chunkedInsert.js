/**
 * Chunked `insertMany` — bound the transient memory of a bulk write without changing what is
 * written.
 *
 * WHY THIS EXISTS
 * `Model.insertMany(N)` is not just "one round trip". Internally Mongoose builds N hydrated
 * Documents AND then a second full array of serialised POJOs, so the inputs, the Documents and the
 * POJOs are all live simultaneously — roughly three copies of the payload at peak. On the widest
 * rows here (~25 string columns) with tens of thousands of documents that is a real spike, and these
 * writes run on workers that PM2 recycles at 2GB.
 *
 * WHY NOT `{ lean: true }`, WHICH LOOKS LIKE THE OBVIOUS FIX
 * Because it silently changes the data. In the installed Mongoose 8.23.0, `lean` skips document
 * construction entirely, which means it skips `initializeTimestamps()` and the `__v` assignment —
 * so `createdAt`/`updatedAt` are never written. Several of these collections' read paths sort on
 * `createdAt` (`findLatestByUserCountryRegion`, `deleteOldBatches`), so rows written that way become
 * invisible to the dashboard. It also skips casting and defaults, which would turn int64 ad IDs into
 * numerics instead of strings and blank out non-empty schema defaults such as `"0.00"` and `"--"`.
 *
 * Chunking gets essentially the same memory win with none of that: every document still goes through
 * `new Model(doc)`, so it is cast, defaulted, validated, timestamped and versioned exactly as
 * before. The stored bytes are identical; only the peak footprint changes.
 *
 * Order is preserved — chunks are inserted sequentially in array order — so this is safe to use with
 * `ordered: true` where relative order carries meaning.
 */

/** Matches ListingItemsService, the pattern this generalises. */
const DEFAULT_INSERT_CHUNK_SIZE = 500;

/**
 * @param {import('mongoose').Model} Model    the Mongoose model to insert into
 * @param {Array<object>} docs                plain objects to insert
 * @param {object} [opts]
 * @param {number}  [opts.chunkSize]          documents per insertMany call
 * @param {boolean} [opts.ordered=false]      passed straight through to insertMany
 * @returns {Promise<number>} how many documents were inserted
 */
async function insertManyChunked(Model, docs, { chunkSize, ordered = false } = {}) {
    const all = Array.isArray(docs) ? docs : [];
    if (!all.length) return 0;

    const size = Number.isFinite(chunkSize) && chunkSize > 0
        ? Math.floor(chunkSize)
        : DEFAULT_INSERT_CHUNK_SIZE;

    let inserted = 0;
    for (let i = 0; i < all.length; i += size) {
        const chunk = all.slice(i, i + size);
        const res = await Model.insertMany(chunk, { ordered });
        // insertMany normally returns the inserted docs; fall back to the chunk length so a mocked
        // or unusual return value never under-reports and trips a caller's "inserted 0" guard.
        inserted += Array.isArray(res) ? res.length : chunk.length;
    }
    return inserted;
}

module.exports = { insertManyChunked, DEFAULT_INSERT_CHUNK_SIZE };

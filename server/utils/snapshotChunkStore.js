/**
 * snapshotChunkStore.js
 *
 * Shared overflow-chunking for ENTITY SNAPSHOT collections — negative keywords, campaigns,
 * ad groups. Generalises `persistKeywordSnapshot` (Services/AmazonAds/Keywords.js), which
 * solved this exact problem for the `Keyword` model first.
 *
 * THE PROBLEM. These collections store a whole entity set in one array field on one
 * document. Past a certain account size that document exceeds MongoDB's hard 16MB ceiling
 * and the write fails — and it fails in a way that is genuinely hard to read, because the
 * `bson` driver's own 17MB serialization buffer overflows first:
 *
 *     RangeError [ERR_OUT_OF_RANGE]: The value of "offset" is out of range.
 *     It must be >= 0 && <= 17825792. Received 17825807
 *
 * Production, 2026-08-21: `negativeKeywords` had not saved since 2026-08-09 for the largest
 * account, failing with exactly this on every run.
 *
 * WHY `metricDate` DOES NOT FIX IT. `NegetiveKeywords` already had a `metricDate` and a
 * unique partial index and still crashed. Per-day partitioning only bounds size when one
 * day genuinely is one day of rows (a date-wise report). A negative-keyword snapshot is
 * every negative across every campaign — one day of it is the whole thing.
 *
 * THE SHAPE. Below the threshold, nothing changes: rows stay inline on the primary
 * document exactly as before, byte-for-byte. Only oversized snapshots spill — the primary
 * document becomes a flagged header (`isChunked: true`, empty array) and the rows are
 * written across N chunk documents. Readers reassemble transparently via
 * `loadLatestSnapshotDoc` in utils/ppcSnapshotLoader.js, so no call site changes.
 *
 * Keeping the inline path identical is deliberate: it is what lets existing suites (e.g.
 * negativeKeywordsChunking.test.js, whose fixtures are small) keep passing unmodified.
 */

const logger = require('./Logger.js');

/**
 * Rows per chunk document. Matches KEYWORD_CHUNK_SIZE in Services/AmazonAds/Keywords.js.
 *
 * Sized from measured production bytes-per-row so one chunk stays far below 16MB for every
 * snapshot shape that uses this: campaigns ~281 B/row (≈2.8MB), negative keywords ~179
 * (≈1.8MB), ad groups ~150 (≈1.5MB).
 */
const SNAPSHOT_CHUNK_SIZE = Math.max(
    1,
    parseInt(process.env.SNAPSHOT_CHUNK_SIZE || '10000', 10) || 10000
);

/**
 * Persist one entity snapshot, chunking only when it is too large for a single document.
 *
 * Stale chunks for the same key are always cleared FIRST, so an account whose set shrank
 * (or which drops below the threshold and goes back inline) never leaves orphaned
 * higher-index chunks behind for the reader to glue on.
 *
 * @param {object}   opts
 * @param {import('mongoose').Model} opts.Model       primary snapshot model
 * @param {import('mongoose').Model} opts.ChunkModel  overflow model for this snapshot
 * @param {string}   opts.dataField                   array field name, same on both models
 * @param {string|object} opts.userId
 * @param {string}   opts.country
 * @param {string}   opts.region
 * @param {string}   opts.metricDate                  YYYY-MM-DD snapshot day
 * @param {Array}    opts.rows
 * @param {number}   [opts.chunkSize=SNAPSHOT_CHUNK_SIZE]
 * @param {string}   [opts.label]                     for logging only
 * @returns {Promise<object>} the primary (header) document
 */
async function persistChunkedSnapshot({
    Model,
    ChunkModel,
    dataField,
    userId,
    country,
    region,
    metricDate,
    rows,
    chunkSize = SNAPSHOT_CHUNK_SIZE,
    label = null,
}) {
    if (!Model || !ChunkModel || !dataField) {
        throw new Error('persistChunkedSnapshot requires Model, ChunkModel and dataField');
    }
    const userIdStr = String(userId);
    const allRows = Array.isArray(rows) ? rows : [];
    const name = label || Model.modelName;

    const key = { userId: userIdStr, country, region, metricDate };

    // Always clear first — see the note above about shrinking sets.
    await ChunkModel.deleteMany(key);

    if (allRows.length <= chunkSize) {
        // Inline: identical to the pre-chunking write.
        return Model.findOneAndUpdate(
            key,
            {
                $set: {
                    ...key,
                    [dataField]: allRows,
                    isChunked: false,
                    totalChunks: 1,
                },
            },
            { new: true, upsert: true, runValidators: true }
        );
    }

    const totalChunks = Math.ceil(allRows.length / chunkSize);
    // Sequential on purpose: awaiting one chunk at a time keeps the event loop — and with
    // it the BullMQ lock-renewal heartbeat — breathing between batches.
    for (let c = 0; c < totalChunks; c++) {
        const slice = allRows.slice(c * chunkSize, (c + 1) * chunkSize);
        await ChunkModel.updateOne(
            { ...key, chunkIndex: c },
            { $set: { ...key, chunkIndex: c, totalChunks, [dataField]: slice } },
            { upsert: true }
        );
    }

    // Header last: until it says `isChunked: true`, readers keep using the previous inline
    // rows rather than a half-written chunk set.
    const header = await Model.findOneAndUpdate(
        key,
        {
            $set: {
                ...key,
                [dataField]: [],
                isChunked: true,
                totalChunks,
            },
        },
        { new: true, upsert: true }
    );

    logger.info(`[snapshotChunkStore] ${name} stored across ${totalChunks} chunk(s)`, {
        userId: userIdStr, country, region, metricDate, rows: allRows.length, totalChunks,
    });
    return header;
}

module.exports = { persistChunkedSnapshot, SNAPSHOT_CHUNK_SIZE };

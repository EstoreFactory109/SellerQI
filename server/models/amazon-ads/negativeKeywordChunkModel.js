const mongoose = require('mongoose');

/**
 * negativeKeywordChunkModel.js
 *
 * Overflow storage for the negative-keyword snapshot (see NegetiveKeywords.js).
 *
 * Same design as keywordChunkModel.js, for the same reason: a single MongoDB document is
 * capped at 16MB, and an account with a very large negative-keyword set overflows that when
 * the whole set is written into one `NegativeKeywords.negativeKeywordsData` array. In
 * production this failed loudly but unhelpfully — the bson driver's own 17MB serialization
 * buffer overflows first, producing
 * `ERR_OUT_OF_RANGE ... must be >= 0 && <= 17825792` — and the largest account had not
 * saved negatives since 2026-08-09 as a result.
 *
 * Normal-sized accounts keep storing their negatives inline in the primary
 * `NegativeKeywords` document exactly as before. Only oversized snapshots are split: the
 * primary doc is flagged `isChunked: true` with `negativeKeywordsData: []`, and the full set
 * is written here as N chunk documents (same userId/country/region/metricDate, distinct
 * `chunkIndex`). Readers reassemble via `loadLatestSnapshotDoc`.
 */

const negativeKeywordChunkSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    country: {
        type: String,
        required: true
    },
    region: {
        type: String
    },
    /** YYYY-MM-DD snapshot day — matches the primary NegativeKeywords doc's metricDate. */
    metricDate: {
        type: String,
        required: true
    },
    /** 0-based position of this chunk within the snapshot. */
    chunkIndex: {
        type: Number,
        required: true
    },
    /** Total number of chunks that make up this snapshot. */
    totalChunks: {
        type: Number,
        required: true
    },
    negativeKeywordsData: [
        {
            campaignId: { type: String, required: true },
            // Not required: campaign-level negatives legitimately have no ad group and
            // write ''. Mongoose treats '' as missing for a required String.
            adGroupId: { type: String, required: false, default: '' },
            keywordId: { type: String, required: true },
            keywordText: { type: String, required: true },
            state: { type: String, default: 'enabled' },
            // Omit the per-row _id mongoose would otherwise stamp: ~17 bytes x tens of
            // thousands of rows is pure overhead, and nothing reads it.
            _id: false
        }
    ]
}, { timestamps: true });

// One document per (account, snapshot day, chunk).
negativeKeywordChunkSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1, chunkIndex: 1 },
    { unique: true }
);

module.exports = mongoose.model('NegativeKeywordChunk', negativeKeywordChunkSchema);

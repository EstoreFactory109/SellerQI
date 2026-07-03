const mongoose = require('mongoose');

/**
 * KeywordChunkModel.js
 *
 * Overflow storage for the SP keyword snapshot (see keywordModel.js).
 *
 * A single MongoDB document is capped at 16MB (BSON limit). Accounts with a
 * very large enabled-keyword set (tens of thousands of keywords) overflow that
 * limit when the whole set is written into one `Keyword.keywordData` array,
 * which makes the write fail (silently, in the legacy code path).
 *
 * To stay backwards compatible, normal-sized accounts continue to store their
 * keywords inline in the primary `Keyword` document exactly as before. Only
 * oversized snapshots are split: the primary `Keyword` doc is flagged
 * `isChunked: true` with `keywordData: []`, and the full keyword set is written
 * here as N chunk documents (same userId/country/region/metricDate, distinct
 * `chunkIndex`). Readers reassemble the full set via `loadKeywordSnapshot`.
 */

const keywordChunkSchema = new mongoose.Schema({
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
    /** YYYY-MM-DD snapshot day — matches the primary Keyword doc's metricDate. */
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
    keywordData: [
        {
            keywordId: { type: String, required: true },
            adGroupId: { type: String, required: true },
            campaignId: { type: String, required: true },
            keywordText: { type: String, required: true },
            matchType: { type: String, required: true },
            bid: { type: Number },
            state: { type: String, required: true }
        }
    ]
}, { timestamps: true });

// One document per (account, snapshot day, chunk).
keywordChunkSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1, chunkIndex: 1 },
    { unique: true }
);

module.exports = mongoose.model('KeywordChunk', keywordChunkSchema);

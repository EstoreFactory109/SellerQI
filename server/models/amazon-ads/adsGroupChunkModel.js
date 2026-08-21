const mongoose = require('mongoose');

/**
 * adsGroupChunkModel.js
 *
 * Overflow storage for the ad-group snapshot (see adsgroupModel.js).
 *
 * PREVENTIVE, not remedial — see campaignChunkModel.js for the full reasoning. Ad groups
 * have the most headroom of the four snapshot collections: measured 2026-08-21 the largest
 * is 0.52MB / 3,633 rows at ~150 bytes/row, so it would take roughly 110,000 ad groups to
 * reach MongoDB's 16MB ceiling. It is wired up because the shape is identical to the two
 * collections that already failed and the helper is now shared, not because it is close.
 *
 * Rows stay inline on the primary AdsGroup document below the threshold. Only oversized
 * snapshots spill here, and `loadLatestSnapshotDoc` reassembles them transparently.
 */

const adsGroupChunkSchema = new mongoose.Schema({
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
    /** YYYY-MM-DD snapshot day — matches the primary AdsGroup doc's metricDate. */
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
    // Mirrors adsgroupModel.adsGroupData.
    adsGroupData: [
        {
            adGroupId: { type: String, required: true },
            name: { type: String, required: true },
            campaignId: { type: String, required: true },
            defaultBid: { type: Number, required: true },
            state: { type: String, required: true },
            _id: false
        }
    ]
}, { timestamps: true });

// One document per (account, snapshot day, chunk).
adsGroupChunkSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1, chunkIndex: 1 },
    { unique: true }
);

module.exports = mongoose.model('AdsGroupChunk', adsGroupChunkSchema);

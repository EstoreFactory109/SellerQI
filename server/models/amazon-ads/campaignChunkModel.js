const mongoose = require('mongoose');

/**
 * campaignChunkModel.js
 *
 * Overflow storage for the campaign snapshot (see CampaignModel.js).
 *
 * PREVENTIVE, not remedial. Unlike keywords and negative keywords, campaigns have not yet
 * hit MongoDB's 16MB document ceiling — measured 2026-08-21 the largest is 1.44MB / 5,390
 * rows at ~281 bytes/row, so it would take roughly 59,000 campaigns to fail. But the shape
 * is identical to the two collections that DID fail (a whole entity set written into one
 * array field with a wholesale `$set` in GetCampaigns.js), and the failure mode is a
 * cryptic driver-level `ERR_OUT_OF_RANGE` rather than anything that names the real cause.
 * Wiring it up now costs almost nothing because the helper already exists.
 *
 * Rows stay inline on the primary Campaign document below the threshold — byte-identical to
 * the previous behaviour. Only oversized snapshots spill here, flagged by `isChunked: true`
 * on the primary doc, and are reassembled transparently by `loadLatestSnapshotDoc`.
 */

const campaignChunkSchema = new mongoose.Schema({
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
    /** YYYY-MM-DD snapshot day — matches the primary Campaign doc's metricDate. */
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
    // Mirrors CampaignModel.campaignData. `campaignType`, `premiumBidAdjustment` and
    // `dailyBudget` stay optional for the same reason as the primary schema: Amazon SP v3
    // `/sp/campaigns/list` no longer returns them.
    campaignData: [
        {
            campaignId: { type: String, required: true },
            name: { type: String, required: true },
            campaignType: { type: String, required: false },
            targetingType: { type: String, required: true },
            premiumBidAdjustment: { type: String, required: false },
            dailyBudget: { type: Number, required: false },
            startDate: { type: String, required: true },
            state: { type: String, required: true },
            _id: false
        }
    ]
}, { timestamps: true });

// One document per (account, snapshot day, chunk).
campaignChunkSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1, chunkIndex: 1 },
    { unique: true }
);

module.exports = mongoose.model('CampaignChunk', campaignChunkSchema);

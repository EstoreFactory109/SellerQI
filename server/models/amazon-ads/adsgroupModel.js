const mongoose = require('mongoose');

const adsgroupSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    country: {
        type: String,
        required: true
    },
    region:{
        type: String,
        required: true
    },
    metricDate: {
        type: String,
        required: false,
        index: true
    },
    /**
     * When true, this snapshot exceeded the inline threshold, so `adsGroupData` here is
     * empty and the full set lives in the AdsGroupChunk collection (`totalChunks`
     * documents). `loadLatestSnapshotDoc` reassembles transparently. Defaults to false →
     * legacy inline behaviour, unchanged. See utils/snapshotChunkStore.js.
     */
    isChunked: {
        type: Boolean,
        default: false
    },
    /** Number of AdsGroupChunk documents for this snapshot (1 when inline). */
    totalChunks: {
        type: Number,
        default: 1
    },
    adsGroupData:[{
        adGroupId: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        campaignId: {
            type: String,
            required: true
        },
        defaultBid: {
            type: Number,
            required: true
        },
        state: {
            type: String,
            required: true
        }
    }]
},{timestamps:true});

// Compound index for efficient queries
adsgroupSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
adsgroupSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1 },
    {
        unique: true,
        partialFilterExpression: { metricDate: { $exists: true, $type: 'string' } }
    }
);

const AdsGroup = mongoose.model('AdsGroup', adsgroupSchema);

module.exports = AdsGroup;
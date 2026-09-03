const mongoose = require('mongoose');

const negativeKeywordsSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    region: { type: String, required: true },
    country: { type: String, required: true },
    metricDate: { type: String, required: false, index: true },
    /**
     * When true, this snapshot was too large for a single 16MB document, so
     * `negativeKeywordsData` here is empty and the full set lives in the
     * NegativeKeywordChunk collection (`totalChunks` documents). Readers go through
     * `loadLatestSnapshotDoc`, which reassembles transparently. Defaults to false →
     * legacy inline behaviour, unchanged.
     *
     * NOTE `metricDate` alone did NOT solve the size problem here. This collection has had
     * a metricDate and a unique partial index all along and still failed, because a
     * negative-keyword snapshot is every negative across every campaign — partitioning it
     * by day does not make one day any smaller. See utils/snapshotChunkStore.js.
     */
    isChunked: { type: Boolean, default: false },
    /** Number of NegativeKeywordChunk documents for this snapshot (1 when inline). */
    totalChunks: { type: Number, default: 1 },
    negativeKeywordsData: [
        {
            campaignId: { type: String, required: true },
            // NOT required: campaign-level negatives have no ad group and deliberately
            // write '' (NegetiveKeywords.js), which mongoose treats as missing for a
            // required String. Previously this only ever passed because the write omitted
            // `runValidators`; relaxing it lets validation actually run.
            adGroupId: { type: String, required: false, default: '' },
            keywordId: { type: String, required: true },
            keywordText: { type: String, required: true },
            state: { type: String, default: "enabled" },
            // Drop the per-row _id mongoose would otherwise stamp — ~17 bytes x 53,000
            // rows on the largest account is ~0.9MB of pure overhead, and nothing reads it.
            _id: false
        }
    ]
}, {timestamps: true});

// Compound index for efficient queries
negativeKeywordsSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
negativeKeywordsSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1 },
    {
        unique: true,
        partialFilterExpression: { metricDate: { $exists: true, $type: 'string' } }
    }
);

const NegativeKeywords = mongoose.model('NegativeKeywords', negativeKeywordsSchema);

module.exports = NegativeKeywords;
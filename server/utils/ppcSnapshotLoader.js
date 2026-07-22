/**
 * Load the latest snapshot document for collections that store one row per metricDate
 * (campaigns, ad groups, negative keywords) with legacy fallback (no metricDate).
 *
 * @param {import('mongoose').Model} Model
 * @param {string} userIdStr
 * @param {string} country
 * @param {string} region
 */
async function loadLatestSnapshotDoc(Model, userIdStr, country, region) {
    const withMetric = await Model.findOne({
        userId: userIdStr,
        country,
        region,
        metricDate: { $exists: true, $ne: null, $type: 'string' }
    })
        .sort({ metricDate: -1 })
        .lean();
    if (withMetric) return withMetric;
    return Model.findOne({ userId: userIdStr, country, region }).sort({ createdAt: -1 }).lean();
}

/**
 * Load the latest keyword snapshot, transparently reassembling chunked
 * snapshots so callers always receive a single doc-shaped object whose
 * `keywordData` is the full keyword set.
 *
 * - Normal (inline) snapshots: returns the primary Keyword doc unchanged.
 * - Oversized (chunked) snapshots (`isChunked: true`): merges all KeywordChunk
 *   documents for the same metricDate, in order, into `keywordData`.
 *
 * @param {string} userIdStr
 * @param {string} country
 * @param {string} region
 */
async function loadKeywordSnapshot(userIdStr, country, region) {
    const KeywordModel = require('../models/amazon-ads/keywordModel.js');
    const doc = await loadLatestSnapshotDoc(KeywordModel, userIdStr, country, region);
    if (!doc || !doc.isChunked) return doc;

    const KeywordChunkModel = require('../models/amazon-ads/keywordChunkModel.js');
    const chunks = await KeywordChunkModel.find({
        userId: userIdStr,
        country,
        region,
        metricDate: doc.metricDate
    })
        .sort({ chunkIndex: 1 })
        .lean();

    const keywordData = [];
    for (const chunk of chunks) {
        if (Array.isArray(chunk.keywordData)) keywordData.push(...chunk.keywordData);
    }
    return { ...doc, keywordData };
}

module.exports = { loadLatestSnapshotDoc, loadKeywordSnapshot };

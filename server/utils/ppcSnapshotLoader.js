/**
 * Loaders for the PPC "entity snapshot" collections — campaigns, ad groups, keywords,
 * negative keywords. Each stores one snapshot per `metricDate`, with a legacy fallback for
 * documents written before the per-day migration.
 *
 * These collections also share a size hazard: the whole entity set goes into one array field
 * on one document, which past a certain account size exceeds MongoDB's hard 16MB ceiling.
 * The write side handles that by spilling oversized snapshots into a sibling chunk
 * collection (see utils/snapshotChunkStore.js). THIS file is the read side of that deal:
 * `loadLatestSnapshotDoc` reassembles chunked snapshots transparently, so every existing
 * caller keeps working unchanged and no reader has to know chunking exists.
 *
 * That transparency is the point. Both negative-keyword readers
 * (Analyse.js, PPCCampaignAnalysisService.getCampaignsWithoutNegatives) flatten
 * `doc.negativeKeywordsData` directly and assume the whole set is present — and the second
 * builds a "campaigns that have negatives" Set, so a partial read would report campaigns as
 * having NO negatives, false-positively. Centralising reassembly here is what keeps that
 * safe.
 */

/**
 * Snapshot models that support overflow chunking: primary model name → its chunk model and
 * shared array field. Lazily required so this module stays cheap to load and cannot create
 * a require cycle with the models.
 *
 * A model absent from this registry simply never reassembles — `isChunked` will be
 * undefined on its documents, so the fast path returns them untouched.
 */
const CHUNKED_SNAPSHOTS = {
    Keyword: {
        dataField: 'keywordData',
        chunkModel: () => require('../models/amazon-ads/keywordChunkModel.js'),
    },
    NegativeKeywords: {
        dataField: 'negativeKeywordsData',
        chunkModel: () => require('../models/amazon-ads/negativeKeywordChunkModel.js'),
    },
    Campaign: {
        dataField: 'campaignData',
        chunkModel: () => require('../models/amazon-ads/campaignChunkModel.js'),
    },
    AdsGroup: {
        dataField: 'adsGroupData',
        chunkModel: () => require('../models/amazon-ads/adsGroupChunkModel.js'),
    },
};

/**
 * Reassemble a chunked snapshot into the doc-shaped object callers expect.
 *
 * Ordered by `chunkIndex` so the merged array matches the order it was written in. Uses
 * `push(...)` per chunk rather than a spread of the whole set: chunk size is bounded
 * (10,000), so this cannot blow the call stack the way spreading 80,000 rows would.
 */
async function reassembleChunks(doc, entry, userIdStr, country, region) {
    const ChunkModel = entry.chunkModel();
    const chunks = await ChunkModel.find({
        userId: userIdStr,
        country,
        region,
        metricDate: doc.metricDate,
    })
        .sort({ chunkIndex: 1 })
        .lean();

    const rows = [];
    for (const chunk of chunks) {
        const part = chunk?.[entry.dataField];
        if (Array.isArray(part)) rows.push(...part);
    }
    return { ...doc, [entry.dataField]: rows };
}

/**
 * Load the latest snapshot document for a per-metricDate collection, with legacy fallback,
 * transparently reassembling an oversized (chunked) snapshot.
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

    const doc = withMetric
        || await Model.findOne({ userId: userIdStr, country, region }).sort({ createdAt: -1 }).lean();

    // Fast path: not chunked (including every legacy document, where the flag is absent).
    if (!doc || !doc.isChunked) return doc;

    const entry = CHUNKED_SNAPSHOTS[Model.modelName];
    // Flagged but unregistered: return as-is rather than silently inventing an empty set.
    if (!entry) return doc;

    return reassembleChunks(doc, entry, userIdStr, country, region);
}

/**
 * Load the latest keyword snapshot.
 *
 * Kept as a named export because several call sites use it directly; `loadLatestSnapshotDoc`
 * now handles the chunk reassembly this function used to do itself.
 */
async function loadKeywordSnapshot(userIdStr, country, region) {
    const KeywordModel = require('../models/amazon-ads/keywordModel.js');
    return loadLatestSnapshotDoc(KeywordModel, userIdStr, country, region);
}

module.exports = { loadLatestSnapshotDoc, loadKeywordSnapshot, CHUNKED_SNAPSHOTS };

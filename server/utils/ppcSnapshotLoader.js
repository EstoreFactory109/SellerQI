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

module.exports = { loadLatestSnapshotDoc };

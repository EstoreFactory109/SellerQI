const mongoose = require("mongoose");

/**
 * Sponsored Products targets (product targets and auto-campaign targets) with their
 * current bid and 14 days of spend, sales and clicks. Written weekly by AdsTargets.js.
 * Lets an ACoS-above-break-even task propose bid cuts on targets too, not only on
 * keywords. Only targets that spent in the window are kept.
 */
const targetSchema = new mongoose.Schema({
    targetId: { type: String, required: true },
    campaignId: { type: String, default: "" },
    adGroupId: { type: String, default: "" },
    // Amazon's own text for the target, e.g. "close-match" or asin="B0..."
    expression: { type: String, default: "" },
    keywordType: { type: String, default: "" },
    // null when the target uses its ad group's default bid
    bid: { type: Number, default: null },
    cost: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 }
}, { _id: false });

const adsTargetSnapshotSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        country: { type: String, required: true },
        region: { type: String, required: true },
        windowStart: { type: String, default: "" },
        windowEnd: { type: String, default: "" },
        targets: { type: [targetSchema], default: [] },
        // Amazon's budget recommendations for enabled campaigns (7-day time in budget,
        // suggested budget, estimated missed sales); null when the read failed.
        budgetRecs: { type: mongoose.Schema.Types.Mixed, default: null },
        targetCount: { type: Number, default: 0 }
    },
    { timestamps: true }
);

adsTargetSnapshotSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
// Only the newest matters; older snapshots expire.
adsTargetSnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: 35 * 24 * 60 * 60 });

module.exports = mongoose.model("AdsTargetSnapshot", adsTargetSnapshotSchema);

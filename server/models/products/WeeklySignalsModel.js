const mongoose = require("mongoose");

/**
 * Weekly reads for three tasks-logics.xlsx checks, one document per run:
 * - featuredOffers: Amazon's featured offer expected price for SKUs losing the Buy Box
 *   ("Priced above featured offer expected price")
 * - subscribeSave: the seller's Subscribe & Save offers and their status
 * - placementFees: inbound placement fees on plans created in the last 30 days
 * - sellerFeedback: 1-2 star seller feedback of the last 60 days, per order
 * Each part is null when its read failed (not "nothing found").
 */
const weeklySignalsSchema = new mongoose.Schema(
    {
        User: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        country: { type: String, required: true },
        region: { type: String, required: true },
        featuredOffers: { type: mongoose.Schema.Types.Mixed, default: null },
        subscribeSave: { type: mongoose.Schema.Types.Mixed, default: null },
        placementFees: { type: mongoose.Schema.Types.Mixed, default: null },
        sellerFeedback: { type: mongoose.Schema.Types.Mixed, default: null }
    },
    { timestamps: true }
);

weeklySignalsSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });
weeklySignalsSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model("WeeklySignals", weeklySignalsSchema);

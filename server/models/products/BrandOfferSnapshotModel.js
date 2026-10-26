const mongoose = require("mongoose");

/**
 * Who offers on the seller's own brand listings, one document per weekly check.
 *
 * WHY THIS EXISTS
 * tasks-logics.xlsx "New seller on brand listing": another seller starting to
 * offer on a brand-owner's ASIN can mean a hijacker or a counterfeit. Spotting a
 * NEW seller needs last week's list to compare with, so each check is kept.
 *
 * Separate from CompetitiveOffers on purpose: that collection holds the Buy Box
 * report's contested-ASIN pricing, and the ESF report reads its newest document.
 * A weekly brand check writing there would replace what that report shows.
 *
 * Only seller IDs are kept per ASIN (not prices): enough to tell a new seller
 * from a known one, small enough for 200 ASINs a week.
 */
const itemSchema = new mongoose.Schema({
    asin: { type: String, required: true },
    // Other sellers' IDs offering on this ASIN (our own offer excluded).
    sellerIds: { type: [String], default: [] },
    offerCount: { type: Number, default: 0 },
    // Amazon returned nothing usable for this ASIN; not the same as "no other sellers".
    error: { type: String, default: "" }
}, { _id: false });

const brandOfferSnapshotSchema = new mongoose.Schema(
    {
        User: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        region: { type: String, required: true },
        country: { type: String, required: true },
        brand: { type: String, default: "" },
        items: { type: [itemSchema], default: [] },
        asinsRequested: { type: Number, default: 0 },
        // False when no offer in the fetch carried a seller ID: then "no new seller"
        // cannot be told from "Amazon withheld identities", and nothing is judged.
        sellerIdsReturned: { type: Boolean, default: false }
    },
    { timestamps: true }
);

brandOfferSnapshotSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model("BrandOfferSnapshot", brandOfferSnapshotSchema);

const mongoose = require("mongoose");

/**
 * Amazon's Suppressed Listings Report (GET_MERCHANTS_LISTINGS_FYP_REPORT).
 *
 * WHY THIS EXISTS
 * The catalogue stores a listing status of Active, Inactive or Incomplete, and
 * none of those is "suppressed" — so the Weekly Account Overview could not say
 * how many listings Amazon was hiding from shoppers, and said so. This is the
 * report Amazon publishes for exactly that question, with the reason per SKU.
 *
 * It complements, not replaces, the enforcement actions on each listing's
 * issues (sellerCentral products[].listingIssues): those arrive per SKU on the
 * weekly catalogue sync, this arrives for the whole catalogue in one file.
 *
 * SNAPSHOT TRAIL, NOT A LIVE ROW
 * One document per fetch per marketplace, same as the other report sources.
 *
 * EMPTY IS A REAL ANSWER HERE
 * A fetch that returns no rows is stored, with `items: []`. For this report
 * "nothing in it" means "nothing suppressed", which is an all-clear worth
 * showing — unlike "never fetched", which has no document at all.
 */

const itemSchema = new mongoose.Schema({
    sku: { type: String, default: "" },
    asin: { type: String, default: "" },
    productName: { type: String, default: "" },
    // Amazon's own words: "Search Suppressed", "Blocked", "At Risk"...
    status: { type: String, default: "" },
    reason: { type: String, default: "" },
    issueDescription: { type: String, default: "" },
    condition: { type: String, default: "" },
    statusChangeDate: { type: String, default: "" },
    // "At risk" listings are still visible; everything else in this report is
    // not. Decided once at parse time so every reader agrees.
    isAtRisk: { type: Boolean, default: false }
}, { _id: false });

const suppressedListingsSchema = new mongoose.Schema(
    {
        User: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        region: { type: String, required: true },
        country: { type: String, required: true },
        items: { type: [itemSchema], default: [] },
        // Rows Amazon returned, which can exceed `items` when capped — see the
        // fetcher. The report counts from this, not from items.length.
        itemCount: { type: Number, default: 0 },
        suppressedCount: { type: Number, default: 0 },
        atRiskCount: { type: Number, default: 0 },
        // What Amazon actually sent, so a header mismatch can be diagnosed
        // from the data instead of guessed at.
        headers: { type: [String], default: [] },
        // True when no SKU column could be found. The rows are then unusable,
        // and the report must not read them as "none suppressed".
        unreadable: { type: Boolean, default: false }
    },
    { timestamps: true }
);

suppressedListingsSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model("SuppressedListings", suppressedListingsSchema);

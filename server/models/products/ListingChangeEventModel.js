const mongoose = require("mongoose");

/**
 * A change seen on one of the seller's listings between two syncs (tasks-logics.xlsx
 * "Detail page changed without us"). Title and price come from the daily listings
 * report; bullet points, main image and brand from the weekly listing sync.
 * `sellerConfirmed` is set when the seller says the change was theirs.
 */
const listingChangeEventSchema = new mongoose.Schema(
    {
        User: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        country: { type: String, required: true },
        region: { type: String, required: true },
        asin: { type: String, required: true },
        sku: { type: String, default: "" },
        // title | price | bulletpoints | main_image | brand
        field: { type: String, required: true },
        oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
        newValue: { type: mongoose.Schema.Types.Mixed, default: null },
        source: { type: String, default: "" },
        sellerConfirmed: { type: Boolean, default: false }
    },
    { timestamps: true }
);

listingChangeEventSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });
// Old events are only history; the check reads the last week.
listingChangeEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model("ListingChangeEvent", listingChangeEventSchema);

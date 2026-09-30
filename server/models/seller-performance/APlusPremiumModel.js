const mongoose = require("mongoose");

/**
 * A+ content read from Amazon's own A+ Content API.
 *
 * WHY THIS IS A SEPARATE COLLECTION FROM APlusContent
 * APlusContent is filled by a third-party scraper (see NumberOfProductReviews.js)
 * which only knows whether a listing has A+ at all, and writes every record as
 * status "APPROVED". Many places read that collection — PageWiseDataController,
 * QMateProductsService, ProductContentChangeAlertService, Analyse.js and the ESF
 * reports — and they all take the latest document for a user and marketplace.
 *
 * Adding a second writer to that collection would mean whichever job ran last
 * decides what those readers see, with two different shapes in play. So the
 * official API writes here instead: the scraper keeps working untouched, and
 * anything that wants the Premium distinction reads this.
 *
 * Retiring the scraper is a separate decision. Nothing here forces it.
 */

const aPlusDocumentSchema = new mongoose.Schema({
    asin: {
        type: String,
        required: true
    },
    // Amazon's handle for the content document itself. One document can be
    // published against many ASINs, which is why the mapping is stored per ASIN.
    contentReferenceKey: {
        type: String,
        default: ""
    },
    // EBC (standard Enhanced Brand Content) or EMC (Premium). Kept alongside the
    // badge because the two do not always agree, and the badge is the one Amazon
    // treats as the eligibility tier.
    contentType: {
        type: String,
        default: ""
    },
    // Everything Amazon returned in the badge set, so a new badge value is not
    // silently lost just because this code did not know about it.
    badges: {
        type: [String],
        default: []
    },
    // Derived from the badge set. The single flag the Listings Audit reports.
    isPremium: {
        type: Boolean,
        default: false
    },
    // APPROVED / DRAFT / SUBMITTED — a draft is not live on the listing.
    status: {
        type: String,
        default: ""
    },
    name: {
        type: String,
        default: ""
    }
}, { _id: false });

const APlusPremiumSchema = new mongoose.Schema(
    {
        User: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        region: {
            type: String,
            required: true
        },
        country: {
            type: String,
            required: true
        },
        documents: {
            type: [aPlusDocumentSchema],
            default: []
        },
        // How many content documents Amazon listed, before the per-ASIN
        // expansion. A large gap between this and documents.length means the
        // ASIN lookups were cut short — worth seeing rather than guessing.
        documentsListed: {
            type: Number,
            default: 0
        }
    },
    { timestamps: true }
);

APlusPremiumSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model("APlusPremium", APlusPremiumSchema);

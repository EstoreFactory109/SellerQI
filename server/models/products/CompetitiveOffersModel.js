const mongoose = require("mongoose");

/**
 * Offer-level pricing for the ASINs we are losing the Buy Box on.
 *
 * WHY THIS EXISTS
 * The Weekly Buybox report could say an ASIN was losing, but not to whom or at
 * what price — it carried `competingSeller: null` / `competingPrice: null` and
 * a caveat admitting the offer feed was not connected. BuyBoxData (Data Kiosk)
 * is an aggregate: ownership percentages, sessions, units. It has no offers in
 * it at all, so no amount of work on that collection could answer the question.
 *
 * This holds what Amazon's Product Pricing API returns for the contested ASINs
 * only. Contested only, deliberately: getItemOffersBatch is rate limited to one
 * call per ten seconds, so pricing the whole catalogue would take hours for an
 * answer that is uninteresting on every ASIN we already win.
 *
 * SNAPSHOT TRAIL, NOT A LIVE ROW
 * One document per fetch per marketplace, same as the other report sources, so
 * View History can show what a past edition was actually built from. Prices
 * move daily; overwriting would make last week's report unreproducible.
 *
 * WHAT MAY BE MISSING, AND WHY THAT IS NOT THE SAME AS ZERO
 * Amazon does not always return `SellerId` on an offer. A competitor's price
 * with no identity attached is still the useful half of the answer, so the two
 * are stored independently and the report degrades to "—" for the seller rather
 * than dropping the row. `sellerIdsReturned` records whether ANY offer in the
 * fetch carried an id, which is how a marketplace that withholds identity is
 * told apart from an account that simply has no competitors.
 */

const offerSchema = new mongoose.Schema({
    // Amazon's merchant token for the offer's seller, e.g. A2XXXXXXXXXXXX.
    // Empty when Amazon withheld it — see the note above.
    sellerId: {
        type: String,
        default: ""
    },
    // Listing price plus shipping. The only figure comparable across offers:
    // a cheaper listing with paid delivery is not the cheaper offer.
    landedPrice: {
        type: Number,
        default: null
    },
    listingPrice: {
        type: Number,
        default: null
    },
    shipping: {
        type: Number,
        default: null
    },
    isBuyBoxWinner: {
        type: Boolean,
        default: false
    },
    // True for our own offer. Taken from Amazon's MyOffer flag where present,
    // otherwise from a match against our stored merchant token.
    isOurs: {
        type: Boolean,
        default: false
    },
    isFulfilledByAmazon: {
        type: Boolean,
        default: false
    },
    isPrime: {
        type: Boolean,
        default: false
    },
    // Percentage and count, when Amazon returns them. Useful context for
    // whether a cheaper competitor is one a shopper would actually pick.
    feedbackRating: {
        type: Number,
        default: null
    },
    feedbackCount: {
        type: Number,
        default: null
    }
}, { _id: false });

const asinOffersSchema = new mongoose.Schema({
    asin: {
        type: String,
        required: true
    },
    currency: {
        type: String,
        default: ""
    },
    // The Buy Box holder's landed price. Null means Amazon returned no Buy Box
    // price for this ASIN — which happens when NOBODY holds it, a real state
    // and not a fetch failure.
    buyBoxPrice: {
        type: Number,
        default: null
    },
    buyBoxSellerId: {
        type: String,
        default: ""
    },
    buyBoxIsFba: {
        type: Boolean,
        default: false
    },
    // OUR landed price as Amazon reports it, which is what the Buy Box price
    // must be compared against. The catalogue's `price` field is a list price
    // with no shipping in it, so a gap computed from that one can be wrong by
    // the whole delivery charge.
    ourLandedPrice: {
        type: Number,
        default: null
    },
    lowestPrice: {
        type: Number,
        default: null
    },
    totalOfferCount: {
        type: Number,
        default: 0
    },
    offers: {
        type: [offerSchema],
        default: []
    },
    // Set when Amazon answered for this ASIN but returned nothing usable, so
    // the report can say which ASINs it genuinely could not price.
    error: {
        type: String,
        default: ""
    }
}, { _id: false });

const CompetitiveOffersSchema = new mongoose.Schema(
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
        items: {
            type: [asinOffersSchema],
            default: []
        },
        // How many contested ASINs the fetch was asked for. A gap between this
        // and items.length means the batch cap or the rate limiter cut it
        // short, which the report states rather than silently under-reporting.
        asinsRequested: {
            type: Number,
            default: 0
        },
        // False when not one offer in the whole fetch carried a seller id —
        // i.e. the marketplace withholds identity, not that there is nobody
        // there. Drives which caveat the report prints.
        sellerIdsReturned: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

CompetitiveOffersSchema.index({ User: 1, country: 1, region: 1, createdAt: -1 });

module.exports = mongoose.model("CompetitiveOffers", CompetitiveOffersSchema);

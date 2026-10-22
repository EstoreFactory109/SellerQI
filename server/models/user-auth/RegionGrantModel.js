/**
 * One Amazon region a user has authorised during multi-marketplace onboarding.
 *
 * Amazon authorises per region, and the seller confirms which of that region's marketplaces to
 * add only after the approval comes back. This holds the approval (and what Amazon reported the
 * account sells in) until then, so the connect checklist can resume after a reload or a return
 * visit. The tokens are copied onto each confirmed marketplace's Seller.sellerAccount entry —
 * that entry stays the source of truth for the data pipeline; this is onboarding state only.
 */
const mongoose = require('mongoose');

const participationSchema = new mongoose.Schema({
    country: String,
    marketplaceId: String,
    name: String,
    hasSuspendedListings: { type: Boolean, default: false },
}, { _id: false });

const adsProfileSchema = new mongoose.Schema({
    profileId: String,
    countryCode: String,     // SellerQI code (UK, not GB)
    currencyCode: String,
    name: String,
    type: String,            // seller | vendor | agency
}, { _id: false });

const regionGrantSchema = new mongoose.Schema({
    User: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    region: { type: String, enum: ['NA', 'EU', 'FE'], required: true },
    sellingPartnerId: { type: String, default: null },
    // Never returned by accident: every reader opts in with select('+…').
    spiRefreshToken: { type: String, default: null, select: false },
    adsRefreshToken: { type: String, default: null, select: false },
    // Marketplaces Amazon reported for this authorisation (supported + participating only).
    participations: { type: [participationSchema], default: [] },
    // True when the participations lookup failed: the seller then picks from the region's list.
    discoveryFailed: { type: Boolean, default: false },
    adsProfiles: { type: [adsProfileSchema], default: [] },
    // The seller's main marketplace, when it is in this region. Set from the first approval;
    // it is fetched first and is the marketplace the dashboard opens on.
    primaryCountry: { type: String, default: null },
}, { timestamps: true });

regionGrantSchema.index({ User: 1, region: 1 }, { unique: true });

module.exports = mongoose.models.RegionGrant || mongoose.model('RegionGrant', regionGrantSchema);

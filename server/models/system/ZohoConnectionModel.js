/**
 * ZohoConnectionModel.js
 *
 * Singleton document holding SellerQI's ONE org-wide Zoho Projects connection.
 *
 * This is deliberately not a per-user credential store (unlike Seller.sellerAccount,
 * which holds one spiRefreshToken/adsRefreshToken per customer marketplace). We connect
 * our own internal Zoho portal exactly once; every request through /api/zoho uses it.
 *
 * The refresh token lives here rather than in .env because Zoho revokes refresh tokens
 * fairly readily (scope change, the 20-token-per-user cap, a manual revoke in the Zoho
 * console). Storing it in Mongo means recovery is "an admin re-runs the connect flow",
 * not "someone edits .env and redeploys".
 */

const mongoose = require('mongoose');

// The one and only key. Every read/write is scoped to it, and the unique index is what
// actually enforces the singleton — findOneAndUpdate({key: SINGLETON_KEY}, ..., {upsert:true})
// can never create a second row.
const SINGLETON_KEY = 'zoho_projects';

const ZohoConnectionSchema = new mongoose.Schema({
    // `unique: true` builds the index that enforces the singleton. Do NOT also add an
    // explicit schema.index({key:1}) — Mongoose warns about the duplicate definition.
    key: {
        type: String,
        default: SINGLETON_KEY,
        unique: true,
        required: true
    },
    // Long-lived OAuth refresh token. select:false so it never leaks into a status
    // response or a stray .find() — ZohoAuth reads it with an explicit
    // .select('+refreshToken'). Existing tokens in this repo are stored plainly, but
    // this one is an internal org credential shared by every user of the endpoint.
    refreshToken: {
        type: String,
        required: false,
        select: false
    },
    // Zoho is data-center partitioned (.com / .eu / .in / .com.au / .jp / .ca) and a
    // token minted against one DC is rejected by another. Both domains are captured
    // from the token exchange rather than hardcoded.
    apiDomain: {
        type: String,
        required: false
    },
    accountsDomain: {
        type: String,
        required: false
    },
    // The portal all project operations run against, resolved from /portals at connect time.
    portalId: {
        type: String,
        required: false
    },
    portalName: {
        type: String,
        required: false
    },
    scopes: {
        type: [String],
        default: []
    },
    connectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    connectedAt: {
        type: Date,
        required: false
    },
    lastRefreshAt: {
        type: Date,
        required: false
    },
    // Last auth failure seen while minting an access token, so /status can explain a
    // broken connection without needing the logs.
    lastError: {
        type: String,
        required: false
    }
}, { timestamps: true });

const ZohoConnection = mongoose.models.ZohoConnection || mongoose.model('ZohoConnection', ZohoConnectionSchema);

module.exports = ZohoConnection;
module.exports.SINGLETON_KEY = SINGLETON_KEY;

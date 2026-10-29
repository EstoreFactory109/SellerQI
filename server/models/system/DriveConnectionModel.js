/**
 * DriveConnectionModel.js
 *
 * Singleton holding the ONE Google Drive the ESF report PDFs are saved to
 * (Services/GoogleDrive). Same shape and reasoning as GmailConnectionModel.js: unique key
 * enforces the singleton, the refresh token is `select: false`, and recovery is "an admin
 * reconnects" rather than an .env edit.
 */

const mongoose = require('mongoose');

const SINGLETON_KEY = 'gdrive_reports';

const DriveConnectionSchema = new mongoose.Schema({
    key: { type: String, default: SINGLETON_KEY, unique: true, required: true },

    /** Read only via `.select('+refreshToken')`. Expires after 7 days if the OAuth app is in "Testing". */
    refreshToken: { type: String, required: false, select: false },

    /** The Google account the Drive belongs to, from about.get at connect time. */
    emailAddress: { type: String, default: null },

    /**
     * "SellerQI Reports", created by SellerQI on first use (drive.file cannot see a folder
     * made by hand). Kept across reconnects of the SAME account; cleared when a different
     * account connects, whose Drive does not have it.
     */
    rootFolderId: { type: String, default: null },

    scopes: { type: [String], default: [] },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    connectedAt: { type: Date, default: null },
    lastRefreshAt: { type: Date, default: null },

    /** Last save that worked, so the portal can show the archive is alive. */
    lastSavedAt: { type: Date, default: null },
    /** Last failure (token or upload), shown on the portal card. */
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
}, { timestamps: true });

const DriveConnection = mongoose.models.DriveConnection
    || mongoose.model('DriveConnection', DriveConnectionSchema);

module.exports = DriveConnection;
module.exports.SINGLETON_KEY = SINGLETON_KEY;

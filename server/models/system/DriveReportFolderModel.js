/**
 * DriveReportFolderModel.js
 *
 * Where one ESF client's report PDFs live in the connected Google Drive.
 *
 * Folder ids are stored and reused, never looked up by name on each run: a brand renamed
 * in Zoho renames this folder (history stays together), and a folder someone moved in
 * Drive is still found. `rootFolderId` records which "SellerQI Reports" folder these ids
 * belong to — a different Drive connected later means they are stale and are rebuilt.
 */

const mongoose = require('mongoose');

const DriveReportFolderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    rootFolderId: { type: String, required: true },
    brandFolderId: { type: String, required: true },
    /** The folder's name as last written, so a brand change is noticed and renamed. */
    brandName: { type: String, required: true },
    /** cadence ('weekly'|'biweekly'|'monthly'|'quarterly') -> folder id */
    cadenceFolders: { type: Map, of: String, default: {} },
}, { timestamps: true });

const DriveReportFolder = mongoose.models.DriveReportFolder
    || mongoose.model('DriveReportFolder', DriveReportFolderSchema);

module.exports = DriveReportFolder;

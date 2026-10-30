/**
 * config.js — Google Drive archive of the ESF clients' report PDFs.
 *
 * Every PDF the ESF reports mailer builds is also saved to ONE Google Drive that ESF
 * connects once in the portal (Estore Factory > Google Drive):
 *
 *     SellerQI Reports / <brand> / <Weekly|Bi-weekly|Monthly|Quarterly> / 2026-10-31 <report>.pdf
 *
 * Mirrors Services/Gmail/config.js: credentials from the environment, the refresh token in
 * Mongo (models/system/DriveConnectionModel.js), everything read lazily.
 *
 * Required in .env:
 *   GDRIVE_CLIENT_ID
 *   GDRIVE_CLIENT_SECRET
 *   GDRIVE_REDIRECT_URI      must match the Authorized redirect URI in the Google Cloud
 *                            console EXACTLY, e.g.
 *                            https://members.sellerqi.com/api/gdrive/auth/callback
 *
 * Optional:
 *   GDRIVE_REPORTS_ENABLED   'false' to stop saving reports; default ON (saving starts
 *                            as soon as a Drive is connected)
 *   GDRIVE_ROOT_FOLDER_NAME  default "SellerQI Reports"
 *
 * ── WHY drive.file AND NOTHING WIDER ──
 * `drive.file` lets SellerQI see only the folders and files it created itself. It is not a
 * sensitive scope, so Google does not review the app, and a leaked token cannot read
 * anything else in ESF's Drive. The cost: a folder someone makes by hand is invisible to
 * SellerQI, so the root folder is always created by SellerQI (ReportFolders.js). Moving or
 * renaming SellerQI's folders in Drive is fine — they are tracked by id, not by name.
 *
 * ── WHY A SEPARATE OAUTH CLIENT ──
 * Same reason as Gmail: not `GOOGLE_CLIENT_ID`, so a problem with this client can never
 * take Google sign-in down with it. (The Gmail client could be reused instead — add the
 * redirect URI to it and point these variables at its id and secret.)
 *
 * ── ONE-TIME GOOGLE CLOUD SETUP ──
 * 1. Enable the Google Drive API in the project.
 * 2. OAuth client (Web application), redirect URI exactly
 *        https://members.sellerqi.com/api/gdrive/auth/callback
 * 3. Consent screen PUBLISHING STATUS "IN PRODUCTION", not "Testing". In Testing Google
 *    expires refresh tokens after 7 days and saving stops with `invalid_grant`.
 *
 * ── TURNING IT ON ──
 * An owner/admin clicks Connect on the Google Drive page and signs in as the ESF Google
 * account; from the next report run on, the PDFs are saved. Nothing is saved before a
 * Drive is connected. To fill a client's folder without waiting or emailing anyone:
 *     node server/Services/BackgroundJobs/esfReportsMailerStandalone.js --run=weekly --drive-only --user=<id>
 *
 * ── ROLLBACK ──
 * GDRIVE_REPORTS_ENABLED=false. Emails are untouched either way, and nothing in Drive is
 * deleted by SellerQI, ever.
 */

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const getCredentials = () => ({
    clientId: process.env.GDRIVE_CLIENT_ID,
    clientSecret: process.env.GDRIVE_CLIENT_SECRET,
    redirectUri: process.env.GDRIVE_REDIRECT_URI,
});

/**
 * Kill switch, default ON. Saving still needs a connected Drive (ReportArchive.archiveReadiness),
 * so until someone clicks Connect this changes nothing.
 */
const isReportsArchiveEnabled = () => String(process.env.GDRIVE_REPORTS_ENABLED || '').trim().toLowerCase() !== 'false';

const rootFolderName = () => (process.env.GDRIVE_ROOT_FOLDER_NAME || '').trim() || 'SellerQI Reports';

const REQUEST_TIMEOUT_MS = 30000;
// A report PDF is a few hundred KB; the largest audit is a few MB.
const UPLOAD_TIMEOUT_MS = 120000;
const TOKEN_REQUEST_TIMEOUT_MS = 15000;

module.exports = {
    getCredentials,
    isReportsArchiveEnabled,
    rootFolderName,
    SCOPES,
    AUTH_ENDPOINT,
    TOKEN_ENDPOINT,
    REVOKE_ENDPOINT,
    API_BASE,
    UPLOAD_BASE,
    FOLDER_MIME,
    REQUEST_TIMEOUT_MS,
    UPLOAD_TIMEOUT_MS,
    TOKEN_REQUEST_TIMEOUT_MS,
};

/**
 * Upload middleware for files attached to a Messages reply or ticket.
 *
 * Modelled on middlewares/multer/zohoUpload.js — same reasoning for disk storage over
 * memory, same refusal of executables — with one limit that is not a preference:
 *
 * ── GMAIL CAPS A WHOLE MESSAGE AT 25MB, AFTER BASE64 ──
 * Attachments are base64 encoded in the MIME body, which inflates them by about a
 * third. So 25MB of Gmail budget is roughly 18MB of actual file, shared across every
 * attachment plus the message text. The Zoho middleware's 50MB-per-file would let a
 * client pick two videos and get a rejection from Google after the upload had already
 * finished — a slow, confusing failure at the very end. The per-file limit here is set
 * so that even the maximum number of maximum-size files stays inside the envelope.
 *
 * Disk rather than memory, per the Zoho note: buffering several files per concurrent
 * request is exactly the memory pressure that has bitten this repo's workers before.
 * The controller reads each file, hands it to Gmail, and is responsible for unlinking
 * it afterwards — including when the send fails.
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uuidv4 = require('uuid').v4;

const tempDir = path.resolve(__dirname, '../../public/temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

const MAX_FILES = 5;
/** 3MB × 5 = 15MB raw ≈ 20MB base64, comfortably inside Gmail's 25MB message ceiling. */
const MAX_FILE_BYTES = 3 * 1024 * 1024;
/** Checked again in the service against the summed total, which multer cannot see. */
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

/**
 * What people actually attach to a support conversation: a screenshot of the problem,
 * a spreadsheet of figures, a signed document, a product photo.
 *
 * Anything executable is refused outright. These files are forwarded into the team's
 * own mailbox and opened there, so relaying one would make this feature a delivery
 * mechanism into the agency's inbox.
 */
const ALLOWED_MIME = [
    /^image\//,
    /^application\/pdf$/,
    /^application\/msword$/,
    /^application\/vnd\.openxmlformats-officedocument\./,
    /^application\/vnd\.ms-excel$/,
    /^text\/csv$/,
    /^text\/plain$/,
];

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempDir),
    // Never trust the client's filename on disk. It reaches Gmail as originalname, but
    // the path we write to is ours alone, so a traversal attempt cannot escape tempDir.
    filename: (_req, file, cb) => cb(null, `gmail-${uuidv4()}${path.extname(file.originalname || '').slice(0, 10)}`),
});

const gmailUpload = multer({
    storage,
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.some((pattern) => pattern.test(file.mimetype || ''))) {
            return cb(null, true);
        }
        const error = new Error(`Files of type ${file.mimetype || 'unknown'} are not accepted`);
        error.code = 'UNSUPPORTED_FILE_TYPE';
        return cb(error);
    },
});

module.exports = gmailUpload;
module.exports.MAX_FILES = MAX_FILES;
module.exports.MAX_FILE_BYTES = MAX_FILE_BYTES;
module.exports.MAX_TOTAL_BYTES = MAX_TOTAL_BYTES;
module.exports.ALLOWED_MIME = ALLOWED_MIME;

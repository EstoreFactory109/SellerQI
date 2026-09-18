/**
 * Upload middleware for client replies that go to a Zoho task.
 *
 * Separate from middlewares/multer/multer.js on purpose: that instance has no size,
 * count, or type limits, which is fine for an internal logo upload but not for a
 * route any ESF client can post to.
 *
 * Disk storage rather than memory: these are the photos and videos an agency asks a
 * client for, and buffering several of them per concurrent request is exactly the kind
 * of memory pressure that has bitten this repo's workers before. The controller streams
 * each file to Zoho and is responsible for unlinking it afterwards.
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
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// What an agency actually asks a client for: product photos, a demo video, a signed
// document, a spreadsheet of figures. Anything executable is rejected outright rather
// than relayed into the team's Zoho portal.
const ALLOWED_MIME = [
    /^image\//,
    /^video\//,
    /^application\/pdf$/,
    /^application\/msword$/,
    /^application\/vnd\.openxmlformats-officedocument\./,
    /^application\/vnd\.ms-excel$/,
    /^text\/csv$/,
    /^text\/plain$/,
];

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempDir),
    // Never trust the client's filename on disk — it reaches Zoho as originalname, but
    // the path we write to is ours alone, so a traversal attempt cannot escape tempDir.
    filename: (_req, file, cb) => cb(null, `zoho-${uuidv4()}${path.extname(file.originalname || '').slice(0, 10)}`),
});

const zohoUpload = multer({
    storage,
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME.some((pattern) => pattern.test(file.mimetype || ''))) {
            return cb(null, true);
        }
        // Surfaced to the client as a readable message by the route's error handler.
        const error = new Error(`Files of type ${file.mimetype || 'unknown'} are not accepted`);
        error.code = 'UNSUPPORTED_FILE_TYPE';
        return cb(error);
    },
});

module.exports = { zohoUpload, MAX_FILES, MAX_FILE_BYTES, tempDir };

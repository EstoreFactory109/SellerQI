/**
 * gdrive.routes.js
 *
 * The Google Drive the ESF clients' report PDFs are saved to. Same auth as
 * gmail.routes.js: behind esfAuth, with connect/disconnect limited to owner/admin in the
 * controller.
 *
 * - GET    /api/gdrive/status         connection health
 * - GET    /api/gdrive/auth/url       consent URL (owner/admin)
 * - GET    /api/gdrive/auth/callback  OAuth redirect target (NO auth — single-use state)
 * - DELETE /api/gdrive/disconnect     forget the connection (owner/admin)
 */

const express = require('express');
const router = express.Router();
const esfAuth = require('../middlewares/Auth/esfAuth.js');
const {
    getDriveStatus,
    startDriveAuth,
    handleDriveCallback,
    disconnectDrive,
} = require('../controllers/integration/GoogleDriveController.js');

router.get('/status', esfAuth, getDriveStatus);
router.get('/auth/url', esfAuth, startDriveAuth);

// Unauthenticated by necessity: the browser lands here from Google without our cookies.
router.get('/auth/callback', handleDriveCallback);

router.delete('/disconnect', esfAuth, disconnectDrive);

module.exports = router;

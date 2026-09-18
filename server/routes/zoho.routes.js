/**
 * zoho.routes.js
 *
 * Routes for the org-wide Zoho Projects integration.
 *
 * These routes are SEPARATE from existing routes and do NOT affect any existing
 * functionality — the only shared file touched is api/app.js, additively.
 *
 * Auth: the whole surface sits behind esfAuth (ESFToken), because Zoho Projects is an
 * internal eStore Factory tool surfaced in the ESF portal, not a seller-facing feature.
 * esfAuth already admits accessType 'superAdmin' alongside 'esfUser', so platform admins
 * keep access without a second code path.
 *
 * Connecting and disconnecting are further limited to owner/admin (see the controller):
 * this is one shared company credential, so a member reconnecting it would silently swap
 * the account out from under everyone.
 *
 * Endpoints:
 * - GET    /api/zoho/status                        - connection status
 * - GET    /api/zoho/auth/url                      - build the consent URL (owner/admin)
 * - GET    /api/zoho/auth/callback                 - OAuth redirect target (no auth)
 * - DELETE /api/zoho/disconnect                    - forget the connection (owner/admin)
 * - GET    /api/zoho/projects                      - list projects
 * - POST   /api/zoho/projects                      - create a project
 * - GET    /api/zoho/projects/:projectId/updates   - tasks, comments, activities, statuses
 */

const express = require('express');
const router = express.Router();
const esfAuth = require('../middlewares/Auth/esfAuth.js');
const {
    validateCreateProject,
    validateProjectIdParam,
    validateCallbackQuery
} = require('../middlewares/validator/zohoValidate.js');
const {
    getZohoStatus,
    startZohoAuth,
    handleZohoCallback,
    disconnectZoho,
    listProjects,
    createProject,
    getProjectTaskUpdates
} = require('../controllers/integration/ZohoProjectsController.js');

// --- Connection lifecycle -------------------------------------------------------------
router.get('/status', esfAuth, getZohoStatus);
router.get('/auth/url', esfAuth, startZohoAuth);

// Unauthenticated by necessity: the browser lands here via a redirect from Zoho, which
// does not carry our SameSite cookies. The single-use CSRF state is what protects it.
router.get('/auth/callback', validateCallbackQuery, handleZohoCallback);

router.delete('/disconnect', esfAuth, disconnectZoho);

// --- Project operations ---------------------------------------------------------------
router.get('/projects', esfAuth, listProjects);
router.post('/projects', esfAuth, validateCreateProject, createProject);
router.get('/projects/:projectId/updates', esfAuth, validateProjectIdParam, getProjectTaskUpdates);

module.exports = router;

/**
 * zoho.routes.js
 *
 * Routes for the org-wide Zoho Projects integration.
 *
 * These routes are SEPARATE from existing routes and do NOT affect any existing
 * functionality — the only shared file touched is api/app.js, additively.
 *
 * Endpoints:
 * - GET    /api/zoho/status                        - connection status (admin)
 * - GET    /api/zoho/auth/url                      - build the consent URL (admin)
 * - GET    /api/zoho/auth/callback                 - OAuth redirect target (no auth)
 * - DELETE /api/zoho/disconnect                    - forget the connection (admin)
 * - GET    /api/zoho/projects                      - list projects
 * - POST   /api/zoho/projects                      - create a project
 * - GET    /api/zoho/projects/:projectId/updates   - tasks, comments, activities, statuses
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const superAdminAuth = require('../middlewares/Auth/superAdminAuth.js');
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

// --- Connection lifecycle (super admin only) ------------------------------------------
router.get('/status', superAdminAuth, getZohoStatus);
router.get('/auth/url', superAdminAuth, startZohoAuth);

// Unauthenticated by necessity: the browser lands here via a redirect from Zoho, which
// does not carry our SameSite cookies. The single-use CSRF state is what protects it.
router.get('/auth/callback', validateCallbackQuery, handleZohoCallback);

router.delete('/disconnect', superAdminAuth, disconnectZoho);

// --- Project operations (any authenticated user) --------------------------------------
router.get('/projects', auth, listProjects);
router.post('/projects', auth, validateCreateProject, createProject);
router.get('/projects/:projectId/updates', auth, validateProjectIdParam, getProjectTaskUpdates);

module.exports = router;

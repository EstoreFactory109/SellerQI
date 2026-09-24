const express = require('express');
const router = express.Router();
const {
    esfLogin,
    esfLogout,
    getEsfProfile,
    updateEsfProfile,
    updateEsfPassword,
    getEsfClients,
    createEsfClient,
    removeEsfClient,
    switchToEsfClient,
    setEsfClientPassword,
    listLinkableUsers,
    linkExistingUsers,
    getEsfUsers,
    removeEsfUser,
    resetEsfUserPassword,
    updateEsfUserRole,
    getEsfPageCatalogue,
    updateEsfUserPermissions,
    getEsfSessionPermissions,
} = require('../controllers/esf/esf.js');
const {
    listInvites,
    createInvite,
    resendInvite,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
} = require('../controllers/esf/esfInvites.js');
const {
    getClientProjectOptions,
    linkClientProject,
    unlinkClientProject,
} = require('../controllers/esf/esfProjects.js');
const {
    listStaffThreads,
    getStaffThread,
    setThreadResolved,
    postStaffReply,
    downloadStaffAttachment,
} = require('../controllers/esf/esfMessages.js');
const {
    listTaskRequests,
    acceptTaskRequest,
    rejectTaskRequest,
    deleteTaskRequest,
    downloadTaskRequestAttachment,
} = require('../controllers/esf/esfTaskRequests.js');
const esfAuth = require('../middlewares/Auth/esfAuth.js');
const gmailUpload = require('../middlewares/multer/gmailUpload.js');
const { authRateLimiter, registerRateLimiter } = require('../middlewares/rateLimiting.js');
const {
    validateEsfLogin,
    validateEsfClient,
    validateEsfInvite,
    validateEsfInviteAccept,
    validateEsfRole,
    validateEsfProfile,
    validateLinkProject,
} = require('../middlewares/validator/esfValidate.js');

// Public
router.post('/login', authRateLimiter, validateEsfLogin, esfLogin);

// Read from inside a client's account to decide what the sidebar shows.
// Answers 200 with isEsfSession:false when no staff session is present, so the
// seller app can call it unconditionally.
router.get('/session-permissions', getEsfSessionPermissions);

// Invitation acceptance is public by necessity — the recipient has no account
// yet. The invite token is the credential.
router.get('/invites/token/:token', getInviteByToken);
router.post('/invites/token/:token/accept', registerRateLimiter, validateEsfInviteAccept, acceptInvite);

// Everything below requires a valid ESFToken cookie belonging to an esfUser.
router.post('/logout', esfAuth, esfLogout);
router.get('/me', esfAuth, getEsfProfile);
router.put('/profile', esfAuth, validateEsfProfile, updateEsfProfile);
router.put('/update-password', esfAuth, updateEsfPassword);

// Clients
router.get('/clients', esfAuth, getEsfClients);
router.post('/clients', esfAuth, registerRateLimiter, validateEsfClient, createEsfClient);
router.post('/clients/switch', esfAuth, switchToEsfClient);
// Adopting existing SellerQI sellers instead of creating a new account.
router.get('/linkable-users', esfAuth, listLinkableUsers);
router.post('/clients/link', esfAuth, linkExistingUsers);
router.post('/clients/:clientId/set-password', esfAuth, setEsfClientPassword);
router.delete('/clients/:clientId', esfAuth, removeEsfClient);

// Connecting a client to an existing Zoho project. Projects are created in
// Zoho, never here — see controllers/esf/esfProjects.js.
router.get('/clients/:clientId/project-options', esfAuth, getClientProjectOptions);
router.post('/clients/:clientId/project', esfAuth, validateLinkProject, linkClientProject);
router.delete('/clients/:clientId/project', esfAuth, unlinkClientProject);

// Team members
router.get('/users', esfAuth, getEsfUsers);
// Staff are added by invitation (see /invites) rather than created directly.
router.get('/invites', esfAuth, listInvites);
router.post('/invites', esfAuth, registerRateLimiter, validateEsfInvite, createInvite);
router.post('/invites/:inviteId/resend', esfAuth, resendInvite);
router.delete('/invites/:inviteId', esfAuth, revokeInvite);
router.get('/pages', esfAuth, getEsfPageCatalogue);
router.patch('/users/:userId/role', esfAuth, validateEsfRole, updateEsfUserRole);
router.put('/users/:userId/permissions', esfAuth, updateEsfUserPermissions);
router.post('/users/:userId/reset-password', esfAuth, resetEsfUserPassword);
router.delete('/users/:userId', esfAuth, removeEsfUser);

/**
 * The staff inbox — client email, with the client's identity removed.
 *
 * esfAuth only. There is no per-client scoping to apply here because this portal has
 * none anywhere; the access question is whether this staff member may open the
 * Messages page, and that check is made explicitly inside the controller. esfPageGuard
 * does NOT cover these routes — it engages only on /api/pagewise inside an
 * impersonated client session.
 */
router.get('/messages', esfAuth, listStaffThreads);
router.get('/messages/:threadId', esfAuth, getStaffThread);
router.patch('/messages/:threadId/resolve', esfAuth, setThreadResolved);
router.post('/messages/:threadId/reply', esfAuth, gmailUpload.array('files', 5), postStaffReply);
router.get('/messages/:threadId/attachments/:messageId/:index', esfAuth, downloadStaffAttachment);

/**
 * Task requests — clients asking for work, and the decision on it.
 *
 * esfAuth admits any staff member; the owner/admin check is made explicitly inside the
 * controller, because esfPageGuard does not cover /app/esf routes. Accepting a request
 * creates a real task in the shared Zoho portal on the client's behalf.
 */
router.get('/task-requests', esfAuth, listTaskRequests);
router.patch('/task-requests/:requestId/accept', esfAuth, acceptTaskRequest);
router.patch('/task-requests/:requestId/reject', esfAuth, rejectTaskRequest);
router.delete('/task-requests/:requestId', esfAuth, deleteTaskRequest);
router.get('/task-requests/:requestId/attachments/:index', esfAuth, downloadTaskRequestAttachment);

module.exports = router;

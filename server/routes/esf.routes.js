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
const esfAuth = require('../middlewares/Auth/esfAuth.js');
const { authRateLimiter, registerRateLimiter } = require('../middlewares/rateLimiting.js');
const {
    validateEsfLogin,
    validateEsfClient,
    validateEsfInvite,
    validateEsfInviteAccept,
    validateEsfRole,
    validateEsfProfile,
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
router.post('/clients/:clientId/set-password', esfAuth, setEsfClientPassword);
router.delete('/clients/:clientId', esfAuth, removeEsfClient);

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

module.exports = router;

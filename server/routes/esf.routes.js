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
    createEsfUser,
    removeEsfUser,
    resetEsfUserPassword,
} = require('../controllers/esf/esf.js');
const esfAuth = require('../middlewares/Auth/esfAuth.js');
const { authRateLimiter, registerRateLimiter } = require('../middlewares/rateLimiting.js');
const {
    validateEsfLogin,
    validateEsfClient,
    validateEsfUser,
    validateEsfProfile,
} = require('../middlewares/validator/esfValidate.js');

// Public
router.post('/login', authRateLimiter, validateEsfLogin, esfLogin);

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
router.post('/users', esfAuth, registerRateLimiter, validateEsfUser, createEsfUser);
router.post('/users/:userId/reset-password', esfAuth, resetEsfUserPassword);
router.delete('/users/:userId', esfAuth, removeEsfUser);

module.exports = router;

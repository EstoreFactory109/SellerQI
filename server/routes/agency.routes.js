const express = require('express');
const router = express.Router();
const { registerAgencyClient, getAgencyClients, switchToClient } = require('../controllers/AgencyController.js');
const { auth, agencyAuth } = require('../middlewares/Auth/auth.js');

// Register a new client for agency owner
router.post('/register-client', auth, agencyAuth, registerAgencyClient);

// Get all clients for agency owner
router.get('/clients', auth, agencyAuth, getAgencyClients);

// Switch to specific client (replace tokens)
router.post('/switch-client', auth, agencyAuth, switchToClient);

module.exports = router; 
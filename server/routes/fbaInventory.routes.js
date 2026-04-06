const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const { getFbaInventoryByAsin } = require('../controllers/inventory/FbaInventoryController.js');

// Stored FBA Inventory API snapshots (FbaInventoryApiDetail), scoped by auth user + location cookie
router.get('/asin/:asin', auth, getLocation, getFbaInventoryByAsin);

module.exports = router;

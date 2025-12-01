const express = require('express');
const router = express.Router();

const {
    clearAnalyseCacheEndpoint,
    clearAllAnalyseCache,
    getCacheStats
} = require('../controllers/system/CacheController.js');

const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');

// Clear cache for specific user, country, region
router.delete('/clear', auth, getLocation, clearAnalyseCacheEndpoint);

// Clear all analyse cache (admin only)
router.delete('/clear-all', auth, clearAllAnalyseCache);

// Get cache statistics
router.get('/stats', auth, getCacheStats);

module.exports = router; 
const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const { analyseDataCache } = require('../middlewares/redisCache.js');
const {
    getReimbursementSummary,
    getAllReimbursements,
    getReimbursementTimeline
} = require('../controllers/finance/ReimbursementController.js');

// All reimbursement routes require authentication and location
// Cache TTL: 1 hour (3600 seconds) for reimbursement data
router.get('/summary', auth, getLocation, analyseDataCache(3600, 'reimbursement-summary'), getReimbursementSummary);
router.get('/', auth, getLocation, getAllReimbursements);
router.get('/timeline', auth, getLocation, getReimbursementTimeline);

module.exports = router;


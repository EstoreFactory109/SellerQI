const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const {
    getReimbursementSummary,
    getAllReimbursements,
    getReimbursementTimeline
} = require('../controllers/finance/ReimbursementController.js');

// All reimbursement routes require authentication and location
router.get('/summary', auth, getLocation, getReimbursementSummary);
router.get('/', auth, getLocation, getAllReimbursements);
router.get('/timeline', auth, getLocation, getReimbursementTimeline);

module.exports = router;


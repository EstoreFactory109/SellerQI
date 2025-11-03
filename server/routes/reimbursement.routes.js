const express = require('express');
const router = express.Router();
const {
    getReimbursementSummaryController,
    getAllReimbursements,
    getPotentialClaims,
    getReimbursementsByProduct,
    getReimbursementStatsByType,
    getReimbursementTimeline,
    updateReimbursementCosts,
    getUrgentClaims,
    fetchReimbursementData
} = require('../controllers/ReimbursementController.js');
const verifyToken = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');

/**
 * Reimbursement Routes
 * All routes are protected and require authentication and location
 */

// GET /app/reimbursements/summary - Get reimbursement summary for dashboard
router.get('/summary', verifyToken, getLocation, getReimbursementSummaryController);

// GET /app/reimbursements - Get all reimbursements with optional filters
router.get('/', verifyToken, getLocation, getAllReimbursements);

// GET /app/reimbursements/potential - Get potential claims (not yet filed)
router.get('/potential', verifyToken, getLocation, getPotentialClaims);

// GET /app/reimbursements/urgent - Get urgent claims (expiring soon)
router.get('/urgent', verifyToken, getLocation, getUrgentClaims);

// GET /app/reimbursements/stats/by-type - Get statistics by reimbursement type
router.get('/stats/by-type', verifyToken, getLocation, getReimbursementStatsByType);

// GET /app/reimbursements/timeline - Get timeline data for charts
router.get('/timeline', verifyToken, getLocation, getReimbursementTimeline);

// GET /app/reimbursements/product/:asin - Get reimbursements for specific product
router.get('/product/:asin', verifyToken, getLocation, getReimbursementsByProduct);

// POST /app/reimbursements/update-costs - Update product costs for reimbursement calculations
router.post('/update-costs', verifyToken, getLocation, updateReimbursementCosts);

// POST /app/reimbursements/fetch - Fetch reimbursement data from Amazon SP-API and store in database
router.post('/fetch', verifyToken, getLocation, fetchReimbursementData);

module.exports = router;


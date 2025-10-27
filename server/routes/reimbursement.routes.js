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
    getUrgentClaims
} = require('../controllers/ReimbursementController.js');
const verifyToken = require('../middlewares/Auth/VerifyToken.js');

/**
 * Reimbursement Routes
 * All routes are protected and require authentication
 */

// GET /app/reimbursements/summary - Get reimbursement summary for dashboard
router.get('/summary', verifyToken, getReimbursementSummaryController);

// GET /app/reimbursements - Get all reimbursements with optional filters
router.get('/', verifyToken, getAllReimbursements);

// GET /app/reimbursements/potential - Get potential claims (not yet filed)
router.get('/potential', verifyToken, getPotentialClaims);

// GET /app/reimbursements/urgent - Get urgent claims (expiring soon)
router.get('/urgent', verifyToken, getUrgentClaims);

// GET /app/reimbursements/stats/by-type - Get statistics by reimbursement type
router.get('/stats/by-type', verifyToken, getReimbursementStatsByType);

// GET /app/reimbursements/timeline - Get timeline data for charts
router.get('/timeline', verifyToken, getReimbursementTimeline);

// GET /app/reimbursements/product/:asin - Get reimbursements for specific product
router.get('/product/:asin', verifyToken, getReimbursementsByProduct);

// POST /app/reimbursements/update-costs - Update product costs for reimbursement calculations
router.post('/update-costs', verifyToken, updateReimbursementCosts);

module.exports = router;


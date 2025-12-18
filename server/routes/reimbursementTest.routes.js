/**
 * Reimbursement Test Routes
 *
 * POST /api/test/reimbursement - Fetch complete reimbursement data (same as frontend)
 *
 * Accepts: { userId, region, country }
 */

const express = require('express');
const router = express.Router();

const {
    testReimbursementData
} = require('../controllers/test/ReimbursementTestController.js');

// Health check
router.get('/test', (req, res) => {
    res.json({
        statusCode: 200,
        message: 'Reimbursement test route is working',
        endpoint: 'POST /api/test/reimbursement',
        body: {
            userId: 'string (required)',
            region: 'string (required) - NA, EU, FE',
            country: 'string (required) - US, CA, UK, etc.'
        },
        timestamp: new Date().toISOString()
    });
});

// Main endpoint - Fetch complete reimbursement data
router.post('/', testReimbursementData);

module.exports = router;

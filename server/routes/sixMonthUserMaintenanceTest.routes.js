/**
 * Six Month User Maintenance Test Routes
 *
 * Endpoints for testing the six‑month warning and cleanup services on a single user.
 *
 * Endpoints:
 * - GET  /api/test/six-month-maintenance/test                - Health / usage info
 * - POST /api/test/six-month-maintenance/user/:userId/warning - Evaluate + optionally send warning email
 * - POST /api/test/six-month-maintenance/user/:userId/delete  - Evaluate + optionally delete user
 */

const express = require('express');
const router = express.Router();

const {
    testSixMonthWarningForUser,
    testDeleteStaleLiteUser,
} = require('../controllers/test/SixMonthUserMaintenanceTestController.js');

router.get('/test', (req, res) => {
    res.json({
        statusCode: 200,
        message: 'Six Month User Maintenance test routes are working',
        availableEndpoints: [
            'POST /user/:userId/warning - Evaluate and optionally send the 6‑month warning email',
            'POST /user/:userId/delete  - Evaluate and optionally delete user using 6+ month LITE cleanup rules',
        ],
        warningExample: {
            method: 'POST',
            path: '/api/test/six-month-maintenance/user/<userId>/warning',
            body: {
                send: true,
            },
        },
        deleteExample: {
            method: 'POST',
            path: '/api/test/six-month-maintenance/user/<userId>/delete',
            body: {
                force: false,
            },
        },
        timestamp: new Date().toISOString(),
    });
});

router.post('/user/:userId/warning', testSixMonthWarningForUser);
router.post('/user/:userId/delete', testDeleteStaleLiteUser);

module.exports = router;


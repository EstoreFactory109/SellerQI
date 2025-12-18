/**
 * Inventory Reports Test Routes
 *
 * POST /api/test/inventory/stranded
 * POST /api/test/inventory/inbound-noncompliance
 * POST /api/test/inventory/restock
 * POST /api/test/inventory/planning - uses csv-parse for TSV parsing
 *
 * All accept: { userId, region, country }
 */

const express = require('express');
const router = express.Router();

const {
  testStrandedInventoryReport,
  testInboundNonComplianceReport,
  testRestockInventoryReport,
  testFbaInventoryPlanningReport
} = require('../controllers/test/InventoryReportsTestController.js');

// Simple health check
router.get('/test', (req, res) => {
  res.json({
    statusCode: 200,
    message: 'Inventory reports test routes are working',
    availableEndpoints: [
      'POST /stranded',
      'POST /inbound-noncompliance',
      'POST /restock',
      'POST /planning (csv-parse)'
    ],
    timestamp: new Date().toISOString()
  });
});

router.post('/stranded', testStrandedInventoryReport);
router.post('/inbound-noncompliance', testInboundNonComplianceReport);
router.post('/restock', testRestockInventoryReport);
router.post('/planning', testFbaInventoryPlanningReport);

module.exports = router;



/**
 * Update Product Content Test Routes
 *
 * REST routes for testing UpdateProductContentService (name, bullet points, description).
 *
 * Endpoints:
 * - GET  /api/test/update-product-content/test - Health / available endpoints
 * - POST /api/test/update-product-content/update - Run update product content
 */

const express = require('express');
const router = express.Router();

const { testUpdateProductContent } = require('../controllers/test/UpdateProductContentTestController.js');

router.get('/test', (req, res) => {
  res.json({
    statusCode: 200,
    message: 'Update Product Content test routes are working',
    availableEndpoints: [
      'POST / - Listing update (same as POST /update)',
      'POST /update - Listing update, analyze-only, or fix-conflicts-only',
    ],
    bodyExample: {
      userId: 'mongoose ObjectId (or set via auth: req.userId / req.user.id)',
      sku: 'SKU_CODE',
      sellerId: 'optional',
      country: 'AU',
      region: 'FE',
      dataToBeUpdated: 'title | description | bulletpoints (required unless fixConflictsOnly)',
      valueToBeUpdated: 'required for updates; string | array of strings (bulletpoints) | { index, value } (partial bullet)',
      analyzeOnly: 'boolean, default false - only analyze, do not update',
      fixConflictsOnly: 'boolean, default false - only fix 8541 catalog conflicts',
      autoFixConflicts: 'boolean, default true - fix conflicts and apply attribute update',
    },
    timestamp: new Date().toISOString(),
  });
});

// POST on base path so POST /api/test/update-product-content works
router.post('/', testUpdateProductContent);
router.post('/update', testUpdateProductContent);

module.exports = router;

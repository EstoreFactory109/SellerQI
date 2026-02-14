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
      'POST / - Update product content (same as POST /update)',
      'POST /update - Update product content (title, description, or bulletpoints)',
    ],
    bodyExample: {
      userId: 'mongoose ObjectId',
      sku: 'SKU_CODE',
      sellerId: 'optional selling_partner_id',
      country: 'US',
      region: 'NA',
      dataToBeUpdated: 'title | description | bulletpoints',
      valueToBeUpdated: 'string (title/description) | array of strings (bulletpoints full) | { index: 2, value: "..." } (bulletpoints update 3rd only)',
    },
    timestamp: new Date().toISOString(),
  });
});

// POST on base path so POST /api/test/update-product-content works
router.post('/', testUpdateProductContent);
router.post('/update', testUpdateProductContent);

module.exports = router;

/**
 * Update Product Content Routes (production)
 *
 * These routes expose the AutoFixListingService to the frontend.
 * They reuse the same controller logic as the test routes.
 *
 * Base path (from app.js): /api/listings
 *
 * POST /api/listings/update-product-content
 *   - Body is identical to the test controller:
 *     {
 *       "userId": "mongoose ObjectId",
 *       "sku": "SKU_CODE",
 *       "country": "AU",
 *       "region": "FE",
 *       "sellerId": "optional",
 *       "dataToBeUpdated": "title | description | bulletpoints | generic_keyword",
 *       "valueToBeUpdated": "string | array | { index, value }",
 *       "analyzeOnly": false,
 *       "fixConflictsOnly": false,
 *       "autoFixConflicts": true,
 *       "brandName": "Your Brand"
 *     }
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');

const {
  updateProductContentController
} = require('../controllers/Operations/UpdateProductContentController.js');

// Production endpoint for frontend integration (auth + location required)
router.post('/update-product-content', auth, getLocation, updateProductContentController);

module.exports = router;


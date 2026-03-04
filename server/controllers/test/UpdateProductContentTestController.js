/**
 * UpdateProductContentTestController.js
 *
 * Single endpoint for all listing update operations (test/prototype).
 * Supports: attribute update, analyze-only, fix-conflicts-only.
 *
 * POST /api/test/update-product-content (or /update)
 *
 * Request body:
 * {
 *   "userId": "mongoose ObjectId",        // Optional if req.userId / req.user.id set (e.g. by auth)
 *   "sku": "3in1Dermaroller",
 *   "country": "AU",
 *   "region": "FE",
 *   "sellerId": "optional",
 *   "dataToBeUpdated": "title",           // Required unless fixConflictsOnly
 *   "valueToBeUpdated": "New Title",      // Required for updates (not for analyzeOnly/fixConflictsOnly)
 *   "analyzeOnly": false,                  // Optional: just analyze, don't update
 *   "fixConflictsOnly": false,             // Optional: only fix 8541 catalog conflicts
 *   "autoFixConflicts": true,              // Optional: fix conflicts + update (default: true)
 *   "brandName": "Your Brand"              // Optional: if brand attribute is missing, set it (exactly as in Brand Registry)
 *   // To update generic keywords (search terms), use:
 *   // "dataToBeUpdated": "generic_keyword",
 *   // "valueToBeUpdated": "search term 1 search term 2"
 * }
 */

// Legacy test controller kept for backward compatibility.
// All logic has been moved to the main production controller:
//   server/controllers/Operations/UpdateProductContentController.js
//
// This file simply re-exports the production handler under the old name.

const {
  updateProductContentController
} = require('../Operations/UpdateProductContentController.js');

module.exports = {
  testUpdateProductContent: updateProductContentController
};

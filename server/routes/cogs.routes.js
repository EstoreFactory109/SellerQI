const express = require("express");
const router = express.Router();
const auth = require("../middlewares/Auth/auth.js");
const { validateSaveCogs, validateBulkSaveCogs, validateAsinParam } = require("../middlewares/validator/cogsValidate.js");
const {
  getCogs,
  saveCogs,
  bulkSaveCogs,
  deleteCogs,
  deleteAllCogs,
} = require("../controllers/finance/CogsController.js");

// Get COGS data for the authenticated user
router.get("/", auth, getCogs);

// Save or update COGS for a specific ASIN
router.post("/", auth, validateSaveCogs, saveCogs);

// Bulk update COGS for multiple ASINs
router.post("/bulk", auth, validateBulkSaveCogs, bulkSaveCogs);

// Delete COGS for a specific ASIN
router.delete("/:asin", auth, validateAsinParam, deleteCogs);

// Delete all COGS data
router.delete("/", auth, deleteAllCogs);

module.exports = router;


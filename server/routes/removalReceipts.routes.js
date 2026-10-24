const express = require("express");
const router = express.Router();
const auth = require("../middlewares/Auth/auth.js");
const { getLocation } = require("../middlewares/Auth/getLocation.js");
const { getPending, confirm } = require("../controllers/inventory/RemovalReceiptController.js");

// Removal order lines shipped back to the seller and not yet confirmed
router.get("/pending", auth, getLocation, getPending);

// The seller's answer: how many units of each line actually arrived
router.post("/confirm", auth, getLocation, confirm);

module.exports = router;

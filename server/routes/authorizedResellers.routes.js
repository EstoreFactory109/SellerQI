const express = require("express");
const router = express.Router();
const auth = require("../middlewares/Auth/auth.js");
const { getLocation } = require("../middlewares/Auth/getLocation.js");
const { list, add, remove } = require("../controllers/inventory/AuthorizedResellerController.js");

// Sellers the brand owner allows on their listings (excluded from new-seller tasks)
router.get("/", auth, getLocation, list);
router.post("/", auth, getLocation, add);
router.delete("/:sellerId", auth, getLocation, remove);

module.exports = router;

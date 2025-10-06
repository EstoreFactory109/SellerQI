const express = require("express");
const { storeUserDetails } = require("../controllers/GetUserDetails");

const router = express.Router();

// POST route to store user details
router.post("/user-details", storeUserDetails);

module.exports = router;

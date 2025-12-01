const express = require('express');
const router = express.Router();
const { getAllUsers, getUserByEmailOrPhone } = require('../controllers/user-auth/GetUserDetails.js');

/**
 * GET /all-users
 * Route to fetch all users with their seller account details
 */
router.get('/all-users', getAllUsers);

/**
 * GET /user
 * Route to fetch user by email or phone
 * Query parameters: email (optional), phone (optional)
 * At least one parameter is required
 */
router.get('/user', getUserByEmailOrPhone);

module.exports = router;

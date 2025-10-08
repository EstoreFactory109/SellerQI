const express = require('express');
const router = express.Router();
const { getAllUsers, getUserByEmailOrPhone } = require('../controllers/GetUserDetails.js');

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

<<<<<<< HEAD
module.exports = router;
=======
module.exports = router;
>>>>>>> 2dc9dbdec24c73d41ba705df10c52c7f4e4cde38

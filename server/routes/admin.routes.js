const express = require('express');
const router = express.Router();
const { adminLogin, adminLogout, getAllAccounts, loginSelectedUser } = require('../controllers/admin/admin.js');
const superAdminAuth = require('../middlewares/Auth/superAdminAuth.js');

// Public admin routes (no authentication required)
router.post('/admin-login', adminLogin);

// Protected admin routes (require superAdmin authentication)
router.post('/admin-logout', superAdminAuth, adminLogout);
router.get('/admin/accounts', superAdminAuth, getAllAccounts);
router.post('/admin/login-as-user', superAdminAuth, loginSelectedUser);

module.exports = router;

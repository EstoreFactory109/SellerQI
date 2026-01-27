const express = require('express');
const router = express.Router();
const { adminLogin, adminLogout, getAllAccounts, loginSelectedUser, deleteUser } = require('../controllers/admin/admin.js');
const superAdminAuth = require('../middlewares/Auth/superAdminAuth.js');
const { authRateLimiter } = require('../middlewares/rateLimiting.js');
const { validateAdminLogin } = require('../middlewares/validator/adminValidate.js');

// Public admin routes (no authentication required)
router.post('/admin-login', authRateLimiter, validateAdminLogin, adminLogin);

// Protected admin routes (require superAdmin authentication)
router.post('/admin-logout', superAdminAuth, adminLogout);
router.get('/admin/accounts', superAdminAuth, getAllAccounts);
router.post('/admin/login-as-user', superAdminAuth, loginSelectedUser);
router.delete('/admin/users/:userId', superAdminAuth, deleteUser);

module.exports = router;

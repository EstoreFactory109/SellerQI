const express = require('express');
const router = express.Router();
const { adminLogin, adminLogout, getAllAccounts, loginSelectedUser, deleteUser, getPaymentLogs, getAllPaymentLogs, cancelUserSubscription } = require('../controllers/admin/admin.js');
const { getSubscriptionData } = require('../controllers/admin/AdminSubscriptionController.js');
const { getAdminEmailLogs } = require('../controllers/admin/AdminEmailLogsController.js');
const { getAdminTicketMessages } = require('../controllers/admin/AdminTicketMessagesController.js');
const { getAdminUserSessions, getAdminUserErrorLogs, getAdminUserSessionDetails } = require('../controllers/admin/AdminUserLogsController.js');
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
router.post('/admin/users/:userId/cancel-subscription', superAdminAuth, cancelUserSubscription);

// Payment logs routes for superAdmin (existing - used by manage-accounts and user logging)
router.get('/admin/payment-logs', superAdminAuth, getAllPaymentLogs);
router.get('/admin/payment-logs/:userId', superAdminAuth, getPaymentLogs);

// Manage-accounts independent routes (subscription, email logs, ticket messages)
router.get('/admin/subscription', superAdminAuth, getSubscriptionData);
router.get('/admin/email-logs', superAdminAuth, getAdminEmailLogs);
router.get('/admin/ticket-messages', superAdminAuth, getAdminTicketMessages);

// User logging routes for admin
router.get('/admin/user-logs/:userId/sessions', superAdminAuth, getAdminUserSessions);
router.get('/admin/user-logs/:userId/errors', superAdminAuth, getAdminUserErrorLogs);
router.get('/admin/user-logs/:userId/session/:sessionId', superAdminAuth, getAdminUserSessionDetails);

module.exports = router;

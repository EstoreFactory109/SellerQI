const express = require('express');
const router = express.Router();
const { adminLogin, adminLogout, getAllAccounts, getAgencyClients, getAccountMembers, getCountryStats, loginSelectedUser, deleteUser, getPaymentLogs, getAllPaymentLogs, cancelUserSubscription, exportAllAccountsCsv, refundUserPayment, updateUserTrialPeriod } = require('../controllers/admin/admin.js');
const { getSubscriptionData } = require('../controllers/admin/AdminSubscriptionController.js');
const { getAdminEmailLogs } = require('../controllers/admin/AdminEmailLogsController.js');
const { getAdminTicketMessages } = require('../controllers/admin/AdminTicketMessagesController.js');
const { getAdminUserSessions, getAdminUserErrorLogs, getAdminUserSessionDetails } = require('../controllers/admin/AdminUserLogsController.js');
const { getActivityOverview, getUserActivity } = require('../controllers/admin/AdminActivityController.js');
const { getAccountBillingOptions, linkAccountBilling, unlinkAccountBilling } = require('../controllers/admin/AdminBillingLinkController.js');
const superAdminAuth = require('../middlewares/Auth/superAdminAuth.js');
const { authRateLimiter } = require('../middlewares/rateLimiting.js');
const { validateAdminLogin } = require('../middlewares/validator/adminValidate.js');
const { refuseIfOtherSession } = require('../middlewares/Auth/singleSession.js');

// Public admin routes (no authentication required)
router.post('/admin-login', authRateLimiter, validateAdminLogin, refuseIfOtherSession('admin'), adminLogin);

// Protected admin routes (require superAdmin authentication)
router.post('/admin-logout', superAdminAuth, adminLogout);
router.get('/admin/accounts', superAdminAuth, getAllAccounts);
// Seller activity monitoring (last active, pages viewed).
router.get('/admin/activity', superAdminAuth, getActivityOverview);
router.get('/admin/activity/users/:userId', superAdminAuth, getUserActivity);
// Link an ESF client to their Zoho Billing customer when the emails differ.
router.get('/admin/accounts/:userId/billing-options', superAdminAuth, getAccountBillingOptions);
router.post('/admin/accounts/:userId/billing', superAdminAuth, linkAccountBilling);
router.delete('/admin/accounts/:userId/billing', superAdminAuth, unlinkAccountBilling);
router.get('/admin/accounts/export', superAdminAuth, exportAllAccountsCsv);
router.get('/admin/accounts/country-stats', superAdminAuth, getCountryStats);
router.get('/admin/accounts/:agencyId/clients', superAdminAuth, getAgencyClients);
router.get('/admin/accounts/:userId/members', superAdminAuth, getAccountMembers);
router.post('/admin/login-as-user', superAdminAuth, loginSelectedUser);
router.delete('/admin/users/:userId', superAdminAuth, deleteUser);
router.post('/admin/users/:userId/cancel-subscription', superAdminAuth, cancelUserSubscription);
router.post('/admin/users/:userId/refund', superAdminAuth, refundUserPayment);
router.post('/admin/users/:userId/update-trial', superAdminAuth, updateUserTrialPeriod);

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

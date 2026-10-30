/**
 * Changes on Amazon from SellerQI's screens (see controllers/actions/AmazonActionsController.js).
 * Mounted at /api/actions behind esfPageGuard and memberPageGuard (api/app.js).
 */
const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const c = require('../controllers/actions/AmazonActionsController.js');

const FEATURE = ':feature(ads|listings|messaging|feeds|reports|orders|notifications)';
// Mongo ObjectId only, so "approve-many" never matches as an id.
const ID = ':id([0-9a-fA-F]{24})';

router.get('/capabilities', auth, getLocation, c.getCapabilities);
router.get('/history', auth, getLocation, c.getHistory);
// Reads for the advertising screens (guarded as the PPC page).
router.get('/ads/campaigns', auth, getLocation, c.adsCampaigns);
router.get('/ads/campaigns/:campaignId([0-9]+)/ad-groups', auth, getLocation, c.adsCampaignAdGroups);
router.get('/ads/new-campaign-options', auth, getLocation, c.adsNewCampaignOptions);
router.get('/reports/pending', auth, getLocation, c.pendingReports);
router.get('/orders/unshipped', auth, getLocation, c.unshippedOrders);
router.get('/notifications/subscriptions', auth, getLocation, c.notificationSubscriptions);
router.get('/orders/:orderId(\\d{3}-\\d{7}-\\d{7})', auth, getLocation, c.orderDetail);

router.post(`/${FEATURE}/preview`, auth, getLocation, c.preview);
router.post(`/${FEATURE}/approve-many`, auth, getLocation, c.approveMany);
router.post(`/${FEATURE}/${ID}/approve`, auth, getLocation, c.approve);
router.get(`/${FEATURE}/${ID}`, auth, getLocation, c.getOne);
router.delete(`/${FEATURE}/${ID}`, auth, getLocation, c.cancel);

module.exports = router;

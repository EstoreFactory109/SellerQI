/**
 * Changes on Amazon from SellerQI's screens (see controllers/actions/AmazonActionsController.js).
 * Mounted at /api/actions behind esfPageGuard and memberPageGuard (api/app.js).
 */
const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');
const c = require('../controllers/actions/AmazonActionsController.js');

const FEATURE = ':feature(ads|listings|messaging)';
// Mongo ObjectId only, so "approve-many" never matches as an id.
const ID = ':id([0-9a-fA-F]{24})';

router.get('/capabilities', auth, getLocation, c.getCapabilities);
router.get('/history', auth, getLocation, c.getHistory);
router.post(`/${FEATURE}/preview`, auth, getLocation, c.preview);
router.post(`/${FEATURE}/approve-many`, auth, getLocation, c.approveMany);
router.post(`/${FEATURE}/${ID}/approve`, auth, getLocation, c.approve);
router.get(`/${FEATURE}/${ID}`, auth, getLocation, c.getOne);
router.delete(`/${FEATURE}/${ID}`, auth, getLocation, c.cancel);

module.exports = router;

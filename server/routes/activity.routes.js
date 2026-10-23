const express = require('express');
const router = express.Router();

const auth = require('../middlewares/Auth/auth.js');
const { activityRateLimiter } = require('../middlewares/rateLimiting.js');
const { ping } = require('../controllers/activity/ActivityController.js');

// Activity monitoring: page opens and heartbeats from seller pages (see Services/Activity).
// The limiter keys on req.userId, so it sits after auth.
router.post('/ping', auth, activityRateLimiter, ping);

module.exports = router;

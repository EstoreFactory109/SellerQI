const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { trackActivity } = require('../controllers/system/ActivityController.js');

// The seller app reports page views and active time here (utils/activityTracker.js
// on the client). The report pages live under /app/auth/admin and /app/esf.
router.post('/', auth, trackActivity);

module.exports = router;

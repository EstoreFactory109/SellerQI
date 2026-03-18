const express = require('express');
const router = express.Router();
const { demoLogin, demoProfile, demoLogout } = require('../controllers/demo/DemoController');
const demoAuth = require('../middlewares/Auth/demoAuth');

router.post('/login', demoLogin);
router.get('/profile', demoAuth, demoProfile);
router.get('/logout', demoAuth, demoLogout);

module.exports = router;

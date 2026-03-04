const express = require('express');
const router = express.Router();
const auth = require('../middlewares/Auth/auth.js');
const { getLocation } = require('../middlewares/Auth/getLocation.js');

const {
  generateRankingContent
} = require('../controllers/Operations/RankingContentAIController.js');

// AI suggestions for ranking-related listing content (title, bullet points, description)
router.post('/ranking-content', auth, getLocation, generateRankingContent);

module.exports = router;


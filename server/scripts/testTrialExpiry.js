// server/scripts/testTrialExpiry.js

require('dotenv').config();

const path = require('path');

// Load env from project root if not already loaded
if (!process.env.DB_URI) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const dbConnect = require('../config/dbConn.js');
const logger = require('../utils/Logger.js');
const mongoose = require('mongoose');

const User = require('../models/user-auth/userModel.js');
const Subscription = require('../models/user-auth/SubscriptionModel.js');
const { downgradeExpiredManualTrials } = require('../Services/BackgroundJobs/TrialExpiryService.js');

async function main() {
  try {
    await dbConnect();
    logger.info('[TestTrialExpiry] Connected to DB');

    const userId = process.env.USER_ID || process.argv[2];

    if (userId) {
      try {
        const user = await User.findById(userId).lean();
        const sub = await Subscription.findOne({ userId }).lean();
        logger.info('[TestTrialExpiry] BEFORE job – user:', user);
        logger.info('[TestTrialExpiry] BEFORE job – subscription:', sub);
      } catch (e) {
        logger.warn('[TestTrialExpiry] Could not load pre-state for user', userId, e.message);
      }
    }

    const result = await downgradeExpiredManualTrials();
    logger.info('[TestTrialExpiry] Job result:', result);

    if (userId) {
      const userAfter = await User.findById(userId).lean();
      const subAfter = await Subscription.findOne({ userId }).lean();
      logger.info('[TestTrialExpiry] AFTER job – user:', userAfter);
      logger.info('[TestTrialExpiry] AFTER job – subscription:', subAfter);
    }

    await mongoose.connection.close();
    logger.info('[TestTrialExpiry] DB connection closed. Done.');
  } catch (err) {
    console.error('[TestTrialExpiry] Fatal error:', err);
    process.exit(1);
  }
}

main();


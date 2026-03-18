/**
 * Seed Demo User
 *
 * Upserts a demo user into MongoDB so the demo auth flow has a real
 * DB record to authenticate against.
 *
 * Usage:  node server/scripts/seedDemoUser.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const dbConsts = require('../config/config.js');
const User = require('../models/user-auth/userModel.js');
const { hashPassword } = require('../utils/HashPassword.js');

const DEMO_EMAIL = 'demo@sellerqi.com';
const DEMO_PASSWORD = 'DemoSellerQI2026!';

const seed = async () => {
  const uri = `${dbConsts.dbUri}/${dbConsts.dbName}`;
  console.log(`Connecting to MongoDB …`);
  await mongoose.connect(uri);
  console.log('Connected.');

  const hashed = await hashPassword(DEMO_PASSWORD);

  const result = await User.findOneAndUpdate(
    { email: DEMO_EMAIL },
    {
      $set: {
        firstName: 'Demo',
        lastName: 'User',
        phone: '0000000000',
        whatsapp: '0000000000',
        email: DEMO_EMAIL,
        password: hashed,
        accessType: 'user',
        packageType: 'PRO',
        isVerified: true,
        FirstAnalysisDone: true,
        allTermsAndConditionsAgreed: true,
        subscriptionStatus: 'active',
        isInTrialPeriod: false,
        subscribedToAlerts: false
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Demo user upserted:  _id=${result._id}  email=${result.email}`);
  await mongoose.connection.close();
  console.log('Done.');
};

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * fixAgencyAccessType.js
 *
 * One-off fix: the agency account sanjay@bestconnectionsinc.com was created
 * with the default accessType 'user' instead of 'enterpriseAdmin'. Without
 * 'enterpriseAdmin', the login flow does not issue an AdminToken, so agency
 * admin endpoints fail with "Admin token required".
 *
 * This sets accessType='enterpriseAdmin' on that single account only.
 * Only touches the accessType field — nothing else.
 *
 * Usage:
 *   node server/scripts/fixAgencyAccessType.js --dry-run
 *   node server/scripts/fixAgencyAccessType.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const dbConsts = require('../config/config.js');
const User = require('../models/user-auth/userModel.js');

const isDryRun = process.argv.includes('--dry-run');
const AGENCY_EMAIL = 'sanjay@bestconnectionsinc.com';

async function main() {
  const MONGODB_URI = dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!MONGODB_URI) {
    console.error('ERROR: DB_URI and DB_NAME must be set in .env');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to MongoDB. Mode: ${isDryRun ? 'DRY-RUN' : 'LIVE'}\n`);

  const agency = await User.findOne({ email: AGENCY_EMAIL.toLowerCase() })
    .select('_id email packageType accessType subscriptionStatus')
    .lean();

  if (!agency) {
    console.error(`ABORT: Agency account not found: ${AGENCY_EMAIL}`);
    await mongoose.connection.close();
    process.exit(1);
  }

  if (agency.packageType !== 'AGENCY') {
    console.error(`ABORT: ${AGENCY_EMAIL} is packageType=${agency.packageType}, not AGENCY. Refusing to touch it.`);
    await mongoose.connection.close();
    process.exit(1);
  }

  console.log(`Found agency: ${agency.email} (_id: ${agency._id})`);
  console.log(`  accessType: ${agency.accessType} → enterpriseAdmin`);
  console.log(`  (all other fields untouched)\n`);

  if (agency.accessType === 'enterpriseAdmin') {
    console.log('Already enterpriseAdmin. Nothing to do.');
    await mongoose.connection.close();
    return;
  }

  if (isDryRun) {
    console.log('[DRY-RUN] No changes made. Remove --dry-run to apply.');
    await mongoose.connection.close();
    return;
  }

  const updated = await User.findByIdAndUpdate(
    agency._id,
    { $set: { accessType: 'enterpriseAdmin' } },
    { new: true, select: '_id email accessType' }
  );

  console.log(`✓ Updated: ${updated.email} accessType=${updated.accessType}`);
  await mongoose.connection.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  mongoose.connection.close().finally(() => process.exit(1));
});

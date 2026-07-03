#!/usr/bin/env node
/**
 * normalizeAgencyClientsToPro.js
 *
 * Agency clients should be plain PRO (not on a trial). Any client linked to the
 * given agency that is still in a trial state is normalized to match a
 * freshly-created agency client:
 *   - subscriptionStatus: 'active'
 *   - isInTrialPeriod:    false
 *   - trialEndsDate:      unset (removed)
 *
 * packageType is left as PRO (never downgraded), and all other fields
 * (seller data, servedTrial history, etc.) are untouched.
 *
 * Usage:
 *   node server/scripts/normalizeAgencyClientsToPro.js --dry-run
 *   node server/scripts/normalizeAgencyClientsToPro.js
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

  const agency = await User.findOne({ email: AGENCY_EMAIL.toLowerCase() }).select('_id email packageType').lean();
  if (!agency || agency.packageType !== 'AGENCY') {
    console.error(`ABORT: Agency owner not found or not AGENCY: ${AGENCY_EMAIL}`);
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log(`Agency owner: ${agency.email} (_id: ${agency._id})\n`);

  // All clients of this agency (new agencyId field OR legacy adminId)
  const clients = await User.find({
    $or: [{ agencyId: agency._id }, { adminId: agency._id }],
  }).select('_id email packageType subscriptionStatus isInTrialPeriod trialEndsDate').lean();

  console.log(`Found ${clients.length} client(s) linked to this agency.\n`);

  // A client needs normalizing if it's flagged as in-trial or its status is trialing.
  const needsFix = clients.filter(
    (c) => c.isInTrialPeriod === true || c.subscriptionStatus === 'trialing'
  );

  if (needsFix.length === 0) {
    console.log('All agency clients are already plain PRO (no trials). Nothing to do.');
    await mongoose.connection.close();
    return;
  }

  for (const c of needsFix) {
    console.log(`  FIX ${c.email} (_id: ${c._id})`);
    console.log(`        packageType:        ${c.packageType} (unchanged)`);
    console.log(`        subscriptionStatus: ${c.subscriptionStatus} → active`);
    console.log(`        isInTrialPeriod:    ${c.isInTrialPeriod} → false`);
    console.log(`        trialEndsDate:      ${c.trialEndsDate || '(none)'} → (removed)`);
  }
  console.log('');

  if (isDryRun) {
    console.log('[DRY-RUN] No changes made. Remove --dry-run to apply.');
    await mongoose.connection.close();
    return;
  }

  for (const c of needsFix) {
    await User.findByIdAndUpdate(c._id, {
      $set: { subscriptionStatus: 'active', isInTrialPeriod: false },
      $unset: { trialEndsDate: '' },
    });
    console.log(`  ✓ Normalized ${c.email}`);
  }

  console.log('\nDone.');
  await mongoose.connection.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  mongoose.connection.close().finally(() => process.exit(1));
});

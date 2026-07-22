#!/usr/bin/env node
/**
 * createAgencyAndLinkExistingClients.js
 *
 * 1. Creates a new AGENCY account for sanjay@bestconnectionsinc.com
 * 2. Links two EXISTING users as agency clients (sanjay@bestconnectionsincc.com,
 *    Joel@bestconnectionsinc.com) — only their agency fields are touched,
 *    all other data (seller connections, finance data, etc.) is fully preserved.
 *
 * Safe to run multiple times: aborts if agency account already exists.
 *
 * Usage:
 *   node server/scripts/createAgencyAndLinkExistingClients.js --dry-run   (preview only)
 *   node server/scripts/createAgencyAndLinkExistingClients.js              (live run)
 *
 * Requires DB_URI and DB_NAME in .env
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const dbConsts = require('../config/config.js');
const User = require('../models/user-auth/userModel.js');
const { hashPassword } = require('../utils/HashPassword.js');

const isDryRun = process.argv.includes('--dry-run');

// ── Configuration ──────────────────────────────────────────────────────────────
const AGENCY = {
  firstName:   'Sanjay',
  lastName:    'BestConnections',
  phone:       '0000000000',        // Update via profile settings after creation
  email:       'sanjay@bestconnectionsinc.com',
  password:    'Sanjay@12345',
  agencyName:  'Best Connections Inc',
};

const EXISTING_CLIENT_EMAILS = [
  'sanjay@bestconnectionsincc.com',  // note: double-c
  'Joel@bestconnectionsinc.com',
];
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const MONGODB_URI = dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!MONGODB_URI) {
    console.error('ERROR: DB_URI and DB_NAME must be set in .env');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(' Create Agency + Link Existing Clients');
  console.log(`  Mode: ${isDryRun ? 'DRY-RUN (no changes)' : 'LIVE'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  // ── Step 1: Check agency account does not already exist ────────────────────
  const existingAgency = await User.findOne({ email: AGENCY.email.toLowerCase() }).lean();
  if (existingAgency) {
    console.error(`ABORT: Agency account ${AGENCY.email} already exists (_id: ${existingAgency._id}).`);
    console.error('       If you need to re-link clients, provide the existing agency _id directly.');
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log(`✓ Agency email ${AGENCY.email} is available.\n`);

  // ── Step 2: Verify both client accounts exist ──────────────────────────────
  const clientUsers = [];
  for (const email of EXISTING_CLIENT_EMAILS) {
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('_id email firstName lastName packageType isAgencyClient agencyId subscriptionStatus')
      .lean();
    if (!user) {
      console.error(`ABORT: Client account not found: ${email}`);
      await mongoose.connection.close();
      process.exit(1);
    }
    clientUsers.push(user);
    console.log(`✓ Found client: ${email} (_id: ${user._id}, currentPlan: ${user.packageType}, isAgencyClient: ${user.isAgencyClient})`);
  }
  console.log('');

  // ── Step 3: Warn if a client is already linked to a different agency ────────
  for (const u of clientUsers) {
    if (u.agencyId) {
      console.warn(`  WARN: ${u.email} already has agencyId=${u.agencyId}. It will be overwritten.`);
    }
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  console.log('Plan:');
  console.log(`  CREATE  Agency user  → ${AGENCY.email} (packageType: AGENCY, subscriptionStatus: active)`);
  for (const u of clientUsers) {
    console.log(`  UPDATE  Client user  → ${u.email}`);
    console.log(`            packageType:   ${u.packageType} → PRO`);
    console.log(`            isAgencyClient: ${u.isAgencyClient} → true`);
    console.log(`            agencyId:       <new agency _id>`);
    console.log(`            adminId:        <new agency _id>`);
    console.log('            (all other fields untouched)');
  }
  console.log('');

  if (isDryRun) {
    console.log('[DRY-RUN] No changes made. Remove --dry-run to apply.');
    await mongoose.connection.close();
    return;
  }

  // ── Step 4: Create the agency account ─────────────────────────────────────
  console.log('Creating agency account…');
  const hashedPw = await hashPassword(AGENCY.password);
  const agencyUser = new User({
    firstName:                AGENCY.firstName,
    lastName:                 AGENCY.lastName,
    phone:                    AGENCY.phone,
    whatsapp:                 AGENCY.phone,
    email:                    AGENCY.email.toLowerCase(),
    password:                 hashedPw,
    agencyName:               AGENCY.agencyName,
    packageType:              'AGENCY',
    accessType:               'enterpriseAdmin',  // required for agency-owner login flow (issues AdminToken)
    subscriptionStatus:       'active',
    isInTrialPeriod:          false,
    isVerified:               true,
    allTermsAndConditionsAgreed: true,
    OTP:                      null,
  });

  const savedAgency = await agencyUser.save();
  console.log(`  ✓ Agency account created: _id=${savedAgency._id}\n`);

  // ── Step 5: Link existing clients ─────────────────────────────────────────
  for (const u of clientUsers) {
    console.log(`Linking client ${u.email}…`);
    const result = await User.findByIdAndUpdate(
      u._id,
      {
        $set: {
          packageType:    'PRO',
          isAgencyClient: true,
          agencyId:       savedAgency._id,
          adminId:        savedAgency._id,
        },
      },
      { new: true, select: '_id email packageType isAgencyClient agencyId' }
    );
    console.log(`  ✓ Linked: packageType=${result.packageType}, isAgencyClient=${result.isAgencyClient}, agencyId=${result.agencyId}\n`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' Done.');
  console.log(`  Agency _id : ${savedAgency._id}`);
  console.log(`  Agency email: ${savedAgency.email}`);
  console.log(`  Clients linked: ${clientUsers.map(u => u.email).join(', ')}`);
  console.log('');
  console.log('  Next: update the agency phone number via the profile');
  console.log('        settings page if needed.');
  console.log('═══════════════════════════════════════════════════════════');

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  mongoose.connection.close().finally(() => process.exit(1));
});

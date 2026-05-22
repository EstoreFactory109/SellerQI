#!/usr/bin/env node
/**
 * Manually trigger the *full daily schedule* for one user/marketplace.
 *
 * Equivalent of the integration "admin trigger" endpoint, but for the
 * scheduled pipeline (sched_init → sched_batch_1_2 → sched_ads →
 * sched_batch_3 → sched_finance → sched_batch_4 → sched_calc_review →
 * sched_finalize).
 *
 * Pushes the INIT phase onto the BullMQ scheduled-jobs queue exactly the
 * same way `cronProducer` does. Your scheduled-jobs worker must be running
 * to actually execute the phases. After enqueueing, watch the worker logs
 * or query Redis/BullMQ UI for progress.
 *
 * Usage:
 *   node server/scripts/triggerDailyFinanceSyncForUser.js \
 *        --user-id=<mongoId> --country=US --region=NA
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

const Seller = require('../models/user-auth/sellerCentralModel.js');
const { enqueueScheduledAccountJob } = require('../Services/BackgroundJobs/producer.js');

function getArg(name) {
  const match = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1].trim() : null;
}

const USER_ID = getArg('user-id');
const COUNTRY = (getArg('country') || '').toUpperCase();
const REGION = (getArg('region') || '').toUpperCase();

if (!USER_ID || !COUNTRY || !REGION) {
  console.error('Missing required args. Usage:');
  console.error('  node server/scripts/triggerDailyFinanceSyncForUser.js \\');
  console.error('       --user-id=<mongoId> --country=US --region=NA');
  process.exit(1);
}

if (!['NA', 'EU', 'FE'].includes(REGION)) {
  console.error(`Invalid region "${REGION}". Expected NA | EU | FE.`);
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[trigger] Connected to ${dbConsts.dbName || MONGODB_URI}`);

  const userObjectId = mongoose.Types.ObjectId.isValid(USER_ID)
    ? new mongoose.Types.ObjectId(USER_ID)
    : USER_ID;

  // Sanity check: confirm the seller account exists before pushing a job
  const sellerCentral = await Seller.findOne({ User: userObjectId }).sort({ createdAt: -1 });
  if (!sellerCentral) throw new Error(`No Seller doc for User=${USER_ID}`);
  const sellerAccount = (sellerCentral.sellerAccount || []).find(
    (acc) => acc?.country === COUNTRY && acc?.region === REGION,
  );
  if (!sellerAccount) throw new Error(`No sellerAccount for ${COUNTRY}/${REGION} on this user`);
  if (!sellerAccount.spiRefreshToken) {
    throw new Error('spiRefreshToken missing — connect SP-API for this marketplace first.');
  }

  console.log(`[trigger] Enqueueing full daily schedule for user ${USER_ID} ${COUNTRY}-${REGION}...`);
  const result = await enqueueScheduledAccountJob(USER_ID.toString(), COUNTRY, REGION);

  console.log('\n[trigger] enqueueScheduledAccountJob result:');
  console.dir(result, { depth: 4 });

  if (result?.success) {
    console.log(`\n[trigger] Job queued. The scheduled-jobs worker will run INIT → BATCH_1_2 → ADS → BATCH_3 → FINANCE → BATCH_4 → CALC_REVIEW → FINALIZE.`);
    console.log('[trigger] Tail your worker logs to follow progress.');
  } else {
    console.log('\n[trigger] Job was NOT enqueued (likely already in progress — see message above).');
  }
}

main()
  .catch((err) => {
    console.error('[trigger] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {}
  });

#!/usr/bin/env node
/**
 * checkUserSyncDates.js
 *
 * Print the last N FinanceSyncLog entries for one (user, country, region).
 *
 * Usage:
 *   node server/scripts/checkUserSyncDates.js --user-id=<id> --country=IN --region=EU
 *   node server/scripts/checkUserSyncDates.js --user-id=<id> --country=IN --region=EU --limit=20
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const FinanceSyncLog = require('../models/finance/FinanceSyncLogModel.js');

function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}

const USER_ID = getArg('user-id');
const COUNTRY = (getArg('country') || '').toUpperCase();
const REGION = (getArg('region') || '').toUpperCase();
const LIMIT = parseInt(getArg('limit') || '10', 10);

if (!USER_ID || !COUNTRY || !REGION) {
  console.error('Missing args. Example:');
  console.error('  node server/scripts/checkUserSyncDates.js --user-id=69ce5770e7af88006e46a36d --country=IN --region=EU');
  process.exit(1);
}

(async () => {
  const uri = dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);

  const rows = await FinanceSyncLog.find({
    User: new mongoose.Types.ObjectId(USER_ID),
    country: COUNTRY,
    region: REGION
  })
    .sort({ date: -1 })
    .limit(LIMIT)
    .select({ date: 1, status: 1, fetchedAt: 1, error: 1, _id: 0 })
    .lean();

  console.log(`Last ${rows.length} FinanceSyncLog entries for ${USER_ID} ${COUNTRY}-${REGION}:\n`);
  console.log('date        | status     | fetchedAt                | error');
  console.log('-'.repeat(110));
  for (const r of rows) {
    console.log(
      [
        r.date,
        (r.status || '').padEnd(10),
        r.fetchedAt ? new Date(r.fetchedAt).toISOString() : '—',
        (r.error || '').slice(0, 60)
      ].join(' | ')
    );
  }

  await mongoose.disconnect();
})();

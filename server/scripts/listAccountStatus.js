#!/usr/bin/env node
/**
 * listAccountStatus.js
 *
 * Prints every connected account's daily-fetch status:
 *   - userId, country, region
 *   - dailyUpdateHour (UTC)
 *   - whether the account was marked complete today (UTC)
 *   - dailyAttempts (how many tries today; capped at 4 by Layer A)
 *   - lastDailyUpdate timestamp
 *
 * Usage:
 *   node server/scripts/listAccountStatus.js
 *   node server/scripts/listAccountStatus.js --not-done   # only accounts still pending today
 *   node server/scripts/listAccountStatus.js --capped     # only accounts at the retry cap
 *   node server/scripts/listAccountStatus.js --user-id=<mongoId>
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

const UserUpdateSchedule = require('../models/user-auth/UserUpdateScheduleModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const JobStatus = require('../models/system/JobStatusModel.js');

// A "running" JobStatus row is considered actually in-flight only if it was
// CREATED within the last STALE_RUNNING_MIN minutes. We use createdAt (phase
// start time) rather than updatedAt because the worker only writes JobStatus
// at phase start and phase end — there's no heartbeat in between. So a long
// ads/finance phase would have a stale updatedAt mid-run.
//
// Each phase has a BullMQ timeout of 2h. We set the threshold to 3h to be
// generous for the rare phase that legitimately takes that long. Anything
// older than 3h with status='running' is almost certainly an orphaned row
// from a worker that died mid-phase without flushing status.
const STALE_RUNNING_MIN = 180;

function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}
function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

const FILTER_USER_ID = getArg('user-id');
const NOT_DONE_ONLY = hasFlag('not-done');
const CAPPED_ONLY = hasFlag('capped');
const ONGOING_ONLY = hasFlag('ongoing');

function pad(value, width) {
  const s = String(value == null ? '' : value);
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[listAccountStatus] Connected to ${dbConsts.dbName || MONGODB_URI}\n`);

  const startOfTodayUtc = new Date(Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 0, 0, 0, 0
  ));

  const matchUser = FILTER_USER_ID
    ? { userId: new mongoose.Types.ObjectId(FILTER_USER_ID) }
    : {};

  const pipeline = [
    { $match: matchUser },
    { $unwind: '$sellerAccounts' },
    { $match: { 'sellerAccounts.country': { $ne: null } } },
    {
      $project: {
        userId: 1,
        country: '$sellerAccounts.country',
        region: '$sellerAccounts.region',
        dailyUpdateHour: 1,
        lastDailyUpdate: '$sellerAccounts.lastDailyUpdate',
        dailyAttempts: { $ifNull: ['$sellerAccounts.dailyAttempts', 0] },
        doneToday: {
          $cond: [
            { $gte: ['$sellerAccounts.lastDailyUpdate', startOfTodayUtc] },
            true,
            false
          ]
        }
      }
    },
    { $sort: { doneToday: -1, lastDailyUpdate: -1 } }
  ];

  const rows = await UserUpdateSchedule.aggregate(pipeline);

  // Batch-load brand names for every distinct user in one query.
  // `brand` is a top-level Seller field (not per-account), so the same brand
  // applies to all (country, region) rows for that user.
  const uniqueUserIds = [...new Set(rows.map((r) => r.userId.toString()))]
    .map((id) => new mongoose.Types.ObjectId(id));
  const sellers = await Seller.find(
    { User: { $in: uniqueUserIds } },
    { User: 1, brand: 1 }
  ).lean();
  const brandByUser = new Map();
  for (const s of sellers) {
    brandByUser.set(s.User.toString(), s.brand || '');
  }

  // Find currently-running pipelines via JobStatus.
  // A phase row is keyed by (userId, country, region) via its metadata.
  // We filter by createdAt (phase start time) rather than updatedAt — see
  // STALE_RUNNING_MIN comment above for why.
  const freshSince = new Date(Date.now() - STALE_RUNNING_MIN * 60 * 1000);
  const runningJobs = await JobStatus.find({
    status: 'running',
    createdAt: { $gte: freshSince }
  }).select({ userId: 1, metadata: 1, createdAt: 1, updatedAt: 1 }).lean();

  // Diagnostic: total 'running' rows in JobStatus (any age) — helps spot
  // when nothing is being written vs. when the freshness window is too tight.
  const allRunningCount = await JobStatus.countDocuments({ status: 'running' });

  // Build a lookup: "<userId>|<country>|<region>" → { phase, ageMin }
  const ongoingByKey = new Map();
  let skippedNoMetadata = 0;
  for (const j of runningJobs) {
    const md = j.metadata || {};
    if (!md.country || !md.region) {
      skippedNoMetadata++;
      continue;
    }
    const key = `${j.userId.toString()}|${md.country}|${md.region}`;
    const ageMin = Math.round((Date.now() - new Date(j.createdAt).getTime()) / 60000);
    // Keep the most-recently-created phase for this account (the latest one
    // in the pipeline — earlier phases of the same pipeline are already
    // completed and won't appear with status='running').
    const prev = ongoingByKey.get(key);
    if (!prev || ageMin < prev.ageMin) {
      ongoingByKey.set(key, { phase: md.phase || '?', ageMin });
    }
  }

  // Diagnostic line printed once — easy to see why "no ongoing" is showing.
  console.log(
    `[ongoing diag] JobStatus rows with status='running': ${allRunningCount} total | ` +
    `${runningJobs.length} within last ${STALE_RUNNING_MIN}m | ` +
    `${skippedNoMetadata} skipped due to missing metadata.country/region | ` +
    `${ongoingByKey.size} mapped to (user, country, region)\n`
  );

  const filtered = rows.filter((r) => {
    const key = `${r.userId.toString()}|${r.country}|${r.region}`;
    const ongoing = ongoingByKey.get(key);
    if (NOT_DONE_ONLY && r.doneToday) return false;
    if (CAPPED_ONLY && (r.dailyAttempts || 0) < 4) return false;
    if (ONGOING_ONLY && !ongoing) return false;
    return true;
  });

  // Header
  console.log(
    pad('userId', 26),
    pad('brand', 24),
    pad('cc', 3),
    pad('rgn', 4),
    pad('hr', 3),
    pad('doneToday', 10),
    pad('ongoing', 28),
    pad('attempts', 9),
    'lastDailyUpdate'
  );
  console.log('-'.repeat(160));

  for (const r of filtered) {
    const brand = brandByUser.get(r.userId.toString()) || '—';
    const key = `${r.userId.toString()}|${r.country}|${r.region}`;
    const ongoing = ongoingByKey.get(key);
    const ongoingCell = ongoing
      ? `🟢 ${ongoing.phase} (${ongoing.ageMin}m)`
      : '—';
    console.log(
      pad(r.userId.toString(), 26),
      pad(brand, 24),
      pad(r.country || '?', 3),
      pad(r.region || '?', 4),
      pad(r.dailyUpdateHour ?? '?', 3),
      pad(r.doneToday ? 'YES' : 'no', 10),
      pad(ongoingCell, 28),
      pad(r.dailyAttempts || 0, 9),
      r.lastDailyUpdate ? new Date(r.lastDailyUpdate).toISOString() : 'never'
    );
  }

  // Summary
  const total = rows.length;
  const doneToday = rows.filter((r) => r.doneToday).length;
  const capped = rows.filter((r) => (r.dailyAttempts || 0) >= 4).length;
  const neverSynced = rows.filter((r) => !r.lastDailyUpdate).length;
  const ongoingCount = rows.filter((r) => {
    const key = `${r.userId.toString()}|${r.country}|${r.region}`;
    return ongoingByKey.has(key);
  }).length;

  console.log('\n' + '='.repeat(60));
  console.log(`Total accounts:  ${total}`);
  console.log(`  Done today:    ${doneToday}`);
  console.log(`  Still pending: ${total - doneToday}`);
  console.log(`  Ongoing now:   ${ongoingCount} (running within last ${STALE_RUNNING_MIN}m)`);
  console.log(`  Capped (>=4):  ${capped}`);
  console.log(`  Never synced:  ${neverSynced}`);
  console.log(`  Shown:         ${filtered.length}`);
}

main()
  .catch((err) => {
    console.error('[listAccountStatus] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await mongoose.disconnect(); } catch {}
  });

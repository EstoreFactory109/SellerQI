#!/usr/bin/env node
/**
 * diagnoseDailySchedule.js
 *
 * Answers: "why is the daily schedule not fetching/storing data?"
 *
 * The pipeline:
 *   cron-producer (hourly @ :00)
 *     → enqueueUsersForDailyUpdate()                       [eligibility]
 *       → enqueueScheduledAccountJob(user, country, region) [BullMQ]
 *         → worker(`worker`) runs phases:
 *           INIT → BATCH_1_2 → ADS → BATCH_3 → FINANCE → BATCH_4 → CALC_REVIEW → FINALIZE
 *
 * This script inspects each layer and prints what's wrong, with a single
 * "ROOT CAUSE" summary at the end. Run on prod (where DB_URI/REDIS are set).
 *
 *   node server/scripts/diagnoseDailySchedule.js
 *   node server/scripts/diagnoseDailySchedule.js --user-id=<id>   # zoom in
 *   node server/scripts/diagnoseDailySchedule.js --hours=48       # widen JobStatus window
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
const UserUpdateSchedule = require('../models/user-auth/UserUpdateScheduleModel.js');
const JobStatus = require('../models/system/JobStatusModel.js');
const OrchestrationCronLock = require('../models/system/OrchestrationCronLockModel.js');
const FinanceSyncLog = require('../models/finance/FinanceSyncLogModel.js');

function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}
const FILTER_USER_ID = getArg('user-id');
const HOURS_BACK = parseInt(getArg('hours') || '24', 10);

function hAgo(ms) {
  if (ms == null) return 'never';
  const s = (Date.now() - new Date(ms).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function section(title) {
  console.log(`\n──── ${title} ────`);
}

const findings = []; // root-cause flags accumulate here

async function checkEligibility() {
  section('1. CRON ELIGIBILITY (UserUpdateSchedule)');

  const total = await UserUpdateSchedule.countDocuments();
  const withHour = await UserUpdateSchedule.countDocuments({ dailyUpdateHour: { $ne: null } });

  const startOfTodayUtc = new Date(Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 0, 0, 0, 0
  ));
  const updatedToday = await UserUpdateSchedule.countDocuments({ lastDailyUpdate: { $gte: startOfTodayUtc } });
  const updated24h = await UserUpdateSchedule.countDocuments({
    lastDailyUpdate: { $gte: new Date(Date.now() - 24 * 3600 * 1000) }
  });

  const currentHour = new Date().getUTCHours();
  const eligibleNow = await UserUpdateSchedule.countDocuments({
    dailyUpdateHour: currentHour,
    $or: [{ lastDailyUpdate: null }, { lastDailyUpdate: { $lt: startOfTodayUtc } }]
  });
  const dueThisHour = await UserUpdateSchedule.countDocuments({ dailyUpdateHour: currentHour });

  console.log(`Schedules total: ${total}`);
  console.log(`  with dailyUpdateHour set: ${withHour}`);
  console.log(`  updated today (UTC):      ${updatedToday}`);
  console.log(`  updated in last 24h:      ${updated24h}`);
  console.log(`Current UTC hour:           ${currentHour}`);
  console.log(`  schedules with this hour: ${dueThisHour}`);
  console.log(`  eligible right now:       ${eligibleNow}`);

  // Hour distribution
  const dist = await UserUpdateSchedule.aggregate([
    { $match: { dailyUpdateHour: { $ne: null } } },
    { $group: { _id: '$dailyUpdateHour', n: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  console.log('Hour distribution (UTC):');
  for (const r of dist) {
    const bar = '#'.repeat(Math.min(40, Math.ceil(r.n / Math.max(1, total / 100))));
    console.log(`  ${String(r._id).padStart(2, '0')}h: ${String(r.n).padStart(4)} ${bar}`);
  }

  if (total === 0) findings.push('CRITICAL: UserUpdateSchedule has 0 docs — no user is eligible for any daily run.');
  if (withHour === 0) findings.push('CRITICAL: no user has dailyUpdateHour set — cron never matches anyone.');
  if (total > 0 && updated24h / total >= 0.98) {
    findings.push('All users were marked complete in the last 24h. If FinanceSyncLog/PPCMetrics are stale, FINALIZE phase is marking complete without successful data fetches.');
  }
}

async function checkLock() {
  section('2. HOURLY TICK LOCK (OrchestrationCronLockModel)');
  const all = await OrchestrationCronLock.find({}).sort({ lockedUntil: -1 }).limit(10).lean();
  if (all.length === 0) {
    console.log('No locks present. (Locks self-expire after the hour they cover; emptiness is fine.)');
    return;
  }
  const now = Date.now();
  for (const l of all) {
    const live = new Date(l.lockedUntil).getTime() > now ? 'LIVE' : 'expired';
    console.log(`  ${l.lockKey}  holder=${l.holder}  until=${l.lockedUntil?.toISOString?.()}  ${live}`);
  }
  const dailyLive = all.filter(l => l.lockKey?.startsWith('daily-update-cron-') && new Date(l.lockedUntil).getTime() > now);
  if (dailyLive.length > 1) findings.push(`Multiple live daily-update locks (${dailyLive.length}) — duplicate cron-producer instances racing.`);
}

async function checkQueue() {
  section('3. BULLMQ QUEUE STATE (scheduled jobs)');
  let getQueue;
  try {
    ({ getQueue } = require('../Services/BackgroundJobs/queue.js'));
  } catch (e) {
    console.log('Could not load queue module:', e.message);
    findings.push('Queue module failed to load — Redis env vars likely missing on this host.');
    return;
  }
  let queue;
  try {
    queue = getQueue();
  } catch (e) {
    console.log('Could not instantiate queue:', e.message);
    findings.push('Queue instantiation failed — cron-producer cannot enqueue and worker cannot consume.');
    return;
  }

  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
  console.log('Job counts by state:', counts);

  if (counts.paused > 0) findings.push(`Queue is paused (${counts.paused} jobs) — worker won't pick up new work.`);
  if (counts.active === 0 && counts.waiting === 0 && counts.delayed === 0) {
    // queue is empty — could mean either (a) nothing was enqueued this hour or (b) worker already drained it
  }

  // Inspect the oldest waiting and failed jobs
  const waiting = await queue.getJobs(['waiting'], 0, 4);
  const delayed = await queue.getJobs(['delayed'], 0, 4);
  const failed = await queue.getJobs(['failed'], 0, 9);
  const active = await queue.getJobs(['active'], 0, 4);

  if (active.length) {
    console.log('\nActive (currently being processed):');
    for (const j of active) {
      console.log(`  ${j.id}  user=${j.data.userId} ${j.data.country}-${j.data.region} phase=${j.data.phase} age=${hAgo(j.timestamp)}`);
    }
  }
  if (waiting.length) {
    console.log('\nWaiting (oldest 5):');
    for (const j of waiting) {
      console.log(`  ${j.id}  user=${j.data.userId} ${j.data.country}-${j.data.region} phase=${j.data.phase} age=${hAgo(j.timestamp)}`);
    }
    if (waiting[0] && (Date.now() - waiting[0].timestamp) > 30 * 60 * 1000) {
      findings.push(`Oldest waiting job is ${hAgo(waiting[0].timestamp)} — worker is not consuming. Is the \`worker\` PM2 app running?`);
    }
  }
  if (delayed.length) {
    console.log('\nDelayed / backoff retries (oldest 5):');
    for (const j of delayed) {
      console.log(`  ${j.id}  user=${j.data.userId} ${j.data.country}-${j.data.region} phase=${j.data.phase} attempts=${j.attemptsMade} age=${hAgo(j.timestamp)}`);
    }
  }
  if (failed.length) {
    console.log('\nFailed (most recent 10):');
    for (const j of failed) {
      const reason = (j.failedReason || '').slice(0, 160);
      console.log(`  ${j.id}  user=${j.data.userId} ${j.data.country}-${j.data.region} phase=${j.data.phase} attempts=${j.attemptsMade}  reason="${reason}"`);
    }
  }

  // We don't close the queue here because there's no clean disconnect helper
  // exported; leaving the connection open is fine for a short-lived diagnostic.
}

async function checkJobStatus() {
  section(`4. JOBSTATUS HISTORY (last ${HOURS_BACK}h)`);
  const since = new Date(Date.now() - HOURS_BACK * 3600 * 1000);
  const match = { createdAt: { $gte: since } };
  if (FILTER_USER_ID) match.userId = new mongoose.Types.ObjectId(FILTER_USER_ID);

  const counts = await JobStatus.aggregate([
    { $match: match },
    { $group: { _id: { status: '$status', phase: '$metadata.phase' }, n: { $sum: 1 } } },
    { $sort: { '_id.phase': 1, '_id.status': 1 } }
  ]);
  if (counts.length === 0) {
    console.log(`No JobStatus rows in the last ${HOURS_BACK}h${FILTER_USER_ID ? ` for user ${FILTER_USER_ID}` : ''}.`);
    findings.push(`No JobStatus rows in last ${HOURS_BACK}h — cron-producer is not running OR not enqueueing OR worker not writing JobStatus.`);
    return;
  }

  console.log('Status x phase counts:');
  for (const c of counts) {
    console.log(`  ${String(c._id.phase || '(legacy)').padEnd(20)} ${String(c._id.status).padEnd(10)} ${c.n}`);
  }

  // Most common error messages
  const errs = await JobStatus.aggregate([
    { $match: { ...match, status: 'failed', error: { $exists: true, $ne: '' } } },
    { $group: { _id: { phase: '$metadata.phase', error: { $substr: ['$error', 0, 140] } }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 10 }
  ]);
  if (errs.length) {
    console.log('\nTop failure messages:');
    for (const e of errs) {
      console.log(`  [${e.n}x] phase=${e._id.phase || '?'}: ${e._id.error}`);
    }
    // Heuristics
    const allText = errs.map(e => (e._id.error || '').toLowerCase()).join(' | ');
    if (allText.includes('access token') || allText.includes('unauthorized')) {
      findings.push('Auth / expired-token errors appear in JobStatus — verify the FinanceService auto-renewal fix is deployed.');
    }
    if (allText.includes('econnrefused') || allText.includes('mongo') || allText.includes('redis')) {
      findings.push('Connection errors (Mongo/Redis) in JobStatus — infra outage.');
    }
    if (allText.includes('timeout')) {
      findings.push('Timeouts in JobStatus — a phase exceeded BullMQ timeout (2h) or SP-API kept retrying.');
    }
  }

  // FINALIZE phase: did it run today?
  const finalizeRecent = await JobStatus.find({
    'metadata.phase': 'sched_finalize',
    status: 'completed',
    completedAt: { $gte: since }
  }).sort({ completedAt: -1 }).limit(5).lean();
  console.log(`\nFINALIZE completions in window: ${finalizeRecent.length}`);
  for (const j of finalizeRecent) {
    console.log(`  ${j.jobId}  user=${j.userId}  ${hAgo(j.completedAt)} ago  dur=${j.duration}ms`);
  }
  if (finalizeRecent.length === 0 && counts.some(c => c._id.phase === 'sched_init')) {
    findings.push('INIT phases ran but FINALIZE never completed — the chain breaks somewhere mid-pipeline (check failed JobStatus rows for which phase).');
  }
}

async function checkFinanceFreshness() {
  section('5. FINANCE DATA FRESHNESS (FinanceSyncLog)');
  // For each account that has SP-API, what's the latest finance sync date?
  const sellerMatch = FILTER_USER_ID
    ? { User: new mongoose.Types.ObjectId(FILTER_USER_ID) }
    : {};
  const sellers = await Seller.find(sellerMatch, { User: 1, sellerAccount: 1 }).lean();
  let connected = 0, fresh = 0, stale = 0, neverSynced = 0;
  const examples = [];

  const yesterdayPacific = (() => {
    const ms = Date.now() - 7 * 3600000 - 86400000;
    return new Date(ms).toISOString().substring(0, 10);
  })();

  for (const s of sellers) {
    for (const acct of (s.sellerAccount || [])) {
      if (!acct?.spiRefreshToken) continue;
      connected++;
      const latest = await FinanceSyncLog.findOne(
        { User: s.User, country: acct.country?.toUpperCase(), region: acct.region?.toUpperCase() },
        { date: 1, status: 1, fetchedAt: 1, error: 1 }
      ).sort({ date: -1 }).lean();
      if (!latest) { neverSynced++; continue; }
      const days = Math.round(
        (new Date(`${yesterdayPacific}T00:00:00Z`) - new Date(`${latest.date}T00:00:00Z`)) / 86400000
      );
      if (days <= 1) fresh++;
      else {
        stale++;
        if (examples.length < 5) examples.push({ user: s.User.toString(), country: acct.country, region: acct.region, latest: latest.date, days, status: latest.status, err: (latest.error || '').slice(0, 100) });
      }
    }
  }
  console.log(`Connected accounts: ${connected}`);
  console.log(`  fresh (<=1d behind yesterday): ${fresh}`);
  console.log(`  stale (>=2d behind):           ${stale}`);
  console.log(`  never synced:                  ${neverSynced}`);
  if (examples.length) {
    console.log('Sample stale accounts:');
    for (const e of examples) console.log(`  ${e.user} ${e.country}-${e.region}  latest=${e.latest}  ${e.days}d behind  status=${e.status}  err="${e.err}"`);
  }
  if (connected > 0 && stale + neverSynced >= connected * 0.5) {
    findings.push(`Finance data is stale on ${stale + neverSynced}/${connected} connected accounts — daily Finance phase is not producing data.`);
  }
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[diag] Connected to ${dbConsts.dbName || MONGODB_URI}`);
  console.log(`[diag] UTC now: ${new Date().toISOString()}  | Pacific yesterday: ${(() => new Date(Date.now() - 7 * 3600000 - 86400000).toISOString().substring(0, 10))()}`);

  await checkEligibility();
  await checkLock();
  await checkQueue();
  await checkJobStatus();
  await checkFinanceFreshness();

  section('ROOT-CAUSE SUMMARY');
  if (findings.length === 0) {
    console.log('No suspicious signals found in the data. If data is still not landing, watch the live logs:');
    console.log('  pm2 logs cron-producer --lines 100   # confirm hourly tick fires');
    console.log('  pm2 logs worker --lines 200 --err    # confirm worker processes phases');
  } else {
    findings.forEach((f, i) => console.log(`${i + 1}. ${f}`));
  }
}

main()
  .catch((err) => {
    console.error('[diag] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await mongoose.disconnect(); } catch {}
    // Force-exit because the BullMQ queue/Redis connection keeps the event loop alive.
    setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
  });

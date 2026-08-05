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
const PendingExpenseOrder = require('../models/finance/PendingExpenseOrderModel.js');

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

/**
 * The async report engine's state lives in AsyncReportRequest, and nothing could read it — so
 * "is the async finance path actually working?" had no answer short of a raw mongo shell.
 *
 * This is the section that tells you: one row per (chunk, phase) with the Amazon reportId, how many
 * times we've polled it, and why it stopped if it did. Two things to look for:
 *   - MORE THAN ONE row per paramsKey => we are duplicating reports, i.e. the bug this engine
 *     exists to prevent has come back.
 *   - SUBMITTED with pollAttempts near maxPollAttempts => Amazon is sitting on the report and the
 *     chunk is about to be marked FAILED.
 *
 * Note the collection has a 30-day TTL on createdAt, so older runs simply won't be here.
 */
async function checkAsyncReportRequests() {
  section('6. ASYNC REPORT ENGINE (AsyncReportRequest)');

  let AsyncReportRequest;
  try {
    AsyncReportRequest = require('../models/amazon-ads/AsyncReportRequestModel.js');
  } catch (err) {
    console.log(`Model not loadable (${err.message}) — async engine not deployed here.`);
    return;
  }

  const q = FILTER_USER_ID ? { userId: String(FILTER_USER_ID) } : {};
  const rows = await AsyncReportRequest.find(q).sort({ updatedAt: -1 }).limit(200).lean();

  if (rows.length === 0) {
    console.log('No rows. Either the async path has never run here, or its flags are off');
    console.log('  (finance: FINANCE_ASYNC_ENABLED [+ FINANCE_ASYNC_USER_IDS]; ads/SP-API: ADS_ASYNC_ENABLED).');
    return;
  }

  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log(`${rows.length} row(s) (newest 200). By status: ` +
    Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join('  '));

  console.log('\n  UPDATED (UTC)        PHASE    STATUS      POLLS    SERVICE / paramsKey');
  console.log('  ' + '-'.repeat(100));
  for (const r of rows.slice(0, 40)) {
    const polls = `${r.pollAttempts || 0}/${r.maxPollAttempts || '?'}`;
    console.log(
      `  ${String(r.updatedAt?.toISOString?.() || '').substring(0, 19).padEnd(20)} ` +
      `${String(r.phase || '?').padEnd(8)} ${String(r.status || '?').padEnd(11)} ${polls.padEnd(8)} ` +
      `${r.service}/${r.paramsKey || '-'}${r.reportId ? `  report=${r.reportId}` : ''}`
    );
    // 200, not 120: the note now carries a `[hop]` tag plus the error code, and clipping at 120 cut
    // exactly the part that says WHICH hop failed — the whole point of adding the tag.
    if (r.note) console.log(`  ${' '.repeat(20)} note: ${String(r.note).slice(0, 200)}`);
  }

  // Duplicate detection — the regression that would mean we are jamming the seller's queue again.
  const seen = new Map();
  for (const r of rows) {
    const k = `${r.userId}|${r.country}|${r.region}|${r.group}|${r.service}|${r.paramsKey}|${r.runDate}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length) {
    console.log(`\n! ${dupes.length} duplicate (account, group, service, paramsKey, runDate) key(s) — ` +
      `the engine should hold exactly one row per chunk.`);
    findings.push(`AsyncReportRequest has ${dupes.length} duplicated chunk key(s) — duplicate Amazon reports are being created.`);
  }

  const nearCap = rows.filter(r => r.status === 'SUBMITTED' && (r.pollAttempts || 0) >= (r.maxPollAttempts || 240) * 0.8);
  if (nearCap.length) {
    console.log(`\n! ${nearCap.length} SUBMITTED row(s) past 80% of their poll cap — Amazon is slow to build these; they will be marked FAILED at the cap.`);
  }
  const failed = rows.filter(r => r.status === 'FAILED');
  if (failed.length) {
    findings.push(`AsyncReportRequest has ${failed.length} FAILED row(s) (newest 200) — see notes above for the cause.`);
  }
}

/**
 * Finance per-date retry state: which dates are BACKED OFF, and which have been GIVEN UP ON.
 *
 * WHY THIS SECTION EXISTS
 * Capping retries stops a permanently-broken window looping ~8x/day, but a capped date keeps
 * estimated (or absent) fees FOREVER and the sweeper will never touch it again. That trade is only
 * acceptable if it is loud. Until now it was completely silent: freshnessSweeper logs its skip
 * counts via `logger.debug`, and Logger drops `debug` in production — so there was no signal at all.
 *
 * RECOVERY: a capped date is not permanently doomed. Clearing `consecutiveFailures`/`nextRetryAfter`
 * on its FinanceSyncLog rows makes the next sweeper tick re-enqueue it with a fresh budget. Worth
 * doing once the underlying cause (see the `[hop]` tag in the error text) is actually fixed.
 */
async function checkFinanceRetryBackoff() {
  console.log('\n──── 8. FINANCE PER-DATE RETRY STATE (backoff / given-up) ────');

  // Bucketed by the SAME helper the sweeper and the chunk walk use, so the three cannot disagree
  // about whether a date is dead. Reimplementing the cap check here is how that drift starts.
  let classifyFinanceRetryState, FINANCE_MAX_DATE_RETRIES;
  try {
    ({ classifyFinanceRetryState, FINANCE_MAX_DATE_RETRIES } = require('../Services/Sp_API/FinanceService.js'));
  } catch (e) {
    console.log(`  (FinanceService failed to load: ${e.message})`);
    return;
  }

  const since = new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10);
  const q = { status: 'failed', date: { $gte: since } };
  if (FILTER_USER_ID) q.User = new mongoose.Types.ObjectId(FILTER_USER_ID);

  const rows = await FinanceSyncLog.find(q, {
    User: 1, country: 1, region: 1, date: 1, consecutiveFailures: 1, nextRetryAfter: 1,
    errorKind: 1, error: 1, fetchedAt: 1,
  }).lean();

  if (!rows.length) {
    console.log(`  No failed finance dates in the last 30 days${FILTER_USER_ID ? ' for this user' : ''}. Nothing backed off or given up on.`);
    return;
  }

  const byAccount = new Map();
  for (const r of rows) {
    const key = `${r.User}|${r.country}-${r.region}`;
    if (!byAccount.has(key)) byAccount.set(key, { capped: [], backed_off: [], due: [], kinds: {}, newest: null });
    const acc = byAccount.get(key);
    acc[classifyFinanceRetryState(r)].push(r.date);
    acc.kinds[r.errorKind || 'unknown'] = (acc.kinds[r.errorKind || 'unknown'] || 0) + 1;
    if (!acc.newest || new Date(r.fetchedAt || 0) > new Date(acc.newest.fetchedAt || 0)) acc.newest = r;
  }

  let totalCapped = 0;
  let totalBackedOff = 0;
  let worst = null;
  for (const [key, acc] of byAccount) {
    totalCapped += acc.capped.length;
    totalBackedOff += acc.backed_off.length;
    if (!worst || acc.capped.length > worst.acc.capped.length) worst = { key, acc };

    const kinds = Object.entries(acc.kinds).map(([k, v]) => `${k}:${v}`).join(',');
    console.log(
      `  ${key}  capped=${acc.capped.length} backed_off=${acc.backed_off.length} due=${acc.due.length}  kinds=${kinds}`
    );
    if (acc.capped.length) {
      const shown = acc.capped.sort().slice(0, 15);
      console.log(`      GIVEN UP (>=${FINANCE_MAX_DATE_RETRIES} failures): ${shown.join(', ')}${acc.capped.length > 15 ? ` … +${acc.capped.length - 15} more` : ''}`);
    }
    // 160 chars so the `[hop]` tag and error code survive — that is what names the failing hop.
    if (acc.newest?.error) console.log(`      newest error: ${String(acc.newest.error).slice(0, 160)}`);
  }

  if (totalCapped) {
    findings.push(
      `CRITICAL: ${totalCapped} finance date(s) across ${[...byAccount.values()].filter(a => a.capped.length).length} account(s) ` +
      `are PAST the retry cap (>=${FINANCE_MAX_DATE_RETRIES} consecutive failures) and will NEVER be retried by the sweeper — ` +
      `they keep estimated/absent fees. Worst: ${worst.key} (${worst.acc.capped.length} dates). ` +
      `Fix the cause, then clear consecutiveFailures/nextRetryAfter on those rows to re-enable them.`
    );
    const cappedKinds = new Set();
    for (const acc of byAccount.values()) {
      if (acc.capped.length) Object.keys(acc.kinds).forEach(k => cappedKinds.add(k));
    }
    if (cappedKinds.size === 1 && cappedKinds.has('timeout')) {
      findings.push(
        `All capped dates bucket as 'timeout' — a TRANSPORT failure, not an Amazon rejection. ` +
        `Check the [hop] tag in the error text above to see which network hop is dying.`
      );
    }
  }
  if (totalBackedOff) {
    findings.push(
      `${totalBackedOff} finance date(s) are in retry backoff — expected after a transient failure, but a growing ` +
      `count means a window that cannot succeed.`
    );
  }
}

/**
 * Step 2 (pending-fee backfill) slice progress.
 *
 * Without this, "is the backlog actually draining?" is unanswerable: the sliced walk deliberately
 * covers only part of the window per run, so a single run's `resolved: 0` says nothing on its own.
 * What matters is whether `coveredUntil` is marching back toward `windowStart` and whether the
 * pending count is falling across runs.
 */
async function checkStep2Cursors() {
  section('7. FINANCE STEP 2 BACKFILL CURSOR (FinanceBackfillCursor)');

  let FinanceBackfillCursor;
  try {
    FinanceBackfillCursor = require('../models/finance/FinanceBackfillCursorModel.js');
  } catch {
    console.log('Model not present in this build — skipping.');
    return;
  }

  const match = FILTER_USER_ID ? { User: new mongoose.Types.ObjectId(FILTER_USER_ID) } : {};
  const cursors = await FinanceBackfillCursor.find(match).sort({ updatedAt: -1 }).limit(50).lean();

  if (cursors.length === 0) {
    console.log('No cursors. Step 2 slicing has never run for this scope');
    console.log('(expected unless FINANCE_STEP2_SLICING_ENABLED is set for the account).');
    return;
  }

  console.log('\n  UPDATED (UTC)        CC-RGN  WINDOW                    COVERED-TO   SLICE  PASS  RESOLVED  PENDING');
  console.log('  ' + '-'.repeat(108));

  for (const c of cursors) {
    const pending = await PendingExpenseOrder.countDocuments({
      User: c.User, country: c.country, region: c.region,
    });
    const complete = c.coveredUntil <= c.windowStart;
    console.log(
      `  ${String(c.updatedAt?.toISOString?.() || '').substring(0, 19).padEnd(20)} ` +
      `${`${c.country}-${c.region}`.padEnd(7)} ` +
      `${`${c.windowStart}→${c.windowEnd}`.padEnd(25)} ` +
      `${String(c.coveredUntil).padEnd(12)} ` +
      `${String(c.slicesDone || 0).padEnd(6)} ` +
      `${String(c.passesCompleted || 0).padEnd(5)} ` +
      `${String(c.resolvedThisPass || 0).padEnd(9)} ${pending}` +
      (complete ? '   [pass complete — next run restarts]' : '')
    );

    // A cursor that has not moved in over a day means Step 2 is not running for this account at all,
    // which on a large backlog reads identically to "draining slowly" unless you look here.
    const ageH = (Date.now() - new Date(c.lastRunAt || c.updatedAt).getTime()) / 3600000;
    if (ageH > 26 && pending > 0) {
      console.log(`  ${' '.repeat(20)} ! last run ${ageH.toFixed(1)}h ago with ${pending} still pending — Step 2 may not be running.`);
      findings.push(`Step 2 cursor for ${c.country}-${c.region} is ${ageH.toFixed(0)}h stale with ${pending} pending orders.`);
    }
    if (c.claimedUntil && new Date(c.claimedUntil) > new Date()) {
      console.log(`  ${' '.repeat(20)} (a run currently holds a claim until ${new Date(c.claimedUntil).toISOString().substring(0, 19)})`);
    }
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
  await checkAsyncReportRequests();
  await checkStep2Cursors();
  await checkFinanceRetryBackoff();

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

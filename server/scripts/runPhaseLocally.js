#!/usr/bin/env node
/**
 * runPhaseLocally.js
 *
 * Invoke a single scheduled phase (or the finance fetch) directly, in-process,
 * and print the FULL error + stack. Use this to reproduce the failures that show
 * up in prod as `{}` (now that the logger serializes errors properly) — e.g. the
 * finance catch-up and batch_1_2 failures — and see the real cause.
 *
 * It runs the SAME code the worker runs, just without BullMQ, so the exception
 * surfaces directly on your console.
 *
 * Requires your local .env to point at a DB that has this user's data (and valid
 * SP-API creds). It connects to Mongo (+ Redis cache, best-effort) like the
 * standalone workers do.
 *
 * Usage:
 *   node server/scripts/runPhaseLocally.js --phase=finance_catchup --user-id=<id> --country=US --region=NA --dates=2026-05-28
 *   node server/scripts/runPhaseLocally.js --phase=batch_1_2       --user-id=<id> --country=US --region=NA
 *   node server/scripts/runPhaseLocally.js --phase=finance         --user-id=<id> --country=US --region=NA
 *   node server/scripts/runPhaseLocally.js --phase=ads_catchup     --user-id=<id> --country=US --region=NA --dates=2026-05-28
 *   node server/scripts/runPhaseLocally.js --phase=sync            --user-id=<id> --country=US --region=NA --dates=2026-05-28,2026-06-09   (direct syncFinanceData forceDates)
 *
 * Valid --phase values:
 *   init | batch_1_2 | ads | batch_3 | finance | batch_4 | calc_review | finalize
 *   ads_catchup | finance_catchup | sync
 *
 * Async phases (FINANCE_ASYNC_ENABLED / ADS_ASYNC_ENABLED on) return after SUBMIT and ask to be
 * rescheduled; normally the worker does that. Add --drive-async to loop here instead:
 *   FINANCE_ASYNC_ENABLED=true node server/scripts/runPhaseLocally.js --phase=finance \
 *     --user-id=<id> --country=US --region=NA --drive-async --poll-every-ms=30000
 *   --poll-every-ms  wait between ticks, overriding production's delay (default 30000)
 *   --max-ticks      safety stop (default 200)
 * Without --drive-async an async phase submits one report and exits — the chunk walk never
 * advances, which looks like a hang but is just the missing worker.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const dbConnect = require('../config/dbConn.js');
let connectRedis;
try { ({ connectRedis } = require('../config/redisConn.js')); } catch (_) { connectRedis = null; }

const { ScheduledIntegration } = require('../Services/schedule/ScheduledIntegration.js');

function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}

const PHASE = (getArg('phase') || '').toLowerCase();
const USER_ID = getArg('user-id');
const COUNTRY = (getArg('country') || '').toUpperCase();
const REGION = (getArg('region') || '').toUpperCase();
const DATES = (getArg('dates') || '').split(',').map((d) => d.trim()).filter(Boolean);

// --drive-async: loop the phase through its reschedules instead of returning after the first tick.
// Required to exercise any async phase locally — see driveAsync() below.
const DRIVE_ASYNC = process.argv.slice(2).includes('--drive-async');
const POLL_EVERY_MS = parseInt(getArg('poll-every-ms') || '30000', 10);
const MAX_TICKS = parseInt(getArg('max-ticks') || '200', 10);

if (!PHASE || !USER_ID || !COUNTRY || !REGION) {
  console.error('Missing args. Example:');
  console.error('  node server/scripts/runPhaseLocally.js --phase=finance_catchup --user-id=<id> --country=US --region=NA --dates=2026-05-28');
  process.exit(1);
}

/**
 * Look up the SP-API refresh token for one seller account. Mirrors the resolution order used by
 * the scheduled processors and the other finance scripts.
 */
async function resolveSpiRefreshToken(userId, country, region) {
  const Seller = require('../models/user-auth/sellerCentralModel.js');
  const sellerCentral = await Seller.findOne({ User: userId }).lean();
  const account = (sellerCentral?.sellerAccount || []).find(
    (acc) => acc.country === country && acc.region === region
  );
  if (!account) {
    throw new Error(`No seller account for ${country}/${region} on user ${userId}`);
  }
  const token = account.spiRefreshToken || account.spRefreshToken || account.refreshToken;
  if (!token) {
    throw new Error(`Seller account ${country}/${region} has no SP-API refresh token`);
  }
  return token;
}

async function invoke(phaseData = {}) {
  const SI = ScheduledIntegration;
  switch (PHASE) {
    case 'init':         return SI.executeScheduledInitPhase(USER_ID, REGION, COUNTRY);
    case 'batch_1_2':    return SI.executeScheduledBatch1And2Phase(USER_ID, REGION, COUNTRY, phaseData);
    case 'ads':          return SI.executeScheduledAdsPhase(USER_ID, REGION, COUNTRY, phaseData);
    case 'batch_3':      return SI.executeScheduledBatch3Phase(USER_ID, REGION, COUNTRY, phaseData);
    case 'finance':      return SI.executeScheduledFinancePhase(USER_ID, REGION, COUNTRY, phaseData);
    case 'batch_4':      return SI.executeScheduledBatch4Phase(USER_ID, REGION, COUNTRY, phaseData);
    case 'calc_review':  return SI.executeScheduledCalcReviewPhase(USER_ID, REGION, COUNTRY, phaseData);
    case 'finalize':     return SI.executeScheduledFinalizePhase(USER_ID, REGION, COUNTRY, phaseData);
    case 'ads_catchup':
      if (!DATES.length) throw new Error('ads_catchup needs --dates=YYYY-MM-DD');
      return SI.executeAdsCatchupPhase(USER_ID, REGION, COUNTRY, { ...phaseData, catchupDate: DATES[0] });
    case 'finance_catchup':
      if (!DATES.length) throw new Error('finance_catchup needs --dates=YYYY-MM-DD[,YYYY-MM-DD]');
      return SI.executeFinanceCatchupPhase(USER_ID, REGION, COUNTRY, { ...phaseData, catchupDates: DATES });
    case 'sync': {
      if (DATES.length !== 2) throw new Error('sync needs --dates=START,END (two dates)');
      const { syncFinanceData } = require('../Services/Sp_API/FinanceService.js');
      // Resolve the seller's refresh token, as the other finance scripts do. Passing it as
      // `undefined` (the previous behaviour) made this phase unusable: createTokenManager needs
      // a refresh token, so every invocation threw before doing any work.
      const refreshToken = await resolveSpiRefreshToken(USER_ID, COUNTRY, REGION);
      return syncFinanceData({
        userId: USER_ID, country: COUNTRY, regionModel: REGION,
        refreshToken, accessToken: undefined,
        clientId: process.env.SPAPI_CLIENT_ID, clientSecret: process.env.SPAPI_CLIENT_SECRET,
        forceDates: [DATES[0], DATES[1]],
      });
    }
    default:
      throw new Error(`Unknown --phase=${PHASE}`);
  }
}

/**
 * Drive an async phase to completion locally.
 *
 * In production a phase that isn't finished returns `{ reschedule: { delayMs, pollAttempt } }` and
 * the WORKER re-enqueues it as a delayed BullMQ job (worker.js:310-345). This script has no worker,
 * so without this loop an async phase would submit its first report, return, and exit — the chunk
 * walk would never advance and you could not test the async path locally at all.
 *
 * This reproduces just the worker's re-entry contract: feed `dataForNextPhase` back in as the next
 * `phaseData`, and repeat until the phase stops asking to be rescheduled. Real delays are replaced
 * by --poll-every-ms so a 5-minute production cadence doesn't make a local test take hours; Amazon
 * still needs real time to build a report, so keep it at tens of seconds, not zero.
 */
async function driveAsync() {
  let phaseData = {};
  let result = null;

  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    result = await invoke(phaseData);

    if (!result || !result.reschedule) {
      console.log(`[runPhase] async complete after ${tick} tick(s)`);
      return result;
    }

    // Mirror scheduledPhases.createNextPhaseJobData: merge, don't replace.
    phaseData = { ...phaseData, ...(result.dataForNextPhase || {}) };

    const realDelay = result.reschedule.delayMs;
    console.log(
      `[runPhase] tick ${tick}: not done (pollAttempt=${result.reschedule.pollAttempt}, ` +
      `chunk=${phaseData.financeChunkIndex ?? '-'}/${(phaseData.financeChunks || []).length || '-'}); ` +
      `prod would wait ${Math.round(realDelay / 1000)}s, waiting ${Math.round(POLL_EVERY_MS / 1000)}s`
    );
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
  }

  console.warn(`[runPhase] hit --max-ticks=${MAX_TICKS} without finishing. Last result below; ` +
    `re-run to continue (state is in AsyncReportRequest, so the same reports are re-checked, not re-created).`);
  return result;
}

async function main() {
  await dbConnect();
  console.log('[runPhase] MongoDB connected');
  if (connectRedis) {
    try { await connectRedis(); console.log('[runPhase] Redis connected'); }
    catch (e) { console.warn('[runPhase] Redis connect failed (continuing):', e.message); }
  }

  console.log(`\n[runPhase] Invoking phase="${PHASE}" user=${USER_ID} ${COUNTRY}-${REGION} dates=[${DATES.join(', ')}]\n${'='.repeat(70)}`);

  let result;
  try {
    result = DRIVE_ASYNC ? await driveAsync() : await invoke();
  } catch (err) {
    // This is the real, previously-hidden error.
    console.error('\n========== THROWN ERROR (the real cause) ==========');
    console.error('message:', err && err.message);
    console.error('name   :', err && err.name);
    console.error('stack  :\n', err && err.stack);
    if (err && err.response) {
      console.error('http status:', err.response.status);
      console.error('http body  :', JSON.stringify(err.response.data || err.response.body || {}, null, 2));
    }
    console.error('full   :', require('util').inspect(err, { depth: 5 }));
    process.exitCode = 1;
    return;
  }

  console.log('\n========== RETURNED RESULT ==========');
  console.log(require('util').inspect(result, { depth: 6, colors: false }));
  if (result && result.success === false) {
    console.log('\n⚠️  Phase returned { success:false }. error:', result.error);
  }
}

main()
  .catch((e) => { console.error('[runPhase] FATAL:', e.stack || e.message); process.exitCode = 1; })
  .finally(async () => { try { await mongoose.disconnect(); } catch {} setTimeout(() => process.exit(process.exitCode || 0), 300).unref(); });

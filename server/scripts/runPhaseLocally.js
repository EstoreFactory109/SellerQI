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

if (!PHASE || !USER_ID || !COUNTRY || !REGION) {
  console.error('Missing args. Example:');
  console.error('  node server/scripts/runPhaseLocally.js --phase=finance_catchup --user-id=<id> --country=US --region=NA --dates=2026-05-28');
  process.exit(1);
}

async function invoke() {
  const SI = ScheduledIntegration;
  switch (PHASE) {
    case 'init':         return SI.executeScheduledInitPhase(USER_ID, REGION, COUNTRY);
    case 'batch_1_2':    return SI.executeScheduledBatch1And2Phase(USER_ID, REGION, COUNTRY, {});
    case 'ads':          return SI.executeScheduledAdsPhase(USER_ID, REGION, COUNTRY, {});
    case 'batch_3':      return SI.executeScheduledBatch3Phase(USER_ID, REGION, COUNTRY, {});
    case 'finance':      return SI.executeScheduledFinancePhase(USER_ID, REGION, COUNTRY, {});
    case 'batch_4':      return SI.executeScheduledBatch4Phase(USER_ID, REGION, COUNTRY, {});
    case 'calc_review':  return SI.executeScheduledCalcReviewPhase(USER_ID, REGION, COUNTRY, {});
    case 'finalize':     return SI.executeScheduledFinalizePhase(USER_ID, REGION, COUNTRY, {});
    case 'ads_catchup':
      if (!DATES.length) throw new Error('ads_catchup needs --dates=YYYY-MM-DD');
      return SI.executeAdsCatchupPhase(USER_ID, REGION, COUNTRY, { catchupDate: DATES[0] });
    case 'finance_catchup':
      if (!DATES.length) throw new Error('finance_catchup needs --dates=YYYY-MM-DD[,YYYY-MM-DD]');
      return SI.executeFinanceCatchupPhase(USER_ID, REGION, COUNTRY, { catchupDates: DATES });
    case 'sync': {
      if (DATES.length !== 2) throw new Error('sync needs --dates=START,END (two dates)');
      const { syncFinanceData } = require('../Services/Sp_API/FinanceService.js');
      return syncFinanceData({
        userId: USER_ID, country: COUNTRY, regionModel: REGION,
        refreshToken: undefined, accessToken: undefined,
        clientId: process.env.SPAPI_CLIENT_ID, clientSecret: process.env.SPAPI_CLIENT_SECRET,
        forceDates: [DATES[0], DATES[1]],
      });
    }
    default:
      throw new Error(`Unknown --phase=${PHASE}`);
  }
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
    result = await invoke();
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

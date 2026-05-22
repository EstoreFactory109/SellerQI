#!/usr/bin/env node
/**
 * checkSyncFreshness.js
 *
 * Audits whether Finance + Ads data is being fetched on schedule across all
 * users/accounts. Reports, per seller account:
 *   - Finance: latest FinanceSyncLog date (Pacific YYYY-MM-DD), days behind
 *     yesterday-Pacific, last status, pending expense order count
 *   - Ads: latest PPCMetrics metricDate, days behind yesterday
 *   - Scheduler: dailyUpdateHour and lastDailyUpdate (per-account, with
 *     hours-since-last-update so you can see if the hourly cron ever fired
 *     this account)
 *
 * It also dumps an aggregate header (stale-vs-fresh counts and the worst
 * offenders) so you don't have to scroll the per-row table on big tenants.
 *
 * Definitions of "stale" (tune via flags below):
 *   - Finance latest-date older than yesterday-Pacific by > FRESH_FINANCE_DAYS
 *   - Ads metricDate older than yesterday by > FRESH_ADS_DAYS
 *   - Scheduler lastDailyUpdate older than > FRESH_SCHED_HOURS
 *
 * Usage:
 *   node server/scripts/checkSyncFreshness.js
 *   node server/scripts/checkSyncFreshness.js --user-id=<mongoId>
 *   node server/scripts/checkSyncFreshness.js --stale-only
 *   node server/scripts/checkSyncFreshness.js --limit=200
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
const FinanceSyncLog = require('../models/finance/FinanceSyncLogModel.js');
const PendingExpenseOrder = require('../models/finance/PendingExpenseOrderModel.js');
const PPCMetrics = require('../models/amazon-ads/PPCMetricsModel.js');

const FRESH_FINANCE_DAYS = 2;   // finance lags 1-2 days by design (yesterday Pacific)
const FRESH_ADS_DAYS = 2;
const FRESH_SCHED_HOURS = 26;   // hourly cron + slack

const PACIFIC_OFFSET_HOURS = 7;

function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}
function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

const FILTER_USER_ID = getArg('user-id');
const STALE_ONLY = hasFlag('stale-only');
const LIMIT = parseInt(getArg('limit') || '0', 10);

function yesterdayPacificStr() {
  const now = Date.now();
  const pacificMs = now - PACIFIC_OFFSET_HOURS * 60 * 60 * 1000 - 24 * 60 * 60 * 1000;
  return new Date(pacificMs).toISOString().substring(0, 10);
}

function daysBetween(yyyyMmDd, refYyyyMmDd) {
  if (!yyyyMmDd) return Infinity;
  const a = new Date(`${yyyyMmDd}T00:00:00.000Z`).getTime();
  const b = new Date(`${refYyyyMmDd}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function hoursSince(dt) {
  if (!dt) return Infinity;
  return (Date.now() - new Date(dt).getTime()) / (60 * 60 * 1000);
}

function fmtAge(days) {
  if (days === Infinity) return 'never';
  if (days <= 0) return 'today';
  return `${days}d`;
}

function fmtHours(h) {
  if (h === Infinity) return 'never';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function pad(s, n) {
  s = String(s ?? '');
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[freshness] Connected to ${dbConsts.dbName || MONGODB_URI}`);

  const yesterday = yesterdayPacificStr();
  console.log(`[freshness] Reference date (yesterday Pacific): ${yesterday}`);
  console.log(`[freshness] Thresholds: finance>${FRESH_FINANCE_DAYS}d, ads>${FRESH_ADS_DAYS}d, sched>${FRESH_SCHED_HOURS}h\n`);

  const sellerQuery = FILTER_USER_ID
    ? { User: new mongoose.Types.ObjectId(FILTER_USER_ID) }
    : {};
  const sellers = await Seller.find(sellerQuery, { User: 1, sellerAccount: 1 }).lean();

  const rows = [];
  for (const s of sellers) {
    if (!s.sellerAccount || s.sellerAccount.length === 0) continue;

    const schedule = await UserUpdateSchedule.findOne({ userId: s.User }).lean();
    const userScheduledHour = schedule?.dailyUpdateHour ?? null;
    const userLastUpdate = schedule?.lastDailyUpdate ?? null;

    for (const acct of s.sellerAccount) {
      if (!acct?.country || !acct?.region) continue;
      if (!acct.spiRefreshToken) continue; // not connected; skip

      const country = acct.country.toUpperCase();
      const region = acct.region.toUpperCase();

      const [latestFin, pending, latestAds] = await Promise.all([
        FinanceSyncLog.findOne(
          { User: s.User, country, region },
          { date: 1, status: 1, fetchedAt: 1, error: 1 }
        ).sort({ date: -1 }).lean(),
        PendingExpenseOrder.countDocuments({ User: s.User, country, region }),
        PPCMetrics.findOne(
          { userId: s.User.toString(), country, region },
          { metricDate: 1, updatedAt: 1 }
        ).sort({ metricDate: -1 }).lean(),
      ]);

      const acctSchedEntry = (schedule?.sellerAccounts || []).find(
        (e) => e.country === country && e.region === region
      );
      const acctLastUpdate = acctSchedEntry?.lastDailyUpdate ?? null;

      const finDate = latestFin?.date || null;
      const finStatus = latestFin?.status || 'none';
      const finBehind = daysBetween(finDate, yesterday);
      const adsDate = latestAds?.metricDate || null;
      const adsBehind = daysBetween(adsDate, yesterday);
      const schedH = hoursSince(acctLastUpdate || userLastUpdate);

      const stale =
        finBehind > FRESH_FINANCE_DAYS ||
        finStatus !== 'success' ||
        adsBehind > FRESH_ADS_DAYS ||
        schedH > FRESH_SCHED_HOURS;

      rows.push({
        userId: s.User.toString(),
        country,
        region,
        userScheduledHour,
        schedH,
        finDate,
        finBehind,
        finStatus,
        finError: latestFin?.error || '',
        pending,
        adsDate,
        adsBehind,
        stale,
      });
    }
  }

  // ─── Aggregate header ─────────────────────────────
  const totalAccounts = rows.length;
  const staleAccounts = rows.filter((r) => r.stale).length;
  const finStale = rows.filter((r) => r.finBehind > FRESH_FINANCE_DAYS || r.finStatus !== 'success').length;
  const adsStale = rows.filter((r) => r.adsBehind > FRESH_ADS_DAYS).length;
  const schedStale = rows.filter((r) => r.schedH > FRESH_SCHED_HOURS).length;
  const neverFinance = rows.filter((r) => !r.finDate).length;
  const neverAds = rows.filter((r) => !r.adsDate).length;
  const failedFin = rows.filter((r) => r.finStatus === 'failed').length;

  console.log('───── Summary ─────');
  console.log(`Total accounts (with SP-API connected): ${totalAccounts}`);
  console.log(`Stale (any signal):                     ${staleAccounts}`);
  console.log(`  Finance behind / failed / never:      ${finStale} (${failedFin} failed, ${neverFinance} never synced)`);
  console.log(`  Ads behind / never:                   ${adsStale} (${neverAds} never synced)`);
  console.log(`  Scheduler stale (>${FRESH_SCHED_HOURS}h since last):     ${schedStale}`);

  // Worst offenders
  const worstFin = [...rows].sort((a, b) => b.finBehind - a.finBehind).slice(0, 5);
  console.log('\nWorst finance lag (top 5):');
  for (const r of worstFin) {
    console.log(`  ${r.userId} ${r.country}-${r.region}  finDate=${r.finDate || '—'}  behind=${fmtAge(r.finBehind)}  status=${r.finStatus}`);
  }

  // ─── Per-row table ────────────────────────────────
  const display = STALE_ONLY ? rows.filter((r) => r.stale) : rows;
  const printed = LIMIT > 0 ? display.slice(0, LIMIT) : display;

  console.log(`\n───── Per account${STALE_ONLY ? ' (stale only)' : ''}: ${printed.length}/${display.length} rows ─────`);
  console.log(
    pad('user', 26),
    pad('cc', 4),
    pad('rgn', 4),
    pad('hr', 3),
    pad('sched_age', 10),
    pad('fin_date', 12),
    pad('fin_age', 8),
    pad('fin_status', 11),
    pad('pending', 8),
    pad('ads_date', 12),
    pad('ads_age', 8),
    'flag'
  );
  for (const r of printed) {
    const flag = r.stale ? 'STALE' : 'ok';
    console.log(
      pad(r.userId, 26),
      pad(r.country, 4),
      pad(r.region, 4),
      pad(r.userScheduledHour ?? '?', 3),
      pad(fmtHours(r.schedH), 10),
      pad(r.finDate || '—', 12),
      pad(fmtAge(r.finBehind), 8),
      pad(r.finStatus, 11),
      pad(r.pending, 8),
      pad(r.adsDate || '—', 12),
      pad(fmtAge(r.adsBehind), 8),
      flag
    );
    if (r.finStatus === 'failed' && r.finError) {
      console.log('    ↳ last error:', r.finError.slice(0, 200));
    }
  }
}

main()
  .catch((err) => {
    console.error('[freshness] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await mongoose.disconnect(); } catch {}
  });

#!/usr/bin/env node
/**
 * cleanOrphanedPreFixFinanceDays.js
 *
 * Removes DailySkuFinance rows left orphaned by the marketplace-local bucketing fix.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * Day keys used to come from a hardcoded UTC-7 ("Pacific") for every marketplace. The fix moved
 * each order onto its own marketplace's calendar day, which for a non-Pacific marketplace shifts
 * some orders onto the NEXT day.
 *
 * A day that kept at least one order self-heals: it produces a fresh bucket, so the persist layer
 * clears and rewrites it. A day that lost ALL of its orders does not. It produces no bucket, the
 * report legitimately says nothing about it, and the persist layer's "never zero a day you have no
 * data for" rule (the guard that exists because an empty/partial re-fetch once wiped a settled
 * May 28 to $0) correctly leaves its stale row alone — forever.
 *
 * The result is a DOUBLE COUNT: the same order sits on both the old day (stale, pre-fix) and the
 * new day (correct, post-fix). Observed on account 69f0600ca71f2bd802bba27c (AU): "03 - Midnight"
 * $69.99 on 2026-08-25 (written pre-fix) and again on 2026-08-26 (written post-fix), putting a
 * 30-day total $69.99 above Seller Central.
 *
 * ── THE SYNC PATH NOW HEALS THIS ITSELF; THIS SCRIPT IS FOR WHAT IT CANNOT REACH ──
 * `resolveDatesToClear` case 3 (interior gaps) clears such a day automatically whenever a re-sync
 * covers it, verified live: re-syncing 2026-08-24..26 for the AU account above deleted the stale
 * 08-25 row on its own. So any day inside the rolling deep-resync window fixes itself, and this
 * script is NOT the remedy for those — it exists for days that have aged out of that window and
 * will therefore never be re-synced again.
 *
 * ── WHY THE REMAINDER IS A SCRIPT AND NOT A SYNC-PATH RULE ──────────────────
 * The tempting fix is to have the sync clear any pre-fix day it finds no orders for. That infers
 * deletion from the ABSENCE of evidence, which is exactly the reasoning behind the May-28 wipe:
 * Amazon returns "EMPTY or partial" reports for older windows, so a partial report that omits a day
 * which genuinely has orders would delete real revenue. An audit found one US account with 8
 * pre-fix days holding 9,488 rows and $1.17M — none of them orphans (US bucketing never shifted,
 * the days simply had not been re-synced yet), all of which such a rule would have destroyed.
 *
 * So this script instead requires POSITIVE evidence from an INDEPENDENT authority: Amazon's own
 * Data Kiosk `orderedProductSales`, the same figure Seller Central shows and the one every
 * verification in this investigation was checked against. A pre-fix day is deleted only when Data
 * Kiosk reports $0.00 for it — i.e. Amazon itself says the day has no sales, so anything stored
 * there is provably wrong.
 *
 * An earlier draft matched a stale row against an adjacent day's row on sku+amount+units. That is
 * unsafe: an account that sells the same SKU at the same price on consecutive days produces exactly
 * that pattern from two genuine, different orders, and the row would be deleted. Row shape cannot
 * distinguish a shifted order from a repeat sale; Data Kiosk can.
 *
 * Days where Data Kiosk reports a NON-zero total that disagrees with what is stored are reported
 * but never touched — the discrepancy is real, but it cannot be attributed to specific rows without
 * order-level evidence, and guessing would be the same mistake in a different costume.
 *
 * Dry-run by default. Nothing is deleted without --confirm.
 *
 * Usage:
 *   node server/scripts/cleanOrphanedPreFixFinanceDays.js                      # dry run, all accounts
 *   node server/scripts/cleanOrphanedPreFixFinanceDays.js --user-id=<id>       # dry run, one account
 *   node server/scripts/cleanOrphanedPreFixFinanceDays.js --confirm            # actually delete
 *   node server/scripts/cleanOrphanedPreFixFinanceDays.js --days=180           # widen the lookback
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URI;

const DailySkuFinance = require('../models/finance/DailySkuFinanceModel.js');
const FinanceSyncLog = require('../models/finance/FinanceSyncLogModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const { addDaysToDateStr } = require('../utils/marketplaceTimezone.js');
const { MARKETPLACES } = require('../Services/MCP/constants.js');
const { fetchSalesAndTrafficByDate } = require('../Services/MCP/MCPSalesAndTrafficIntegration.js');

function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}
const FILTER_USER_ID = getArg('user-id');
const CONFIRM = process.argv.slice(2).includes('--confirm');
const LOOKBACK_DAYS = parseInt(getArg('days') || '120', 10);

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Amazon's own per-day orderedProductSales for a window — the figure Seller Central shows, already
 * bucketed by the marketplace's local calendar. Returns Map<'YYYY-MM-DD', number>.
 *
 * Throws rather than returning a partial/empty map, because every caller treats a $0.00 day as
 * grounds for deletion: a silently wrong or missing answer here would delete real revenue.
 */
async function fetchDataKioskTotals(refreshToken, country, region, startDate, endDate) {
  // The query builder falls back to `MARKETPLACES.US` for an unrecognised code, silently. Without
  // this guard a UK account would be compared against US totals and its real rows would look like
  // $0.00 orphans.
  if (!MARKETPLACES[country]) throw new Error(`unknown marketplace code ${country}`);

  const res = await fetchSalesAndTrafficByDate(refreshToken, region, country, startDate, endDate);
  if (!res || !res.success) throw new Error((res && res.error) || 'Data Kiosk fetch failed');

  const rows = (res.data && res.data.datewiseSales) || [];
  // An empty result means "nothing matched", which is indistinguishable from a query that matched
  // nothing for a benign reason (a permissions gap, an unfinished backfill on Amazon's side). It is
  // NOT treated as proof that every day is $0 — that is the infer-from-absence mistake this whole
  // script exists to avoid.
  if (rows.length === 0) throw new Error('Data Kiosk returned no rows for this window');

  const out = new Map();
  for (const d of rows) {
    if (!d || !d.date) continue;
    out.set(d.date, parseFloat((d.sales && d.sales.amount) || 0));
  }
  return out;
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[orphan-clean] Connected to ${dbConsts.dbName || MONGODB_URI}`);
  console.log(`[orphan-clean] ${CONFIRM ? '*** LIVE RUN — rows WILL be deleted ***' : 'DRY RUN — nothing will be deleted'}`);

  const since = addDaysToDateStr(new Date().toISOString().slice(0, 10), -LOOKBACK_DAYS);
  const logMatch = { date: { $gte: since } };
  if (FILTER_USER_ID) logMatch.User = new mongoose.Types.ObjectId(FILTER_USER_ID);

  // Pre-fix days are those whose sync log never got a bucketTimezone stamp.
  const logs = await FinanceSyncLog.find(logMatch, { User: 1, country: 1, region: 1, date: 1, bucketTimezone: 1 }).lean();
  const byAccount = new Map();
  for (const l of logs) {
    const key = `${l.User}|${l.country}|${l.region}`;
    if (!byAccount.has(key)) byAccount.set(key, { pre: new Set(), post: new Set() });
    (l.bucketTimezone ? byAccount.get(key).post : byAccount.get(key).pre).add(l.date);
  }
  console.log(`[orphan-clean] scanning ${byAccount.size} account(s) since ${since}\n`);

  const totals = {
    accounts: 0, daysChecked: 0,
    confirmed: 0, deletedRows: 0, deletedDollars: 0,   // Data Kiosk says $0.00 — safe to delete
    mismatch: 0, mismatchDollars: 0,                   // Data Kiosk disagrees but is non-zero — reported only
    agree: 0,                                          // pre-fix but already correct
    needsResync: 0, needsResyncDollars: 0,             // $0.00 per Data Kiosk, but neighbours not re-synced
    unverifiable: 0,                                   // no token / no Data Kiosk row — never touched
  };

  for (const [key, { pre, post }] of byAccount) {
    if (pre.size === 0 || post.size === 0) continue;   // nothing stale, or never re-synced yet
    const [userId, country, region] = key.split('|');
    const acctFilter = { User: new mongoose.Types.ObjectId(userId), country, region };

    // Which pre-fix days actually hold rows? Only those are worth a Data Kiosk call.
    const candidates = [];
    for (const day of [...pre].sort()) {
      totals.daysChecked++;
      const rows = await DailySkuFinance.find({ ...acctFilter, date: day }).lean();
      if (rows.length > 0) candidates.push({ day, rows });
    }
    if (candidates.length === 0) continue;

    totals.accounts++;
    console.log(`${userId}  ${country}-${region}  — ${candidates.length} pre-fix day(s) with rows`);

    const sellerDoc = await Seller.findOne({ User: acctFilter.User }, { sellerAccount: 1 }).lean();
    const acct = (sellerDoc && sellerDoc.sellerAccount || []).find(
      (a) => (a.country || '').toUpperCase() === country && (a.region || '').toUpperCase() === region && a.spiRefreshToken
    );
    if (!acct) {
      console.log('  ! no connected SP-API account — cannot verify against Data Kiosk, skipping');
      totals.unverifiable += candidates.length;
      continue;
    }

    const days = candidates.map((c) => c.day);
    let kiosk;
    try {
      kiosk = await fetchDataKioskTotals(acct.spiRefreshToken, country, region, days[0], days[days.length - 1]);
    } catch (err) {
      console.log(`  ! Data Kiosk lookup failed (${err.message}) — skipping this account, nothing touched`);
      totals.unverifiable += candidates.length;
      continue;
    }

    for (const { day, rows } of candidates) {
      const stored = round2(rows.reduce((s, r) => s + (r.productSales || 0), 0));
      if (!kiosk.has(day)) {
        totals.unverifiable++;
        console.log(`  ! ${day}: $${stored.toFixed(2)} stored, Data Kiosk returned no row for this day — left untouched`);
        continue;
      }
      const truth = round2(kiosk.get(day));

      if (truth === 0) {
        // Data Kiosk saying $0.00 proves the stored rows are in the wrong place, but not that the
        // revenue has already been written to the right place. The orders that left this day landed
        // on an adjacent day, and that day only holds them if it has been re-synced post-fix.
        // Deleting while both neighbours are still pre-fix would remove money with nowhere to live
        // and push the account's total BELOW Seller Central.
        const healed = [addDaysToDateStr(day, 1), addDaysToDateStr(day, -1)].some((d) => post.has(d));
        if (!healed) {
          totals.needsResync++; totals.needsResyncDollars += stored;
          console.log(`  ⟳ ${day}: $${stored.toFixed(2)} stored, Data Kiosk says $0.00 — but neither neighbour is re-synced yet; needs a re-sync first, left untouched`);
          continue;
        }
        totals.confirmed++; totals.deletedRows += rows.length; totals.deletedDollars += stored;
        console.log(`  ✓ ${day}: $${stored.toFixed(2)} stored, Data Kiosk says $0.00 — orphaned, ${rows.length} row(s) to delete`);
        for (const r of rows) console.log(`      ${r.sku} $${(r.productSales || 0).toFixed(2)} x${r.units}`);
        if (CONFIRM) {
          const res = await DailySkuFinance.deleteMany({ ...acctFilter, date: day });
          await FinanceSyncLog.updateOne({ ...acctFilter, date: day }, { $set: { bucketTimezone: 'cleaned-orphan' } });
          console.log(`      deleted ${res.deletedCount} row(s)`);
        }
      } else if (Math.abs(stored - truth) >= 0.005) {
        totals.mismatch++; totals.mismatchDollars += Math.abs(stored - truth);
        console.log(`  · ${day}: $${stored.toFixed(2)} stored vs $${truth.toFixed(2)} Data Kiosk — real discrepancy, but not attributable to specific rows; left untouched`);
      } else {
        totals.agree++;
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Accounts with pre-fix rows:        ${totals.accounts}`);
  console.log(`Pre-fix days examined:             ${totals.daysChecked}`);
  console.log(`Orphaned (Data Kiosk $0.00):       ${totals.confirmed}  (${totals.deletedRows} rows, $${totals.deletedDollars.toFixed(2)})`);
  console.log(`Already correct:                   ${totals.agree}`);
  console.log(`Need a re-sync before deleting:    ${totals.needsResync}  ($${totals.needsResyncDollars.toFixed(2)})`);
  console.log(`Disagree but non-zero (reported):  ${totals.mismatch}  ($${totals.mismatchDollars.toFixed(2)} of drift)`);
  console.log(`Unverifiable (left untouched):     ${totals.unverifiable}`);
  console.log(CONFIRM ? '\nRows deleted.' : '\nDry run — re-run with --confirm to delete the Data-Kiosk-confirmed orphans.');
}

main()
  .catch((err) => { console.error('[orphan-clean] FAILED:', err.message); if (err.stack) console.error(err.stack); process.exitCode = 1; })
  .finally(async () => { try { await mongoose.disconnect(); } catch {} });

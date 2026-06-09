#!/usr/bin/env node
/**
 * backfillMissingFinanceDays.js
 *
 * One-shot remediation for accounts that have MISSING or ZERO finance days
 * inside a recent window — the exact symptom where a day reads $0 in the
 * dashboard but the manual/test-route range fetch returns real data.
 *
 * It does NOT introduce any new calculation. For each day that looks wrong it
 * simply calls `syncFinanceData({ forceDates: [day, day] })` — the same proven
 * path the test route uses — so the day is recomputed and rewritten correctly.
 *
 * "Looks wrong" = for a day inside the window, either:
 *   - there is NO FinanceSyncLog success row for it (never fetched), OR
 *   - there are NO DailySkuFinance rows for it (fetched empty / frozen), OR
 *   - (with --include-zero) productSales sums to 0 while a neighbour day is > 0.
 *
 * Usage:
 *   # one account, last 30 days
 *   node server/scripts/backfillMissingFinanceDays.js --user-id=<id> --country=IN --region=EU
 *
 *   # custom window
 *   node server/scripts/backfillMissingFinanceDays.js --user-id=<id> --country=US --region=NA --days=45
 *
 *   # dry run — report what WOULD be re-fetched, change nothing
 *   node server/scripts/backfillMissingFinanceDays.js --user-id=<id> --country=US --region=NA --dry-run
 *
 *   # also heal days that exist but sum to 0 next to a non-zero neighbour
 *   node server/scripts/backfillMissingFinanceDays.js --user-id=<id> --country=US --region=NA --include-zero
 *
 *   # all connected accounts (omit --user-id) — heavier; use --dry-run first
 *   node server/scripts/backfillMissingFinanceDays.js --days=30 --dry-run
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
const FinanceSyncLog = require('../models/finance/FinanceSyncLogModel.js');
const DailySkuFinance = require('../models/finance/DailySkuFinanceModel.js');
const { syncFinanceData } = require('../Services/Sp_API/FinanceService.js');
const { getAccessToken } = require('../Services/Sp_API/SpApiMarketplace.js');
const spCredentials = require('../Services/Sp_API/config.js');

const PACIFIC_OFFSET_HOURS = 7;

function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}
function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

const FILTER_USER_ID = getArg('user-id');
const FILTER_COUNTRY = (getArg('country') || '').toUpperCase() || null;
const FILTER_REGION = (getArg('region') || '').toUpperCase() || null;
const WINDOW_DAYS = parseInt(getArg('days') || '30', 10);
const DRY_RUN = hasFlag('dry-run');
const INCLUDE_ZERO = hasFlag('include-zero');

function pacificYesterdayStr() {
  const ms = Date.now() - PACIFIC_OFFSET_HOURS * 3600000 - 86400000;
  return new Date(ms).toISOString().substring(0, 10);
}
function subDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().substring(0, 10);
}
function dateList(startStr, endStr) {
  const out = [];
  const d = new Date(`${startStr}T00:00:00.000Z`);
  const end = new Date(`${endStr}T00:00:00.000Z`);
  while (d <= end) { out.push(d.toISOString().substring(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

/**
 * Determine which days in [start, end] need a re-fetch for one account.
 */
async function findBrokenDays(userObjectId, country, region, startDate, endDate) {
  const days = dateList(startDate, endDate);

  // Days with a success sync-log row.
  const logRows = await FinanceSyncLog.find(
    { User: userObjectId, country, region, date: { $gte: startDate, $lte: endDate }, status: 'success' },
    { date: 1, _id: 0 }
  ).lean();
  const loggedSuccess = new Set(logRows.map((r) => r.date));

  // Per-day productSales sums.
  const salesAgg = await DailySkuFinance.aggregate([
    { $match: { User: userObjectId, country, region, date: { $gte: startDate, $lte: endDate } } },
    { $group: { _id: '$date', sales: { $sum: '$productSales' }, rows: { $sum: 1 } } },
  ]);
  const salesByDate = new Map(salesAgg.map((r) => [r._id, { sales: r.sales || 0, rows: r.rows || 0 }]));

  const broken = [];
  for (const day of days) {
    const hasLog = loggedSuccess.has(day);
    const sd = salesByDate.get(day);
    const hasRows = !!sd && sd.rows > 0;
    const sales = sd ? sd.sales : 0;

    if (!hasLog) { broken.push({ day, reason: 'no-sync-log' }); continue; }
    if (!hasRows) { broken.push({ day, reason: 'no-daily-rows' }); continue; }
    if (INCLUDE_ZERO && sales === 0) { broken.push({ day, reason: 'zero-sales' }); continue; }
  }

  // For --include-zero, only keep zero-sales days that sit next to a non-zero
  // neighbour (a lone run of zeros is more likely a genuine no-sales stretch).
  if (INCLUDE_ZERO) {
    return broken.filter((b) => {
      if (b.reason !== 'zero-sales') return true;
      const prev = salesByDate.get(subDays(b.day, 1));
      const next = salesByDate.get(subDays(b.day, -1));
      return (prev && prev.sales > 0) || (next && next.sales > 0);
    });
  }
  return broken;
}

function collectAccounts(seller) {
  const out = [];
  for (const acc of seller.sellerAccount || []) {
    const country = (acc?.country || '').toUpperCase();
    const region = (acc?.region || '').toUpperCase();
    const refreshToken = acc?.spiRefreshToken;
    if (!country || !region || !refreshToken) continue;
    if (FILTER_COUNTRY && country !== FILTER_COUNTRY) continue;
    if (FILTER_REGION && region !== FILTER_REGION) continue;
    out.push({ country, region, refreshToken });
  }
  return out;
}

async function healAccount(userObjectId, userIdStr, acct, clientId, clientSecret) {
  const { country, region, refreshToken } = acct;
  const endDate = pacificYesterdayStr();
  const startDate = subDays(endDate, WINDOW_DAYS - 1);

  const broken = await findBrokenDays(userObjectId, country, region, startDate, endDate);
  if (broken.length === 0) {
    console.log(`  ${userIdStr} ${country}-${region}: OK — no broken days in ${startDate}→${endDate}`);
    return { scanned: 1, healedDays: 0, brokenDays: 0 };
  }

  console.log(`  ${userIdStr} ${country}-${region}: ${broken.length} broken day(s) in ${startDate}→${endDate}`);
  for (const b of broken) console.log(`      ${b.day}  (${b.reason})`);

  if (DRY_RUN) {
    console.log('      [dry-run] not re-fetching');
    return { scanned: 1, healedDays: 0, brokenDays: broken.length };
  }

  // Re-fetch each broken day individually via the proven forceDates path.
  // Contiguous days could be batched, but per-day keeps the re-fetch minimal
  // and matches exactly how the test route validates a single day.
  let accessToken;
  try {
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
  } catch (e) {
    console.error(`      FAIL (access token): ${e.message}`);
    return { scanned: 1, healedDays: 0, brokenDays: broken.length };
  }

  let healed = 0;
  for (const b of broken) {
    try {
      const result = await syncFinanceData({
        userId: userIdStr,
        country,
        regionModel: region,
        refreshToken,
        accessToken,
        clientId,
        clientSecret,
        forceDates: [b.day, b.day],
      });
      if (result?.step1?.token) accessToken = result.step1.token; // reuse refreshed token
      const orders = Number(result?.step1?.salesOrders ?? 0);
      const skuDocs = Number(result?.step1?.skuDocs ?? 0);
      console.log(`      healed ${b.day}: orders=${orders} skuDocs=${skuDocs}`);
      healed++;
    } catch (e) {
      console.error(`      FAIL ${b.day}: ${e.message}`);
    }
  }
  return { scanned: 1, healedDays: healed, brokenDays: broken.length };
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[backfill-missing] Connected to ${dbConsts.dbName || MONGODB_URI}`);
  console.log(`[backfill-missing] window=${WINDOW_DAYS}d dryRun=${DRY_RUN} includeZero=${INCLUDE_ZERO}` +
    (FILTER_USER_ID ? ` user=${FILTER_USER_ID}` : ' (all connected accounts)'));

  const clientId = spCredentials.clientId || process.env.SPAPI_CLIENT_ID;
  const clientSecret = spCredentials.clientSecret || process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET not set');
  }

  const sellerQuery = FILTER_USER_ID
    ? { User: new mongoose.Types.ObjectId(FILTER_USER_ID) }
    : { 'sellerAccount.spiRefreshToken': { $ne: null, $ne: '' } };
  const sellers = await Seller.find(sellerQuery, { User: 1, sellerAccount: 1 }).lean();

  const totals = { accounts: 0, brokenDays: 0, healedDays: 0 };
  for (const seller of sellers) {
    const accounts = collectAccounts(seller);
    for (const acct of accounts) {
      const r = await healAccount(seller.User, seller.User.toString(), acct, clientId, clientSecret);
      totals.accounts += r.scanned;
      totals.brokenDays += r.brokenDays;
      totals.healedDays += r.healedDays;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Accounts scanned:  ${totals.accounts}`);
  console.log(`Broken days found: ${totals.brokenDays}`);
  console.log(`Days re-fetched:   ${totals.healedDays}${DRY_RUN ? ' (dry-run — none actually re-fetched)' : ''}`);
}

main()
  .catch((err) => {
    console.error('[backfill-missing] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await mongoose.disconnect(); } catch {}
  });

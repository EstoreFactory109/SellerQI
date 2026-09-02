#!/usr/bin/env node
/**
 * verifyMarketplaceBucketing.js
 *
 * ★ READ-ONLY. Writes NOTHING — no DailySkuFinance, no DailyOverheadFinance, no FinanceSyncLog,
 *   no PendingExpenseOrder. It fetches the Sales Report and does the arithmetic in memory.
 *   Safe to run against production.
 *
 * WHY THIS EXISTS
 * Finance day buckets used to be built from a hardcoded UTC-7 ("Pacific") for every account.
 * For a non-Pacific marketplace that shifts the whole day: an AU seller (UTC+10 in July) had
 * their "2026-07-12" actually span 17:00 AEST Jul 12 → 16:59 AEST Jul 13, which under-reported
 * daily sales against Seller Central. Day keys are now marketplace-local.
 *
 * This script proves the fix on real data WITHOUT re-syncing anything: it fetches the report
 * once and buckets the same rows BOTH ways, so you can compare each figure against Seller
 * Central directly. Use it before deciding whether to re-sync any history.
 *
 * WHAT TO EXPECT for the reported account (AU, 2026-07-12):
 *   OLD (hardcoded UTC-7)   ≈ 703.48   ← what the dashboard shows today
 *   NEW (marketplace-local) ≈ 900.56   ← what Seller Central shows
 *
 * Usage:
 *   node server/scripts/verifyMarketplaceBucketing.js \
 *     --user-id=6a40e42712ce56d674f734a0 --country=AU --region=FE \
 *     --start=2026-07-10 --end=2026-07-14 --focus=2026-07-12
 *
 *   # widen the fetch window without changing which days are reported
 *   ... --start=2026-07-01 --end=2026-07-31 --focus=2026-07-12
 *
 * NOTE ON WINDOWS: Amazon's GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE report only returns an
 * OLD order-date when the request window extends toward the present. A narrow window ending far
 * in the past can legitimately come back EMPTY — that is an Amazon behaviour, not a bug here. If
 * you get 0 rows for an old date, widen --end toward yesterday.
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
const DailySkuFinance = require('../models/finance/DailySkuFinanceModel.js');
const spCredentials = require('../Services/Sp_API/config.js');
const {
  createTokenManager,
  fetchSalesReport,
  salesReportWindowISO,
} = require('../Services/Sp_API/FinanceService.js');
const { resolveMarketplaceAndRegion } = require('../Services/Sp_API/Expences.js');
const { getMarketplaceTimezone, toMarketplaceDateStr } = require('../utils/marketplaceTimezone.js');

// ── args ─────────────────────────────────────────────────────────────────────
function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}
const USER_ID = getArg('user-id');
const COUNTRY = (getArg('country') || '').toUpperCase();
const REGION = (getArg('region') || '').toUpperCase();
const START = getArg('start');
const END = getArg('end');
const FOCUS = getArg('focus');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
if (!USER_ID || !COUNTRY || !REGION || !ISO.test(START || '') || !ISO.test(END || '')) {
  console.error('Usage: --user-id=<id> --country=AU --region=FE --start=YYYY-MM-DD --end=YYYY-MM-DD [--focus=YYYY-MM-DD]');
  process.exit(2);
}

// ── the OLD (buggy) bucketing, reproduced verbatim for comparison ────────────
const LEGACY_PACIFIC_OFFSET_HOURS = 7;
function legacyToPacificDateStr(dateInput) {
  if (!dateInput) return null;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() - LEGACY_PACIFIC_OFFSET_HOURS * 3600000).toISOString().substring(0, 10);
}
function legacyWindowISO(startDate, endDate) {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    salesStartISO: `${startDate}T07:00:00.000Z`,
    salesEndISO: `${end.toISOString().substring(0, 10)}T06:59:59.999Z`,
  };
}

// Same row filters parseSalesReportRows applies, so we compare like with like.
const COUNTRY_TO_SALES_CHANNEL = {
  US: 'Amazon.com', CA: 'Amazon.ca', MX: 'Amazon.com.mx', BR: 'Amazon.com.br',
  UK: 'Amazon.co.uk', GB: 'Amazon.co.uk', DE: 'Amazon.de', FR: 'Amazon.fr', IT: 'Amazon.it',
  ES: 'Amazon.es', NL: 'Amazon.nl', SE: 'Amazon.se', PL: 'Amazon.pl', BE: 'Amazon.com.be',
  IN: 'Amazon.in', TR: 'Amazon.com.tr', AE: 'Amazon.ae', SA: 'Amazon.sa', EG: 'Amazon.eg',
  JP: 'Amazon.co.jp', AU: 'Amazon.com.au', SG: 'Amazon.sg', IE: 'Amazon.ie', ZA: 'Amazon.co.za',
};
function keepRow(row, salesChannel) {
  if ((row['order-status'] || '').toLowerCase() === 'cancelled') return false;
  if ((row['sales-channel'] || '').toLowerCase() === 'non-amazon') return false;
  if (salesChannel && row['sales-channel'] !== salesChannel) return false;
  return true;
}

const money = (n) => (Math.round(n * 100) / 100).toFixed(2);
const pad = (s, n) => (String(s).length >= n ? String(s).slice(0, n) : String(s) + ' '.repeat(n - String(s).length));
const padL = (s, n) => (String(s).length >= n ? String(s) : ' '.repeat(n - String(s).length) + String(s));

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[verify] Connected to ${dbConsts.dbName || MONGODB_URI}  (READ-ONLY — nothing will be written)\n`);

  const seller = await Seller.findOne({ User: new mongoose.Types.ObjectId(USER_ID) }, { User: 1, sellerAccount: 1 }).lean();
  if (!seller) throw new Error(`No Seller doc for user ${USER_ID}`);
  const acct = (seller.sellerAccount || []).find(
    (a) => (a?.country || '').toUpperCase() === COUNTRY && (a?.region || '').toUpperCase() === REGION
  );
  if (!acct?.spiRefreshToken) throw new Error(`No connected ${COUNTRY}-${REGION} account (with spiRefreshToken) for ${USER_ID}`);

  const tz = getMarketplaceTimezone(COUNTRY);
  console.log(`Account : ${USER_ID}  ${COUNTRY}-${REGION}`);
  console.log(`Timezone: ${tz}   (old code assumed a fixed UTC-7 for every marketplace)`);

  const clientId = spCredentials.clientId || process.env.SPAPI_CLIENT_ID;
  const clientSecret = spCredentials.clientSecret || process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET not set');

  const regionInternal = REGION === 'NA' ? 'na' : REGION === 'EU' ? 'eu' : 'apac';
  const { baseUrl, marketplaceId } = resolveMarketplaceAndRegion(COUNTRY, regionInternal);
  const tokenManager = createTokenManager({ refreshToken: acct.spiRefreshToken, clientId, clientSecret });

  // Fetch a window that is the UNION of both interpretations, so neither bucketing is
  // starved of rows it should have seen. Comparing on a window built for only one of them
  // would bias the result.
  const newWin = salesReportWindowISO(START, END, COUNTRY);
  const oldWin = legacyWindowISO(START, END);
  const fetchStart = newWin.salesStartISO < oldWin.salesStartISO ? newWin.salesStartISO : oldWin.salesStartISO;
  const fetchEnd = newWin.salesEndISO > oldWin.salesEndISO ? newWin.salesEndISO : oldWin.salesEndISO;

  console.log(`\nRequest window (union of both interpretations):`);
  console.log(`  marketplace-local ${START}→${END}: ${newWin.salesStartISO} … ${newWin.salesEndISO}`);
  console.log(`  legacy UTC-7      ${START}→${END}: ${oldWin.salesStartISO} … ${oldWin.salesEndISO}`);
  console.log(`  fetching          : ${fetchStart} … ${fetchEnd}`);

  console.log('\n[verify] Fetching Sales Report from Amazon (this can take a few minutes)…');
  const rows = await fetchSalesReport(tokenManager, baseUrl, marketplaceId, fetchStart, fetchEnd);
  console.log(`[verify] Report returned ${rows.length} row(s).`);
  if (rows.length === 0) {
    console.log('\n⚠️  Empty report. For an old date this is normal Amazon behaviour — widen --end toward yesterday.');
    return;
  }

  // ── bucket the SAME rows both ways ────────────────────────────────────────
  const salesChannel = COUNTRY_TO_SALES_CHANNEL[COUNTRY] || null;
  const oldByDate = new Map();
  const newByDate = new Map();
  let kept = 0, filtered = 0;

  for (const r of rows) {
    if (!keepRow(r, salesChannel)) { filtered++; continue; }
    const price = parseFloat(r['item-price']) || 0;
    const units = parseInt(r.quantity, 10) || 0;
    const oldD = legacyToPacificDateStr(r['purchase-date']);
    const newD = toMarketplaceDateStr(r['purchase-date'], COUNTRY);
    if (!oldD && !newD) continue;
    kept++;
    const bump = (map, d) => {
      if (!d) return;
      const cur = map.get(d) || { sales: 0, units: 0, rows: 0 };
      cur.sales += price; cur.units += units; cur.rows++;
      map.set(d, cur);
    };
    bump(oldByDate, oldD);
    bump(newByDate, newD);
  }
  console.log(`[verify] Kept ${kept} row(s) after the same filters the sync applies (${filtered} filtered out).\n`);

  // What is CURRENTLY stored, for reference (a plain read).
  const stored = await DailySkuFinance.aggregate([
    {
      $match: {
        User: new mongoose.Types.ObjectId(USER_ID), country: COUNTRY, region: REGION,
        date: { $gte: START, $lte: END },
      },
    },
    { $group: { _id: '$date', sales: { $sum: '$productSales' } } },
  ]);
  const storedByDate = new Map(stored.map((s) => [s._id, s.sales || 0]));

  // ── report ────────────────────────────────────────────────────────────────
  // Only report days inside [START, END]; the union fetch deliberately pulled a little extra.
  const days = [...new Set([...oldByDate.keys(), ...newByDate.keys(), ...storedByDate.keys()])]
    .filter((d) => d >= START && d <= END)
    .sort();

  console.log(`${pad('DAY', 12)}${padL('STORED NOW', 13)}${padL('OLD (UTC-7)', 14)}${padL('NEW (' + COUNTRY + ' local)', 22)}${padL('DIFF', 12)}`);
  console.log('─'.repeat(73));
  let totOld = 0, totNew = 0;
  for (const d of days) {
    const o = oldByDate.get(d)?.sales || 0;
    const n = newByDate.get(d)?.sales || 0;
    const s = storedByDate.get(d);
    totOld += o; totNew += n;
    const mark = d === FOCUS ? ' ←' : '';
    console.log(
      pad(d, 12) +
      padL(s === undefined ? '—' : money(s), 13) +
      padL(money(o), 14) +
      padL(money(n), 22) +
      padL((n - o >= 0 ? '+' : '') + money(n - o), 12) + mark
    );
  }
  console.log('─'.repeat(73));
  console.log(pad('TOTAL', 12) + padL('', 13) + padL(money(totOld), 14) + padL(money(totNew), 22) + padL((totNew - totOld >= 0 ? '+' : '') + money(totNew - totOld), 12));

  if (FOCUS) {
    const o = oldByDate.get(FOCUS)?.sales || 0;
    const n = newByDate.get(FOCUS)?.sales || 0;
    const s = storedByDate.get(FOCUS);
    console.log(`\n── ${FOCUS} ──`);
    console.log(`  Stored in DB now      : ${s === undefined ? '(no rows)' : money(s)}`);
    console.log(`  OLD bucketing (UTC-7) : ${money(o)}   ${s !== undefined && Math.abs(s - o) < 0.02 ? '✓ matches what is stored — confirms the stored value came from the old bucketing' : ''}`);
    console.log(`  NEW bucketing (${tz}): ${money(n)}`);
    console.log(`\n  → Compare the NEW figure against Seller Central for ${FOCUS}. If they agree, the fix is correct.`);
    console.log('  → Note: totals cover product sales (item-price) only, excluding shipping/gift-wrap,');
    console.log('    and exclude cancelled orders — the same definition the finance page uses.');
  }

  console.log('\n[verify] Done. Nothing was written.');
}

main()
  .catch((err) => {
    console.error('[verify] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await mongoose.disconnect(); } catch {}
  });

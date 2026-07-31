/**
 * Show what is sitting in an account's SP-API report queue — READ ONLY.
 *
 * Why this exists
 * ---------------
 * The finance sync for some accounts fails with "Report did not complete within 1800s" while every
 * single poll says IN_QUEUE. The inline poll loop then ABANDONS that report and the next run calls
 * createReport again, so each attempt added another request to the same per-seller queue. That is
 * why waiting 3x longer did not help: we were not waiting on a slow report, we were queued behind
 * our own abandoned ones.
 *
 * The async report path stops ADDING to that backlog (it persists the reportId and re-checks the
 * SAME report instead of recreating). It does NOT clear a backlog that already exists. This script
 * answers the question that decides whether anything else is needed:
 *
 *   - Many IN_QUEUE reports, mostly GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE, with old
 *     createdTime values  -> the queue is jammed with our abandoned duplicates. Cancelling them is
 *     what unblocks the account; the async path is what keeps it unblocked.
 *   - Queue nearly empty but the report still sits IN_QUEUE -> the delay is Amazon-side and the
 *     async path's ~4h window is the real test.
 *
 * It only calls GET /reports/2021-06-30/reports. It creates nothing and cancels nothing, so it is
 * safe to run against production at any time. `--print-cancel` writes the curl commands you would
 * need to cancel, but does not run them — cancelling is a destructive action and stays a human
 * decision.
 *
 * Usage (from repo root):
 *   node server/scripts/inspectReportQueue.js \
 *     --user-id=6a57b823571ceb9266953c30 \
 *     --country=US \
 *     --region=NA
 *
 *   Optional:
 *     --statuses=IN_QUEUE,IN_PROGRESS   which processingStatuses to list (default these two)
 *     --types=TYPE1,TYPE2               reportTypes to check (default: the finance report type
 *                                        this script exists to diagnose). Amazon REQUIRES at
 *                                        least one reportType on a first-page call — there is no
 *                                        "all types" wildcard, so to check a different report
 *                                        queue (e.g. an ads report), pass its type explicitly.
 *     --all                             include DONE/FATAL/CANCELLED too (fuller picture)
 *     --days=7                          how far back createdSince goes (default 30)
 *     --json                            emit raw JSON instead of the table
 *     --print-cancel                    also print (do NOT run) the cancel commands
 *
 * Env: DB_URI + DB_NAME (or MONGODB_URI), SPAPI_CLIENT_ID, SPAPI_CLIENT_SECRET in .env
 */
/* eslint-disable no-console */
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const {
  getAccessToken: getSpApiAccessToken,
  resolveMarketplaceAndRegion,
} = require('../Services/Sp_API/Expences.js');
// Imported rather than hardcoded — a previous copy of this literal was wrong (missing the
// _GENERAL suffix), which made every call here query Amazon for a report type this script never
// actually needed, returning a 403 that looked exactly like an authorization problem but wasn't
// one. FinanceService.js's REPORT_TYPE is the one createReport actually requests, so importing
// it means this can never drift out of sync with production again.
const { REPORT_TYPE: FINANCE_REPORT_TYPE } = require('../Services/Sp_API/FinanceService.js');

const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) { out[raw.slice(2)] = true; continue; }
    out[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return out;
}

function requireParam(args, key) {
  const v = args[key];
  if (!v) throw new Error(`Missing required arg: --${key}=...`);
  return String(v);
}

function regionModelToInternal(regionModel) {
  const r = String(regionModel || '').trim().toUpperCase();
  if (r === 'NA') return 'na';
  if (r === 'EU') return 'eu';
  if (r === 'FE') return 'apac';
  return null;
}

function httpsGet({ hostname, pathname, headers }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: pathname, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ statusCode: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getUserSpApiRefreshToken({ userId, country, region }) {
  const sellerCentral = await Seller.findOne({ User: userId }).sort({ createdAt: -1 }).lean();
  if (!sellerCentral) throw new Error(`SellerCentral not found for userId=${userId}`);
  const acc = (sellerCentral.sellerAccount || []).find((a) => a?.country === country && a?.region === region);
  if (!acc) throw new Error(`Seller account not found for ${region}/${country} (userId=${userId})`);
  const refreshToken = acc.spiRefreshToken;
  if (!refreshToken) throw new Error(`spiRefreshToken missing for ${region}/${country} (userId=${userId})`);
  return refreshToken;
}

/**
 * Walk every page of GET /reports. Amazon caps pageSize at 100 and returns a nextToken; a jammed
 * queue is exactly the case where there is more than one page, so not paginating would understate
 * the problem this script exists to measure.
 */
async function fetchAllReports({ baseUrl, accessToken, statuses, types, createdSince }) {
  const rows = [];
  let nextToken = null;
  let page = 0;

  do {
    page += 1;
    let pathname;
    if (nextToken) {
      // When paginating, nextToken must be the ONLY query parameter — Amazon rejects the request
      // if the original filters are repeated alongside it.
      pathname = `/reports/2021-06-30/reports?nextToken=${encodeURIComponent(nextToken)}`;
    } else {
      if (!types.length) {
        // Defence in depth: reportTypes is mandatory on a first-page call. Failing loudly here
        // beats sending a request Amazon will reject with a 400 anyway.
        throw new Error('reportTypes is required for a first-page getReports call and none were resolved.');
      }
      const qs = [
        `processingStatuses=${statuses.map(encodeURIComponent).join(',')}`,
        `reportTypes=${types.map(encodeURIComponent).join(',')}`,
        `createdSince=${encodeURIComponent(createdSince)}`,
        'pageSize=100',
      ];
      pathname = `/reports/2021-06-30/reports?${qs.join('&')}`;
    }

    const res = await httpsGet({
      hostname: baseUrl,
      pathname,
      headers: { 'x-amz-access-token': accessToken },
    });

    if (res.statusCode !== 200 || (res.body && res.body.errors)) {
      const detail = res.body && res.body.errors ? JSON.stringify(res.body.errors) : String(res.body);
      throw new Error(`getReports failed (HTTP ${res.statusCode}): ${detail}`);
    }

    rows.push(...(res.body.reports || []));
    nextToken = res.body.nextToken || null;

    // Rate limit on getReports is 0.0222 req/sec burst 10 — generous for a handful of pages, but
    // pace anyway so a deep queue cannot trip a 429 mid-walk.
    if (nextToken) await new Promise((r) => setTimeout(r, 2000));
  } while (nextToken && page < 50);

  if (nextToken) {
    console.warn('! Stopped at 50 pages; there are MORE reports than shown. The queue is very deep.');
  }
  return rows;
}

function ageMinutes(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}

function fmtAge(mins) {
  if (mins == null) return '?';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h${String(mins % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!MONGODB_URI) {
    throw new Error('DB connection is not configured. Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
  }

  const userIdRaw = requireParam(args, 'user-id');
  const country = requireParam(args, 'country').trim().toUpperCase();
  const region = requireParam(args, 'region').trim().toUpperCase();
  if (!['NA', 'EU', 'FE'].includes(region)) {
    throw new Error(`Invalid --region=${region}. Expected NA, EU, or FE.`);
  }

  const statuses = args.all
    ? ['IN_QUEUE', 'IN_PROGRESS', 'DONE', 'FATAL', 'CANCELLED']
    : String(args.statuses || 'IN_QUEUE,IN_PROGRESS').split(',').map((s) => s.trim()).filter(Boolean);
  // Amazon's getReports REQUIRES reportTypes on a first-page call — it's only optional once
  // paginating with nextToken. There is no wildcard for "all types", so default to the one report
  // type this script actually exists to diagnose rather than omitting the parameter (which Amazon
  // rejects with HTTP 400 "reportTypes;" missing).
  const types = args.types
    ? String(args.types).split(',').map((s) => s.trim()).filter(Boolean)
    : [FINANCE_REPORT_TYPE];
  const days = parseInt(args.days || '30', 10);
  const createdSince = new Date(Date.now() - days * 86400000).toISOString();

  const clientId = process.env.SPAPI_CLIENT_ID;
  const clientSecret = process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Set SPAPI_CLIENT_ID and SPAPI_CLIENT_SECRET in .env');

  const internalRegion = regionModelToInternal(region);
  const userId = mongoose.Types.ObjectId.isValid(userIdRaw)
    ? new mongoose.Types.ObjectId(userIdRaw)
    : userIdRaw;

  await mongoose.connect(MONGODB_URI);
  let refreshToken;
  try {
    refreshToken = await getUserSpApiRefreshToken({ userId, country, region });
  } finally {
    await mongoose.connection.close();
  }

  const { baseUrl } = resolveMarketplaceAndRegion(country, internalRegion);
  const accessToken = await getSpApiAccessToken(clientId, clientSecret, refreshToken);

  console.log(`\nReport queue for ${country}-${region} (user ${userIdRaw})`);
  console.log(`host=${baseUrl}  statuses=${statuses.join(',')}  createdSince=${createdSince.substring(0, 10)}`);
  if (types.length) console.log(`reportTypes=${types.join(',')}`);

  const reports = await fetchAllReports({ baseUrl, accessToken, statuses, types, createdSince });

  if (args.json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  if (reports.length === 0) {
    console.log('\nNo reports match. The queue is clear for this filter.');
    console.log('=> Nothing is backed up. If a report still sits IN_QUEUE during a sync, the delay');
    console.log('   is Amazon-side, and the async path\'s ~4h poll window is the real test.\n');
    return;
  }

  // Oldest first: the head of the queue is what everything else is stuck behind.
  const sorted = [...reports].sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));

  console.log(`\n${sorted.length} report(s):\n`);
  console.log('  AGE      STATUS       CREATED (UTC)         REPORT TYPE');
  console.log('  ' + '-'.repeat(96));
  for (const r of sorted) {
    const age = fmtAge(ageMinutes(r.createdTime));
    console.log(
      `  ${age.padEnd(8)} ${String(r.processingStatus || '?').padEnd(12)} ` +
      `${String(r.createdTime || '?').substring(0, 19).padEnd(21)} ${r.reportType || '?'}`
    );
  }

  // ---- Summary: the numbers that decide what to do next ----
  const byStatus = {};
  const byType = {};
  for (const r of sorted) {
    byStatus[r.processingStatus] = (byStatus[r.processingStatus] || 0) + 1;
    byType[r.reportType] = (byType[r.reportType] || 0) + 1;
  }

  console.log('\nBy status: ' + Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('By type:');
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${t}`);
  }

  const queued = sorted.filter((r) => r.processingStatus === 'IN_QUEUE');
  const financeQueued = queued.filter((r) => r.reportType === FINANCE_REPORT_TYPE);
  const oldestQueued = queued[0] ? ageMinutes(queued[0].createdTime) : null;

  console.log('\n--- Reading of the queue ---');
  if (financeQueued.length > 1) {
    console.log(`${financeQueued.length} ${FINANCE_REPORT_TYPE} reports are IN_QUEUE for this account.`);
    console.log('More than one means duplicates: the inline path abandoned a report and recreated it,');
    console.log('and each copy is still queued. This is the backlog the async path stops growing but');
    console.log('does not clear.');
    console.log('=> Cancelling the older duplicates is what unblocks this account now.');
    console.log('   Re-run with --print-cancel to get the commands (it will not run them).');
  } else if (financeQueued.length === 1) {
    console.log(`Exactly one ${FINANCE_REPORT_TYPE} is queued (age ${fmtAge(ageMinutes(financeQueued[0].createdTime))}).`);
    console.log('No duplicate pile-up. Amazon is simply slow to start this report.');
    console.log('=> Nothing to cancel. The async path will keep re-checking this same report.');
  } else if (queued.length > 0) {
    console.log(`${queued.length} report(s) queued, none of them ${FINANCE_REPORT_TYPE}.`);
    console.log('=> The finance report is not the thing backed up here.');
  }
  if (oldestQueued != null && oldestQueued > 240) {
    console.log(`\n! The oldest queued report is ${fmtAge(oldestQueued)} old — beyond the async path's`);
    console.log(`  default ~4h poll window (FINANCE_MAX_POLL_ATTEMPTS=48 x 5min). If reports for this`);
    console.log(`  account routinely sit this long, raise that cap or the chunk will still end FAILED.`);
  }

  if (args['print-cancel']) {
    // Printed, never executed. Cancelling is destructive and irreversible, and picking WHICH
    // duplicate to keep is a judgement call — so it stays with you.
    console.log('\n--- Cancel commands (NOT run — review before pasting) ---');
    console.log('# Keep the NEWEST queued finance report and cancel the older duplicates.');
    const cancellable = financeQueued.slice(0, -1);
    if (cancellable.length === 0) {
      console.log('# Nothing to cancel: there are no older duplicates.');
    }
    for (const r of cancellable) {
      console.log(
        `curl -X DELETE "https://${baseUrl}/reports/2021-06-30/reports/${r.reportId}" \\\n` +
        `  -H "x-amz-access-token: $SPAPI_ACCESS_TOKEN"   # queued ${fmtAge(ageMinutes(r.createdTime))}`
      );
    }
    if (cancellable.length) {
      console.log(`\n# Kept: ${financeQueued[financeQueued.length - 1].reportId} ` +
        `(newest, queued ${fmtAge(ageMinutes(financeQueued[financeQueued.length - 1].createdTime))})`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

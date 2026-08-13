#!/usr/bin/env node
/**
 * Discover the REAL column headers of Amazon's Long-Term Storage Fee report.
 *
 * Why this exists: the sync at
 * Services/Sp_API/GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA.js has a
 * verified report TYPE but an UNVERIFIED column mapping — no public source
 * documents this report's TSV headers. Rather than guess (which is how the
 * report type itself ended up wrong the first time), run this once against a
 * real account, read the printed headers, and correct the findField() candidate
 * lists in the sync file.
 *
 * STRICTLY READ-ONLY: requests + downloads + parses the report and prints what
 * it found. Writes NOTHING to Mongo. It only opens a DB connection to look up
 * the seller's refresh token.
 *
 * Usage:
 *   node server/scripts/discoverLtsfReportHeaders.js \
 *     --user-id=<mongoId> --country=AU --region=FE
 *
 * Options:
 *   --rows=N   How many sample data rows to print (default 3)
 *
 * Env: DB_URI, DB_NAME (or MONGODB_URI), SPAPI credentials
 *      (Services/Sp_API/config.js or SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET)
 *
 * Note: Amazon can take several minutes to produce a report. This polls for up
 * to ~10 minutes before giving up.
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
const { getAccessToken, resolveMarketplaceAndRegion } = require('../Services/Sp_API/SpApiMarketplace.js');
const spCredentials = require('../Services/Sp_API/config.js');
const ltsfSync = require('../Services/Sp_API/GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA.js');

function getArg(name) {
  const match = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=').trim() : null;
}

const USER_ID = getArg('user-id');
const COUNTRY = (getArg('country') || '').toUpperCase();
const REGION = (getArg('region') || '').toUpperCase();
const SAMPLE_ROWS = Number(getArg('rows')) || 3;

const POLL_INTERVAL_MS = 20000;
const MAX_POLLS = 30; // ~10 minutes

async function main() {
  if (!USER_ID || !COUNTRY || !REGION) {
    console.error('Usage: node server/scripts/discoverLtsfReportHeaders.js --user-id=<id> --country=AU --region=FE');
    process.exit(1);
  }
  if (!MONGODB_URI) {
    throw new Error('No Mongo URI configured (DB_URI + DB_NAME, or MONGODB_URI)');
  }

  await mongoose.connect(MONGODB_URI);

  const seller = await Seller.findOne({ User: USER_ID }).lean();
  if (!seller) throw new Error(`No Seller document for user ${USER_ID}`);

  const account = (seller.sellerAccount || []).find(
    (a) =>
      String(a?.country || '').toUpperCase() === COUNTRY &&
      String(a?.region || '').toUpperCase() === REGION
  );
  if (!account) throw new Error(`No sellerAccount for ${COUNTRY}/${REGION}`);

  const refreshToken = account.spiRefreshToken;
  if (!refreshToken) throw new Error('spiRefreshToken missing for this marketplace');

  const clientId = spCredentials.clientId || process.env.SPAPI_CLIENT_ID;
  const clientSecret = spCredentials.clientSecret || process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET not configured');
  }

  const { marketplaceId, baseUrl } = resolveMarketplaceAndRegion(COUNTRY);
  // The sync's helpers take `baseuri` as a bare host (they prepend https://).
  const baseuri = String(baseUrl).replace(/^https?:\/\//, '');

  console.log(`\nReport type : ${ltsfSync.REPORT_TYPE}`);
  console.log(`Account     : ${USER_ID}  ${COUNTRY}/${REGION}`);
  console.log(`Marketplace : ${marketplaceId}`);
  console.log('Mode        : READ-ONLY (nothing will be written to Mongo)\n');

  console.log('Fetching SP-API access token...');
  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

  console.log('Requesting report...');
  const reportId = await ltsfSync.generateReport(accessToken, [marketplaceId], baseuri);
  if (!reportId) throw new Error('Amazon did not return a reportId');
  console.log(`reportId: ${reportId}`);

  let reportDocumentId = null;
  for (let i = MAX_POLLS; i > 0 && !reportDocumentId; i--) {
    console.log(`  waiting for Amazon to build the report... (${i} tries left)`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    reportDocumentId = await ltsfSync.checkReportStatus(accessToken, reportId, baseuri);
    if (reportDocumentId === false) {
      throw new Error('Amazon reported FATAL/CANCELLED/DONE_NO_DATA for this report — see log above');
    }
  }
  if (!reportDocumentId) throw new Error('Report did not finish within the polling window');

  console.log('\nDownloading report document...');
  const axios = require('axios');
  const url = await ltsfSync.getReportLink(accessToken, reportDocumentId, baseuri);
  const res = await axios({ method: 'GET', url, responseType: 'arraybuffer' });

  const rows = await ltsfSync.convertTSVToJson(res.data);
  if (!rows || rows.length === 0) {
    console.log('\nReport parsed but contained 0 rows (this account may simply have no LTSF charges).');
    console.log('Re-run against an account with aged FBA inventory to see real headers.');
    return;
  }

  const headers = Object.keys(rows[0]);

  console.log('\n===================== REAL HEADERS =====================');
  headers.forEach((h) => console.log(`  ${h}`));
  console.log('========================================================');
  console.log(`(${headers.length} columns, ${rows.length} data rows)\n`);

  console.log(`===== FIRST ${Math.min(SAMPLE_ROWS, rows.length)} DATA ROW(S) =====`);
  rows.slice(0, SAMPLE_ROWS).forEach((r, i) => {
    console.log(`\n--- row ${i + 1} ---`);
    console.log(JSON.stringify(r, null, 2));
  });

  // Show which of the sync's current guesses actually resolve, so the fix is obvious.
  console.log('\n===== MAPPING CHECK (current candidates vs real headers) =====');
  const EXPECTED = ['asin', 'productName', 'snapShotDate', 'quantity', 'amount', 'volume', 'surCharge', 'rate_surCharge'];
  const matchesFor = (needles) => headers.filter((h) => needles.some((n) => h.toLowerCase().includes(n)));
  const HINTS = {
    asin: ['asin'],
    productName: ['product', 'item_name', 'item-name', 'title'],
    snapShotDate: ['snapshot', 'date', 'month'],
    quantity: ['qty', 'quantity', 'unit'],
    amount: ['fee', 'amount', 'charge', 'total'],
    volume: ['volume'],
    surCharge: ['surcharge', 'age', 'tier', 'range'],
    rate_surCharge: ['rate'],
  };
  EXPECTED.forEach((field) => {
    const candidates = matchesFor(HINTS[field]);
    console.log(`  ${field.padEnd(14)} → ${candidates.length ? candidates.join(', ') : '*** NO OBVIOUS MATCH ***'}`);
  });
  console.log('\nUpdate the findField() candidate lists in');
  console.log('  server/Services/Sp_API/GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA.js');
  console.log('to use the real header names above, then re-enable the ltsfData entry in ScheduleConfig.js.\n');
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nERROR:', err.message);
    try { await mongoose.disconnect(); } catch { /* already closed */ }
    process.exit(1);
  });

#!/usr/bin/env node
/**
 * fetchAgencyClientsData.js
 *
 * Fetches Finance (SP-API) and Ads (Amazon Ads API) data for all agency clients.
 * Uses the date range stored in DataFetchTracking per user/country/region.
 *
 * Finance: syncFinanceData with forceDates → DailySkuFinance, DailyOverheadFinance, etc.
 * Ads: getPPCMetrics → PPCMetrics collection
 *
 * Usage:
 *   Dry run (prints plan, no API calls):
 *   node server/scripts/fetchAgencyClientsData.js --dry-run
 *
 *   Live run:
 *   node server/scripts/fetchAgencyClientsData.js
 *
 * Options:
 *   --dry-run            Preview what would be fetched without making API calls
 *   --client-id=<id>     Process a single agency client (User ObjectId)
 *   --finance-only       Only fetch finance data (skip ads)
 *   --ads-only           Only fetch ads data (skip finance)
 *   --days=N             Override: fetch last N days instead of DataFetchTracking range (default: use tracking)
 *   --chunk=N            Days per finance chunk (default: 30)
 *   --delay-ms=N         Delay between accounts in ms (default: 1000)
 *   --agency-user-id=<id> Filter by agency owner User ID
 *   --exclude-client-id=<id>  Exclude specific client(s); comma-separated or repeat flag
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

// ── CLI args ──
const argv = process.argv.slice(2);
function getArg(name) {
  const match = argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1].trim() : null;
}
const isDryRun = argv.includes('--dry-run');
const FINANCE_ONLY = argv.includes('--finance-only');
const ADS_ONLY = argv.includes('--ads-only');
const SINGLE_CLIENT_ID = getArg('client-id') || null;
const AGENCY_USER_ID = getArg('agency-user-id') || null;
const OVERRIDE_DAYS = getArg('days') ? parseInt(getArg('days'), 10) : null;
const CHUNK_SIZE = getArg('chunk') ? parseInt(getArg('chunk'), 10) : 30;
const DELAY_MS = getArg('delay-ms') ? parseInt(getArg('delay-ms'), 10) : 1000;

const DEFAULT_EXCLUDED_CLIENTS = ['69b3fb0813e7a7ba975e9ea9'];

function parseExcludeClientIds() {
  const ids = new Set(DEFAULT_EXCLUDED_CLIENTS);
  for (const arg of argv) {
    if (!arg.startsWith('--exclude-client-id=')) continue;
    const raw = arg.split('=').slice(1).join('=').trim();
    for (const part of raw.split(',')) {
      const id = part.trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}
const EXCLUDE_CLIENT_IDS = parseExcludeClientIds();

// ── Models & services ──
const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const DataFetchTracking = require('../models/system/DataFetchTrackingModel.js');
const spCredentials = require('../Services/Sp_API/config.js');
const { getAccessToken } = require('../Services/Sp_API/SpApiMarketplace.js');
const { syncFinanceData } = require('../Services/Sp_API/FinanceService.js');
const { getPPCMetrics } = require('../Services/AmazonAds/GetPPCMetrics.js');
const { generateAdsAccessToken } = require('../Services/AmazonAds/GenerateToken.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function subtractDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().substring(0, 10);
}

function buildChunks(endDate, totalDays, chunkSize) {
  const chunks = [];
  let chunkEnd = endDate;
  let remaining = totalDays;

  while (remaining > 0) {
    const daysInChunk = Math.min(remaining, chunkSize);
    const chunkStart = subtractDays(chunkEnd, daysInChunk - 1);
    chunks.push({ startDate: chunkStart, endDate: chunkEnd });
    chunkEnd = subtractDays(chunkStart, 1);
    remaining -= daysInChunk;
  }

  return chunks;
}

function countDaysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

async function getDateRangeFromTracking(userId, country, region) {
  const tracking = await DataFetchTracking.findOne({
    User: userId,
    country,
    region,
    status: { $in: ['completed', 'partial'] },
  })
    .sort({ fetchedAt: -1 })
    .select('dataRange')
    .lean();

  if (!tracking?.dataRange?.startDate || !tracking?.dataRange?.endDate) return null;
  return { startDate: tracking.dataRange.startDate, endDate: tracking.dataRange.endDate };
}

async function fetchFinanceForClient(client, dateRange, stats) {
  const label = `${client.brand || 'no-brand'} (${client.clientId}) ${client.country}-${client.region}`;
  const totalDays = countDaysInclusive(dateRange.startDate, dateRange.endDate);
  const chunks = buildChunks(dateRange.endDate, totalDays, CHUNK_SIZE);

  console.log(`    [Finance] ${chunks.length} chunk(s) for ${dateRange.startDate} → ${dateRange.endDate} (${totalDays} days)`);

  if (isDryRun) {
    for (let i = 0; i < chunks.length; i++) {
      console.log(`      [dry-run] chunk ${i + 1}/${chunks.length}: ${chunks[i].startDate} → ${chunks[i].endDate}`);
    }
    stats.financeDryRun += chunks.length;
    return;
  }

  const clientId = spCredentials.clientId || process.env.SPAPI_CLIENT_ID;
  const clientSecret = spCredentials.clientSecret || process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(`      FAIL ${label}: SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET not set`);
    stats.financeTokenFailed += 1;
    return;
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(clientId, clientSecret, client.spiRefreshToken);
  } catch (e) {
    stats.financeTokenFailed += 1;
    console.error(`      FAIL ${label} (SP-API token): ${e.message}`);
    return;
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const startTs = Date.now();
      const result = await syncFinanceData({
        userId: client.clientId,
        country: client.country,
        regionModel: client.region,
        refreshToken: client.spiRefreshToken,
        accessToken,
        clientId,
        clientSecret,
        forceDates: [chunk.startDate, chunk.endDate],
      });

      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      const salesOrders = Number(result?.step1?.salesOrders ?? 0);
      const skuDocs = Number(result?.step1?.skuDocs ?? 0);
      console.log(`      OK chunk ${i + 1}/${chunks.length} (${chunk.startDate}→${chunk.endDate}) | ${elapsed}s | orders=${salesOrders} skuDocs=${skuDocs}`);
      stats.financeSucceeded += 1;
    } catch (e) {
      stats.financeFailed += 1;
      console.error(`      FAIL chunk ${i + 1}/${chunks.length} (${chunk.startDate}→${chunk.endDate}): ${e.message}`);
    }

    if (i < chunks.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
  }
}

async function fetchAdsForClient(client, dateRange, stats) {
  const label = `${client.brand || 'no-brand'} (${client.clientId}) ${client.country}-${client.region}`;

  if (!client.adsRefreshToken || !client.ProfileId) {
    console.log(`    [Ads] SKIP — missing adsRefreshToken or ProfileId`);
    stats.adsSkippedNoToken += 1;
    return;
  }

  console.log(`    [Ads] ${dateRange.startDate} → ${dateRange.endDate}`);

  if (isDryRun) {
    console.log(`      [dry-run] getPPCMetrics: ${dateRange.startDate} → ${dateRange.endDate}`);
    stats.adsDryRun += 1;
    return;
  }

  let adsAccessToken;
  try {
    adsAccessToken = await generateAdsAccessToken(client.adsRefreshToken);
  } catch (e) {
    stats.adsTokenFailed += 1;
    console.error(`      FAIL ${label} (Ads token): ${e.message}`);
    return;
  }

  try {
    const startTs = Date.now();
    await getPPCMetrics(
      adsAccessToken,
      client.ProfileId,
      client.clientId.toString(),
      client.country,
      client.region,
      client.adsRefreshToken,
      dateRange.startDate,
      dateRange.endDate,
      true
    );
    const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
    console.log(`      OK getPPCMetrics | ${elapsed}s`);
    stats.adsSucceeded += 1;
  } catch (e) {
    stats.adsFailed += 1;
    console.error(`      FAIL ${label} (getPPCMetrics): ${e.message}`);
  }
}

async function main() {
  if (!MONGODB_URI) {
    console.error('ERROR: Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(' Fetch Finance + Ads for Agency Clients');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Mode:         ${isDryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`Fetch:        ${ADS_ONLY ? 'Ads only' : FINANCE_ONLY ? 'Finance only' : 'Finance + Ads'}`);
  console.log(`Chunk size:   ${CHUNK_SIZE} days (finance)`);
  console.log(`Delay:        ${DELAY_MS}ms between accounts`);
  if (OVERRIDE_DAYS) console.log(`Override days: ${OVERRIDE_DAYS} (ignoring DataFetchTracking range)`);
  if (SINGLE_CLIENT_ID) console.log(`Single client: ${SINGLE_CLIENT_ID}`);
  if (AGENCY_USER_ID) console.log(`Agency owner:  ${AGENCY_USER_ID}`);
  if (EXCLUDE_CLIENT_IDS.size > 0) console.log(`Excluded:      ${[...EXCLUDE_CLIENT_IDS].join(', ')}`);
  console.log('─────────────────────────────────────────────────────────\n');

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  // Find agency clients: users with agencyId field set in User model
  const userFilter = { agencyId: { $ne: null } };
  if (SINGLE_CLIENT_ID) {
    userFilter._id = new mongoose.Types.ObjectId(SINGLE_CLIENT_ID);
  }
  if (AGENCY_USER_ID) {
    userFilter.agencyId = new mongoose.Types.ObjectId(AGENCY_USER_ID);
  }

  const agencyClients = await User.find(userFilter)
    .select('_id email agencyId')
    .lean();
  console.log(`Found ${agencyClients.length} agency client user(s).\n`);

  // For each agency client, look up their seller accounts
  const allClients = [];
  for (const user of agencyClients) {
    const userId = user._id.toString();
    if (EXCLUDE_CLIENT_IDS.has(userId)) continue;

    const seller = await Seller.findOne({ User: user._id }).lean();
    if (!seller || !seller.sellerAccount || seller.sellerAccount.length === 0) continue;

    for (const acc of seller.sellerAccount) {
      if (!acc.country || !acc.region) continue;
      if (!acc.spiRefreshToken && !acc.adsRefreshToken) continue;
      allClients.push({
        agencyUserId: user.agencyId,
        clientId: user._id,
        email: user.email || '',
        brand: seller.brand || '',
        country: acc.country.toUpperCase(),
        region: acc.region.toUpperCase(),
        spiRefreshToken: acc.spiRefreshToken || null,
        adsRefreshToken: acc.adsRefreshToken || null,
        ProfileId: acc.ProfileId || null,
      });
    }
  }

  console.log(`Total agency client accounts to process: ${allClients.length}\n`);

  const stats = {
    processed: 0,
    skippedNoTracking: 0,
    skippedNoSpiToken: 0,
    financeDryRun: 0,
    financeTokenFailed: 0,
    financeSucceeded: 0,
    financeFailed: 0,
    adsDryRun: 0,
    adsSkippedNoToken: 0,
    adsTokenFailed: 0,
    adsSucceeded: 0,
    adsFailed: 0,
  };

  for (let idx = 0; idx < allClients.length; idx++) {
    const client = allClients[idx];
    const label = `${client.email || client.brand || 'no-brand'} (${client.clientId}) ${client.country}-${client.region}`;

    console.log(`\n[${idx + 1}/${allClients.length}] ${label}`);

    // Determine date range
    let dateRange;
    if (OVERRIDE_DAYS) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
      dateRange = { startDate: subtractDays(yesterday, OVERRIDE_DAYS - 1), endDate: yesterday };
    } else {
      dateRange = await getDateRangeFromTracking(client.clientId, client.country, client.region);
    }

    if (!dateRange) {
      console.log(`  SKIP — no DataFetchTracking entry found`);
      stats.skippedNoTracking += 1;
      continue;
    }

    console.log(`  Date range: ${dateRange.startDate} → ${dateRange.endDate}`);
    stats.processed += 1;

    // Finance
    if (!ADS_ONLY) {
      if (!client.spiRefreshToken) {
        console.log(`    [Finance] SKIP — no spiRefreshToken`);
        stats.skippedNoSpiToken += 1;
      } else {
        await fetchFinanceForClient(client, dateRange, stats);
      }
    }

    // Ads
    if (!FINANCE_ONLY) {
      await fetchAdsForClient(client, dateRange, stats);
    }

    if (idx < allClients.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(JSON.stringify(stats, null, 2));
  console.log('');

  await mongoose.connection.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  mongoose.connection.close().finally(() => process.exit(1));
});

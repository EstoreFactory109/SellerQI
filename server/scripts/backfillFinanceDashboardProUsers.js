#!/usr/bin/env node
/**
 * Backfill Finance Dashboard (DailySkuFinance) for PRO & PRO-trial users
 *
 * Fetches finance data (sales + expenses) from Amazon SP-API and stores it
 * using the new unified FinanceService flow:
 *   - DailySkuFinance  (per-SKU daily buckets — revenue, units, expenses)
 *   - DailyOverheadFinance (account-level overhead)
 *   - FinanceSyncLog  (per-day sync status)
 *   - PendingExpenseOrder (orders awaiting settlement)
 *   - AsinRelationship (parent/child ASIN mappings)
 *
 * Chunked fetching:
 *   The total span (default 60 days) is split into 30-day chunks.
 *   Each chunk is fetched separately via syncFinanceData, starting from the
 *   most recent 30 days and working backwards. This avoids API timeouts and
 *   ensures complete data for each window.
 *
 *   Example for --days=60, tracking end date = 2026-05-17:
 *     Chunk 1: 2026-04-18 → 2026-05-17  (most recent 30 days)
 *     Chunk 2: 2026-03-19 → 2026-04-17  (30 days before that)
 *
 * End date: Read from DataFetchTracking.dataRange.endDate per user/marketplace
 *           so the finance data aligns with the PPC / sales data already fetched.
 *
 * Duplicate safety: syncFinanceData internally does deleteMany for all dates
 * in the range before insertMany, so re-running is safe and idempotent.
 *
 * Eligibility:
 *   - packageType === 'PRO'
 *   - AND (subscriptionStatus active|trialing OR isInTrialPeriod === true)
 *   - Seller with sellerAccount rows: spiRefreshToken + region + valid country
 *
 * Usage:
 *   node server/scripts/backfillFinanceDashboardProUsers.js [options]
 *
 * Options:
 *   --dry-run           Print what would run without making API calls or DB writes
 *   --limit=N           Process at most N users
 *   --user-id=<id>      Process a single user (useful for testing)
 *   --days=N            Total days to backfill (default: 60)
 *   --chunk=N           Days per API chunk (default: 30)
 *   --delay-ms=N        Delay in ms between chunks/marketplace jobs (default: 500)
 *   --skip-if-synced    Skip marketplaces whose full backfill date range is already synced
 *                       (default ON for bulk runs; use --no-skip-synced to force re-fetch)
 *   --no-skip-synced    Re-fetch even when FinanceSyncLog already covers the range
 *   --exclude-user-id=<id>  Skip user(s); comma-separated or repeat flag (e.g. already migrated)
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
const SINGLE_USER_ID = getArg('user-id') || null;
// Bulk runs: skip marketplaces already fully synced unless --no-skip-synced
const skipIfSynced =
  !argv.includes('--no-skip-synced') &&
  (argv.includes('--skip-if-synced') || !SINGLE_USER_ID);
const LIMIT = getArg('limit') ? parseInt(getArg('limit'), 10) : null;
const BACKFILL_DAYS = getArg('days') ? parseInt(getArg('days'), 10) : 60;
const CHUNK_SIZE = getArg('chunk') ? parseInt(getArg('chunk'), 10) : 30;
const DELAY_MS = getArg('delay-ms') ? parseInt(getArg('delay-ms'), 10) : 500;

function parseExcludeUserIds() {
  const ids = new Set();
  for (const arg of argv) {
    if (!arg.startsWith('--exclude-user-id=')) continue;
    const raw = arg.split('=').slice(1).join('=').trim();
    for (const part of raw.split(',')) {
      const id = part.trim();
      if (id && mongoose.Types.ObjectId.isValid(id)) ids.add(id);
    }
  }
  return ids;
}

const EXCLUDE_USER_IDS = parseExcludeUserIds();

// ── Models & services ──
const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const DataFetchTracking = require('../models/system/DataFetchTrackingModel.js');
const FinanceSyncLog = require('../models/finance/FinanceSyncLogModel.js');
const DailySkuFinance = require('../models/finance/DailySkuFinanceModel.js');
const { REGION_VALID_MARKETPLACES } = require('../Services/MCP/constants.js');
const { getAccessToken } = require('../Services/Sp_API/SpApiMarketplace.js');
const spCredentials = require('../Services/Sp_API/config.js');
const { syncFinanceData } = require('../Services/Sp_API/FinanceService.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return raw.trim().toUpperCase() || null;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

function subtractDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().substring(0, 10);
}

/**
 * Split a date span into 30-day chunks, most recent first.
 * E.g. for endDate=2026-05-17, totalDays=60, chunkSize=30:
 *   chunk 1: 2026-04-18 → 2026-05-17
 *   chunk 2: 2026-03-19 → 2026-04-17
 */
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

function collectMarketplaces(seller) {
  const accounts = Array.isArray(seller?.sellerAccount) ? seller.sellerAccount : [];
  const seen = new Set();
  const out = [];

  for (const acc of accounts) {
    const region = acc?.region;
    const country = normalizeCountry(acc?.country || acc?.countryCode);
    const refreshToken = acc?.spiRefreshToken;
    if (!region || !country || !refreshToken) continue;

    const valid = REGION_VALID_MARKETPLACES[region] || [];
    if (!valid.includes(country)) continue;

    const key = `${region}:${country}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ region, country, refreshToken });
  }
  return out;
}

async function getEndDateFromTracking(userId, country, region) {
  const tracking = await DataFetchTracking.findOne({
    User: userId,
    country,
    region,
    status: { $in: ['completed', 'partial'] },
  })
    .sort({ fetchedAt: -1 })
    .select('dataRange')
    .lean();

  return tracking?.dataRange?.endDate || null;
}

function countDaysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

async function countSkuDocsWithSalesInRange(userId, country, region, startDate, endDate) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  return DailySkuFinance.countDocuments({
    User: userObjectId,
    country: normalizeCountry(country),
    region,
    date: { $gte: startDate, $lte: endDate },
    $or: [{ productSales: { $gt: 0.01 } }, { units: { $gt: 0 } }],
  });
}

/**
 * "Fully synced" only when FinanceSyncLog covers the range AND DailySkuFinance
 * has real sales/units — not expense-only rows from a broken prior run.
 */
async function isBackfillRangeFullySynced(userId, country, region, startDate, endDate) {
  const userObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const expectedDays = countDaysInclusive(startDate, endDate);
  const syncedDays = await FinanceSyncLog.countDocuments({
    User: userObjectId,
    country: normalizeCountry(country),
    region,
    status: 'success',
    date: { $gte: startDate, $lte: endDate },
  });
  if (syncedDays < expectedDays) return false;

  const salesRows = await countSkuDocsWithSalesInRange(
    userId,
    country,
    region,
    startDate,
    endDate
  );
  return salesRows > 0;
}

async function processMarketplace(userId, email, mp, stats) {
  const label = `${email} (${userId}) ${mp.region}/${mp.country}`;

  const trackingEndDate = await getEndDateFromTracking(userId, mp.country, mp.region);
  if (!trackingEndDate) {
    console.log(`  SKIP (no DataFetchTracking end date): ${label}`);
    stats.skippedNoTracking += 1;
    return;
  }

  const startDate = subtractDays(trackingEndDate, BACKFILL_DAYS - 1);
  const chunks = buildChunks(trackingEndDate, BACKFILL_DAYS, CHUNK_SIZE);

  if (skipIfSynced) {
    try {
      const fullySynced = await isBackfillRangeFullySynced(
        userId,
        mp.country,
        mp.region,
        startDate,
        trackingEndDate
      );
      if (fullySynced) {
        console.log(
          `  SKIP (range synced with sales data ${startDate} → ${trackingEndDate}): ${label}`
        );
        stats.skippedAlreadySynced += 1;
        return;
      }
    } catch {
      // If check fails, proceed with sync
    }
  }

  console.log(
    `  Plan: ${chunks.length} chunk(s) of up to ${CHUNK_SIZE} days — ${chunks.map((c, i) => `(${i + 1}) ${c.startDate}→${c.endDate}`).join(', ')}`
  );

  if (isDryRun) {
    for (let i = 0; i < chunks.length; i++) {
      console.log(`  [dry-run] chunk ${i + 1}/${chunks.length}: ${label} ${chunks[i].startDate} → ${chunks[i].endDate}`);
    }
    stats.dryRunJobs += chunks.length;
    return;
  }

  const clientId = spCredentials.clientId || process.env.SPAPI_CLIENT_ID;
  const clientSecret = spCredentials.clientSecret || process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(`  FAIL ${label}: SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET not set`);
    stats.tokenFailed += 1;
    return;
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(clientId, clientSecret, mp.refreshToken);
  } catch (e) {
    stats.tokenFailed += 1;
    console.error(`  FAIL ${label} (access token): ${e.message}`);
    return;
  }

  // Process each chunk sequentially, most recent first
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkLabel = `chunk ${i + 1}/${chunks.length}`;

    try {
      const startTs = Date.now();
      const result = await syncFinanceData({
        userId,
        country: mp.country,
        regionModel: mp.region,
        refreshToken: mp.refreshToken,
        accessToken,
        clientId,
        clientSecret,
        forceDates: [chunk.startDate, chunk.endDate],
      });

      // Reuse the refreshed token from the previous call for the next chunk
      if (result?.step1?.token) accessToken = result.step1.token;

      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
      const salesOrders = Number(result?.step1?.salesOrders ?? 0);
      const skuDocs = Number(result?.step1?.skuDocs ?? 0);
      const pendingOrders = Number(result?.step1?.pendingOrders ?? 0);

      if (salesOrders === 0) {
        console.warn(
          `  WARN ${label} | ${chunkLabel} ${chunk.startDate} → ${chunk.endDate} | ${elapsed}s | ` +
          `orders=0 skuDocs=${skuDocs} — Sales Report returned no orders; only expenses may be stored. ` +
          `Re-run with --no-skip-synced after delete script.`
        );
        stats.chunksExpensesOnly += 1;
      } else {
        console.log(
          `  OK ${label} | ${chunkLabel} ${chunk.startDate} → ${chunk.endDate} | ${elapsed}s | ` +
          `orders=${salesOrders} skuDocs=${skuDocs} pending=${pendingOrders}`
        );
        stats.syncSucceeded += 1;
      }
    } catch (e) {
      stats.syncFailed += 1;
      console.error(`  FAIL ${label} ${chunkLabel} (${chunk.startDate} → ${chunk.endDate}): ${e.message}`);
    }

    // Delay between chunks to respect rate limits
    if (i < chunks.length - 1 && DELAY_MS > 0) {
      await sleep(DELAY_MS);
    }
  }
}

async function main() {
  if (!MONGODB_URI) {
    console.error('ERROR: Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
    process.exit(1);
  }

  const numChunks = Math.ceil(BACKFILL_DAYS / CHUNK_SIZE);

  console.log('═══════════════════════════════════════════════════════════');
  console.log(' Finance Dashboard Backfill — PRO & PRO-trial users');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Mode:        ${isDryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`Total days:  ${BACKFILL_DAYS} (from each user's DataFetchTracking end date)`);
  console.log(`Chunk size:  ${CHUNK_SIZE} days → ${numChunks} chunk(s) per marketplace`);
  console.log(`Delay:       ${DELAY_MS}ms between chunks`);
  if (skipIfSynced) {
    console.log('Skip-if-synced: ON (range in FinanceSyncLog AND DailySkuFinance has sales/units)');
  }
  if (argv.includes('--no-skip-synced')) console.log('Skip-if-synced: OFF (--no-skip-synced)');
  if (EXCLUDE_USER_IDS.size > 0) {
    console.log(`Excluded users: ${[...EXCLUDE_USER_IDS].join(', ')}`);
  }
  if (LIMIT) console.log(`User limit:  ${LIMIT}`);
  if (SINGLE_USER_ID) console.log(`Single user: ${SINGLE_USER_ID}`);
  console.log('─────────────────────────────────────────────────────────\n');

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const userFilter = {
    packageType: 'PRO',
    $or: [
      { subscriptionStatus: 'active' },
      { subscriptionStatus: 'trialing' },
      { isInTrialPeriod: true },
    ],
  };
  if (SINGLE_USER_ID) {
    userFilter._id = new mongoose.Types.ObjectId(SINGLE_USER_ID);
  }

  let query = User.find(userFilter)
    .select('_id email packageType subscriptionStatus isInTrialPeriod')
    .sort({ _id: 1 })
    .lean();

  if (LIMIT && Number.isFinite(LIMIT) && LIMIT > 0) {
    query = query.limit(LIMIT);
  }

  const users = await query;
  console.log(`Found ${users.length} PRO / PRO-trial user(s).\n`);

  const stats = {
    usersProcessed: 0,
    usersSkippedNoSeller: 0,
    usersSkippedNoMarketplaces: 0,
    skippedNoTracking: 0,
    dryRunJobs: 0,
    tokenFailed: 0,
    syncSucceeded: 0,
    syncFailed: 0,
    chunksExpensesOnly: 0,
    skippedAlreadySynced: 0,
    usersSkippedExcluded: 0,
  };

  for (const u of users) {
    const userId = u._id;
    const userIdStr = String(userId);

    if (EXCLUDE_USER_IDS.has(userIdStr)) {
      stats.usersSkippedExcluded += 1;
      console.log(`Skip (excluded): ${u.email} (${userIdStr})`);
      continue;
    }

    const seller = await Seller.findOne({ User: userId }).lean();
    if (!seller) {
      stats.usersSkippedNoSeller += 1;
      console.log(`Skip (no Seller): ${u.email} (${userId})`);
      continue;
    }

    const marketplaces = collectMarketplaces(seller);
    if (marketplaces.length === 0) {
      stats.usersSkippedNoMarketplaces += 1;
      console.log(`Skip (no usable marketplace): ${u.email} (${userId})`);
      continue;
    }

    stats.usersProcessed += 1;
    console.log(`\nUser ${u.email} (${userId}) — ${marketplaces.length} marketplace(s)`);

    for (const mp of marketplaces) {
      await processMarketplace(userId, u.email, mp, stats);
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
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

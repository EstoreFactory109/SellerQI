/**
 * Backfill SalesOnlyMetrics + DataFetchTracking for PRO and PRO-trial users
 *
 * Fetches MCP sales-only data (default service window: UTC yesterday−30 → yesterday),
 * upserts SalesOnlyMetrics, and writes a completed DataFetchTracking row with the same
 * dataRange (mirrors scheduled calendar tracking for mcpEconomicsData / SalesOnly).
 *
 * Eligibility:
 *   - packageType === 'PRO'
 *   - AND (subscriptionStatus in active|trialing OR isInTrialPeriod === true)
 *   - Has Seller document with at least one sellerAccount having spiRefreshToken + region + country
 *
 * Usage:
 *   node server/scripts/backfillSalesOnlyMetricsProUsers.js [--dry-run] [--limit=N] [--user-id=<ObjectId>] [--delay-ms=500]
 *
 * Env: DB_URI, DB_NAME (see server/config/config.js) — same as other migration scripts.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName ? `${dbConsts.dbUri}/${dbConsts.dbName}` : process.env.MONGODB_URI || process.env.MONGO_URI;

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find((a) => a.startsWith('--limit='));
const userIdArg = args.find((a) => a.startsWith('--user-id='));
const delayArg = args.find((a) => a.startsWith('--delay-ms='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const SINGLE_USER_ID = userIdArg ? userIdArg.split('=')[1].trim() : null;
const DELAY_MS = delayArg ? parseInt(delayArg.split('=')[1], 10) : 0;

const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const { REGION_VALID_MARKETPLACES } = require('../Services/MCP/constants.js');
const {
  fetchAndStoreSalesOnlyData,
  getDefaultSalesOnlyDateRangeUtc,
} = require('../Services/MCP/MCPSalesOnlyIntegration.js');
const DataFetchTrackingService = require('../Services/system/DataFetchTrackingService.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return c || null;
}

/**
 * Unique marketplace rows from seller.sellerAccount[].
 */
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
    if (!valid.includes(country)) {
      console.warn(`  Skip invalid marketplace: region=${region} country=${country} (not in REGION_VALID_MARKETPLACES)`);
      continue;
    }

    const key = `${region}:${country}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ region, country, refreshToken });
  }
  return out;
}

async function processMarketplace(userId, email, { region, country, refreshToken }, sessionId, dataRange, stats) {
  const label = `${email} (${userId}) ${region}/${country}`;

  if (isDryRun) {
    console.log(`[dry-run] would fetch SalesOnly + tracking: ${label}`);
    stats.dryRunJobs += 1;
    return;
  }

  let trackingId = null;
  try {
    const entry = await DataFetchTrackingService.startTracking(
      userId,
      country,
      region,
      { startDate: dataRange.startDateStr, endDate: dataRange.endDateStr },
      sessionId
    );
    trackingId = entry._id;
  } catch (e) {
    console.warn(`  DataFetchTracking start failed (${label}): ${e.message}`);
  }

  try {
    const result = await fetchAndStoreSalesOnlyData(userId, refreshToken, region, country);
    if (result?.success) {
      stats.succeeded += 1;
      console.log(`  OK ${label}`);
      if (trackingId) {
        await DataFetchTrackingService.completeTracking(trackingId);
      }
    } else {
      stats.failed += 1;
      const err = result?.error || 'unknown';
      console.error(`  FAIL ${label}: ${err}`);
      if (trackingId) {
        await DataFetchTrackingService.failTracking(trackingId, String(err).slice(0, 500));
      }
    }
  } catch (e) {
    stats.failed += 1;
    console.error(`  FAIL ${label}: ${e.message}`);
    if (trackingId) {
      try {
        await DataFetchTrackingService.failTracking(trackingId, String(e.message).slice(0, 500));
      } catch (_) {
        /* ignore */
      }
    }
  }

  if (DELAY_MS > 0) await sleep(DELAY_MS);
}

async function main() {
  if (!MONGODB_URI) {
    console.error('ERROR: Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
    process.exit(1);
  }

  const dataRange = getDefaultSalesOnlyDateRangeUtc();
  const sessionId = `backfill-salesonly-${Date.now()}`;

  console.log('Sales-only default dataRange (UTC):', dataRange);
  console.log('Mode:', isDryRun ? 'DRY-RUN' : 'LIVE');
  if (LIMIT) console.log('User limit:', LIMIT);
  if (SINGLE_USER_ID) console.log('Single user:', SINGLE_USER_ID);
  console.log('SessionId:', sessionId);
  console.log('---');

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const userFilter = {
    packageType: 'PRO',
    $or: [{ subscriptionStatus: 'active' }, { subscriptionStatus: 'trialing' }, { isInTrialPeriod: true }],
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
  console.log(`Found ${users.length} PRO / PRO-trial user(s) matching filter.\n`);

  const stats = {
    usersProcessed: 0,
    usersSkippedNoSeller: 0,
    usersSkippedNoMarketplaces: 0,
    dryRunJobs: 0,
    succeeded: 0,
    failed: 0,
  };

  for (const u of users) {
    const userId = u._id;
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
    console.log(`User ${u.email} (${userId}) — ${marketplaces.length} marketplace(s)`);

    for (const mp of marketplaces) {
      await processMarketplace(userId, u.email, mp, sessionId, dataRange, stats);
    }
  }

  console.log('\n--- Summary ---');
  console.log(JSON.stringify(stats, null, 2));
  await mongoose.connection.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  mongoose.connection.close().finally(() => process.exit(1));
});

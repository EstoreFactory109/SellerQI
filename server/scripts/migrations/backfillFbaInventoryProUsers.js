/**
 * Backfill FBA Inventory API data for PRO and PRO-trial users
 *
 * For each eligible user's connected marketplaces:
 *   - fetchInventoryStock (ItemStock.js)
 *   - persistFbaInventoryFromFetch (FbaInventoryStorageService.js) — Seller.products.quantity + FbaInventoryApiDetail
 *
 * Eligibility (aligned with backfillReviewsAndIssuesProUsers.js — User + Subscription):
 *   - Subscription: planType PRO AND status in active|trialing, OR
 *   - User: packageType PRO AND (subscriptionStatus active|trialing OR isInTrialPeriod === true)
 *   (Merges both sets so Stripe trialing PRO is included even if User doc lags.)
 *   - Seller with sellerAccount rows: spiRefreshToken + region (NA|EU|FE) + valid country
 *
 * Usage:
 *   node server/scripts/migrations/backfillFbaInventoryProUsers.js [--dry-run] [--limit=N] [--user-id=<ObjectId>] [--delay-ms=500]
 *
 * Env: DB_URI, DB_NAME (or MONGODB_URI), SPAPI credentials via server/Services/Sp_API/config.js or SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const dbConsts = require('../../config/config.js');
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

const User = require('../../models/user-auth/userModel.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { REGION_VALID_MARKETPLACES } = require('../../Services/MCP/constants.js');
const { getAccessToken } = require('../../Services/Sp_API/SpApiMarketplace.js');
const spCredentials = require('../../Services/Sp_API/config.js');
const { fetchInventoryStock } = require('../../Services/Sp_API/ItemStock.js');
const { persistFbaInventoryFromFetch } = require('../../Services/Sp_API/FbaInventoryStorageService.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sellerRegionToSpApiInternal(regionUpper) {
  const r = String(regionUpper).toUpperCase();
  if (r === 'NA') return 'na';
  if (r === 'EU') return 'eu';
  if (r === 'FE') return 'apac';
  return null;
}

function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return c || null;
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
    if (!valid.includes(country)) {
      console.warn(`  Skip invalid marketplace: region=${region} country=${country}`);
      continue;
    }

    const key = `${region}:${country}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ region, country, refreshToken });
  }
  return out;
}

async function processMarketplace(userId, email, { region, country, refreshToken }, stats) {
  const label = `${email} (${userId}) ${region}/${country}`;
  const internalRegion = sellerRegionToSpApiInternal(region);
  if (!internalRegion) {
    stats.skippedBadRegion += 1;
    console.warn(`  Skip bad region mapping: ${label}`);
    return;
  }

  if (isDryRun) {
    console.log(`[dry-run] would fetch + persist FBA inventory: ${label}`);
    stats.dryRunJobs += 1;
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
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
  } catch (e) {
    stats.tokenFailed += 1;
    console.error(`  FAIL ${label} (access token): ${e.message}`);
    return;
  }

  try {
    const result = await fetchInventoryStock({
      userId: String(userId),
      country,
      region: internalRegion,
      accessToken,
      sellerSkus: [],
    });

    if (!result?.hasData || !Array.isArray(result.stockRows) || result.stockRows.length === 0) {
      stats.fetchEmpty += 1;
      console.log(`  OK inventory (no rows) ${label} marketplaceId=${result?.marketplaceId || 'n/a'}`);
      if (DELAY_MS > 0) await sleep(DELAY_MS);
      return;
    }

    const persistSummary = await persistFbaInventoryFromFetch({
      userId,
      country,
      region,
      marketplaceId: result.marketplaceId,
      stockRows: result.stockRows,
    });

    stats.fetchSucceeded += 1;
    console.log(
      `  OK inventory ${label} skus=${result.stockRows.length} ` +
        `sellerQtyUpdated=${persistSummary.sellerProductsUpdated} detailsWritten=${persistSummary.inventorySkuRowsWritten}`
    );
  } catch (e) {
    stats.fetchFailed += 1;
    console.error(`  FAIL inventory ${label}: ${e.message}`);
  }

  if (DELAY_MS > 0) await sleep(DELAY_MS);
}

async function main() {
  if (!MONGODB_URI) {
    console.error('ERROR: Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
    process.exit(1);
  }

  console.log('Mode:', isDryRun ? 'DRY-RUN' : 'LIVE');
  if (LIMIT) console.log('User limit:', LIMIT);
  if (SINGLE_USER_ID) console.log('Single user:', SINGLE_USER_ID);
  if (DELAY_MS) console.log('Delay between jobs (ms):', DELAY_MS);
  console.log('---');

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  let users;
  if (SINGLE_USER_ID) {
    users = await User.find({ _id: new mongoose.Types.ObjectId(SINGLE_USER_ID) })
      .select('_id email packageType subscriptionStatus isInTrialPeriod')
      .sort({ _id: 1 })
      .lean();
  } else {
    const fromSubs = await Subscription.find({
      planType: 'PRO',
      status: { $in: ['active', 'trialing'] },
    })
      .select('userId')
      .lean();
    const idsFromSubs = new Set(fromSubs.map((s) => String(s.userId || '')).filter(Boolean));

    const fromUsers = await User.find({
      packageType: 'PRO',
      $or: [
        { subscriptionStatus: { $in: ['active', 'trialing'] } },
        { isInTrialPeriod: true },
      ],
    })
      .select('_id')
      .lean();
    const idsFromUsers = new Set(fromUsers.map((u) => String(u._id || '')).filter(Boolean));

    const mergedSorted = [...new Set([...idsFromSubs, ...idsFromUsers])].sort();
    let userIds = mergedSorted.map((id) => new mongoose.Types.ObjectId(id));
    if (LIMIT && Number.isFinite(LIMIT) && LIMIT > 0) {
      userIds = userIds.slice(0, LIMIT);
    }

    console.log('PRO / PRO-trial ID merge:', {
      fromSubscription: idsFromSubs.size,
      fromUserDoc: idsFromUsers.size,
      mergedUnique: mergedSorted.length,
      processingAfterLimit: userIds.length,
    });

    users = await User.find({ _id: { $in: userIds } })
      .select('_id email packageType subscriptionStatus isInTrialPeriod')
      .sort({ _id: 1 })
      .lean();
  }

  console.log(`Loaded ${users.length} user row(s) for backfill.\n`);

  const stats = {
    usersProcessed: 0,
    usersSkippedNoSeller: 0,
    usersSkippedNoMarketplaces: 0,
    dryRunJobs: 0,
    skippedBadRegion: 0,
    tokenFailed: 0,
    fetchSucceeded: 0,
    fetchFailed: 0,
    fetchEmpty: 0,
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
      await processMarketplace(userId, u.email, mp, stats);
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

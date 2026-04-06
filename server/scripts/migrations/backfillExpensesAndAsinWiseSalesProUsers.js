/**
 * Backfill ExpenseReport + ASIN-wise sales (Mongo) for PRO and PRO-trial users
 *
 * Calls the same services as integration/schedule with their default windows:
 *   - ExpenseReportService.fetchPersistAndReturnExpenseReport — daysBack: EXPENSE_FINANCE_DAYS_BACK env or 30
 *   - AsinWiseSalesStorageService.fetchPersistAndReturnAsinWiseSales — days defaults to 30
 *
 * Eligibility (same spirit as backfillSalesOnlyMetricsProUsers.js):
 *   - packageType === 'PRO'
 *   - AND (subscriptionStatus active|trialing OR isInTrialPeriod === true)
 *   - Seller with sellerAccount rows: spiRefreshToken + region (NA|EU|FE) + valid country
 *
 * Usage:
 *   node server/scripts/migrations/backfillExpensesAndAsinWiseSalesProUsers.js [--dry-run] [--limit=N] [--user-id=<ObjectId>] [--delay-ms=500] [--skip-expenses] [--skip-asin]
 *
 * Env: DB_URI, DB_NAME, SPAPI_CLIENT_ID, SPAPI_CLIENT_SECRET (see server/config/config.js)
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
const SKIP_EXPENSES = args.includes('--skip-expenses');
const SKIP_ASIN = args.includes('--skip-asin');

const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { REGION_VALID_MARKETPLACES } = require('../../Services/MCP/constants.js');
const { getAccessToken } = require('../../Services/Sp_API/SpApiMarketplace.js');
const spCredentials = require('../../Services/Sp_API/config.js');
const { getDefaultExpenseFinanceDaysBack } = require('../../config/expenseFinanceDaysBack.js');
const { fetchPersistAndReturnExpenseReport } = require('../../Services/Sp_API/ExpenseReportService.js');
const { fetchPersistAndReturnAsinWiseSales } = require('../../Services/Sp_API/AsinWiseSalesStorageService.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

  if (isDryRun) {
    const parts = [];
    if (!SKIP_EXPENSES) parts.push('expenses');
    if (!SKIP_ASIN) parts.push('asin-wise-sales');
    console.log(`[dry-run] would ${parts.join(' + ')}: ${label}`);
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

  if (!SKIP_EXPENSES) {
    try {
      const expenseResult = await fetchPersistAndReturnExpenseReport({
        userId,
        country,
        regionModel: region,
        refreshToken,
        accessToken,
        // daysBack omitted → EXPENSE_FINANCE_DAYS_BACK or 30
        clientId,
        clientSecret,
      });
      stats.expenseSucceeded += 1;
      console.log(
        `  OK expenses ${label} hasNewData=${Boolean(expenseResult?.hasNewData)}`
      );
    } catch (e) {
      stats.expenseFailed += 1;
      console.error(`  FAIL expenses ${label}: ${e.message}`);
    }
  }

  if (!SKIP_ASIN) {
    try {
      await fetchPersistAndReturnAsinWiseSales({
        userId,
        country,
        regionModel: region,
        refreshToken,
        accessToken,
        // days omitted → service default 30
        clientId,
        clientSecret,
      });
      stats.asinSucceeded += 1;
      console.log(`  OK asin-wise-sales ${label}`);
    } catch (e) {
      stats.asinFailed += 1;
      console.error(`  FAIL asin-wise-sales ${label}: ${e.message}`);
    }
  }

  if (DELAY_MS > 0) await sleep(DELAY_MS);
}

async function main() {
  if (!MONGODB_URI) {
    console.error('ERROR: Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
    process.exit(1);
  }

  if (SKIP_EXPENSES && SKIP_ASIN) {
    console.error('ERROR: Both --skip-expenses and --skip-asin; nothing to do.');
    process.exit(1);
  }

  console.log('Mode:', isDryRun ? 'DRY-RUN' : 'LIVE');
  console.log(
    `Default service windows: expenses daysBack=${getDefaultExpenseFinanceDaysBack()} (EXPENSE_FINANCE_DAYS_BACK or 30), ASIN-wise days=30`
  );
  if (SKIP_EXPENSES) console.log('Skipping expenses');
  if (SKIP_ASIN) console.log('Skipping ASIN-wise sales');
  if (LIMIT) console.log('User limit:', LIMIT);
  if (SINGLE_USER_ID) console.log('Single user:', SINGLE_USER_ID);
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
  console.log(`Found ${users.length} PRO / PRO-trial user(s).\n`);

  const stats = {
    usersProcessed: 0,
    usersSkippedNoSeller: 0,
    usersSkippedNoMarketplaces: 0,
    dryRunJobs: 0,
    tokenFailed: 0,
    expenseSucceeded: 0,
    expenseFailed: 0,
    asinSucceeded: 0,
    asinFailed: 0,
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

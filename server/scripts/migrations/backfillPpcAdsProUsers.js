/**
 * Backfill Amazon Ads report data for PRO and PRO-trial users (Campaign Audit / PPC metrics).
 *
 * Calls the same services as Integration.js for the PPC batch, with each service’s built-in
 * default date window (UTC yesterday − 30 → yesterday), matching Expences.js-style defaults:
 *   - GetPPCProductWise.getPPCSpendsBySKU → ProductWiseSponsoredAdsItem
 *   - GetWastedSpendKeywords.getKeywordPerformanceReport → adsKeywordsPerformanceModel
 *   - GetDateWiseSpendKeywords.getPPCSpendsDateWise → GetDateWisePPCspend
 *   - GetPPCMetrics.getPPCMetrics → PPCMetrics (startDate/endDate omitted)
 *   - GetPPCUnitsSold.getPPCUnitsSold → PPCUnitsSold (startDate/endDate omitted)
 *
 * Eligibility (same as backfillExpensesAndAsinWiseSalesProUsers.js):
 *   - packageType === 'PRO'
 *   - AND (subscriptionStatus active|trialing OR isInTrialPeriod === true)
 *   - Seller with sellerAccount rows: region (NA|EU|FE), valid country, adsRefreshToken + ProfileId
 *
 * Usage:
 *   node server/scripts/migrations/backfillPpcAdsProUsers.js [--dry-run] [--limit=N] [--user-id=<ObjectId>]
 *        [--delay-ms=500] [--service-delay-ms=2000]
 *        [--skip-product-wise] [--skip-keyword-report] [--skip-date-wise] [--skip-metrics] [--skip-units-sold]
 *
 * Env: DB_URI, DB_NAME (or MONGODB_URI), AMAZON_ADS_CLIENT_ID, AMAZON_ADS_CLIENT_SECRET
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
const serviceDelayArg = args.find((a) => a.startsWith('--service-delay-ms='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const SINGLE_USER_ID = userIdArg ? userIdArg.split('=')[1].trim() : null;
const DELAY_MS = delayArg ? parseInt(delayArg.split('=')[1], 10) : 0;
const SERVICE_DELAY_MS = serviceDelayArg ? parseInt(serviceDelayArg.split('=')[1], 10) : 2000;

const SKIP_PRODUCT_WISE = args.includes('--skip-product-wise');
const SKIP_KEYWORD_REPORT = args.includes('--skip-keyword-report');
const SKIP_DATE_WISE = args.includes('--skip-date-wise');
const SKIP_METRICS = args.includes('--skip-metrics');
const SKIP_UNITS_SOLD = args.includes('--skip-units-sold');

const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { REGION_VALID_MARKETPLACES } = require('../../Services/MCP/constants.js');
const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
const { getPPCSpendsBySKU } = require('../../Services/AmazonAds/GetPPCProductWise.js');
const { getKeywordPerformanceReport } = require('../../Services/AmazonAds/GetWastedSpendKeywords.js');
const { getPPCSpendsDateWise } = require('../../Services/AmazonAds/GetDateWiseSpendKeywords.js');
const { getPPCMetrics } = require('../../Services/AmazonAds/GetPPCMetrics.js');
const { getPPCUnitsSold } = require('../../Services/AmazonAds/GetPPCUnitsSold.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return c || null;
}

/**
 * Marketplaces that have Amazon Ads connected (refresh token + profile).
 */
function collectAdsMarketplaces(seller) {
  const accounts = Array.isArray(seller?.sellerAccount) ? seller.sellerAccount : [];
  const seen = new Set();
  const out = [];

  for (const acc of accounts) {
    const region = acc?.region;
    const country = normalizeCountry(acc?.country || acc?.countryCode);
    const adsRefreshToken = acc?.adsRefreshToken;
    const profileId = acc?.ProfileId;

    if (!region || !country || !adsRefreshToken || !profileId) continue;

    const valid = REGION_VALID_MARKETPLACES[region] || [];
    if (!valid.includes(country)) {
      console.warn(`  Skip invalid marketplace: region=${region} country=${country}`);
      continue;
    }

    const key = `${region}:${country}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      region,
      country,
      adsRefreshToken,
      profileId: String(profileId),
    });
  }
  return out;
}

function anyJobEnabled() {
  return (
    !SKIP_PRODUCT_WISE ||
    !SKIP_KEYWORD_REPORT ||
    !SKIP_DATE_WISE ||
    !SKIP_METRICS ||
    !SKIP_UNITS_SOLD
  );
}

async function runService(name, fn, stats, keyPrefix) {
  const okKey = `${keyPrefix}Succeeded`;
  const failKey = `${keyPrefix}Failed`;
  try {
    await fn();
    stats[okKey] += 1;
    console.log(`    OK ${name}`);
  } catch (e) {
    stats[failKey] += 1;
    console.error(`    FAIL ${name}: ${e.message}`);
  }
  if (SERVICE_DELAY_MS > 0) await sleep(SERVICE_DELAY_MS);
}

async function processMarketplace(userId, email, { region, country, adsRefreshToken, profileId }, stats) {
  const label = `${email} (${userId}) ${region}/${country}`;
  const uid = userId.toString();

  if (isDryRun) {
    const jobs = [];
    if (!SKIP_PRODUCT_WISE) jobs.push('product-wise');
    if (!SKIP_KEYWORD_REPORT) jobs.push('keyword-report');
    if (!SKIP_DATE_WISE) jobs.push('date-wise-spend');
    if (!SKIP_METRICS) jobs.push('ppc-metrics');
    if (!SKIP_UNITS_SOLD) jobs.push('ppc-units-sold');
    console.log(`[dry-run] would run Ads backfill (${jobs.join(', ')}): ${label}`);
    stats.dryRunJobs += 1;
    return;
  }

  if (!process.env.AMAZON_ADS_CLIENT_ID || !process.env.AMAZON_ADS_CLIENT_SECRET) {
    console.error(`  FAIL ${label}: AMAZON_ADS_CLIENT_ID / AMAZON_ADS_CLIENT_SECRET not set`);
    stats.adsTokenFailed += 1;
    return;
  }

  let adsAccessToken;
  try {
    adsAccessToken = await generateAdsAccessToken(adsRefreshToken);
  } catch (e) {
    stats.adsTokenFailed += 1;
    console.error(`  FAIL ${label} (Ads access token): ${e.message}`);
    return;
  }

  if (!SKIP_PRODUCT_WISE) {
    await runService(
      'getPPCSpendsBySKU',
      async () => {
        const r = await getPPCSpendsBySKU(adsAccessToken, profileId, uid, country, region, adsRefreshToken);
        if (!r?.success) throw new Error(r?.message || r?.error || 'getPPCSpendsBySKU failed');
      },
      stats,
      'productWise'
    );
  }

  if (!SKIP_KEYWORD_REPORT) {
    await runService(
      'getKeywordPerformanceReport',
      async () => {
        const r = await getKeywordPerformanceReport(adsAccessToken, profileId, uid, country, region, adsRefreshToken);
        if (!r?.success) throw new Error(r?.error || 'getKeywordPerformanceReport failed');
      },
      stats,
      'keywordReport'
    );
  }

  if (!SKIP_DATE_WISE) {
    await runService(
      'getPPCSpendsDateWise',
      async () => {
        const r = await getPPCSpendsDateWise(adsAccessToken, profileId, uid, country, region, adsRefreshToken);
        if (!r?.success) throw new Error(r?.message || r?.error || 'getPPCSpendsDateWise failed');
      },
      stats,
      'dateWise'
    );
  }

  if (!SKIP_METRICS) {
    await runService(
      'getPPCMetrics',
      async () => {
        const r = await getPPCMetrics(
          adsAccessToken,
          profileId,
          uid,
          country,
          region,
          adsRefreshToken,
          null,
          null,
          true
        );
        if (!r?.success) throw new Error(r?.message || 'getPPCMetrics failed');
      },
      stats,
      'metrics'
    );
  }

  if (!SKIP_UNITS_SOLD) {
    await runService(
      'getPPCUnitsSold',
      async () => {
        const r = await getPPCUnitsSold(
          adsAccessToken,
          profileId,
          uid,
          country,
          region,
          adsRefreshToken,
          null,
          null,
          true
        );
        if (!r?.success) throw new Error(r?.message || 'getPPCUnitsSold failed');
      },
      stats,
      'unitsSold'
    );
  }

  stats.marketplacesCompleted += 1;
  if (DELAY_MS > 0) await sleep(DELAY_MS);
}

async function main() {
  if (!MONGODB_URI) {
    console.error('ERROR: Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
    process.exit(1);
  }

  if (!anyJobEnabled()) {
    console.error('ERROR: All jobs skipped; remove some --skip-* flags.');
    process.exit(1);
  }

  console.log('Mode:', isDryRun ? 'DRY-RUN' : 'LIVE');
  console.log('Default Ads report window per service: UTC (yesterday − 30) → yesterday (same as integration).');
  if (SKIP_PRODUCT_WISE) console.log('Skipping: product-wise (getPPCSpendsBySKU)');
  if (SKIP_KEYWORD_REPORT) console.log('Skipping: keyword performance report');
  if (SKIP_DATE_WISE) console.log('Skipping: date-wise PPC spend');
  if (SKIP_METRICS) console.log('Skipping: PPC metrics');
  if (SKIP_UNITS_SOLD) console.log('Skipping: PPC units sold');
  if (LIMIT) console.log('User limit:', LIMIT);
  if (SINGLE_USER_ID) console.log('Single user:', SINGLE_USER_ID);
  console.log('Delay between services (ms):', SERVICE_DELAY_MS);
  console.log('Delay between marketplaces (ms):', DELAY_MS);
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
    usersSkippedNoAdsMarketplaces: 0,
    dryRunJobs: 0,
    adsTokenFailed: 0,
    marketplacesCompleted: 0,
    productWiseSucceeded: 0,
    productWiseFailed: 0,
    keywordReportSucceeded: 0,
    keywordReportFailed: 0,
    dateWiseSucceeded: 0,
    dateWiseFailed: 0,
    metricsSucceeded: 0,
    metricsFailed: 0,
    unitsSoldSucceeded: 0,
    unitsSoldFailed: 0,
  };

  for (const u of users) {
    const userId = u._id;
    const seller = await Seller.findOne({ User: userId }).lean();
    if (!seller) {
      stats.usersSkippedNoSeller += 1;
      console.log(`Skip (no Seller): ${u.email} (${userId})`);
      continue;
    }

    const marketplaces = collectAdsMarketplaces(seller);
    if (marketplaces.length === 0) {
      stats.usersSkippedNoAdsMarketplaces += 1;
      console.log(`Skip (no Ads marketplace: need country+region+adsRefreshToken+ProfileId): ${u.email} (${userId})`);
      continue;
    }

    stats.usersProcessed += 1;
    console.log(`User ${u.email} (${userId}) — ${marketplaces.length} Ads marketplace(s)`);

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

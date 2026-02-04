/**
 * runAlertsWorkerForUser.js
 *
 * Runs the alerts worker flow for a single user (all alert services + single summary email).
 * Use this to test the new alerts worker for a specific userId without running the full cron.
 *
 * Usage:
 *   node server/scripts/runAlertsWorkerForUser.js <userId>
 *   node server/scripts/runAlertsWorkerForUser.js <userId> <country> <region>
 *
 * Or with env:
 *   ALERTS_TEST_USER_ID=<userId> node server/scripts/runAlertsWorkerForUser.js
 *   ALERTS_TEST_USER_ID=<userId> ALERTS_TEST_COUNTRY=US ALERTS_TEST_REGION=NA node server/scripts/runAlertsWorkerForUser.js
 *
 * Examples:
 *   node server/scripts/runAlertsWorkerForUser.js 507f1f77bcf86cd799439011
 *   node server/scripts/runAlertsWorkerForUser.js 507f1f77bcf86cd799439011 US NA
 */

require('dotenv').config();

const mongoose = require('mongoose');
const dbConnect = require('../config/dbConn.js');
const logger = require('../utils/Logger.js');
const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const { processAccountAlerts } = require('../Services/BackgroundJobs/alertsWorker.js');

function normalizeId(id) {
  if (!id) return id;
  if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  return id;
}

async function runForUser(userIdInput, countryFilter, regionFilter) {
  const userId = normalizeId(userIdInput);
  if (!userId) {
    logger.error('[runAlertsWorkerForUser] Invalid userId');
    process.exit(1);
  }

  await dbConnect();

  const user = await User.findById(userId).select('_id email firstName isVerified subscribedToAlerts').lean();
  if (!user) {
    logger.error('[runAlertsWorkerForUser] User not found', { userId: String(userId) });
    process.exit(1);
  }

  const seller = await Seller.findOne({ User: userId }).select('User sellerAccount').lean();
  if (!seller?.sellerAccount?.length) {
    logger.error('[runAlertsWorkerForUser] No seller account found for user', { userId: String(userId) });
    process.exit(1);
  }

  const accounts = seller.sellerAccount.filter(
    (acc) => acc?.country && acc?.region
  );
  if (accounts.length === 0) {
    logger.error('[runAlertsWorkerForUser] No valid account (country/region) for user', { userId: String(userId) });
    process.exit(1);
  }

  let toProcess = accounts;
  if (countryFilter && regionFilter) {
    toProcess = accounts.filter(
      (acc) => acc.country === countryFilter && acc.region === regionFilter
    );
    if (toProcess.length === 0) {
      logger.error('[runAlertsWorkerForUser] No account matching country/region', {
        userId: String(userId),
        country: countryFilter,
        region: regionFilter,
      });
      process.exit(1);
    }
  }

  logger.info('[runAlertsWorkerForUser] Starting alerts run for user', {
    userId: String(userId),
    email: user.email,
    accountCount: toProcess.length,
    countryRegion: countryFilter && regionFilter ? `${countryFilter}-${regionFilter}` : 'all',
  });

  const results = [];
  for (const account of toProcess) {
    const result = await processAccountAlerts({
      user: { _id: user._id, email: user.email, firstName: user.firstName },
      userId,
      email: user.email,
      firstName: user.firstName || 'Seller',
      account,
    });
    results.push({ country: account.country, region: account.region, ...result });
  }

  logger.info('[runAlertsWorkerForUser] Completed', {
    userId: String(userId),
    results: results.map((r) => ({
      country: r.country,
      region: r.region,
      success: r.success,
      skipped: r.skipped,
      productContent: r.results?.productContent?.counts,
      buyBox: r.results?.buyBoxMissing?.count,
      inventory: r.results?.inventory?.counts,
      salesDrop: r.results?.salesDrop?.count,
      conversionRates: r.results?.conversionRates?.count,
    })),
  });

  return results;
}

async function main() {
  const userIdFromArg = process.argv[2];
  const countryFromArg = process.argv[3];
  const regionFromArg = process.argv[4];
  const userId = userIdFromArg || process.env.ALERTS_TEST_USER_ID;
  const country = countryFromArg || process.env.ALERTS_TEST_COUNTRY;
  const region = regionFromArg || process.env.ALERTS_TEST_REGION;

  if (!userId) {
    console.error('Usage: node server/scripts/runAlertsWorkerForUser.js <userId> [country] [region]');
    console.error('   Or:  ALERTS_TEST_USER_ID=<userId> node server/scripts/runAlertsWorkerForUser.js');
    process.exit(1);
  }

  try {
    await runForUser(userId, country || null, region || null);
    process.exit(0);
  } catch (err) {
    logger.error('[runAlertsWorkerForUser] Failed', { error: err?.message, stack: err?.stack });
    process.exit(1);
  }
}

main();

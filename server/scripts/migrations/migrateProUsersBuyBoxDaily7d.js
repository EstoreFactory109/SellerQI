/**
 * Migration: Backfill DAILY BuyBox data (last 7 days) for PRO users
 *
 * Why:
 * - We changed MCP BuyBox fetch to run daily for a single day (yesterday).
 * - Existing BuyBoxData documents may contain 30-day ranges. For consistency and easier querying,
 *   we want one BuyBoxData document per day (dateRange.startDate === dateRange.endDate).
 *
 * What it does per (userId, country, region):
 * 1) Fetch BuyBox for each day in the last 7 days (yesterday back 6 more), one by one:
 *    fetchAndStoreBuyBoxData(userId, spiRefreshToken, region, country, day, day)
 * 2) After successful backfill, delete ALL previous BuyBoxData docs for that user+country+region
 *    EXCEPT the newly backfilled 7 daily docs (safety).
 *
 * Scope:
 * - PRO / PRO Trial users only (same selection logic as other PRO migrations).
 *
 * Usage:
 *   node server/scripts/migrations/migrateProUsersBuyBoxDaily7d.js
 *
 * Options (env):
 *   DRY_RUN=1           Skip writes/deletes (still runs fetches, but does NOT save?).
 *                      NOTE: fetchAndStoreBuyBoxData writes by design; DRY_RUN disables the delete step
 *                      and logs intended actions. (Keeping fetch enabled to validate tokens/data.)
 *   COUNT_ONLY=1        Only compute how many users/accounts would be processed. No fetches, no deletes.
 *   PAID_ONLY=1         Only paid PRO (exclude trials). Default: 1.
 *   LIMIT=50            Max number of users to process
 *   USER_ID=xxx         Process only this user ID (overrides LIMIT)
 *   DAYS=7              Number of days to backfill (default 7)
 *
 * Requires:
 * - MongoDB env vars (DB_URI + DB_NAME or MONGODB_URI / MONGO_URI)
 * - A valid `.env` at repo root (same as other scripts)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const mongoose = require('mongoose');
const dbConnect = require('../../config/dbConn.js');

const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');

const { fetchAndStoreBuyBoxData } = require('../../Services/MCP/MCPBuyBoxIntegration.js');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const COUNT_ONLY = process.env.COUNT_ONLY === '1' || process.env.COUNT_ONLY === 'true';
const PAID_ONLY = process.env.PAID_ONLY === undefined ? true : (process.env.PAID_ONLY === '1' || process.env.PAID_ONLY === 'true');
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null;
const SINGLE_USER_ID = process.env.USER_ID || null;
const DAYS = process.env.DAYS ? Math.max(1, parseInt(process.env.DAYS, 10)) : 7;

function log(msg, data = {}) {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : '';
  console.log(`${prefix}[migrateProUsersBuyBoxDaily7d] ${msg}`, Object.keys(data).length ? data : '');
}

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

function getLastNDatesEndingYesterday(n) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const dates = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(yesterday);
    day.setDate(yesterday.getDate() - i);
    dates.push(isoDate(day));
  }
  return dates; // [yesterday, yesterday-1, ...]
}

/**
 * Same PRO selection strategy used in migrateProUsersIssuesData.js
 */
async function getProUserIds() {
  if (SINGLE_USER_ID) {
    log('Single user mode (bypasses PRO filter — works for any plan: Lite, Pro, etc.)', { userId: SINGLE_USER_ID });
    return [new mongoose.Types.ObjectId(SINGLE_USER_ID)];
  }

  const subsStatusFilter = PAID_ONLY ? ['active'] : ['active', 'trialing'];
  const fromSubs = await Subscription.find({
    planType: 'PRO',
    status: { $in: subsStatusFilter },
  })
    .select('userId')
    .lean();
  const idsFromSubs = new Set(fromSubs.map((s) => s.userId?.toString()).filter(Boolean));

  // IMPORTANT:
  // For paid-only mode, use SubscriptionModel as the source of truth.
  // This avoids over-counting users whose User.packageType/subscriptionStatus are out of sync.
  let userIds = [...idsFromSubs].map((id) => new mongoose.Types.ObjectId(id));

  if (LIMIT) userIds = userIds.slice(0, LIMIT);

  log(PAID_ONLY ? 'Paid PRO user IDs (Subscription only)' : 'Pro/Pro Trial user IDs (Subscription only)', {
    count: userIds.length,
    fromSubscription: idsFromSubs.size,
    paidOnly: PAID_ONLY,
    subscriptionStatuses: subsStatusFilter,
  });

  return userIds;
}

async function getSellerAccounts(userId) {
  const seller = await Seller.findOne({ User: userId })
    .select('sellerAccount.country sellerAccount.region sellerAccount.spiRefreshToken')
    .lean();

  const accounts = Array.isArray(seller?.sellerAccount) ? seller.sellerAccount : [];
  return accounts
    .filter((acc) => acc?.country && acc?.region)
    .map((acc) => ({
      country: acc.country,
      region: acc.region,
      spiRefreshToken: acc.spiRefreshToken || null,
    }));
}

async function backfillForAccount({ userId, country, region, spiRefreshToken, dates }) {
  if (!spiRefreshToken) {
    log('Skip account (no spiRefreshToken)', { userId: userId.toString(), country, region });
    return { success: false, skipped: true, reason: 'no_spi_refresh_token' };
  }

  log('Backfilling BuyBox daily docs', { userId: userId.toString(), country, region, days: dates.length });

  const createdIds = [];
  for (const day of dates) {
    try {
      const result = await fetchAndStoreBuyBoxData(userId, spiRefreshToken, region, country, day, day);
      if (!result?.success) {
        log('BuyBox fetch failed for day', { userId: userId.toString(), country, region, day, error: result?.error });
        return { success: false, error: result?.error || 'fetch_failed', createdIds };
      }
      const savedId = result?.data?.buyBoxDataId || result?.data?._id;
      if (savedId) {
        createdIds.push(savedId);
      }
      log('BuyBox fetched', {
        userId: userId.toString(),
        country,
        region,
        day,
        dateRange: result?.data?.dateRange,
        savedId: savedId?.toString(),
      });
    } catch (err) {
      log('BuyBox fetch threw for day', { userId: userId.toString(), country, region, day, error: err?.message });
      return { success: false, error: err?.message || 'fetch_threw', createdIds };
    }
  }

  // Delete previous BuyBox docs for this marketplace, but keep the newly created ones.
  if (DRY_RUN) {
    log('DRY_RUN: would delete older BuyBoxData docs (excluding new ids)', {
      userId: userId.toString(),
      country,
      region,
      keepIds: createdIds.map((x) => x.toString()),
    });
    return { success: true, createdIds, deletedCount: 0 };
  }

  if (!createdIds.length) {
    log('SAFETY: No saved IDs tracked — skipping delete to prevent data loss', {
      userId: userId.toString(), country, region,
    });
    return { success: false, error: 'no_saved_ids_tracked', createdIds };
  }

  const deleteFilter = {
    User: userId,
    country,
    region,
    _id: { $nin: createdIds },
  };
  const delRes = await BuyBoxData.deleteMany(deleteFilter);
  log('Deleted previous BuyBoxData docs', {
    userId: userId.toString(),
    country,
    region,
    deleted: delRes.deletedCount ?? delRes.n ?? undefined,
  });

  return { success: true, createdIds, deletedCount: delRes.deletedCount ?? 0 };
}

async function main() {
  const startedAt = Date.now();
  try {
    await dbConnect();

    const userIds = await getProUserIds();
    const dates = getLastNDatesEndingYesterday(DAYS);

    log('Backfill dates', { dates });

    let processedAccounts = 0;
    let successAccounts = 0;
    let failedAccounts = 0;
    let skippedAccounts = 0;
    let usersWithAnyAccount = 0;
    let totalAccountsFound = 0;
    let accountsWithToken = 0;

    for (const uid of userIds) {
      const accounts = await getSellerAccounts(uid);
      if (!accounts.length) {
        log('No seller accounts for user', { userId: uid.toString() });
        continue;
      }
      usersWithAnyAccount++;
      totalAccountsFound += accounts.length;
      accountsWithToken += accounts.filter(a => !!a.spiRefreshToken).length;

      if (COUNT_ONLY) {
        // Don't fetch/delete anything in count mode
        continue;
      }

      for (const acc of accounts) {
        processedAccounts++;
        const res = await backfillForAccount({
          userId: uid,
          country: acc.country,
          region: acc.region,
          spiRefreshToken: acc.spiRefreshToken,
          dates,
        });

        if (res.skipped) skippedAccounts++;
        else if (res.success) successAccounts++;
        else failedAccounts++;
      }
    }

    if (COUNT_ONLY) {
      log('COUNT_ONLY summary', {
        users: userIds.length,
        usersWithAnyAccount,
        totalAccountsFound,
        accountsWithToken,
        accountsMissingToken: totalAccountsFound - accountsWithToken,
        daysPerAccount: dates.length,
        totalDayFetchesIfRun: accountsWithToken * dates.length,
        durationMs: Date.now() - startedAt,
      });
      await mongoose.connection.close();
      process.exit(0);
    }

    log('Completed', {
      users: userIds.length,
      processedAccounts,
      successAccounts,
      failedAccounts,
      skippedAccounts,
      durationMs: Date.now() - startedAt,
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('[migrateProUsersBuyBoxDaily7d] Failed', err?.message || err);
    try {
      await mongoose.connection.close();
    } catch (_) {}
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}


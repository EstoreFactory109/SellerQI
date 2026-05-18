#!/usr/bin/env node
/**
 * Remove finance-dashboard data written by backfillFinanceDashboardProUsers.js
 *
 * Deletes documents in the same date window the migration uses:
 *   startDate = DataFetchTracking.dataRange.endDate - (days - 1)
 *   endDate   = DataFetchTracking.dataRange.endDate
 *
 * Collections (date-scoped):
 *   - DailySkuFinance
 *   - DailyOverheadFinance
 *   - FinanceSyncLog
 *   - PendingExpenseOrder (purchasePacificDate in range)
 *
 * AsinRelationship is NOT deleted by default (no per-day field; shared catalog data).
 * Pass --clear-relationships to remove all relationships for each marketplace.
 *
 * Eligibility: same as backfill — PRO / PRO-trial with linked Seller marketplaces.
 *
 * Usage:
 *   node server/scripts/deleteFinanceDashboardMigrationDataProUsers.js --dry-run
 *   node server/scripts/deleteFinanceDashboardMigrationDataProUsers.js --confirm
 *   node server/scripts/deleteFinanceDashboardMigrationDataProUsers.js --confirm --user-id=<id>
 *   node server/scripts/deleteFinanceDashboardMigrationDataProUsers.js --confirm --days=60
 *   node server/scripts/deleteFinanceDashboardMigrationDataProUsers.js --confirm --start-date=2026-03-19 --end-date=2026-05-17
 *
 * Options (aligned with backfillFinanceDashboardProUsers.js):
 *   --skip-if-synced    Skip marketplaces whose full backfill range is in FinanceSyncLog
 *                       (default ON for bulk runs — protects successfully migrated users)
 *   --no-skip-synced    Delete even when the range is fully synced
 *   --exclude-user-id=<id>  Never delete for these user(s); comma-separated or repeat flag
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

const argv = process.argv.slice(2);
function getArg(name) {
  const match = argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1].trim() : null;
}
const isDryRun = argv.includes('--dry-run');
const isConfirm = argv.includes('--confirm');
const clearRelationships = argv.includes('--clear-relationships');
const SINGLE_USER_ID = getArg('user-id') || null;
// Bulk runs: do not delete fully-synced marketplaces unless --no-skip-synced
const skipIfSynced =
  !argv.includes('--no-skip-synced') &&
  (argv.includes('--skip-if-synced') || !SINGLE_USER_ID);
const LIMIT = getArg('limit') ? parseInt(getArg('limit'), 10) : null;
const BACKFILL_DAYS = getArg('days') ? parseInt(getArg('days'), 10) : 60;
const OVERRIDE_START = getArg('start-date') || null;
const OVERRIDE_END = getArg('end-date') || null;

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

const User = require('../models/user-auth/userModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const DataFetchTracking = require('../models/system/DataFetchTrackingModel.js');
const DailySkuFinance = require('../models/finance/DailySkuFinanceModel.js');
const DailyOverheadFinance = require('../models/finance/DailyOverheadFinanceModel.js');
const FinanceSyncLog = require('../models/finance/FinanceSyncLogModel.js');
const PendingExpenseOrder = require('../models/finance/PendingExpenseOrderModel.js');
const AsinRelationship = require('../models/finance/AsinRelationshipModel.js');
const { REGION_VALID_MARKETPLACES } = require('../Services/MCP/constants.js');

function subtractDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().substring(0, 10);
}

function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return raw.trim().toUpperCase() || null;
}

function collectMarketplaces(seller) {
  const accounts = Array.isArray(seller?.sellerAccount) ? seller.sellerAccount : [];
  const seen = new Set();
  const out = [];

  for (const acc of accounts) {
    const region = acc?.region;
    const country = normalizeCountry(acc?.country || acc?.countryCode);
    if (!region || !country) continue;

    const valid = REGION_VALID_MARKETPLACES[region] || [];
    if (!valid.includes(country)) continue;

    const key = `${region}:${country}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ region, country });
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

function resolveDateRange(trackingEndDate) {
  if (OVERRIDE_START && OVERRIDE_END) {
    return { startDate: OVERRIDE_START, endDate: OVERRIDE_END };
  }
  if (!trackingEndDate) return null;
  return {
    startDate: subtractDays(trackingEndDate, BACKFILL_DAYS - 1),
    endDate: trackingEndDate,
  };
}

function countDaysInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/** Used to protect successful migrations from bulk delete (must have sales/units, not expenses-only). */
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

  const salesRows = await DailySkuFinance.countDocuments({
    User: userObjectId,
    country: normalizeCountry(country),
    region,
    date: { $gte: startDate, $lte: endDate },
    $or: [{ productSales: { $gt: 0.01 } }, { units: { $gt: 0 } }],
  });
  return salesRows > 0;
}

function buildBaseFilter(userId, country, region) {
  return {
    User: typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId,
    country: normalizeCountry(country),
    region,
  };
}

function buildDateRangeFilter(baseFilter, startDate, endDate) {
  return {
    ...baseFilter,
    date: { $gte: startDate, $lte: endDate },
  };
}

async function countForMarketplace(userId, mp, startDate, endDate) {
  const base = buildBaseFilter(userId, mp.country, mp.region);
  const dateFilter = buildDateRangeFilter(base, startDate, endDate);
  const pendingFilter = {
    ...base,
    purchasePacificDate: { $gte: startDate, $lte: endDate },
  };

  const counts = {
    dailySkuFinance: await DailySkuFinance.countDocuments(dateFilter),
    dailyOverheadFinance: await DailyOverheadFinance.countDocuments(dateFilter),
    financeSyncLog: await FinanceSyncLog.countDocuments(dateFilter),
    pendingExpenseOrder: await PendingExpenseOrder.countDocuments(pendingFilter),
    asinRelationship: 0,
  };

  if (clearRelationships) {
    counts.asinRelationship = await AsinRelationship.countDocuments(base);
  }

  counts.total =
    counts.dailySkuFinance +
    counts.dailyOverheadFinance +
    counts.financeSyncLog +
    counts.pendingExpenseOrder +
    counts.asinRelationship;

  return counts;
}

async function deleteForMarketplace(userId, mp, startDate, endDate) {
  const base = buildBaseFilter(userId, mp.country, mp.region);
  const dateFilter = buildDateRangeFilter(base, startDate, endDate);
  const pendingFilter = {
    ...base,
    purchasePacificDate: { $gte: startDate, $lte: endDate },
  };

  const [sku, overhead, syncLog, pending] = await Promise.all([
    DailySkuFinance.deleteMany(dateFilter),
    DailyOverheadFinance.deleteMany(dateFilter),
    FinanceSyncLog.deleteMany(dateFilter),
    PendingExpenseOrder.deleteMany(pendingFilter),
  ]);

  const deleted = {
    dailySkuFinance: sku.deletedCount || 0,
    dailyOverheadFinance: overhead.deletedCount || 0,
    financeSyncLog: syncLog.deletedCount || 0,
    pendingExpenseOrder: pending.deletedCount || 0,
    asinRelationship: 0,
  };

  if (clearRelationships) {
    const rel = await AsinRelationship.deleteMany(base);
    deleted.asinRelationship = rel.deletedCount || 0;
  }

  deleted.total =
    deleted.dailySkuFinance +
    deleted.dailyOverheadFinance +
    deleted.financeSyncLog +
    deleted.pendingExpenseOrder +
    deleted.asinRelationship;

  return deleted;
}

async function processMarketplace(userId, email, mp, stats) {
  const label = `${email} (${userId}) ${mp.region}/${mp.country}`;

  const trackingEnd = await getEndDateFromTracking(userId, mp.country, mp.region);
  const range = resolveDateRange(trackingEnd);

  if (!range) {
    console.log(`  SKIP (no date range): ${label}`);
    stats.skippedNoRange += 1;
    return;
  }

  const { startDate, endDate } = range;

  if (skipIfSynced) {
    try {
      const fullySynced = await isBackfillRangeFullySynced(
        userId,
        mp.country,
        mp.region,
        startDate,
        endDate
      );
      if (fullySynced) {
        console.log(
          `  SKIP (range fully synced — protected): ${label} ${startDate} → ${endDate}`
        );
        stats.skippedFullySynced += 1;
        return;
      }
    } catch {
      // If check fails, proceed with delete logic
    }
  }

  const counts = await countForMarketplace(userId, mp, startDate, endDate);

  if (counts.total === 0) {
    console.log(`  SKIP (nothing in range): ${label} ${startDate} → ${endDate}`);
    stats.skippedEmpty += 1;
    return;
  }

  if (isDryRun) {
    console.log(
      `  [dry-run] ${label} ${startDate} → ${endDate} | ` +
        `sku=${counts.dailySkuFinance} overhead=${counts.dailyOverheadFinance} ` +
        `syncLog=${counts.financeSyncLog} pending=${counts.pendingExpenseOrder}` +
        (clearRelationships ? ` relationships=${counts.asinRelationship}` : '')
    );
    stats.dryRunJobs += 1;
    stats.dryRunDocs += counts.total;
    return;
  }

  const deleted = await deleteForMarketplace(userId, mp, startDate, endDate);
  console.log(
    `  DELETED ${label} ${startDate} → ${endDate} | ` +
      `sku=${deleted.dailySkuFinance} overhead=${deleted.dailyOverheadFinance} ` +
      `syncLog=${deleted.financeSyncLog} pending=${deleted.pendingExpenseOrder}` +
      (clearRelationships ? ` relationships=${deleted.asinRelationship}` : '')
  );
  stats.marketplacesDeleted += 1;
  stats.totalDeleted += deleted.total;
}

async function main() {
  if (!MONGODB_URI) {
    console.error('ERROR: Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
    process.exit(1);
  }

  if (!isDryRun && !isConfirm) {
    console.error('Safety: pass --dry-run to preview or --confirm to delete.');
    process.exit(1);
  }

  if ((OVERRIDE_START && !OVERRIDE_END) || (!OVERRIDE_START && OVERRIDE_END)) {
    console.error('Error: --start-date and --end-date must be used together.');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(' Delete finance migration data — PRO & PRO-trial');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Mode:     ${isDryRun ? 'DRY-RUN' : 'CONFIRM DELETE'}`);
  if (OVERRIDE_START && OVERRIDE_END) {
    console.log(`Range:    fixed ${OVERRIDE_START} → ${OVERRIDE_END}`);
  } else {
    console.log(`Range:    ${BACKFILL_DAYS} days ending at DataFetchTracking.dataRange.endDate`);
  }
  if (clearRelationships) console.log('Also delete: AsinRelationship (all for marketplace)');
  if (skipIfSynced) {
    console.log('Skip-if-synced: ON (will not delete fully-synced migration ranges)');
  }
  if (argv.includes('--no-skip-synced')) console.log('Skip-if-synced: OFF (--no-skip-synced)');
  if (EXCLUDE_USER_IDS.size > 0) {
    console.log(`Excluded users: ${[...EXCLUDE_USER_IDS].join(', ')}`);
  }
  if (LIMIT) console.log(`Limit:    ${LIMIT} users`);
  if (SINGLE_USER_ID) console.log(`User:     ${SINGLE_USER_ID}`);
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
    .select('_id email')
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
    skippedNoRange: 0,
    skippedEmpty: 0,
    dryRunJobs: 0,
    dryRunDocs: 0,
    marketplacesDeleted: 0,
    totalDeleted: 0,
    usersSkippedExcluded: 0,
    skippedFullySynced: 0,
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
      console.log(`Skip (no marketplace): ${u.email} (${userId})`);
      continue;
    }

    stats.usersProcessed += 1;
    console.log(`\nUser ${u.email} (${userId}) — ${marketplaces.length} marketplace(s)`);

    for (const mp of marketplaces) {
      await processMarketplace(userId, u.email, mp, stats);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(' Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(JSON.stringify(stats, null, 2));

  await mongoose.connection.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  mongoose.connection.close().finally(() => process.exit(1));
});

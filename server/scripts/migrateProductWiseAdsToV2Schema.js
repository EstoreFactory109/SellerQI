#!/usr/bin/env node
/**
 * Migration Script: ProductWiseSponsoredAdsItem — old field layout → v2 unified schema
 *
 * Converts documents that still carry legacy fields (salesIn7Days, salesIn14Days,
 * salesIn30Days, purchasedIn7Days, …) to the current v2 layout:
 *   - sales         ← salesIn7Days (SP default) or salesIn14Days (SD default)
 *   - purchases     ← purchasedIn7Days or purchasedIn14Days
 *   - unitsSoldClicks  (set to 0 if missing)
 *   - adType        ← 'SP' (legacy data was exclusively Sponsored Products)
 *   - sku, adGroupName (set to '' if missing)
 *
 * After setting the new fields the script $unset-s the legacy fields so the
 * documents match the current schema exactly.
 *
 * SCOPE: Only PRO and PRO-trial users (packageType = "PRO" AND
 *        (subscriptionStatus = "active" OR isInTrialPeriod = true)).
 *
 * Usage:
 *   node server/scripts/migrateProductWiseAdsToV2Schema.js [options]
 *
 * Options:
 *   --dry-run        Preview counts without writing anything
 *   --batch-size=N   Bulk-write batch size (default 1000)
 *   --limit=N        Cap the number of users to process (for testing)
 *   --user=<id>      Migrate a single user by ObjectId
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGODB_URI) {
  console.error('ERROR: DB_URI / DB_NAME (or MONGODB_URI) env vars are required');
  process.exit(1);
}

// ── CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun     = args.includes('--dry-run');
const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
const limitArg     = args.find(a => a.startsWith('--limit='));
const userArg      = args.find(a => a.startsWith('--user='));
const BATCH_SIZE   = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 1000;
const USER_LIMIT   = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const SINGLE_USER  = userArg ? userArg.split('=')[1] : null;

// ── Models (imported after connection) ───────────────────────────────────
let User;
let ProductWiseSponsoredAdsItem;

async function connect() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');
  User = require('../models/user-auth/userModel.js');
  ProductWiseSponsoredAdsItem = require('../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
}

// ── Resolve eligible user IDs ────────────────────────────────────────────
async function getEligibleUserIds() {
  if (SINGLE_USER) {
    return [new mongoose.Types.ObjectId(SINGLE_USER)];
  }

  const query = {
    packageType: 'PRO',
    $or: [
      { subscriptionStatus: 'active' },
      { subscriptionStatus: 'trialing' },
      { isInTrialPeriod: true },
    ],
  };

  const projection = { _id: 1 };
  let q = User.find(query, projection).lean();
  if (USER_LIMIT) q = q.limit(USER_LIMIT);
  const users = await q;
  return users.map(u => u._id);
}

// ── Detect legacy documents ──────────────────────────────────────────────
// A document is "legacy" if it has any of the old salesIn* / purchasedIn*
// fields OR is missing the required `adType` field.
function legacyFilter(userIds) {
  return {
    userId: { $in: userIds },
    $or: [
      { adType: { $exists: false } },
      { salesIn7Days: { $exists: true } },
      { salesIn14Days: { $exists: true } },
      { salesIn30Days: { $exists: true } },
      { purchasedIn7Days: { $exists: true } },
      { purchasedIn14Days: { $exists: true } },
      { purchasedIn30Days: { $exists: true } },
    ],
  };
}

const LEGACY_FIELDS_TO_UNSET = [
  'salesIn7Days',
  'salesIn14Days',
  'salesIn30Days',
  'purchasedIn7Days',
  'purchasedIn14Days',
  'purchasedIn30Days',
];

// ── Migrate one batch of documents ───────────────────────────────────────
async function migrateBatch(docs) {
  const ops = docs.map(doc => {
    // Determine the best sales figure: prefer salesIn7Days (SP default),
    // fall back to salesIn14Days (SD default), then salesIn30Days.
    const sales =
      Number(doc.sales) ||
      Number(doc.salesIn7Days) ||
      Number(doc.salesIn14Days) ||
      Number(doc.salesIn30Days) ||
      0;

    const purchases =
      Number(doc.purchases) ||
      Number(doc.purchasedIn7Days) ||
      Number(doc.purchasedIn14Days) ||
      Number(doc.purchasedIn30Days) ||
      0;

    const $set = {
      sales,
      purchases,
      unitsSoldClicks: Number(doc.unitsSoldClicks) || 0,
      adType: doc.adType || 'SP',
      sku: doc.sku ?? '',
      adGroupName: doc.adGroupName ?? '',
    };

    const $unset = {};
    for (const f of LEGACY_FIELDS_TO_UNSET) {
      if (doc[f] !== undefined) $unset[f] = '';
    }

    const update = { $set };
    if (Object.keys($unset).length > 0) update.$unset = $unset;

    return {
      updateOne: {
        filter: { _id: doc._id },
        update,
      },
    };
  });

  const result = await ProductWiseSponsoredAdsItem.bulkWrite(ops, { ordered: false });
  return result.modifiedCount;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function run() {
  console.log('='.repeat(70));
  console.log('Migration: ProductWiseSponsoredAdsItem → v2 unified schema');
  console.log('='.repeat(70));
  console.log(`Mode           : ${isDryRun ? '🔍 DRY RUN' : '🚀 LIVE'}`);
  console.log(`Batch size     : ${BATCH_SIZE}`);
  if (SINGLE_USER) console.log(`Single user    : ${SINGLE_USER}`);
  if (USER_LIMIT) console.log(`User limit     : ${USER_LIMIT}`);
  console.log('');

  await connect();

  // 1. Resolve eligible users
  const userIds = await getEligibleUserIds();
  console.log(`Found ${userIds.length} eligible PRO / PRO-trial user(s)\n`);
  if (userIds.length === 0) {
    console.log('Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  // 2. Count legacy docs
  const filter = legacyFilter(userIds);
  const totalLegacy = await ProductWiseSponsoredAdsItem.countDocuments(filter);
  console.log(`Legacy documents to migrate: ${totalLegacy}`);

  if (totalLegacy === 0) {
    console.log('✅ All documents are already on the v2 schema.');
    await mongoose.disconnect();
    return;
  }

  if (isDryRun) {
    // In dry-run, show a per-user breakdown
    const perUser = await ProductWiseSponsoredAdsItem.aggregate([
      { $match: filter },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    console.log('\nPer-user breakdown:');
    for (const row of perUser) {
      console.log(`  userId=${row._id}  →  ${row.count} docs`);
    }
    console.log('\n👉 Run without --dry-run to perform the actual migration');
    await mongoose.disconnect();
    return;
  }

  // 3. Stream in batches and migrate
  let processed = 0;
  let modified = 0;
  let batchNum = 0;

  while (processed < totalLegacy) {
    const docs = await ProductWiseSponsoredAdsItem
      .find(filter)
      .limit(BATCH_SIZE)
      .lean();

    if (docs.length === 0) break;

    batchNum++;
    const batchModified = await migrateBatch(docs);
    processed += docs.length;
    modified += batchModified;

    const pct = ((processed / totalLegacy) * 100).toFixed(1);
    console.log(`  Batch ${batchNum}: ${docs.length} docs processed, ${batchModified} modified  (${pct}% done)`);

    // Yield to the event loop between batches
    await new Promise(resolve => setImmediate(resolve));
  }

  // 4. Summary
  console.log('\n' + '='.repeat(70));
  console.log('Migration Summary');
  console.log('='.repeat(70));
  console.log(`Users processed       : ${userIds.length}`);
  console.log(`Legacy docs found     : ${totalLegacy}`);
  console.log(`Documents processed   : ${processed}`);
  console.log(`Documents modified    : ${modified}`);
  console.log('='.repeat(70));

  await mongoose.disconnect();
  console.log('\n✅ Disconnected from MongoDB');
}

run()
  .then(() => {
    console.log('\n✅ Migration script completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Migration script failed:', err);
    process.exit(1);
  });

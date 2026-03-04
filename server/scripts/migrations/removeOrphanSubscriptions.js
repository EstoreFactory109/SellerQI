/**
 * Migration: Remove subscription records that have no corresponding user account
 *
 * CRITICAL: This script deletes subscription documents whose userId does not exist
 * in the User collection. Payment data for valid users is never touched.
 *
 * Safety:
 * - DRY RUN by default: only reports what would be removed; no deletes.
 * - Pass --execute to perform deletion. A backup JSON is written before any delete.
 * - Orphan detection uses a single aggregation ($lookup) so only subscriptions
 *   with no matching user are ever considered for removal.
 *
 * Usage:
 *   node server/scripts/migrations/removeOrphanSubscriptions.js              # dry run (default)
 *   node server/scripts/migrations/removeOrphanSubscriptions.js --execute   # run for real (writes backup then deletes)
 *
 * Backup file (when using --execute): server/scripts/migrations/backups/orphan_subscriptions_YYYY-MM-DD_HH-MM-SS.json
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dbConnect = require('../../config/dbConn.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const User = require('../../models/user-auth/userModel.js');

const EXECUTE = process.argv.includes('--execute');

function getOrphanSubscriptions(userCollectionName) {
  const from = userCollectionName || 'users';
  return Subscription.aggregate([
    {
      $lookup: {
        from,
        localField: 'userId',
        foreignField: '_id',
        as: '_user',
      },
    },
    {
      $match: {
        _user: { $size: 0 },
      },
    },
    {
      $project: {
        _user: 0,
      },
    },
  ]);
}

function toSafeBackupDoc(doc) {
  const d = doc && (doc._doc !== undefined ? doc._doc : doc);
  return {
    _id: d._id?.toString(),
    userId: d.userId?.toString(),
    paymentGateway: d.paymentGateway,
    planType: d.planType,
    status: d.status,
    paymentStatus: d.paymentStatus,
    amount: d.amount,
    currency: d.currency,
    stripeCustomerId: d.stripeCustomerId,
    stripeSubscriptionId: d.stripeSubscriptionId,
    razorpaySubscriptionId: d.razorpaySubscriptionId,
    lastPaymentDate: d.lastPaymentDate,
    currentPeriodStart: d.currentPeriodStart,
    currentPeriodEnd: d.currentPeriodEnd,
    paymentHistoryCount: Array.isArray(d.paymentHistory) ? d.paymentHistory.length : 0,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function main() {
  const startedAt = Date.now();

  console.log('[removeOrphanSubscriptions] Starting...');
  console.log('[removeOrphanSubscriptions] Mode:', EXECUTE ? 'EXECUTE (will delete)' : 'DRY RUN (no changes)');
  console.log('');

  try {
    await dbConnect();

    const totalSubscriptions = await Subscription.countDocuments();
    console.log('[removeOrphanSubscriptions] Total subscriptions in DB:', totalSubscriptions);

    const userCollectionName = User.collection?.collectionName || User.collection?.name || 'users';
    const orphans = await getOrphanSubscriptions(userCollectionName);
    const orphanCount = orphans.length;

    console.log('[removeOrphanSubscriptions] Orphan subscriptions (no user account):', orphanCount);
    console.log('');

    if (orphanCount === 0) {
      console.log('[removeOrphanSubscriptions] Nothing to remove. Exiting.');
      await mongoose.connection.close();
      process.exit(0);
      return;
    }

    if (EXECUTE) {
      const backupsDir = path.join(__dirname, 'backups');
      if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = path.join(backupsDir, `orphan_subscriptions_${timestamp}.json`);
      const backupData = orphans.map(toSafeBackupDoc);
      fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf8');
      console.log('[removeOrphanSubscriptions] Backup written to:', backupPath);

      const idsToDelete = orphans.map((o) => o._id);
      const result = await Subscription.deleteMany({ _id: { $in: idsToDelete } });
      const deleted = result.deletedCount ?? result.n ?? 0;
      console.log('[removeOrphanSubscriptions] Deleted:', deleted, 'orphan subscription(s)');
    } else {
      console.log('[removeOrphanSubscriptions] DRY RUN: no records were deleted.');
      console.log('[removeOrphanSubscriptions] To perform removal, run with --execute');
      orphans.slice(0, 10).forEach((o, i) => {
        console.log(`  ${i + 1}. _id=${o._id}, userId=${o.userId}, plan=${o.planType}, status=${o.status}`);
      });
      if (orphanCount > 10) {
        console.log(`  ... and ${orphanCount - 10} more`);
      }
    }

    console.log('');
    console.log('[removeOrphanSubscriptions] Completed in', Date.now() - startedAt, 'ms');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('[removeOrphanSubscriptions] Failed:', err?.message || err);
    try {
      await mongoose.connection.close();
    } catch (_) {}
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { getOrphanSubscriptions, toSafeBackupDoc, EXECUTE };

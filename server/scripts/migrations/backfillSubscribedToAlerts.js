/**
 * Migration: Backfill User.subscribedToAlerts = true
 *
 * Purpose:
 * - Existing users created before `subscribedToAlerts` was added won't have the field.
 * - This script sets `subscribedToAlerts: true` ONLY when the field is missing or null.
 * - It will NOT overwrite users who have explicitly unsubscribed (`false`).
 *
 * Usage:
 *   node server/scripts/migrations/backfillSubscribedToAlerts.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const dbConnect = require('../../config/dbConn.js');
const User = require('../../models/user-auth/userModel.js');

async function main() {
  const startedAt = Date.now();
  try {
    await dbConnect();

    const filter = {
      $or: [{ subscribedToAlerts: { $exists: false } }, { subscribedToAlerts: null }],
    };

    const beforeCount = await User.countDocuments(filter);

    const result = await User.updateMany(filter, {
      $set: { subscribedToAlerts: true },
    });

    const modified =
      typeof result.modifiedCount === 'number'
        ? result.modifiedCount
        : typeof result.nModified === 'number'
          ? result.nModified
          : undefined;

    const afterCount = await User.countDocuments(filter);

    console.log('[backfillSubscribedToAlerts] Completed', {
      matched: result.matchedCount ?? result.n ?? undefined,
      modified,
      remainingMissingOrNull: afterCount,
      initiallyMissingOrNull: beforeCount,
      durationMs: Date.now() - startedAt,
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('[backfillSubscribedToAlerts] Failed', err?.message || err);
    try {
      await mongoose.connection.close();
    } catch (_) {
      // ignore
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}


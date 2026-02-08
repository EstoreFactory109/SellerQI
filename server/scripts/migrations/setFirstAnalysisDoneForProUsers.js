/**
 * Migration: Set FirstAnalysisDone = true for all PRO and PRO trial users
 *
 * Purpose:
 * - PRO and PRO trial users should have dashboard access (analysis considered done).
 * - This script sets FirstAnalysisDone to true for every user with packageType "PRO"
 *   (includes both paid PRO and PRO trial, since trial users have packageType PRO).
 *
 * Usage:
 *   node server/scripts/migrations/setFirstAnalysisDoneForProUsers.js
 *
 * Run from project root. Requires .env with MongoDB connection (DB_URI / DB_NAME or equivalent).
 */

require('dotenv').config();

const mongoose = require('mongoose');
const dbConnect = require('../../config/dbConn.js');
const User = require('../../models/user-auth/userModel.js');

async function main() {
  const startedAt = Date.now();
  try {
    await dbConnect();

    // PRO and PRO trial: both have packageType "PRO"
    const filter = { packageType: 'PRO' };

    const totalProUsers = await User.countDocuments(filter);
    const alreadyDone = await User.countDocuments({
      ...filter,
      FirstAnalysisDone: true,
    });

    const result = await User.updateMany(filter, {
      $set: { FirstAnalysisDone: true },
    });

    const modified =
      typeof result.modifiedCount === 'number'
        ? result.modifiedCount
        : typeof result.nModified === 'number'
          ? result.nModified
          : undefined;

    console.log('[setFirstAnalysisDoneForProUsers] Completed', {
      totalProUsers,
      alreadyDoneBefore: alreadyDone,
      matched: result.matchedCount ?? result.n ?? undefined,
      modified,
      durationMs: Date.now() - startedAt,
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('[setFirstAnalysisDoneForProUsers] Failed', err?.message || err);
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

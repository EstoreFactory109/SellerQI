#!/usr/bin/env node
/**
 * cleanupStaleJobStatus.js
 *
 * One-shot cleanup for orphaned JobStatus rows.
 *
 * The worker writes `status: 'running'` when it picks a phase up and flips
 * to `completed`/`failed` when the phase finishes. If the worker crashes,
 * the BullMQ phase times out (2h cap), or anything else interrupts the
 * normal status flip, the row stays as `running` forever.
 *
 * This script flips any `running` row older than CUTOFF_HOURS to `failed`.
 * Real phases never legitimately take 4 hours — the 2h BullMQ timeout
 * guarantees that.
 *
 * Usage:
 *   node server/scripts/cleanupStaleJobStatus.js
 *   node server/scripts/cleanupStaleJobStatus.js --hours=4    # default 4
 *   node server/scripts/cleanupStaleJobStatus.js --dry-run    # show count, no writes
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

const JobStatus = require('../models/system/JobStatusModel.js');

function getArg(name) {
  const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1].trim() : null;
}
function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

const CUTOFF_HOURS = parseInt(getArg('hours') || '4', 10);
const DRY_RUN = hasFlag('dry-run');

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[cleanup] Connected to ${dbConsts.dbName || MONGODB_URI}`);

  const cutoff = new Date(Date.now() - CUTOFF_HOURS * 60 * 60 * 1000);
  console.log(`[cleanup] Cutoff: any 'running' row older than ${cutoff.toISOString()} (${CUTOFF_HOURS}h ago)`);

  const filter = { status: 'running', createdAt: { $lt: cutoff } };
  const count = await JobStatus.countDocuments(filter);
  console.log(`[cleanup] Found ${count} stale running rows`);

  if (count === 0) {
    console.log('[cleanup] Nothing to do');
    return;
  }

  if (DRY_RUN) {
    console.log('[cleanup] --dry-run set, no writes performed');
    return;
  }

  const res = await JobStatus.updateMany(filter, {
    $set: {
      status: 'failed',
      error: `orphan-cleanup-${CUTOFF_HOURS}h+`,
      failedAt: new Date().toISOString()
    }
  });
  console.log(`[cleanup] Marked failed: ${res.modifiedCount}`);
}

main()
  .catch((err) => {
    console.error('[cleanup] FAILED:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await mongoose.disconnect(); } catch {}
  });

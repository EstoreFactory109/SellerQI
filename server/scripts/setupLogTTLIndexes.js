#!/usr/bin/env node
/**
 * Set up / update / inspect the TTL (auto-expiry) indexes on the log collections.
 *
 * Log cleanup is enforced by MongoDB TTL indexes — the DB deletes documents once
 * their date field is older than the configured retention window (see
 * server/config/logRetention.js). Those indexes are declared on the schemas and
 * are auto-created on server boot (autoIndex is on). This script exists for the
 * cases that boot-time creation does NOT handle cleanly:
 *
 *   1. CHANGING a retention window. An existing TTL index with a different
 *      duration causes an IndexOptionsConflict on boot (silently logged, NOT
 *      applied). This script updates the duration in place via `collMod`.
 *   2. Verifying / reporting what is configured and how many docs are eligible
 *      for deletion right now (useful before the first deploy on a big DB).
 *
 * Usage:
 *   node server/scripts/setupLogTTLIndexes.js            # apply config (idempotent) + report
 *   node server/scripts/setupLogTTLIndexes.js --dry-run  # report only, change nothing
 *
 * Env: DB_URI, DB_NAME (or MONGODB_URI / MONGO_URI)
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const { LOG_RETENTION, expireAfterSeconds } = require('../config/logRetention.js');

const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

const DRY_RUN = process.argv.slice(2).includes('--dry-run');

// Require the models so their collections (and other indexes) are registered.
require('../models/system/ErrorLogs.js');
require('../models/system/PaymentLogsModel.js');
require('../models/system/EmailLogsModel.js');
require('../models/finance/FinanceSyncLogModel.js');

async function ensureTtlIndex(policyKey) {
  const policy = LOG_RETENTION[policyKey];
  const wantSeconds = expireAfterSeconds(policyKey);
  const Model = mongoose.model(policy.model);
  const coll = Model.collection;
  const collName = coll.collectionName;

  const result = {
    collection: collName,
    field: policy.dateField,
    retentionDays: policy.retentionDays,
    action: 'none',
  };

  // Count docs + how many are already past the cutoff (eligible for deletion).
  const cutoff = new Date(Date.now() - wantSeconds * 1000);
  const [total, eligible] = await Promise.all([
    coll.estimatedDocumentCount(),
    coll.countDocuments({ [policy.dateField]: { $lt: cutoff } }),
  ]);
  result.totalDocs = total;
  result.eligibleForDeletion = eligible;

  const indexes = await coll.indexes();
  const existing = indexes.find(
    (ix) => ix.name === policy.indexName || (ix.key && ix.key[policy.dateField] === 1 && 'expireAfterSeconds' in ix)
  );

  if (!existing) {
    result.action = DRY_RUN ? 'would-create' : 'created';
    if (!DRY_RUN) {
      await coll.createIndex({ [policy.dateField]: 1 }, { name: policy.indexName, expireAfterSeconds: wantSeconds });
    }
    return result;
  }

  result.currentSeconds = existing.expireAfterSeconds;

  // Index on the wrong field/key — drop and recreate on the configured field.
  const keyMatches = existing.key && existing.key[policy.dateField] === 1 && Object.keys(existing.key).length === 1;
  if (!keyMatches) {
    result.action = DRY_RUN ? 'would-recreate (wrong key)' : 'recreated (wrong key)';
    if (!DRY_RUN) {
      await coll.dropIndex(existing.name);
      await coll.createIndex({ [policy.dateField]: 1 }, { name: policy.indexName, expireAfterSeconds: wantSeconds });
    }
    return result;
  }

  if (existing.expireAfterSeconds === wantSeconds) {
    result.action = 'already-correct';
    return result;
  }

  // Same key, different duration — update in place (collMod avoids the conflict).
  result.action = DRY_RUN ? `would-update (${existing.expireAfterSeconds}s -> ${wantSeconds}s)` : 'updated';
  if (!DRY_RUN) {
    await mongoose.connection.db.command({
      collMod: collName,
      index: { name: existing.name, expireAfterSeconds: wantSeconds },
    });
  }
  return result;
}

async function main() {
  if (!MONGODB_URI) {
    throw new Error('No Mongo connection string. Set DB_URI + DB_NAME (or MONGODB_URI).');
  }

  console.log(`[setupLogTTLIndexes] ${DRY_RUN ? 'DRY RUN — ' : ''}connecting to MongoDB...`);
  await mongoose.connect(MONGODB_URI);
  console.log('[setupLogTTLIndexes] connected.\n');

  const keys = Object.keys(LOG_RETENTION);
  const results = [];
  for (const key of keys) {
    try {
      results.push(await ensureTtlIndex(key));
    } catch (err) {
      results.push({ collection: LOG_RETENTION[key].model, action: 'ERROR', error: err.message });
    }
  }

  console.table(
    results.map((r) => ({
      collection: r.collection,
      field: r.field,
      retentionDays: r.retentionDays,
      totalDocs: r.totalDocs,
      eligibleNow: r.eligibleForDeletion,
      action: r.action,
      error: r.error || '',
    }))
  );

  if (DRY_RUN) {
    console.log('\nDry run complete — no changes made.');
  } else {
    console.log('\nTTL indexes applied. MongoDB will delete eligible documents within ~60s.');
    console.log('NOTE: TTL/deletes free space inside the collection for reuse but do NOT');
    console.log('return it to the OS. To reclaim disk after a large first purge, run');
    console.log('db.runCommand({ compact: "<collection>" }) during a maintenance window.');
  }
}

main()
  .then(() => mongoose.connection.close().finally(() => process.exit(0)))
  .catch((err) => {
    console.error('[setupLogTTLIndexes] FAILED:', err);
    mongoose.connection.close().finally(() => process.exit(1));
  });

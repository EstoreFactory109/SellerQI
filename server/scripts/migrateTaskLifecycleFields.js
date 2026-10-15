#!/usr/bin/env node
/**
 * migrateTaskLifecycleFields.js
 *
 * Backfills the lifecycle fields task reconcile relies on, and creates the
 * open-work index. Run it BEFORE setting TASK_RECONCILE_MODE=on for any account.
 *
 * WHY
 * ---
 * Reconcile reopens a completed task that is still detected once COMPLETED_GRACE_DAYS
 * have passed since `completedAt`. Rows completed before that field existed have no
 * `completedAt`, so reconcile falls back to `updatedAt`, and it pins that value on
 * its first write to the row. Backfilling here does the same thing up front, for
 * every row at once, so no grace period depends on when reconcile first touches a row.
 *
 * WHAT THIS DOES (each step touches only rows where the field is missing, so it is
 * safe to re-run)
 *   1. completed tasks:  completedAt  <- updatedAt
 *   2. every task:       firstSeenAt  <- createdAt
 *   3. every task:       lastSeenAt   <- updatedAt
 *   4. creates { userId, country, region, status } on taskitems
 *
 * No status, amount or text is changed, and nothing is deleted.
 *
 * USAGE
 *   node server/scripts/migrateTaskLifecycleFields.js            # report only
 *   node server/scripts/migrateTaskLifecycleFields.js --apply    # do it
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
    dbConsts.dbUri && dbConsts.dbName
        ? `${dbConsts.dbUri}/${dbConsts.dbName}`
        : process.env.MONGODB_URI || process.env.MONGO_URI;

const hasFlag = (n) => process.argv.slice(2).includes(`--${n}`);

// Each step: which rows are missing the field, and the aggregation-pipeline
// update that fills it from a field already on the same row.
const STEPS = [
    {
        name: 'completedAt from updatedAt (completed tasks)',
        filter: { status: 'completed', completedAt: { $exists: false }, updatedAt: { $exists: true } },
        update: [{ $set: { completedAt: '$updatedAt' } }]
    },
    {
        name: 'firstSeenAt from createdAt',
        filter: { firstSeenAt: { $exists: false }, createdAt: { $exists: true } },
        update: [{ $set: { firstSeenAt: '$createdAt' } }]
    },
    {
        name: 'lastSeenAt from updatedAt',
        filter: { lastSeenAt: { $exists: false }, updatedAt: { $exists: true } },
        update: [{ $set: { lastSeenAt: '$updatedAt' } }]
    }
];

const OPEN_WORK_INDEX = { key: { userId: 1, country: 1, region: 1, status: 1 } };

async function run({ apply }) {
    const col = mongoose.connection.db.collection('taskitems');
    const report = { apply, steps: [], index: null };

    for (const step of STEPS) {
        const pending = await col.countDocuments(step.filter);
        let modified = 0;
        if (apply && pending > 0) {
            const r = await col.updateMany(step.filter, step.update);
            modified = r.modifiedCount;
        }
        report.steps.push({ step: step.name, missing: pending, modified });
    }

    const existing = await col.indexes();
    const want = JSON.stringify(OPEN_WORK_INDEX.key);
    const has = existing.some(ix => JSON.stringify(ix.key) === want);
    if (has) {
        report.index = 'already present';
    } else if (apply) {
        report.index = `created ${await col.createIndex(OPEN_WORK_INDEX.key)}`;
    } else {
        report.index = 'missing (would create)';
    }

    return report;
}

if (require.main === module) {
    (async () => {
        const apply = hasFlag('apply');
        await mongoose.connect(MONGODB_URI);
        try {
            const report = await run({ apply });
            console.log(JSON.stringify(report, null, 2));
            if (!apply) console.log('\nReport only. Re-run with --apply to write.');
        } finally {
            await mongoose.disconnect();
        }
    })().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { run, STEPS, OPEN_WORK_INDEX };

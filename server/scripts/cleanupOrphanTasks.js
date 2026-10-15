#!/usr/bin/env node
/**
 * cleanupOrphanTasks.js
 *
 * Deletes tasks (taskitems) and task metadata (tasks) whose owner no longer exists
 * in `users`.
 *
 * WHY
 * ---
 * In October 2026 there were ~29,400 open tasks belonging to 37 deleted accounts.
 * Sellers never saw them (the owner is gone, and the rows predate marketplace
 * scoping, so scoped reads skip them), but they inflated every task statistic and
 * every analysis built on taskitems. Account deletion has queued a full data purge
 * (fullUserDataPurgeService, which covers TaskItem) only since 2026-02-25; the
 * report below shows each orphan owner's newest task, to tell "deleted before the
 * purge existed" apart from "purge failed".
 *
 * WHAT THIS DOES
 * --------------
 * Report only, unless --apply. Idempotent: an owner that exists is never touched,
 * and a second run finds nothing. Only `taskitems` and `tasks` are deleted; other
 * orphaned collections are out of scope.
 *
 * USAGE
 *   node server/scripts/cleanupOrphanTasks.js            # report only
 *   node server/scripts/cleanupOrphanTasks.js --apply    # delete
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

/**
 * Owners referenced by tasks that have no `users` document.
 * @param {import('mongodb').Db} db
 * @returns {Promise<Array<{ userId, taskItems, open, newestTask, metaDocs }>>}
 */
async function findOrphanOwners(db) {
    const owners = await db.collection('taskitems').aggregate([
        {
            $group: {
                _id: '$userId',
                taskItems: { $sum: 1 },
                open: { $sum: { $cond: [{ $in: ['$status', ['pending', 'in_progress']] }, 1, 0] } },
                newestTask: { $max: '$createdAt' },
            },
        },
    ], { allowDiskUse: true }).toArray();

    const metaOwners = await db.collection('tasks').distinct('userId');
    const allIds = [...new Map([...owners.map((o) => o._id), ...metaOwners]
        .filter(Boolean).map((id) => [String(id), id])).values()];

    const existing = new Set((await db.collection('users')
        .find({ _id: { $in: allIds } }).project({ _id: 1 }).toArray()).map((u) => String(u._id)));

    const byId = new Map(owners.map((o) => [String(o._id), o]));
    const metaCounts = new Map((await db.collection('tasks').aggregate([
        { $match: { userId: { $in: allIds.filter((id) => !existing.has(String(id))) } } },
        { $group: { _id: '$userId', n: { $sum: 1 } } },
    ]).toArray()).map((m) => [String(m._id), m.n]));

    return allIds
        .filter((id) => !existing.has(String(id)))
        .map((id) => {
            const o = byId.get(String(id));
            return {
                userId: id,
                taskItems: o?.taskItems || 0,
                open: o?.open || 0,
                newestTask: o?.newestTask || null,
                metaDocs: metaCounts.get(String(id)) || 0,
            };
        });
}

const PURGE_INTRODUCED = new Date('2026-02-25T00:00:00Z');

async function run(db, { apply }) {
    const orphans = await findOrphanOwners(db);
    const summary = {
        apply,
        orphanOwners: orphans.length,
        taskItems: orphans.reduce((s, o) => s + o.taskItems, 0),
        openTaskItems: orphans.reduce((s, o) => s + o.open, 0),
        metaDocs: orphans.reduce((s, o) => s + o.metaDocs, 0),
        // Owners whose newest task postdates the purge queue: their purge should have
        // removed these rows, so it failed or never ran for them.
        ownersWithTasksAfterPurgeExisted: orphans.filter((o) => o.newestTask && o.newestTask >= PURGE_INTRODUCED).length,
        deleted: { taskItems: 0, metaDocs: 0 },
    };

    if (apply && orphans.length > 0) {
        const ids = orphans.map((o) => o.userId);
        summary.deleted.taskItems = (await db.collection('taskitems').deleteMany({ userId: { $in: ids } })).deletedCount;
        summary.deleted.metaDocs = (await db.collection('tasks').deleteMany({ userId: { $in: ids } })).deletedCount;
    }

    return { summary, orphans };
}

if (require.main === module) {
    (async () => {
        const apply = hasFlag('apply');
        await mongoose.connect(MONGODB_URI);
        try {
            const { summary, orphans } = await run(mongoose.connection.db, { apply });
            console.log(JSON.stringify(summary, null, 2));
            console.log('\nPer owner (newest task first):');
            orphans
                .sort((a, b) => (b.newestTask || 0) - (a.newestTask || 0))
                .forEach((o) => console.log(`  ${o.userId}  tasks=${o.taskItems} open=${o.open} meta=${o.metaDocs} newest=${o.newestTask ? o.newestTask.toISOString().slice(0, 10) : '-'}`));
            if (!apply) console.log('\nReport only. Re-run with --apply to delete.');
        } finally {
            await mongoose.disconnect();
        }
    })().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { run, findOrphanOwners, PURGE_INTRODUCED };

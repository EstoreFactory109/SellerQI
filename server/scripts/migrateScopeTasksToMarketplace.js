#!/usr/bin/env node
/**
 * migrateScopeTasksToMarketplace.js
 *
 * Gives every stored task a marketplace, and swaps the dedup indexes to match.
 *
 * WHY
 * ---
 * TaskItem was keyed by user alone. A seller with more than one marketplace
 * therefore had ONE shared task pool, which caused three separate problems:
 *
 *   1. The AI views ("Top things to fix", "Top products to fix") are stored per
 *      marketplace but were built from that shared pool, so each marketplace was
 *      described using the others' products. On one live account 10,090 of
 *      10,091 task ASINs belonged to UK-EU while a US-NA view was generated from
 *      them; another account's tasks spanned all four of its marketplaces.
 *   2. The unique index {userId, asin, errorCategory, errorType} meant the SAME
 *      ASIN failing the SAME way in two marketplaces collided — the second
 *      insert was rejected and that marketplace's task was silently lost.
 *   3. Task metadata (taskRenewalDate) was unique per user, so whichever
 *      marketplace rebuilt first set the renewal date for all of them and the
 *      rest never got a rebuild of their own. The delete at renewal was also
 *      unscoped, so one marketplace's rebuild wiped the others' tasks.
 *
 * WHAT THIS DOES
 * --------------
 * Single-marketplace accounts: their tasks can only belong to that one
 * marketplace, so they are stamped in place. Nothing is recomputed and no
 * seller-set status is touched.
 *
 * Multi-marketplace accounts: their tasks are genuinely mixed and cannot be
 * attributed after the fact — an ads task carries a keyword, not an ASIN, and a
 * shared ASIN belongs to several catalogues. Guessing would put real work under
 * the wrong marketplace, so their tasks and metadata are removed and rebuilt
 * correctly scoped by migrateRecomputeDerivedTaskData.js (run it straight after,
 * for the same users) or by their next scheduled run.
 *
 * Tasks whose user has no seller account left cannot be placed either. They are
 * left untouched: nothing reads them, and deleting them is a separate decision.
 *
 * INDEXES
 * -------
 * Backfill first, then create the new unique indexes, then drop the old ones —
 * so the collection is never left without a uniqueness guard. Adding
 * country/region to an existing unique key can only make it more selective, so
 * the new index cannot fail on data the old one already accepted.
 *
 * ORDER
 * -----
 * Run this WITH the deploy that scopes the reads. Until it runs, a scoped read
 * finds no rows, because no row has a marketplace yet.
 *
 * USAGE
 *   node server/scripts/migrateScopeTasksToMarketplace.js            # report only
 *   node server/scripts/migrateScopeTasksToMarketplace.js --apply    # do it
 *   node server/scripts/migrateScopeTasksToMarketplace.js --apply --skip-indexes
 *
 * PHASED (recommended, because a push to main deploys immediately):
 *   1. before deploy:  --apply --skip-multi     # stamp + swap indexes; old code
 *                                               # ignores the new fields, so this
 *                                               # is a no-op for what is running
 *   2. deploy
 *   3. after deploy:   --apply                  # clear the multi-marketplace
 *                                               # accounts, then recompute them
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
    dbConsts.dbUri && dbConsts.dbName
        ? `${dbConsts.dbUri}/${dbConsts.dbName}`
        : process.env.MONGODB_URI || process.env.MONGO_URI;

const Seller = require('../models/user-auth/sellerCentralModel.js');
const TaskItem = require('../models/MCP/TaskItemModel.js');
const Task = require('../models/MCP/TaskModel.js');

const hasFlag = (n) => process.argv.slice(2).includes(`--${n}`);
const APPLY = hasFlag('apply');
const SKIP_INDEXES = hasFlag('skip-indexes');
// Multi-marketplace accounts are cleared for a scoped rebuild. That rebuild has
// to be done by the NEW code, so this phase is skipped on a pre-deploy run and
// done straight after the deploy.
const SKIP_MULTI = hasFlag('skip-multi');
const log = (...a) => console.log(...a);

const OLD_TASKITEM_INDEX = 'userId_1_asin_1_errorCategory_1_errorType_1';
const OLD_TASK_INDEX = 'userId_1';

/** Matches a row that has not been given a marketplace yet. */
const unstamped = (userId) => ({
    userId,
    $or: [{ country: { $exists: false } }, { country: null }],
});

/**
 * Remove unstamped rows that would collide with one a previous run already stamped.
 *
 * ── WHY THIS IS NEEDED AT ALL ──
 * The migration is phased around a deploy, and the running code keeps inserting the whole
 * time. An unstamped insert indexes as (userId, null, null, …) — a different index entry
 * from the stamped row's — so the unique index admits it quite happily. Stamping it later
 * then tries to create a duplicate key, and the updateMany aborts with E11000 partway
 * through, leaving the account half-migrated.
 *
 * The two rows are the same logical thing, so the unstamped copy goes and the stamped one
 * stays: it is the one the scoped code has been maintaining, and for TaskItem it is the one
 * that may carry the seller's completed / in-progress status.
 *
 * ── IT APPLIES TO BOTH COLLECTIONS, WHICH IS THE EASY HALF TO MISS ──
 * TaskItem collides on {userId, country, region, asin, errorCategory, errorType}; Task
 * metadata collides on {userId, country, region}. Task has no discriminator beyond the
 * marketplace itself, so ANY stamped metadata doc collides with ANY unstamped one for that
 * user — `keyOf` returns a constant and the rest of the logic is unchanged. Eight accounts
 * are in exactly that state today, and each would have aborted the run.
 *
 * Counted in report mode as well as under --apply. A destructive step that will only tell
 * you what it deletes by deleting it is not a dry run.
 *
 * Memory: this loads two id-and-key projections per account. At today's ~364k task rows
 * spread across hundreds of accounts that is small, but it is per-account and unbounded in
 * principle — if one account ever holds a seven-figure row count, batch it.
 *
 * @returns {number} rows removed, or without --apply, rows that would be
 */
const dropClashingUnstamped = async ({ model, userId, mk, projection, keyOf, apply = APPLY }) => {
    const stamped = await model
        .find({ userId, country: mk.country, region: mk.region }, projection)
        .lean();
    if (stamped.length === 0) return 0;

    const stampedKeys = new Set(stamped.map(keyOf));
    const clashing = (await model.find(unstamped(userId), projection).lean())
        .filter((doc) => stampedKeys.has(keyOf(doc)))
        .map((doc) => doc._id);
    if (clashing.length === 0) return 0;

    if (!apply) return clashing.length;
    const result = await model.deleteMany({ _id: { $in: clashing } });
    return result.deletedCount || 0;
};

/** The two collections this runs over, and how a collision is identified in each. */
const TASK_ITEM_DEDUP = {
    model: TaskItem,
    projection: { asin: 1, errorCategory: 1, errorType: 1 },
    keyOf: (t) => `${t.asin}|${t.errorCategory}|${t.errorType}`,
};
const TASK_META_DEDUP = {
    model: Task,
    projection: { _id: 1 },
    // One metadata doc per marketplace, so every unstamped one collides with a stamped one.
    keyOf: () => 'one-per-marketplace',
};

async function main() {
    if (!MONGODB_URI) throw new Error('No Mongo URI configured');
    await mongoose.connect(MONGODB_URI);

    log('='.repeat(76));
    log(`Scope tasks to marketplace — ${APPLY ? 'APPLY (writing)' : 'REPORT ONLY (no writes)'}`);
    log('='.repeat(76));

    // One entry per user with the marketplaces they actually own.
    const owners = await Seller.aggregate([
        { $unwind: '$sellerAccount' },
        {
            $group: {
                _id: '$User',
                marketplaces: { $addToSet: { country: '$sellerAccount.country', region: '$sellerAccount.region' } }
            }
        }
    ]);

    const single = [];
    const multi = [];
    for (const o of owners) {
        const mk = (o.marketplaces || []).filter((m) => m && m.country && m.region);
        if (mk.length === 1) single.push({ userId: o._id, mk: mk[0] });
        else if (mk.length > 1) multi.push({ userId: o._id, mk });
    }

    const totalTasks = await TaskItem.countDocuments();
    const alreadyScoped = await TaskItem.countDocuments({ country: { $exists: true, $ne: null } });
    log(`tasks total ${totalTasks}, already scoped ${alreadyScoped}`);
    log(`accounts: ${single.length} single-marketplace, ${multi.length} multi-marketplace\n`);

    // ── 1. stamp single-marketplace accounts ────────────────────────────────
    let stampedTasks = 0, stampedMeta = 0, dedupedTasks = 0, dedupedMeta = 0;
    for (const s of single) {
        const filter = unstamped(s.userId);
        const taskCount = await TaskItem.countDocuments(filter);
        const metaCount = await Task.countDocuments(filter);
        /**
         * Both counts, not just the task one. An account can have every task row
         * stamped and still hold an unstamped metadata doc — 86 of 249 metadata docs
         * are unstamped today — and skipping on the task count alone leaves those
         * behind for the next run to collide on.
         */
        if (taskCount === 0 && metaCount === 0) continue;

        // Before stamping, never after: the whole point is to clear the duplicate-key
        // collision out of the way of the updateMany below.
        const droppedTasks = await dropClashingUnstamped({ ...TASK_ITEM_DEDUP, userId: s.userId, mk: s.mk });
        const droppedMeta = await dropClashingUnstamped({ ...TASK_META_DEDUP, userId: s.userId, mk: s.mk });
        dedupedTasks += droppedTasks;
        dedupedMeta += droppedMeta;

        if (APPLY) {
            const r = await TaskItem.updateMany(filter, { $set: { country: s.mk.country, region: s.mk.region } });
            stampedTasks += r.modifiedCount || 0;
            const m = await Task.updateMany(filter, { $set: { country: s.mk.country, region: s.mk.region } });
            stampedMeta += m.modifiedCount || 0;
        } else {
            // Nothing was deleted in report mode, so the counts still include the rows
            // the dedup would have removed. Subtract them, or the preview overstates
            // what ends up stamped.
            stampedTasks += taskCount - droppedTasks;
            stampedMeta += metaCount - droppedMeta;
        }
    }
    log(`single-marketplace: ${APPLY ? 'stamped' : 'would stamp'} ${stampedTasks} tasks, ${stampedMeta} metadata docs`);
    if (dedupedTasks > 0 || dedupedMeta > 0) {
        log(`  ${APPLY ? 'dropped' : 'would drop'} ${dedupedTasks} task(s) and ${dedupedMeta} metadata doc(s)`);
        log('  that duplicate an already-stamped row — each would otherwise abort the run with E11000');
    }

    // ── 2. clear multi-marketplace accounts for a scoped rebuild ────────────
    let clearedTasks = 0, clearedMeta = 0;
    for (const m of (SKIP_MULTI ? [] : multi)) {
        const n = await TaskItem.countDocuments({ userId: m.userId });
        const places = m.mk.map((x) => `${x.country}-${x.region}`).join(',');
        log(`  ${m.userId}  ${places}  ${n} mixed task(s) ${APPLY ? '-> removing' : '-> would remove'}`);
        if (APPLY) {
            const r = await TaskItem.deleteMany({ userId: m.userId });
            clearedTasks += r.deletedCount || 0;
            const mm = await Task.deleteMany({ userId: m.userId });
            clearedMeta += mm.deletedCount || 0;
        } else {
            clearedTasks += n;
        }
    }
    if (SKIP_MULTI) {
        const pending = multi.reduce((n, m) => n + (m.mk ? 1 : 0), 0);
        log(`multi-marketplace: SKIPPED (${pending} account(s)) — re-run without --skip-multi once the`);
        log('  scoped code is deployed, so their rebuild writes rows that carry a marketplace.');
    }
    log(`multi-marketplace: ${APPLY ? 'removed' : 'would remove'} ${clearedTasks} tasks, ${clearedMeta} metadata docs`);
    if (multi.length > 0 && !SKIP_MULTI) {
        log('  -> rebuild these per marketplace with:');
        log(`     node server/scripts/migrateRecomputeDerivedTaskData.js --apply --user-id="${multi.map((m) => m.userId).join(',')}"`);
    }

    // ── 3. unattributable leftovers ─────────────────────────────────────────
    const ownerIds = new Set(owners.map((o) => String(o._id)));
    const holders = await TaskItem.distinct('userId');
    const orphanIds = holders.filter((h) => !ownerIds.has(String(h)));
    if (orphanIds.length > 0) {
        const orphanTasks = await TaskItem.countDocuments({ userId: { $in: orphanIds } });
        log(`\nleft alone: ${orphanTasks} tasks across ${orphanIds.length} user(s) with no seller account`);
    }

    // ── 4. index swap ───────────────────────────────────────────────────────
    if (!SKIP_INDEXES) {
        log('\nindexes:');
        const taskItems = mongoose.connection.db.collection('taskitems');
        const tasksCol = mongoose.connection.db.collection('tasks');
        if (APPLY) {
            // Create the replacements BEFORE dropping the old ones, so the
            // collection is never briefly without a uniqueness guard.
            await taskItems.createIndex(
                { userId: 1, country: 1, region: 1, asin: 1, errorCategory: 1, errorType: 1 },
                { unique: true, name: 'task_dedup_marketplace' }
            );
            await taskItems.createIndex({ userId: 1, country: 1, region: 1 }, { name: 'userId_1_country_1_region_1' });
            await tasksCol.createIndex(
                { userId: 1, country: 1, region: 1 },
                { unique: true, name: 'task_meta_marketplace' }
            );
            log('  created task_dedup_marketplace, userId_1_country_1_region_1, task_meta_marketplace');
            for (const [col, name] of [[taskItems, OLD_TASKITEM_INDEX], [tasksCol, OLD_TASK_INDEX]]) {
                try {
                    await col.dropIndex(name);
                    log(`  dropped ${name}`);
                } catch (e) {
                    log(`  could not drop ${name}: ${e.message}`);
                }
            }
        } else {
            log('  would create task_dedup_marketplace + task_meta_marketplace, then drop');
            log(`  ${OLD_TASKITEM_INDEX} and ${OLD_TASK_INDEX}`);
        }
    }

    const stillUnscoped = await TaskItem.countDocuments({
        $or: [{ country: { $exists: false } }, { country: null }]
    });
    log(`\ntasks still without a marketplace: ${stillUnscoped}${APPLY ? '' : ' (nothing was written)'}`);
    log('='.repeat(76));
    if (!APPLY) log('Re-run with --apply to perform the migration.');

    await mongoose.disconnect();
    process.exit(0);
}

if (require.main === module) {
    main().catch(async (e) => {
        console.error('FATAL:', e.message);
        console.error(e.stack);
        try { await mongoose.disconnect(); } catch {}
        process.exit(1);
    });
}

/**
 * Exported for tests only — nothing else requires this file.
 *
 * The dedup rule is the one part of this script that DELETES, so it is the one part that
 * has to be provable without a database in front of it. `dropClashingUnstamped` takes its
 * model and its `apply` flag as arguments precisely so a test can hand it a fake and
 * exercise both modes.
 */
module.exports = { dropClashingUnstamped, unstamped, TASK_ITEM_DEDUP, TASK_META_DEDUP };

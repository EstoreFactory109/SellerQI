#!/usr/bin/env node
/**
 * cleanupStaleRecoverableAmountData.js
 *
 * One-shot cleanup of two stale document sets that feed the recoverable-$
 * feature with wrong or duplicated values. Both regenerate correctly on the
 * next sync / task renewal, so deleting them is safe.
 *
 * 1. STALE LTSF SNAPSHOTS (LONG_TERM_STORAGE_FEE_CHARGES_DATA)
 *    Documents whose newest row is older than LTSF_MAX_SNAPSHOT_AGE_DAYS.
 *    Analyse.js now ignores these at runtime (buildLtsfAmountMap), so this is
 *    housekeeping rather than a correctness fix — but leaving 11-month-old
 *    storage fees in the collection invites the next reader to trust them.
 *    Matched by age, and the age constant is imported from the same module the
 *    runtime guard uses, so the two can never drift apart.
 *
 * 2. MISROUTED PROFITABILITY TASKS (TaskItem, errorType 'profitability_issue')
 *    `generateProfitabilityTasks` used to compare against 'low_profit_margin'
 *    while upstream only ever emits 'low_margin', so every low-margin task fell
 *    through to the generic 'profitability_issue' branch. That comparison is
 *    fixed, and low-margin tasks now store errorType 'low_margin' — a DIFFERENT
 *    key in the {userId, asin, errorCategory, errorType} unique index, so the
 *    stale generic row would sit alongside the new tailored one until the user's
 *    weekly renewal. Deleting them avoids the duplicate; they are recreated
 *    correctly on the next run.
 *    Safe because upstream only produces 'negative_profit' and 'low_margin' —
 *    every 'profitability_issue' document is a misrouted low-margin task.
 *
 * Dry-run by default: this deletes ~17.5k documents, so writes require --apply.
 *
 * Usage:
 *   node server/scripts/cleanupStaleRecoverableAmountData.js              # report only
 *   node server/scripts/cleanupStaleRecoverableAmountData.js --apply      # delete
 *   node server/scripts/cleanupStaleRecoverableAmountData.js --only=ltsf  # ltsf | tasks
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
    dbConsts.dbUri && dbConsts.dbName
        ? `${dbConsts.dbUri}/${dbConsts.dbName}`
        : process.env.MONGODB_URI || process.env.MONGO_URI;

const LongTermStorageFees = require('../models/finance/LongTermStorageFeesModel.js');
const TaskItem = require('../models/MCP/TaskItemModel.js');
const { LTSF_MAX_SNAPSHOT_AGE_DAYS } = require('../Services/Calculations/RecoverableAmountUtils.js');

function getArg(name) {
    const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return m ? m.split('=')[1].trim() : null;
}
function hasFlag(name) {
    return process.argv.slice(2).includes(`--${name}`);
}

const APPLY = hasFlag('apply');
const ONLY = getArg('only');
const runLtsf = !ONLY || ONLY === 'ltsf';
const runTasks = !ONLY || ONLY === 'tasks';

/** Newest row timestamp in an LTSF doc, falling back to the doc's own createdAt. */
function newestRowTime(doc) {
    const times = (doc.data || [])
        .map((r) => Date.parse(r && r.snapShotDate))
        .filter((t) => Number.isFinite(t));
    if (times.length > 0) return Math.max(...times);
    const created = doc.createdAt ? new Date(doc.createdAt).getTime() : NaN;
    return Number.isFinite(created) ? created : NaN;
}

async function cleanupStaleLtsf() {
    const cutoff = Date.now() - LTSF_MAX_SNAPSHOT_AGE_DAYS * 24 * 60 * 60 * 1000;
    const docs = await LongTermStorageFees.find({}).lean();

    const stale = [];
    for (const doc of docs) {
        const newest = newestRowTime(doc);
        // Undatable documents are treated as stale: buildLtsfAmountMap already
        // refuses to surface money it cannot date, so keeping them serves nobody.
        if (!Number.isFinite(newest) || newest < cutoff) stale.push({ doc, newest });
    }

    console.log(`\n── Stale LTSF snapshots (older than ${LTSF_MAX_SNAPSHOT_AGE_DAYS} days) ──`);
    console.log(`   total documents in collection : ${docs.length}`);
    console.log(`   stale                         : ${stale.length}`);
    for (const { doc, newest } of stale) {
        const total = (doc.data || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
        const when = Number.isFinite(newest) ? new Date(newest).toISOString().slice(0, 10) : 'undatable';
        console.log(`     user=${doc.User} ${doc.country}/${doc.region} rows=${(doc.data || []).length} newestSnapshot=${when} total=$${total.toFixed(2)}`);
    }

    if (!APPLY || stale.length === 0) return { deleted: 0, matched: stale.length };
    const res = await LongTermStorageFees.deleteMany({ _id: { $in: stale.map((s) => s.doc._id) } });
    console.log(`   deleted                       : ${res.deletedCount}`);
    return { deleted: res.deletedCount, matched: stale.length };
}

async function cleanupMisroutedProfitabilityTasks() {
    const filter = { errorCategory: 'profitability', errorType: 'profitability_issue' };

    const matched = await TaskItem.countDocuments(filter);
    const affectedUsers = (await TaskItem.distinct('userId', filter)).length;
    const stillCorrect = await TaskItem.countDocuments({
        errorCategory: 'profitability',
        errorType: { $in: ['negative_profit', 'low_margin'] }
    });

    console.log(`\n── Misrouted profitability tasks (errorType 'profitability_issue') ──`);
    console.log(`   matched for deletion          : ${matched}`);
    console.log(`   across users                  : ${affectedUsers}`);
    console.log(`   correctly-typed docs (kept)   : ${stillCorrect}`);

    if (!APPLY || matched === 0) return { deleted: 0, matched };
    const res = await TaskItem.deleteMany(filter);
    console.log(`   deleted                       : ${res.deletedCount}`);
    return { deleted: res.deletedCount, matched };
}

async function main() {
    if (!MONGODB_URI) {
        console.error('❌ No Mongo URI resolved (need DB_URI + DB_NAME, or MONGODB_URI).');
        process.exit(1);
    }

    await mongoose.connect(MONGODB_URI);
    console.log(APPLY ? '⚠️  APPLY mode — documents WILL be deleted.' : 'ℹ️  Dry run — no writes. Re-run with --apply to delete.');

    try {
        const ltsf = runLtsf ? await cleanupStaleLtsf() : null;
        const tasks = runTasks ? await cleanupMisroutedProfitabilityTasks() : null;

        console.log('\n── Summary ──');
        if (ltsf) console.log(`   LTSF docs         : ${ltsf.matched} matched, ${ltsf.deleted} deleted`);
        if (tasks) console.log(`   Profitability docs: ${tasks.matched} matched, ${tasks.deleted} deleted`);
        if (!APPLY) console.log('\n   Nothing was changed. Re-run with --apply to perform the deletions.');
        console.log('');
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((err) => {
    console.error('❌ Cleanup failed:', err.message);
    process.exit(1);
});

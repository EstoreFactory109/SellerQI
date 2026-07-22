/**
 * closeStuckIntegrationParentJobs.js
 *
 * One-off remediation for the "integration stuck in progress" bug.
 *
 * The phased integration worker keeps a parent/bootstrap JobStatus row
 * (`integration-<userId>-<country>-<region>`, metadata.bootstrapped === true)
 * pinned at status 'running' to represent the whole pipeline. Before the fix in
 * integrationWorker.js, that parent row was never flipped to a terminal state
 * when the final phase completed — so `getAggregatedJobStatus(parentJobId)`
 * returned 'running' forever and the account showed "in progress" indefinitely.
 *
 * This script finds those orphaned parent rows whose pipeline has ACTUALLY
 * finished (their `-finalize` phase row reached a terminal state) and closes the
 * parent to match. It is conservative by design:
 *
 *   - DRY RUN by default. Nothing is written unless you pass --confirm.
 *   - Only touches rows where metadata.bootstrapped === true AND status === 'running'.
 *   - Only closes a parent whose `<parentJobId>-finalize` row is 'completed'
 *     or 'failed'. Parents without a terminal finalize row are left untouched
 *     (reported as "incomplete / in-flight").
 *   - Staleness guard: skips parents updated within --maxAgeMinutes (default 10)
 *     so it never races a worker that is finishing right now.
 *   - Never deletes anything. Never touches phase rows. Never touches non-
 *     integration / non-bootstrap rows.
 *
 * Usage:
 *   node server/scripts/closeStuckIntegrationParentJobs.js --dryRun
 *   node server/scripts/closeStuckIntegrationParentJobs.js --confirm
 *   node server/scripts/closeStuckIntegrationParentJobs.js --userId=<id> --confirm
 *   node server/scripts/closeStuckIntegrationParentJobs.js --maxAgeMinutes=30 --confirm
 */

const path = require('path');
// Load env from the current working dir first, then fall back to the repo-root
// .env (this script lives in server/scripts, the .env is at the repo root).
// dotenv does not override already-set vars, so calling twice is safe.
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');
const JobStatus = require('../models/system/JobStatusModel.js');
const { PHASES } = require('../Services/BackgroundJobs/integrationPhases.js');

const DB_URI = process.env.DB_URI;
const DB_NAME = process.env.DB_NAME;
const MONGODB_URI =
    DB_URI && DB_NAME
        ? `${DB_URI}/${DB_NAME}`
        : process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/sellerqi';

const TERMINAL_STATES = ['completed', 'failed'];

function parseArgs() {
    const args = { dryRun: false, confirm: false, userId: null, maxAgeMinutes: 10 };
    process.argv.slice(2).forEach((arg) => {
        if (!arg.startsWith('--')) return;
        const eq = arg.indexOf('=');
        if (eq === -1) {
            const flag = arg.slice(2);
            if (flag === 'dryRun') args.dryRun = true;
            else if (flag === 'confirm') args.confirm = true;
            return;
        }
        const key = arg.slice(2, eq);
        const val = arg.slice(eq + 1);
        if (key === 'userId') args.userId = val;
        else if (key === 'maxAgeMinutes') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n) && n >= 0) args.maxAgeMinutes = n;
        }
    });
    return args;
}

async function main() {
    const { dryRun, confirm, userId, maxAgeMinutes } = parseArgs();

    // Default to dry run unless --confirm is explicitly passed.
    const willWrite = confirm && !dryRun;
    if (!dryRun && !confirm) {
        console.log('No mode passed — defaulting to DRY RUN. Pass --confirm to apply changes.\n');
    }

    await mongoose.connect(MONGODB_URI);
    console.log(`[CloseStuckParents] Connected. Mode => ${willWrite ? 'APPLY' : 'DRY RUN'}`);
    console.log(`[CloseStuckParents] Staleness guard: only rows older than ${maxAgeMinutes} min\n`);

    const query = { status: 'running', 'metadata.bootstrapped': true };
    if (userId) query.userId = userId;

    const parents = await JobStatus.find(query).lean();
    console.log(`[CloseStuckParents] Found ${parents.length} bootstrap parent row(s) in 'running' state${userId ? ` for user ${userId}` : ''}.\n`);

    const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
    const closeable = [];
    const skippedInFlight = [];
    const skippedIncomplete = [];
    const skippedTooFresh = [];

    for (const parent of parents) {
        const finalizeJobId = `${parent.jobId}-${PHASES.FINALIZE}`;
        const finalizeRow = await JobStatus.findOne({ jobId: finalizeJobId }).lean();

        // No terminal finalize row → pipeline did not finish; leave alone.
        if (!finalizeRow || !TERMINAL_STATES.includes(finalizeRow.status)) {
            const reason = !finalizeRow
                ? 'no finalize phase row'
                : `finalize phase still '${finalizeRow.status}'`;
            (finalizeRow && finalizeRow.status === 'running' ? skippedInFlight : skippedIncomplete)
                .push({ jobId: parent.jobId, reason });
            continue;
        }

        // Staleness guard: don't race a worker that just finished.
        const updatedAtMs = new Date(parent.updatedAt || parent.createdAt || 0).getTime();
        if (updatedAtMs > cutoff) {
            skippedTooFresh.push({ jobId: parent.jobId, updatedAt: parent.updatedAt });
            continue;
        }

        closeable.push({
            jobId: parent.jobId,
            userId: parent.userId,
            newStatus: finalizeRow.status, // 'completed' or 'failed'
            finalizeAt: finalizeRow.completedAt || finalizeRow.failedAt || null
        });
    }

    // ---- Report ----
    console.log(`Closeable (finalize terminal): ${closeable.length}`);
    closeable.forEach((c) => console.log(`  • ${c.jobId}  ->  ${c.newStatus}  (user ${c.userId})`));
    if (skippedInFlight.length) {
        console.log(`\nSkipped — finalize still running (in-flight): ${skippedInFlight.length}`);
        skippedInFlight.forEach((s) => console.log(`  • ${s.jobId}  (${s.reason})`));
    }
    if (skippedTooFresh.length) {
        console.log(`\nSkipped — updated within ${maxAgeMinutes} min (too fresh): ${skippedTooFresh.length}`);
        skippedTooFresh.forEach((s) => console.log(`  • ${s.jobId}  (updatedAt ${s.updatedAt})`));
    }
    if (skippedIncomplete.length) {
        console.log(`\nSkipped — pipeline never reached a terminal finalize (left as-is): ${skippedIncomplete.length}`);
        skippedIncomplete.forEach((s) => console.log(`  • ${s.jobId}  (${s.reason})`));
    }

    // ---- Apply ----
    if (!willWrite) {
        console.log(`\n[CloseStuckParents] DRY RUN complete. No rows modified. Pass --confirm to apply.`);
        await mongoose.disconnect();
        return;
    }

    let updated = 0;
    for (const c of closeable) {
        const tsField = c.newStatus === 'completed' ? 'completedAt' : 'failedAt';
        const res = await JobStatus.updateOne(
            { jobId: c.jobId, status: 'running' }, // re-check status to avoid clobbering a concurrent update
            {
                $set: {
                    status: c.newStatus,
                    [tsField]: c.finalizeAt || new Date(),
                    'metadata.closedByBackfill': true,
                    updatedAt: new Date()
                }
            }
        );
        if (res.modifiedCount > 0) {
            updated += 1;
            console.log(`  ✓ Closed ${c.jobId} -> ${c.newStatus}`);
        } else {
            console.log(`  - Skipped ${c.jobId} (no longer 'running' — concurrent update)`);
        }
    }

    console.log(`\n[CloseStuckParents] APPLY complete. Closed ${updated}/${closeable.length} parent row(s).`);
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('[CloseStuckParents] Error:', err.message);
    try { await mongoose.disconnect(); } catch (_) { /* noop */ }
    process.exit(1);
});

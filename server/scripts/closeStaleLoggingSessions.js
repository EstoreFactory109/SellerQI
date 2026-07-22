/**
 * closeStaleLoggingSessions.js
 *
 * One-off remediation for orphaned "in_progress" logging sessions
 * (UserAccountLogs / ErrorLogs). A session is created at the start of a run
 * (initSession) and only flipped to a terminal state by endSession. Runs that
 * crash or stall before their finalize/endSession call leave the session pinned
 * at 'in_progress' forever, so the frontend "user logging" page shows a
 * perpetual spinner.
 *
 * This closes sessions that are demonstrably NOT running anymore:
 *   - sessionStatus === 'in_progress'
 *   - no sessionEndTime
 *   - sessionStartTime older than --maxAgeHours (default 6h) — comfortably
 *     beyond any real run (worker lock is 2h with extensions; the longest
 *     PPC report path is capped at ~4h), so anything older is orphaned.
 *
 * Conservative by design:
 *   - DRY RUN by default. Nothing is written unless you pass --confirm.
 *   - Optional --userId to scope to a single account.
 *   - Sets a terminal status (default 'partial' — honest for "we don't know if
 *     it finished"; override with --status=failed) plus sessionEndTime and an
 *     audit note. Never deletes. Only touches rows still 'in_progress'.
 *
 * Usage:
 *   node server/scripts/closeStaleLoggingSessions.js --userId=<id> --dryRun
 *   node server/scripts/closeStaleLoggingSessions.js --userId=<id> --confirm
 *   node server/scripts/closeStaleLoggingSessions.js --dryRun            # global preview
 *   node server/scripts/closeStaleLoggingSessions.js --maxAgeHours=12 --status=failed --confirm
 */

const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');
const UserAccountLogs = require('../models/system/ErrorLogs.js');

const DB_URI = process.env.DB_URI;
const DB_NAME = process.env.DB_NAME;
const MONGODB_URI =
    DB_URI && DB_NAME
        ? `${DB_URI}/${DB_NAME}`
        : process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/sellerqi';

const VALID_STATUSES = ['failed', 'partial'];

function parseArgs() {
    const args = { dryRun: false, confirm: false, userId: null, maxAgeHours: 6, status: 'partial' };
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
        else if (key === 'status' && VALID_STATUSES.includes(val)) args.status = val;
        else if (key === 'maxAgeHours') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n) && n >= 0) args.maxAgeHours = n;
        }
    });
    return args;
}

async function main() {
    const { dryRun, confirm, userId, maxAgeHours, status } = parseArgs();
    const willWrite = confirm && !dryRun;
    if (!dryRun && !confirm) {
        console.log('No mode passed — defaulting to DRY RUN. Pass --confirm to apply.\n');
    }

    await mongoose.connect(MONGODB_URI);
    console.log(`[CloseStaleSessions] Connected. Mode => ${willWrite ? 'APPLY' : 'DRY RUN'}`);
    console.log(`[CloseStaleSessions] Closing 'in_progress' sessions with no end, older than ${maxAgeHours}h -> '${status}'\n`);

    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    const query = {
        sessionStatus: 'in_progress',
        sessionStartTime: { $lt: cutoff },
        $or: [{ sessionEndTime: null }, { sessionEndTime: { $exists: false } }]
    };
    if (userId) query.userId = userId;

    const total = await UserAccountLogs.countDocuments(query);
    console.log(`[CloseStaleSessions] Matching stale sessions${userId ? ` for user ${userId}` : ' (GLOBAL)'}: ${total}\n`);

    // Preview a sample (avoid dumping tens of thousands of rows)
    const sample = await UserAccountLogs.find(query)
        .sort({ sessionStartTime: -1 })
        .limit(userId ? 100 : 25)
        .select('sessionId userId region country sessionStartTime')
        .lean();
    const now = Date.now();
    sample.forEach((s) => {
        const ageH = ((now - new Date(s.sessionStartTime).getTime()) / 3.6e6).toFixed(1);
        console.log(`  • ${s.sessionId}  (${s.country}-${s.region}, age ${ageH}h)`);
    });
    if (total > sample.length) console.log(`  … and ${total - sample.length} more`);

    if (!willWrite) {
        console.log(`\n[CloseStaleSessions] DRY RUN complete. No sessions modified. Pass --confirm to apply.`);
        await mongoose.disconnect();
        return;
    }

    // Apply. Re-assert sessionStatus:'in_progress' in the filter so a session
    // that legitimately closes between preview and write is never clobbered.
    // NOTE: overallSummary is a numeric object (totalFunctions, successRate, …),
    // so we must NOT overwrite it. We only flip the terminal fields and stamp an
    // audit marker; the run's per-function log entries are left intact.
    const res = await UserAccountLogs.updateMany(
        query,
        [
            {
                $set: {
                    sessionStatus: status,
                    sessionEndTime: '$$NOW',
                    sessionDuration: { $subtract: ['$$NOW', '$sessionStartTime'] },
                    autoClosedStale: true,
                    autoClosedAt: '$$NOW'
                }
            }
        ]
    );

    console.log(`\n[CloseStaleSessions] APPLY complete. Closed ${res.modifiedCount} session(s) -> '${status}'.`);
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('[CloseStaleSessions] Error:', err.message);
    try { await mongoose.disconnect(); } catch (_) { /* noop */ }
    process.exit(1);
});

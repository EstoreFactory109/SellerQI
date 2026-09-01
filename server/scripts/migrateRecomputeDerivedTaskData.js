#!/usr/bin/env node
/**
 * migrateRecomputeDerivedTaskData.js
 *
 * Rolls this branch's task/amount corrections out to every existing account by
 * RECOMPUTING each account's derived data from the raw data already in Mongo.
 *
 * WHY A MIGRATION IS NEEDED AT ALL
 * --------------------------------
 * The fixes are code, so they apply to everything computed from now on — but
 * TaskItem documents are STORED, and a scheduled run only rewrites them at the
 * account's weekly `taskRenewalDate` boundary. In between, a run can only INSERT
 * newly-appeared tasks; the unique index rejects re-inserts, so an existing
 * task's amount/type/renderData is never updated in place. Every task written
 * before this branch therefore keeps its old values for up to a week, and the
 * corrections below simply would not reach it:
 *
 *   - profitability amounts computed while COGS lookups silently missed (the
 *     write path keyed on a currency code, the read paths on a country code)
 *   - low-margin issues stored under the generic 'profitability_issue' type
 *     because the branch compared against a name upstream never emits
 *   - Buy Box amounts holding lost REVENUE where a profit-equivalent is meant
 *   - unfulfillable / stranded stock counted as recoverable profit rather than
 *     capital tied up (no `capitalAmount` field existed yet)
 *   - keyword-level ads issues collapsed onto one row per campaign by a dedup
 *     key that fell through to campaignId, discarding most of them outright
 *   - ads renderData missing `clicks` (rendering "0 clicks") and `campaignId`
 *     (leaving ad waste unattributable to a product)
 *   - long-term storage fees read from snapshots too old to describe today
 *
 * HOW IT AVOIDS CHANGING ANY UNDERLYING DATA
 * ------------------------------------------
 * It does not fabricate or patch values, and it does not re-fetch from Amazon.
 * It replays the SAME code path production uses — AnalyseService.Analyse() then
 * analyseData() — over the raw data already stored. That path is provably
 * read-only apart from the tasks it writes:
 *
 *   - Analyse.js performs no writes and makes no network calls (pure DB reads)
 *   - analyseData()'s only write is the task-creation call
 *
 * So source collections (Seller, EconomicsMetrics, PPCMetrics, BuyBoxData, Cogs,
 * ads reports, finance, inventory …) are never written to. Only the derived
 * artifacts are rebuilt: TaskItem, Task.taskRenewalDate, and — with --ai — the
 * two stored AI views.
 *
 * Seller-owned state is preserved: tasks the seller marked completed or
 * in-progress are captured before the rebuild and reapplied to the matching
 * regenerated tasks afterwards, so a rebuild never silently resets progress.
 * (A normal weekly renewal does drop it; this migration deliberately does not.)
 *
 * MULTI-MARKETPLACE ORDERING
 * --------------------------
 * Tasks are keyed by userId alone, with no country/region, so a user's
 * marketplaces share one task set. This mirrors the scheduled pipeline exactly:
 * the first marketplace performs the full rebuild, and any further marketplaces
 * then only add tasks unique to them. Forcing a rebuild per marketplace would
 * make the last one processed wipe the others.
 *
 * SCOPE
 * -----
 * Accounts are enumerated from Seller.sellerAccount, because recomputing needs a
 * (country, region) to run Analyse against. Tasks belonging to a userId with no
 * seller account left — disconnected or deleted integrations — therefore cannot
 * be recomputed and are deliberately skipped rather than guessed at. They are
 * dead rows that no live account reads; deleting them is a separate decision,
 * not something a recompute should silently make.
 *
 * USAGE
 *   # report what would happen — writes nothing
 *   node server/scripts/migrateRecomputeDerivedTaskData.js
 *
 *   # same, but also rehearse the recompute read-only to prove it succeeds
 *   node server/scripts/migrateRecomputeDerivedTaskData.js --verify --limit=5
 *
 *   # do it
 *   node server/scripts/migrateRecomputeDerivedTaskData.js --apply
 *
 *   # one account, or a slice, or with the AI views regenerated too
 *   node server/scripts/migrateRecomputeDerivedTaskData.js --apply --user-id=<id>
 *   node server/scripts/migrateRecomputeDerivedTaskData.js --apply --limit=20
 *   node server/scripts/migrateRecomputeDerivedTaskData.js --apply --ai
 *
 * FLAGS
 *   --apply            perform writes (default: report only)
 *   --verify           in report mode, rehearse the recompute read-only
 *   --ai               also regenerate the two stored AI views (COSTS OpenAI —
 *                      2 calls per marketplace; off by default, see note below)
 *   --user-id=<id>     restrict to one user
 *   --limit=<n>        process at most n users
 *   --concurrency=<n>  users in parallel (default 1 — Analyse is memory-heavy)
 *   --timeout=<sec>    per-account ceiling (default 900) so one account cannot
 *                      stall the whole run
 *   --state=<path>     resume checkpoint file (default: alongside this script)
 *   --force            ignore the checkpoint and reprocess everything
 *
 * ON --ai: the views regenerate on their own at each account's next task
 * rebuild, which this migration schedules a week out. Skipping --ai therefore
 * costs nothing in correctness (an account with no stored view simply has none
 * until then); passing it makes the views current immediately, for the price of
 * an OpenAI call pair per marketplace.
 */

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
    dbConsts.dbUri && dbConsts.dbName
        ? `${dbConsts.dbUri}/${dbConsts.dbName}`
        : process.env.MONGODB_URI || process.env.MONGO_URI;

const Seller = require('../models/user-auth/sellerCentralModel.js');
const Task = require('../models/MCP/TaskModel.js');
const TaskItem = require('../models/MCP/TaskItemModel.js');

function getArg(name) {
    const m = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return m ? m.split('=')[1].trim() : null;
}
function hasFlag(name) {
    return process.argv.slice(2).includes(`--${name}`);
}

const APPLY = hasFlag('apply');
const VERIFY = hasFlag('verify');
const WITH_AI = hasFlag('ai');
const FORCE = hasFlag('force');
const ONLY_USER = getArg('user-id');
const LIMIT = getArg('limit') ? parseInt(getArg('limit'), 10) : null;
const CONCURRENCY = Math.max(1, parseInt(getArg('concurrency') || '1', 10) || 1);
const TIMEOUT_MS = Math.max(60, parseInt(getArg('timeout') || '900', 10) || 900) * 1000;
const STATE_FILE =
    getArg('state') || path.resolve(__dirname, '.migrateRecomputeDerivedTaskData.state.json');

const log = (...a) => console.log(...a);
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/** Checkpoint so a long run can be resumed after an interruption. */
function loadState() {
    if (FORCE) return { done: [], failed: [] };
    try {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return { done: raw.done || [], failed: raw.failed || [] };
    } catch {
        return { done: [], failed: [] };
    }
}
function saveState(state) {
    if (!APPLY) return; // report mode never writes a checkpoint
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
        log(`  ! could not write checkpoint ${STATE_FILE}: ${e.message}`);
    }
}

/** Reject rather than hang forever on one pathological account. */
function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms / 1000}s`)), ms);
        })
    ]);
}

/** Stored-task shape summary, used for the before/after report. */
async function taskStats(userId) {
    const rows = await TaskItem.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                amount: { $sum: { $ifNull: ['$amount', 0] } },
                capital: { $sum: { $ifNull: ['$capitalAmount', 0] } },
                misrouted: { $sum: { $cond: [{ $eq: ['$errorType', 'profitability_issue'] }, 1, 0] } },
                noCapitalField: { $sum: { $cond: [{ $eq: [{ $type: '$capitalAmount' }, 'missing'] }, 1, 0] } }
            }
        }
    ]);
    return rows[0] || { total: 0, amount: 0, capital: 0, misrouted: 0, noCapitalField: 0 };
}

/**
 * Seller-set task state, keyed the same way the unique index is, so it can be
 * reapplied to the regenerated task carrying the same identity.
 */
async function captureProgress(userId) {
    const rows = await TaskItem.find(
        { userId, status: { $ne: 'pending' } },
        { asin: 1, errorCategory: 1, errorType: 1, status: 1 }
    ).lean();
    return rows.map((r) => ({
        key: { userId, asin: r.asin, errorCategory: r.errorCategory, errorType: r.errorType },
        status: r.status
    }));
}

async function restoreProgress(progress) {
    if (progress.length === 0) return 0;
    const ops = progress.map((p) => ({
        updateOne: { filter: p.key, update: { $set: { status: p.status } } }
    }));
    const res = await TaskItem.bulkWrite(ops, { ordered: false });
    return res.modifiedCount || 0;
}

/**
 * Make the next createTasksFromErrors() take its renewal branch (wipe + fresh
 * insert) instead of the insert-only one. Backdating the existing marker is
 * what the weekly boundary itself does, so no new code path is involved; an
 * account with no marker at all already builds a full set.
 */
async function forceRebuildBranch(userId) {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await Task.updateOne({ userId }, { $set: { taskRenewalDate: past } });
}

/** Recompute one marketplace. Writes tasks only when `persist` is true. */
async function recomputeMarketplace(userId, country, region, persist) {
    const { AnalyseService } = require('../Services/main/Analyse.js');
    const { analyseData } = require('../Services/Calculations/DashboardCalculation.js');

    const analysed = await AnalyseService.Analyse(userId, country, region);
    if (!analysed || analysed.status !== 200 || !analysed.message) {
        throw new Error(`Analyse returned status ${analysed && analysed.status}`);
    }
    // Passing null as the userId computes everything and writes nothing — that is
    // what makes --verify a real rehearsal rather than a guess.
    const result = await analyseData(analysed.message, persist ? userId : null);
    if (!result || !result.dashboardData) throw new Error('analyseData produced no dashboardData');
    return result;
}

async function regenerateAiViews(userId, country, region) {
    const { calculateAndStoreTopOpportunities } = require('../Services/AI/TopOpportunitiesService.js');
    const { calculateAndStoreTopProducts } = require('../Services/AI/TopProductsService.js');
    const out = [];
    for (const step of [
        { name: 'topOpportunities', run: calculateAndStoreTopOpportunities },
        { name: 'topProducts', run: calculateAndStoreTopProducts }
    ]) {
        try {
            // 0 waives the service throttle: the tasks underneath just changed,
            // which is exactly the case its "nothing changed recently" premise
            // does not cover.
            const r = await step.run(userId, country, region, 'migration', { minIntervalHours: 0 });
            out.push(`${step.name}=${r && r.success ? 'ok' : 'failed'}`);
        } catch (e) {
            out.push(`${step.name}=error(${e.message})`);
        }
    }
    return out.join(' ');
}

async function processUser(account, index, total) {
    const { userId, marketplaces } = account;
    const label = `[${index}/${total}] ${userId}`;
    const started = Date.now();

    const before = await taskStats(userId);
    const places = marketplaces.map((m) => `${m.country}-${m.region}`).join(', ');
    log(`${label} ${marketplaces.length} marketplace(s): ${places}`);
    log(
        `${label}   before: ${before.total} tasks, raw amount sum ${money(before.amount)}, ` +
            `capital ${money(before.capital)}, misrouted ${before.misrouted}, ` +
            `missing capitalAmount ${before.noCapitalField}`
    );

    if (!APPLY) {
        if (VERIFY) {
            // Read-only rehearsal on the primary marketplace.
            const m = marketplaces[0];
            const r = await withTimeout(
                recomputeMarketplace(userId, m.country, m.region, false),
                TIMEOUT_MS,
                'verify'
            );
            const dd = r.dashboardData;
            log(
                `${label}   verify: recompute OK — ${(dd.TotalProduct || []).length} products, ` +
                    `${dd.totalProfitabilityErrors || 0} profitability / ` +
                    `${dd.totalSponsoredAdsErrors || 0} ads issues (nothing written)`
            );
        }
        return { userId, ok: true, skipped: 'report-only' };
    }

    const progress = await captureProgress(userId);
    if (progress.length > 0) log(`${label}   preserving ${progress.length} seller-set task status(es)`);

    // Only the first marketplace rebuilds; the rest add, mirroring production.
    await forceRebuildBranch(userId);
    for (let i = 0; i < marketplaces.length; i++) {
        const m = marketplaces[i];
        await withTimeout(
            recomputeMarketplace(userId, m.country, m.region, true),
            TIMEOUT_MS,
            `recompute ${m.country}-${m.region}`
        );
    }

    const restored = await restoreProgress(progress);
    if (progress.length > 0) log(`${label}   restored ${restored} task status(es)`);

    if (WITH_AI) {
        for (const m of marketplaces) {
            const r = await regenerateAiViews(userId, m.country, m.region);
            log(`${label}   ai ${m.country}-${m.region}: ${r}`);
        }
    }

    const after = await taskStats(userId);
    log(
        `${label}   after:  ${after.total} tasks, raw amount sum ${money(after.amount)}, ` +
            `capital ${money(after.capital)}, misrouted ${after.misrouted} ` +
            `(${((Date.now() - started) / 1000).toFixed(1)}s)`
    );
    return { userId, ok: true, before, after };
}

/** Fixed-size worker pool; Analyse is memory-heavy so the default is serial. */
async function runPool(items, size, worker) {
    const results = [];
    let cursor = 0;
    const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            results[i] = await worker(items[i], i + 1, items.length);
        }
    });
    await Promise.all(runners);
    return results;
}

async function main() {
    if (!MONGODB_URI) throw new Error('No Mongo URI configured');
    await mongoose.connect(MONGODB_URI);

    log('='.repeat(78));
    log(`Recompute derived task data — ${APPLY ? 'APPLY (writing)' : 'REPORT ONLY (no writes)'}`);
    log(`concurrency=${CONCURRENCY} timeout=${TIMEOUT_MS / 1000}s ai=${WITH_AI ? 'on' : 'off'}`);
    log('='.repeat(78));

    // One entry per user, carrying that user's marketplaces in a stable order.
    const tuples = await Seller.aggregate([
        { $unwind: '$sellerAccount' },
        {
            $group: {
                _id: '$User',
                marketplaces: {
                    $addToSet: { country: '$sellerAccount.country', region: '$sellerAccount.region' }
                }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    let accounts = tuples
        .filter((t) => t._id)
        .map((t) => ({
            userId: String(t._id),
            marketplaces: (t.marketplaces || [])
                .filter((m) => m && m.country && m.region)
                .sort((a, b) => `${a.country}${a.region}`.localeCompare(`${b.country}${b.region}`))
        }))
        .filter((a) => a.marketplaces.length > 0);

    if (ONLY_USER) accounts = accounts.filter((a) => a.userId === ONLY_USER);

    const state = loadState();
    const doneSet = new Set(state.done);
    const pending = accounts.filter((a) => !doneSet.has(a.userId));
    const selected = LIMIT ? pending.slice(0, LIMIT) : pending;

    log(`${accounts.length} account(s) in scope, ${doneSet.size} already done, processing ${selected.length}`);
    if (!APPLY) log('Nothing will be written. Re-run with --apply to perform the migration.\n');
    else log(`Checkpoint: ${STATE_FILE}\n`);

    const failures = [];
    const results = await runPool(selected, CONCURRENCY, async (account, i, total) => {
        try {
            const r = await processUser(account, i, total);
            if (APPLY) {
                state.done.push(account.userId);
                state.failed = state.failed.filter((f) => f !== account.userId);
                saveState(state);
            }
            return r;
        } catch (e) {
            log(`[${i}/${total}] ${account.userId}   FAILED: ${e.message}`);
            failures.push({ userId: account.userId, error: e.message });
            if (APPLY) {
                if (!state.failed.includes(account.userId)) state.failed.push(account.userId);
                saveState(state);
            }
            return { userId: account.userId, ok: false, error: e.message };
        }
    });

    const okResults = results.filter((r) => r && r.ok && r.before && r.after);
    log('\n' + '='.repeat(78));
    log(`Processed ${results.length}, succeeded ${results.filter((r) => r && r.ok).length}, failed ${failures.length}`);
    if (okResults.length > 0) {
        const sum = (k, f) => okResults.reduce((s, r) => s + (r[f][k] || 0), 0);
        log(
            `Tasks     ${sum('total', 'before')} -> ${sum('total', 'after')}   ` +
                `Raw amount sum ${money(sum('amount', 'before'))} -> ${money(sum('amount', 'after'))}   ` +
                `Capital ${money(sum('capital', 'before'))} -> ${money(sum('capital', 'after'))}`
        );
        log(`Misrouted 'profitability_issue' rows: ${sum('misrouted', 'before')} -> ${sum('misrouted', 'after')}`);
    }
    if (failures.length > 0) {
        log('\nFailed accounts (safe to re-run — the checkpoint skips the ones that succeeded):');
        failures.forEach((f) => log(`  ${f.userId}: ${f.error}`));
    }
    log('='.repeat(78));

    await mongoose.disconnect();
    process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(async (e) => {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
});

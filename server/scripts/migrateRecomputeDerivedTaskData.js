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
 * WHAT GETS RECOMPUTED (stages)
 * -----------------------------
 * The corrections touch more than tasks, because several surfaces persist their
 * own copy of the same computed numbers:
 *
 *   tasks     TaskItem + Task.taskRenewalDate — the Tasks page, and everything
 *             derived from it (Dashboard top fixes, Top Products to Fix, and
 *             QMate's strategy answers, which read tasks live).
 *   issues    IssuesDataChunks + IssueSummary — the Issues pages. These store
 *             profitabilityErrorDetails / sponsoredAdsErrorDetails /
 *             conversion / inventory error arrays, which carry the same
 *             netProfit, profitMargin, errorType and ads fields the fixes
 *             changed (stored details currently have no `clicks`, and
 *             low-margin rows still land under the generic type).
 *   products  Seller.sellerAccount.products.issueCount — the per-product issue
 *             badge. Worth knowing: this is the one stage that writes into a
 *             collection that also holds Amazon's own product facts. It sets
 *             issueCount / issueCountUpdatedAt and nothing else; asin, sku,
 *             price, status, quantity and itemName are left exactly as found.
 *   ai        TopOpportunities + TopProducts, the two stored AI views. This is
 *             the only stage with a bill attached: a pair of OpenAI calls per
 *             marketplace (~480 across the current 241 marketplaces).
 *
 * Surfaces that need NO migration, because they compute live per request and so
 * are already correct the moment the code and the tasks are: the Dashboard's
 * High-impact / Quick-wins bucketing, the per-ASIN sales fallback on the
 * Your Products tabs, the PPC Campaign Audit figures, and QMate's answers
 * (GeneralStrategyEngine persists nothing — it reads tasks at question time).
 *
 * All four run by default, so one pass leaves every stored surface consistent
 * with the others. Narrow it with --stages when you want less — e.g.
 * --stages=tasks,issues skips the stage that writes outside the task/issue
 * collections and the one that costs money.
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
 *   # one account, or a slice
 *   node server/scripts/migrateRecomputeDerivedTaskData.js --apply --user-id=<id>
 *   node server/scripts/migrateRecomputeDerivedTaskData.js --apply --limit=20
 *
 *   # narrow the stages (all four run by default)
 *   node server/scripts/migrateRecomputeDerivedTaskData.js --apply --stages=tasks
 *   node server/scripts/migrateRecomputeDerivedTaskData.js --apply --stages=tasks,issues
 *
 * FLAGS
 *   --apply            perform writes (default: report only)
 *   --verify           in report mode, rehearse the recompute read-only
 *   --stages=<list>    comma-separated subset of tasks,issues,products,ai
 *                      (default: all four — see the stage table above)
 *   --user-id=<id>     restrict to one user, or a comma-separated list of users
 *   --limit=<n>        process at most n users
 *   --concurrency=<n>  users in parallel (default 1 — Analyse is memory-heavy)
 *   --timeout=<sec>    per-account ceiling (default 900) so one account cannot
 *                      stall the whole run
 *   --state=<path>     resume checkpoint file (default: alongside this script)
 *   --force            ignore the checkpoint and reprocess everything
 *
 * ON THE ai STAGE: it runs by default so the stored views describe the tasks
 * this migration just rebuilt, rather than trailing them. If you would rather
 * not pay for that, --stages=tasks,issues,products skips it and each account
 * regenerates its own views for free at its next weekly task rebuild.
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
const VALID_STAGES = ['tasks', 'issues', 'products', 'ai'];
const STAGES = (getArg('stages') || VALID_STAGES.join(','))
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const badStage = STAGES.find((x) => !VALID_STAGES.includes(x));
if (badStage) {
    console.error(`Unknown stage "${badStage}". Valid: ${VALID_STAGES.join(', ')}`);
    process.exit(2);
}
const wants = (stage) => STAGES.includes(stage);
const FORCE = hasFlag('force');
const ONLY_USERS = (getArg('user-id') || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
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

/**
 * Recompute one marketplace and hand back the dashboardData.
 * Tasks are written only when `persistTasks` is true; passing null as the
 * userId is what makes a read-only rehearsal possible.
 */
async function recomputeMarketplace(userId, country, region, persistTasks) {
    const { AnalyseService } = require('../Services/main/Analyse.js');
    const { analyseData } = require('../Services/Calculations/DashboardCalculation.js');

    const analysed = await AnalyseService.Analyse(userId, country, region);
    if (!analysed || analysed.status !== 200 || !analysed.message) {
        throw new Error(`Analyse returned status ${analysed && analysed.status}`);
    }
    // `persistTasks: false` computes everything and writes nothing — that is what
    // makes --verify a real rehearsal. The userId is still passed, because it is
    // also what lets analyseData read the account's live per-ASIN finance; nulling
    // it to suppress writes would quietly compute profitability against zero sales.
    const result = await analyseData(analysed.message, userId, { persistTasks });
    if (!result || !result.dashboardData) throw new Error('analyseData produced no dashboardData');
    return result;
}

/**
 * Rewrite the Issues-page artifacts from an already-computed dashboardData.
 *
 * Each of these services also has a calculateAndStoreX() that re-runs Analyse
 * itself; reusing the dashboardData we already have keeps it at one Analyse per
 * marketplace instead of four, and guarantees every surface is written from one
 * consistent computation rather than four separate ones.
 */
async function storeIssueArtifacts(userId, country, region, dashboardData) {
    const out = [];

    if (wants('issues')) {
        const { storeIssuesDataFromDashboard } = require('../Services/Calculations/IssuesDataService.js');
        const { storeIssueSummaryFromDashboardData } = require('../Services/Calculations/IssueSummaryService.js');
        for (const step of [
            { name: 'issuesData', run: storeIssuesDataFromDashboard },
            { name: 'issueSummary', run: storeIssueSummaryFromDashboardData }
        ]) {
            try {
                const r = await step.run(userId, country, region, dashboardData, 'migration');
                out.push(`${step.name}=${r && r.success === false ? 'failed' : 'ok'}`);
            } catch (e) {
                out.push(`${step.name}=error(${e.message})`);
            }
        }
    }

    // Separate stage: this one writes issueCount onto the Seller document.
    if (wants('products')) {
        const { storeProductIssuesFromDashboardData } = require('../Services/Calculations/ProductIssuesService.js');
        try {
            const r = await storeProductIssuesFromDashboardData(userId, country, region, dashboardData, 'migration');
            out.push(`productIssues=${r && r.success === false ? 'failed' : 'ok'}`);
        } catch (e) {
            out.push(`productIssues=error(${e.message})`);
        }
    }

    return out.join(' ');
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

    const doTasks = wants('tasks');
    const progress = doTasks ? await captureProgress(userId) : [];
    if (progress.length > 0) log(`${label}   preserving ${progress.length} seller-set task status(es)`);

    // Only the first marketplace rebuilds tasks; the rest add, mirroring production.
    if (doTasks) await forceRebuildBranch(userId);

    for (const m of marketplaces) {
        const result = await withTimeout(
            recomputeMarketplace(userId, m.country, m.region, doTasks),
            TIMEOUT_MS,
            `recompute ${m.country}-${m.region}`
        );
        // Reuses the dashboardData just computed — no second Analyse.
        const stored = await storeIssueArtifacts(userId, m.country, m.region, result.dashboardData);
        if (stored) log(`${label}   ${m.country}-${m.region}: ${stored}`);
    }

    if (doTasks) {
        const restored = await restoreProgress(progress);
        if (progress.length > 0) log(`${label}   restored ${restored} task status(es)`);
    }

    if (wants('ai')) {
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
    log(`stages=${STAGES.join(',')} concurrency=${CONCURRENCY} timeout=${TIMEOUT_MS / 1000}s`);
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

    if (ONLY_USERS.length > 0) accounts = accounts.filter((a) => ONLY_USERS.includes(a.userId));

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

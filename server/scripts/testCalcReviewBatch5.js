#!/usr/bin/env node
/**
 * testCalcReviewBatch5.js
 *
 * Reproduces, locally and read-only, the OTHER half of the `sched_calc_review` stall — the
 * batch-5 calculation half that PR #32 addressed — so it can be verified without waiting on
 * a production run.
 *
 * WHAT WENT WRONG, AND WHAT THIS MEASURES
 * The three batch-5 services (issueSummary, productIssues, issuesData) each used to run the
 * FULL pipeline themselves — `AnalyseService.Analyse()` then `analyseData()` — and their
 * promises were created eagerly, so all three ran CONCURRENTLY. On 2026-09-01 one PRO
 * account's newest sponsored-ads batch reached 234,035 rows / 102 MB of legitimate 30-day
 * data — roughly 300-400 MB per copy as lean JS objects. Three concurrent copies plus the
 * other ~24 collections exceeded the 1536 MB heap cap, the worker GC-thrashed,
 * `fetchAllDataModels` never returned, and BullMQ stall-reclaimed the job every 20 minutes
 * forever. That account had not completed a run in over a week.
 *
 * The fix memoises the computation so all three services observe ONE object
 * (ScheduledIntegration.js:1050-1081) and replaces the 234k-row scan with aggregation.
 *
 * So the thing to measure is not "does it work" but "does it still take three copies":
 *
 *   --mode=legacy   three CONCURRENT Analyse+analyseData copies (pre-#32 behaviour)
 *   --mode=fixed    ONE shared computation, memoised (what the code does now)
 *
 * Run both under production's heap cap. `legacy` is expected to thrash or die on a heavy
 * account; `fixed` is expected to finish. If BOTH finish comfortably, the account you picked
 * is not heavy enough to reproduce the bug — use --list-heavy to find one that is.
 *
 * READ-ONLY BY DEFAULT. Nothing is written unless you pass --store, which additionally runs
 * the three storers. Point this at a local DB or a restored dump; the banner prints the host
 * it connected to before doing anything.
 *
 * USAGE
 *   # 1. Which accounts are heavy enough to reproduce this?
 *   node server/scripts/testCalcReviewBatch5.js --list-heavy
 *
 *   # 2. Reproduce the old failure (expect thrash / OOM on a heavy account)
 *   node --max-old-space-size=1536 server/scripts/testCalcReviewBatch5.js \
 *        --user-id=<mongoId> --country=US --region=NA --mode=legacy
 *
 *   # 3. Show the fix holds on the same account
 *   node --max-old-space-size=1536 server/scripts/testCalcReviewBatch5.js \
 *        --user-id=<mongoId> --country=US --region=NA --mode=fixed
 *
 * The --max-old-space-size=1536 is not optional garnish: it is the worker's real cap
 * (ecosystem.config.js). Without it a dev machine's default heap can be several GB and the
 * legacy path will happily succeed, proving nothing.
 */

const path = require('path');
const v8 = require('v8');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
    dbConsts.dbUri && dbConsts.dbName
        ? `${dbConsts.dbUri}/${dbConsts.dbName}`
        : process.env.MONGODB_URI || process.env.MONGO_URI;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const USER_ID = opt('user-id');
const COUNTRY = opt('country', 'US');
const REGION = opt('region', 'NA');
const MODE = opt('mode', 'fixed');
const STORE = flag('store');
const LIST_HEAVY = flag('list-heavy');
const HEAVY_LIMIT = parseInt(opt('limit', '15'), 10) || 15;

const MB = 1024 * 1024;
const mb = (bytes) => `${(bytes / MB).toFixed(0)} MB`;
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

// ---------------------------------------------------------------------------
// measurement
// ---------------------------------------------------------------------------

/**
 * Samples memory on a timer while the work runs.
 *
 * The interesting number is not peak memory alone but `maxGapMs` — how long the sampler
 * went without being scheduled. A 250ms timer that misses by tens of seconds means the
 * event loop was blocked, which is what GC thrash looks like from the inside and is the
 * symptom that made BullMQ reclaim the job as stalled.
 */
function startProbe(intervalMs = 250) {
    const state = { peakRss: 0, peakHeap: 0, samples: 0, maxGapMs: 0, last: Date.now() };
    const timer = setInterval(() => {
        const now = Date.now();
        const gap = now - state.last - intervalMs;
        if (gap > state.maxGapMs) state.maxGapMs = gap;
        state.last = now;
        const m = process.memoryUsage();
        if (m.rss > state.peakRss) state.peakRss = m.rss;
        if (m.heapUsed > state.peakHeap) state.peakHeap = m.heapUsed;
        state.samples++;
    }, intervalMs);
    timer.unref();
    return { state, stop: () => clearInterval(timer) };
}

// ---------------------------------------------------------------------------
// the work under test
// ---------------------------------------------------------------------------

/** Exactly what getSharedDashboardData() does — one full Analyse + DashboardCalculation. */
async function computeDashboardData(userId, country, region) {
    const { AnalyseService } = require('../Services/main/Analyse.js');
    const { analyseData } = require('../Services/Calculations/DashboardCalculation.js');

    const analyse = await AnalyseService.Analyse(userId, country, region);
    if (!analyse || analyse.status !== 200 || !analyse.message) {
        throw new Error(`Failed to get analyse data: status ${analyse?.status}`);
    }
    const calculationResult = await analyseData(analyse.message, userId);
    if (!calculationResult?.dashboardData) {
        throw new Error('Failed to calculate dashboard data');
    }
    return calculationResult.dashboardData;
}

/** The three storers, same signature and order the pipeline uses. WRITES. */
async function runStorers(userId, country, region, dd) {
    const storers = {
        issueSummary: () => require('../Services/Calculations/IssueSummaryService.js')
            .storeIssueSummaryFromDashboardData(userId, country, region, dd, 'schedule'),
        productIssues: () => require('../Services/Calculations/ProductIssuesService.js')
            .storeProductIssuesFromDashboardData(userId, country, region, dd, 'schedule'),
        issuesData: () => require('../Services/Calculations/IssuesDataService.js')
            .storeIssuesDataFromDashboard(userId, country, region, dd, 'schedule'),
    };
    const out = {};
    for (const [name, fn] of Object.entries(storers)) {
        const t0 = Date.now();
        try {
            await fn();
            out[name] = `ok (${secs(Date.now() - t0)})`;
        } catch (err) {
            out[name] = `FAILED: ${err.message}`;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// how heavy is this account?
// ---------------------------------------------------------------------------

/**
 * Rows and estimated bytes in the account's newest sponsored-ads batch — the input that
 * decides whether this account can reproduce the bug at all.
 */
async function profileAdsBatch(userId, country, region) {
    const Item = require('../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
    const meta = await Item.findLatestBatchMeta(userId, country, region);
    if (!meta.batchId) return { rows: 0, batchId: null, createdAt: null, estBytes: 0 };

    const rows = await Item.countDocuments({ batchId: meta.batchId });
    // Average document size from a bounded sample, extrapolated. A full $bsonSize pass over
    // 234k rows is exactly the kind of scan this script exists to avoid provoking.
    const sample = await Item.aggregate([
        { $match: { batchId: meta.batchId } },
        { $limit: 1000 },
        { $group: { _id: null, avg: { $avg: { $bsonSize: '$$ROOT' } } } },
    ]).allowDiskUse(true);
    const avg = sample[0]?.avg || 0;
    return { rows, batchId: meta.batchId, createdAt: meta.createdAt, estBytes: Math.round(rows * avg) };
}

/** Rank every connected account by newest-batch row count, heaviest first. */
async function listHeavyAccounts() {
    const Seller = require('../models/user-auth/sellerCentralModel.js');
    const sellers = await Seller.find(
        {},
        { User: 1, 'sellerAccount.country': 1, 'sellerAccount.region': 1 }
    ).lean();

    const rowsFor = [];
    for (const s of sellers) {
        if (!s?.User || !Array.isArray(s.sellerAccount)) continue;
        for (const a of s.sellerAccount) {
            if (!a?.country || !a?.region) continue;
            try {
                const p = await profileAdsBatch(s.User, a.country, a.region);
                if (p.rows > 0) {
                    rowsFor.push({ userId: String(s.User), country: a.country, region: a.region, ...p });
                }
            } catch (_) { /* an account we cannot profile is not the one we are hunting */ }
        }
    }

    rowsFor.sort((x, y) => y.rows - x.rows);
    console.log(`\nHeaviest sponsored-ads batches (${rowsFor.length} accounts with data):\n`);
    console.log('  rows      est. size   account');
    console.log('  --------  ----------  -------------------------------------------');
    for (const r of rowsFor.slice(0, HEAVY_LIMIT)) {
        console.log(
            `  ${String(r.rows).padStart(8)}  ${mb(r.estBytes).padStart(10)}  ` +
            `--user-id=${r.userId} --country=${r.country} --region=${r.region}`
        );
    }
    console.log(
        '\nThe 2026-09-01 failure was 234,035 rows / 102 MB. Anything near that should\n' +
        'reproduce under --mode=legacy with a 1536 MB heap; a few thousand rows will not.\n'
    );
}

// ---------------------------------------------------------------------------

async function main() {
    const heapLimit = v8.getHeapStatistics().heap_size_limit;

    // Read the flag rather than infer it from heap_size_limit: V8 reports a limit that
    // includes semi-space and other overhead (--max-old-space-size=1536 shows as ~1728 MB),
    // so any threshold on that number either misses real misconfigurations or nags at
    // correct ones.
    const oldSpaceFlag = [...process.execArgv, ...(process.env.NODE_OPTIONS || '').split(/\s+/)]
        .map((a) => (a.match(/^--max-old-space-size=(\d+)$/) || [])[1])
        .filter(Boolean)
        .map(Number)
        .pop();

    console.log('\n' + '='.repeat(76));
    console.log('  calc_review batch-5 reproduction — READ-ONLY' + (STORE ? ' … except --store is ON (WRITES)' : ''));
    console.log('='.repeat(76));
    console.log(`  database   ${String(MONGODB_URI).replace(/\/\/[^@]*@/, '//<credentials>@')}`);
    console.log(`  heap cap   ${mb(heapLimit)}` +
        (oldSpaceFlag ? `  (--max-old-space-size=${oldSpaceFlag})` : '  (no --max-old-space-size set)'));

    if (!oldSpaceFlag || oldSpaceFlag > 1536) {
        console.log(
            `\n  ⚠  ${oldSpaceFlag ? `Old-space cap is ${oldSpaceFlag} MB, above` : 'No old-space cap set, so this machine\'s default applies instead of'}` +
            ' the worker\'s 1536 MB.\n' +
            '     The legacy path will probably succeed here and prove nothing. Re-run with:\n' +
            '       node --max-old-space-size=1536 ' + path.relative(process.cwd(), __filename) + ' ...'
        );
    }
    if (STORE) {
        console.log('\n  ⚠  --store is set: the three calculation storers WILL write to this database.');
    }
    console.log('');

    // Validate before connecting, so a typo costs nothing and the script is runnable
    // without a database when you only want to check the invocation.
    if (!LIST_HEAVY && !USER_ID) {
        console.error('  --user-id is required (or use --list-heavy to find a candidate).\n');
        process.exitCode = 2;
        return;
    }
    if (!LIST_HEAVY && !['legacy', 'fixed'].includes(MODE)) {
        console.error(`  --mode must be "legacy" or "fixed", got "${MODE}".\n`);
        process.exitCode = 2;
        return;
    }
    if (!MONGODB_URI) {
        console.error('  No database URI. Set MONGODB_URI (or dbUri/dbName in .env).\n');
        process.exitCode = 2;
        return;
    }

    // Fail fast rather than sitting on the default 30s selection timeout: this is a CLI
    // tool, and "the DB is unreachable" should be an immediate answer.
    await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 60000,
        socketTimeoutMS: 600000,
    });

    if (LIST_HEAVY) {
        await listHeavyAccounts();
        return;
    }

    const profile = await profileAdsBatch(USER_ID, COUNTRY, REGION);
    console.log(`  account    ${USER_ID}  ${COUNTRY}/${REGION}`);
    console.log(`  ads batch  ${profile.rows.toLocaleString()} rows, ~${mb(profile.estBytes)}` +
        (profile.createdAt ? `, newest ${new Date(profile.createdAt).toISOString()}` : ''));
    if (profile.rows < 50000) {
        console.log('             (well under the 234k rows that caused the failure — a "pass" here');
        console.log('              is weak evidence. Use --list-heavy to find a heavier account.)');
    }
    console.log(`  mode       ${MODE}${MODE === 'legacy' ? '  — 3 CONCURRENT copies, the pre-#32 behaviour' : '  — 1 shared computation, memoised'}`);
    console.log('');

    const probe = startProbe();
    const t0 = Date.now();
    let outcome = 'completed';
    let error = null;
    let storerResults = null;

    try {
        if (MODE === 'legacy') {
            // Three concurrent full computations — what the three services each used to do.
            const [dd] = await Promise.all([
                computeDashboardData(USER_ID, COUNTRY, REGION),
                computeDashboardData(USER_ID, COUNTRY, REGION),
                computeDashboardData(USER_ID, COUNTRY, REGION),
            ]);
            if (STORE) storerResults = await runStorers(USER_ID, COUNTRY, REGION, dd);
        } else {
            const dd = await computeDashboardData(USER_ID, COUNTRY, REGION);
            if (STORE) storerResults = await runStorers(USER_ID, COUNTRY, REGION, dd);
        }
    } catch (err) {
        outcome = 'FAILED';
        error = err;
    }

    const elapsed = Date.now() - t0;
    probe.stop();
    const { peakRss, peakHeap, maxGapMs } = probe.state;

    console.log('  ' + '-'.repeat(72));
    console.log(`  outcome            ${outcome}${error ? `: ${error.message}` : ''}`);
    console.log(`  wall time          ${secs(elapsed)}`);
    console.log(`  peak heap used     ${mb(peakHeap)}  of ${mb(heapLimit)} cap`);
    console.log(`  peak RSS           ${mb(peakRss)}`);
    console.log(`  max event-loop gap ${secs(maxGapMs)}`);
    if (storerResults) {
        console.log('  storers            ' + JSON.stringify(storerResults));
    }
    console.log('  ' + '-'.repeat(72));

    // A verdict, so the numbers do not have to be interpreted from scratch each time.
    const thrashed = maxGapMs > 5000;
    const nearCap = peakHeap > heapLimit * 0.85;
    if (outcome === 'FAILED') {
        console.log(`\n  ${MODE === 'legacy'
            ? 'Expected: this is the failure PR #32 fixed. Now run --mode=fixed on this same account.'
            : 'NOT expected. The fixed path failed — this is a real regression, capture the error above.'}`);
    } else if (thrashed || nearCap) {
        console.log(`\n  Completed, but under stress (${thrashed ? `event loop blocked ${secs(maxGapMs)}` : ''}` +
            `${thrashed && nearCap ? ', ' : ''}${nearCap ? `heap reached ${mb(peakHeap)} of ${mb(heapLimit)}` : ''}).`);
        console.log('  In production BullMQ reclaims a job whose worker stalls for 20 minutes, so');
        console.log('  "slow but finished" here can still be "reclaimed forever" there.');
    } else {
        console.log(`\n  Clean run: ${secs(elapsed)}, peak heap ${mb(peakHeap)}, no event-loop stall.`);
        if (MODE === 'fixed' && profile.rows >= 50000) {
            console.log('  On an account this size that is the fix working. Compare against --mode=legacy.');
        }
    }
    console.log('');
}

main()
    .catch((err) => {
        console.error('\n  Script failed:', err?.stack || err?.message || err, '\n');
        process.exitCode = 1;
    })
    .finally(async () => {
        try { await mongoose.disconnect(); } catch (_) {}
    });

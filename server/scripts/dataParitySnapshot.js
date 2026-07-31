#!/usr/bin/env node
/**
 * dataParitySnapshot.js
 *
 * Verifies the "same data" guarantee of the cost-reduction changes (P1/P3/P4/P6/P7)
 * by snapshotting the collections the daily pipeline writes for ONE account, so you
 * can compare BEFORE vs AFTER a full daily cycle and confirm the values are identical.
 *
 * It normalises out per-run/volatile fields (_id, __v, timestamps, runId, batchId, …)
 * so the comparison reflects the actual fetched/derived DATA, not incidental churn, and
 * prints a stable SHA-256 per collection plus document counts.
 *
 * WORKFLOW (run in an env with DB access — staging or a controlled account):
 *   1. On the CURRENT (pre-change) code, run a daily cycle for a test account, then:
 *        node server/scripts/dataParitySnapshot.js --user-id=<id> --country=US --region=NA \
 *          --out=/tmp/parity.before.json
 *   2. Deploy the changes, run the SAME account's daily cycle again, then:
 *        node server/scripts/dataParitySnapshot.js --user-id=<id> --country=US --region=NA \
 *          --out=/tmp/parity.after.json
 *   3. Diff:
 *        node server/scripts/dataParitySnapshot.js --diff --before=/tmp/parity.before.json \
 *          --after=/tmp/parity.after.json
 *      Identical per-collection hashes ⇒ same data. Any mismatch is reported with a
 *      small sample of differing document keys.
 *
 * Notes:
 *   - The pipeline upserts by natural keys, so re-running the same day is idempotent —
 *     that is what makes before/after comparable.
 *   - Use --days=N to restrict date-scoped collections (ads/finance) to the last N days
 *     (default: all). Keep it the same for before and after. --days is WALL-CLOCK relative, so
 *     take both snapshots on the same UTC day — straddling UTC midnight shifts the window and
 *     reports a mismatch that isn't real.
 *   - This script is READ-ONLY against the DB.
 *   - Coverage: ads (PPCMetrics, ProductWiseSponsoredAdsItem), DashboardSlice, and the finance
 *     collections (AsinWiseSalesDateItem, DailySkuFinance, DailyOverheadFinance, FinanceSyncLog,
 *     PendingExpenseOrder). The four finance-dashboard collections were added later — before that
 *     this script could report parity while being blind to every collection a finance change
 *     writes. `server/__tests__/scripts/dataParitySnapshot.test.js` locks the registry so that
 *     blind spot cannot come back.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// ---- args ----------------------------------------------------------------
function arg(name, def = undefined) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    if (hit) return hit.split('=').slice(1).join('=');
    return process.argv.includes(`--${name}`) ? true : def;
}

const DIFF_MODE = !!arg('diff', false);

// Fields that legitimately change every run — excluded from the parity comparison.
const VOLATILE_FIELDS = new Set([
    '_id', '__v', 'createdAt', 'updatedAt', 'runId', 'batchId', 'jobId',
    'syncedAt', 'lastSyncedAt', 'processedAt', 'fetchedAt', 'expiresAt',
]);

/**
 * @param {Set<string>} [extra] Per-collection volatile fields, on top of VOLATILE_FIELDS. Needed
 *   for working queues like PendingExpenseOrder whose bookkeeping columns (`attempts`) legitimately
 *   change on a re-run — without this they read as a data mismatch when nothing is actually wrong.
 */
function stripVolatile(obj, extra = null) {
    if (Array.isArray(obj)) return obj.map((v) => stripVolatile(v, extra));
    if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
        const out = {};
        for (const k of Object.keys(obj).sort()) {
            if (VOLATILE_FIELDS.has(k)) continue;
            if (extra && extra.has(k)) continue;
            out[k] = stripVolatile(obj[k], extra);
        }
        return out;
    }
    return obj;
}

function stableStringify(v) {
    return JSON.stringify(v, (key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
            return Object.keys(val).sort().reduce((acc, k) => { acc[k] = val[k]; return acc; }, {});
        }
        return val;
    });
}

// ---- collection registry -------------------------------------------------
// Each entry knows its model and how to filter by (userId, country, region).
// A "keyOf" produces a stable natural key per doc so diffs can be aligned.
function buildCollections() {
    const list = [
        {
            name: 'PPCMetrics',
            modelPath: '../models/amazon-ads/PPCMetricsModel.js',
            filter: (uid, c, r) => ({ userId: String(uid), country: c, region: r }),
            dateField: 'metricDate',
            keyOf: (d) => `${d.metricDate}`,
        },
        {
            name: 'ProductWiseSponsoredAdsItem',
            modelPath: '../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js',
            filter: (uid, c, r) => ({ userId: String(uid), country: c, region: r }),
            dateField: 'date',
            keyOf: (d) => `${d.date}|${d.adType || ''}|${d.asin || d.sku || ''}`,
        },
        {
            name: 'DashboardSlice',
            modelPath: '../models/dashboard/DashboardSliceModel.js',
            filter: (uid, c, r) => ({ userId: String(uid), country: c, region: r }),
            dateField: null,
            keyOf: (d) => `${d.sliceKey}`,
        },
        {
            name: 'AsinWiseSalesDateItem',
            modelPath: '../models/finance/AsinWiseSalesDateItemModel.js',
            filter: (uid, c, r) => ({ User: uid, country: c, region: r }),
            dateField: 'date',
            keyOf: (d) => `${d.date}|${d.asin || d.sku || ''}`,
        },

        // ── Finance dashboard collections ────────────────────────────────────────────────────
        // These are the collections the finance sync actually writes, and they were MISSING here.
        // Without them this script reported "✅ Data parity confirmed" while saying nothing at all
        // about the data a finance change touches — a false pass, which is worse than no check.
        //
        // They filter on `User` (ObjectId) rather than `userId` (String), and FinanceService stores
        // `country` upper-cased, so normalise it here — a `--country=us` would otherwise match zero
        // documents and hash two empty sets to "identical".
        {
            name: 'DailySkuFinance',
            modelPath: '../models/finance/DailySkuFinanceModel.js',
            filter: (uid, c, r) => ({ User: uid, country: String(c).toUpperCase(), region: r }),
            dateField: 'date',
            keyOf: (d) => `${d.date}|${d.sku || ''}|${d.asin || ''}`,
        },
        {
            name: 'DailyOverheadFinance',
            modelPath: '../models/finance/DailyOverheadFinanceModel.js',
            filter: (uid, c, r) => ({ User: uid, country: String(c).toUpperCase(), region: r }),
            dateField: 'date',
            keyOf: (d) => `${d.date}|${d.category || ''}`,
        },
        {
            name: 'FinanceSyncLog',
            modelPath: '../models/finance/FinanceSyncLogModel.js',
            filter: (uid, c, r) => ({ User: uid, country: String(c).toUpperCase(), region: r }),
            dateField: 'date',
            keyOf: (d) => `${d.date}`,
            // `syncRunId` identifies WHICH run wrote a day (the async idempotency marker). It is
            // expected to change between two runs of the same window and says nothing about whether
            // the DATA matches, so it must not count as a diff.
            ignoreFields: ['syncRunId'],
        },
        {
            name: 'PendingExpenseOrder',
            modelPath: '../models/finance/PendingExpenseOrderModel.js',
            filter: (uid, c, r) => ({ User: uid, country: String(c).toUpperCase(), region: r }),
            dateField: 'purchasePacificDate',
            // Unique on (User, country, region, orderId, sku) — multi-SKU orders have several rows.
            keyOf: (d) => `${d.orderId}|${d.sku || ''}`,
            // A work queue, not output: `attempts` increments every time Step 2 tries to resolve an
            // order, and `firstSeenAt` is a timestamp. Both differ on a legitimate re-run.
            ignoreFields: ['attempts', 'firstSeenAt'],
        },
    ];

    return list
        .map((entry) => {
            try {
                entry.model = require(entry.modelPath);
                return entry;
            } catch (err) {
                console.warn(`[parity] skipping ${entry.name} — model not loadable: ${err.message}`);
                return null;
            }
        })
        .filter(Boolean);
}

// ---- snapshot ------------------------------------------------------------
async function snapshot() {
    const userId = arg('user-id');
    const country = arg('country');
    const region = arg('region');
    const outPath = arg('out');
    const days = parseInt(arg('days', '0'), 10);

    if (!userId || !country || !region || !outPath) {
        console.error('Usage: --user-id=<id> --country=<US> --region=<NA> --out=<file.json> [--days=N]');
        process.exit(1);
    }

    const dbConsts = require('../config/config.js');
    const MONGODB_URI = dbConsts.dbUri && dbConsts.dbName
        ? `${dbConsts.dbUri}/${dbConsts.dbName}`
        : (process.env.MONGODB_URI || process.env.MONGO_URI);
    if (!MONGODB_URI) { console.error('No Mongo URI resolved.'); process.exit(1); }

    await mongoose.connect(MONGODB_URI, { connectTimeoutMS: 60000, socketTimeoutMS: 120000 });
    console.log(`[parity] connected. Snapshotting user=${userId} ${country}/${region}${days ? ` last ${days}d` : ''}`);

    let sinceStr = null;
    if (days > 0) {
        const d = new Date(Date.now() - days * 86400000);
        sinceStr = d.toISOString().slice(0, 10); // YYYY-MM-DD (date fields are stored as such)
    }

    const collections = buildCollections();
    const result = {
        meta: { userId: String(userId), country, region, days: days || null, generatedAtUTC: new Date().toISOString() },
        collections: {},
    };

    for (const c of collections) {
        const query = c.filter(userId, country, region);
        if (sinceStr && c.dateField) query[c.dateField] = { $gte: sinceStr };
        let docs = await c.model.find(query).lean();
        const extraVolatile = c.ignoreFields ? new Set(c.ignoreFields) : null;
        const normalized = docs
            .map((d) => stripVolatile(d, extraVolatile))
            .sort((a, b) => (c.keyOf(a) < c.keyOf(b) ? -1 : c.keyOf(a) > c.keyOf(b) ? 1 : 0));
        const hash = crypto.createHash('sha256').update(stableStringify(normalized)).digest('hex');
        result.collections[c.name] = {
            count: normalized.length,
            hash,
            // index of key -> per-doc hash, for pinpointing diffs without storing full docs
            docHashes: normalized.reduce((acc, d) => {
                acc[c.keyOf(d)] = crypto.createHash('sha256').update(stableStringify(d)).digest('hex');
                return acc;
            }, {}),
        };
        console.log(`[parity]   ${c.name}: ${normalized.length} docs  sha256=${hash.slice(0, 12)}…`);
    }

    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`[parity] wrote ${outPath}`);
    await mongoose.disconnect();
}

// ---- diff ----------------------------------------------------------------
function diff() {
    const beforePath = arg('before');
    const afterPath = arg('after');
    if (!beforePath || !afterPath) {
        console.error('Usage: --diff --before=<before.json> --after=<after.json>');
        process.exit(1);
    }
    const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
    const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));

    const names = new Set([...Object.keys(before.collections), ...Object.keys(after.collections)]);
    let anyMismatch = false;

    for (const name of names) {
        const b = before.collections[name];
        const a = after.collections[name];
        if (!b || !a) {
            anyMismatch = true;
            console.log(`❌ ${name}: present in only one snapshot (before=${!!b}, after=${!!a})`);
            continue;
        }
        if (b.hash === a.hash && b.count === a.count) {
            console.log(`✅ ${name}: identical (${a.count} docs)`);
            continue;
        }
        anyMismatch = true;
        console.log(`❌ ${name}: MISMATCH  count ${b.count} → ${a.count}`);
        const keys = new Set([...Object.keys(b.docHashes), ...Object.keys(a.docHashes)]);
        const changed = [];
        for (const k of keys) {
            const bh = b.docHashes[k];
            const ah = a.docHashes[k];
            if (bh !== ah) changed.push(`${!bh ? 'ADDED' : !ah ? 'REMOVED' : 'CHANGED'}: ${k}`);
        }
        console.log(`   ${changed.length} differing doc(s). Sample:`);
        changed.slice(0, 15).forEach((c) => console.log(`     - ${c}`));
        if (changed.length > 15) console.log(`     … and ${changed.length - 15} more`);
    }

    console.log('');
    if (anyMismatch) {
        console.log('RESULT: ❌ Differences found — investigate before shipping.');
        process.exit(2);
    }
    console.log('RESULT: ✅ Data parity confirmed — all collections identical.');
}

// Only run when invoked directly. Without this guard the script would execute (and try to connect
// to Mongo) on `require`, which is what a unit test asserting the collection registry has to do.
if (require.main === module) {
    (async () => {
        try {
            if (DIFF_MODE) diff();
            else await snapshot();
        } catch (err) {
            console.error('[parity] fatal:', err);
            process.exit(1);
        }
    })();
}

module.exports = { buildCollections, stripVolatile, stableStringify };

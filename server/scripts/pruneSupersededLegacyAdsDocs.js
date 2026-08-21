/**
 * pruneSupersededLegacyAdsDocs.js
 *
 * One-off garbage collection for collections whose rows have moved elsewhere, leaving behind
 * superseded parent documents no code path can reach.
 *
 * Ads collections, still written per-day (--model=keywords / searchterms):
 *   - adsKeywordsPerformance  (keywordsData[])
 *   - searchterms             (searchTermData[])
 *
 * Fully migrated parents, no writer since 2026-02-03 (--model=productwiseads / ledgersummary):
 *   - productwisesponsoredadsdatas (sponsoredAds[])  -> ProductWiseSponsoredAdsItem
 *   - ledgersummaryviews           (data[])          -> LedgerSummaryViewItem
 * These two are read ONLY as a fallback for accounts whose last successful write predates their
 * migration, so the same conservative rule applies: keep the newest per (user, country, region) and
 * delete only the unreachable rest. Dry run 2026-08-21 found 1,301 + 220 candidates = 2,338.8 MB.
 *
 * WHAT THIS IS NOT. It is not a TTL / retention policy. Measured 2026-08-20, a TTL on
 * `metricDate` would reclaim about 1% of these collections, because 85-88% of the bytes
 * sit in LEGACY documents that have no `metricDate` field at all and which a TTL index
 * therefore cannot see:
 *
 *                              total          legacy (no metricDate)   per-day >90d old
 *   adsKeywordsPerformance     6,915 / 2842MB   2,840 docs / 2494MB      451 docs / 22MB
 *   searchterms                7,410 / 2485MB   2,508 docs / 2114MB      543 docs / 21MB
 *
 * WHAT THE WASTE ACTUALLY IS. Legacy documents are the pre-per-day schema: one whole
 * report snapshot per document. Every read path resolves them the same way — newest ONE
 * per (userId, country, region), by `createdAt`:
 *
 *   adsKeywordsPerformanceModel.findMergedKeywordsData  -> findOne(...).sort({createdAt:-1})
 *   SearchTermsModel.findMergedSearchTermData           -> findOne(...).sort({createdAt:-1})
 *   PPCCampaignAnalysisService.resolveDailyOrLegacyMatch-> findOne(...).sort({createdAt:-1})._id
 *   ProductPPCIssuesService.resolveDailyOrLegacyMatch   -> same
 *   TestController                                      -> findOne(...).sort({createdAt:-1})
 *
 * Yet there are up to 158 legacy documents per account — 2,840 across 113 groups and
 * 2,508 across 106 groups. Everything except the newest per group is unreachable by any
 * code path in the repo. That is roughly 4.4GB of the 5.3GB.
 *
 * Legacy WRITING stopped on 2026-05-18 (93 days before this was written), so this is a
 * one-time cleanup, not a recurring leak — there is deliberately no cron for it.
 *
 * SAFETY
 *   - DRY RUN by default. Nothing is deleted unless you pass --confirm.
 *   - Documents WITH a `metricDate` are never candidates. Per-day data is untouched.
 *   - The newest legacy document per group is ALWAYS kept, whatever its age.
 *   - Superseded documents younger than --minAgeDays (default 30) are also kept, so a
 *     re-enabled legacy write path can never have its output deleted out from under it.
 *   - Group keys include the BSON type of `userId`. adsKeywordsPerformance stores it as
 *     an ObjectId and searchterms as a String; a document whose stored type does not
 *     match the type its readers query with is unreachable by those readers, so it must
 *     not be allowed to displace a document that IS reachable.
 *   - Deletes in bounded batches so a single enormous delete never stalls the primary.
 *
 * Usage:
 *   node server/scripts/pruneSupersededLegacyAdsDocs.js --dryRun
 *   node server/scripts/pruneSupersededLegacyAdsDocs.js --model=keywords --dryRun
 *   node server/scripts/pruneSupersededLegacyAdsDocs.js --confirm
 *   node server/scripts/pruneSupersededLegacyAdsDocs.js --confirm --batchSize=200 --minAgeDays=60
 *   node server/scripts/pruneSupersededLegacyAdsDocs.js --model=productwiseads --dryRun
 *   node server/scripts/pruneSupersededLegacyAdsDocs.js --model=ledgersummary --dryRun
 */

const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const DB_URI = process.env.DB_URI;
const DB_NAME = process.env.DB_NAME;
const MONGODB_URI =
    DB_URI && DB_NAME
        ? `${DB_URI}/${DB_NAME}`
        : process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/sellerqi';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MIN_AGE_DAYS = 30;

/**
 * Build the group key for one legacy document.
 *
 * The `userId` BSON type is part of the key on purpose — see SAFETY above. `String()`
 * normalises an ObjectId to its hex form and leaves a string alone, so the two are
 * otherwise indistinguishable, and merging them could keep an unreachable document and
 * delete the reachable one.
 */
function groupKeyFor(doc) {
    const raw = doc?.userId;
    const typeTag = raw && typeof raw === 'object' && typeof raw.toHexString === 'function'
        ? 'oid'
        : typeof raw;
    return `${typeTag}:${String(raw)}|${doc?.country ?? ''}|${doc?.region ?? ''}`;
}

/**
 * Decide which legacy documents are superseded and safe to delete.
 *
 * PURE — no database access — so the selection rule can be tested directly. This is the
 * part that must be right; the aggregation that feeds it does no selection of its own
 * beyond "has no metricDate".
 *
 * @param {Array<{_id:any,userId:any,country:string,region:string,createdAt:Date,metricDate?:any,sizeBytes?:number}>} docs
 * @param {{minAgeMs?: number, now?: number}} opts
 * @returns {{groups:number, kept:Array, candidates:Array, skippedTooRecent:number, skippedHasMetricDate:number}}
 */
function selectSupersededLegacyDocs(docs, { minAgeMs = 0, now = Date.now() } = {}) {
    const byGroup = new Map();
    let skippedHasMetricDate = 0;

    for (const doc of Array.isArray(docs) ? docs : []) {
        if (!doc || !doc._id) continue;
        // Belt and braces: the caller already filters on metricDate, but this is the
        // invariant that makes the whole script safe, so it is re-asserted here where
        // the tests can see it.
        if (doc.metricDate !== undefined && doc.metricDate !== null) {
            skippedHasMetricDate++;
            continue;
        }
        const key = groupKeyFor(doc);
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key).push(doc);
    }

    const kept = [];
    const candidates = [];
    let skippedTooRecent = 0;

    for (const group of byGroup.values()) {
        // Newest first, exactly matching every reader's `.sort({ createdAt: -1 })`.
        // `_id` breaks ties deterministically (ObjectIds are time-ordered), so two
        // documents written in the same millisecond can never swap places between the
        // dry run and the apply run.
        group.sort((a, b) => {
            const ta = new Date(a.createdAt || 0).getTime();
            const tb = new Date(b.createdAt || 0).getTime();
            if (tb !== ta) return tb - ta;
            return String(b._id).localeCompare(String(a._id));
        });

        kept.push(group[0]);
        for (const doc of group.slice(1)) {
            const age = now - new Date(doc.createdAt || 0).getTime();
            if (age < minAgeMs) {
                skippedTooRecent++;
                continue;
            }
            candidates.push(doc);
        }
    }

    return { groups: byGroup.size, kept, candidates, skippedTooRecent, skippedHasMetricDate };
}

function parseArgs() {
    const args = {
        dryRun: false,
        confirm: false,
        model: 'all',
        batchSize: DEFAULT_BATCH_SIZE,
        minAgeDays: DEFAULT_MIN_AGE_DAYS,
    };
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
        if (key === 'model' && ['all', 'keywords', 'searchterms', 'productwiseads', 'ledgersummary'].includes(val)) args.model = val;
        else if (key === 'batchSize') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n) && n > 0) args.batchSize = n;
        } else if (key === 'minAgeDays') {
            const n = parseInt(val, 10);
            if (!Number.isNaN(n) && n >= 0) args.minAgeDays = n;
        }
    });
    return args;
}

const mb = (bytes) => (Number(bytes || 0) / (1024 * 1024)).toFixed(1);

/**
 * Load every legacy document's scalars (never its payload array) plus its BSON size.
 *
 * `$bsonSize` forces a collection scan whatever we do, so the size comes along for free
 * and gives the dry run a number that can be reconciled against `collStats`.
 */
async function loadLegacyDocs(Model, { userField = 'userId' } = {}) {
    return Model.aggregate([
        { $match: { $or: [{ metricDate: { $exists: false } }, { metricDate: null }] } },
        {
            $project: {
                // Normalise the scope key: the ads collections store it as `userId`, the finance
                // ones as `User`. Everything downstream then reads `userId` regardless.
                userId: `$${userField}`,
                country: 1,
                region: 1,
                createdAt: 1,
                sizeBytes: { $bsonSize: '$$ROOT' },
            },
        },
    ]).allowDiskUse(true);
}

async function pruneModel(Model, label, { willWrite, batchSize, minAgeMs, userField = 'userId' }) {
    console.log(`\n=== ${label} ===`);

    const docs = await loadLegacyDocs(Model, { userField });
    const totalLegacyBytes = docs.reduce((sum, d) => sum + (Number(d.sizeBytes) || 0), 0);
    console.log(`  legacy docs (no metricDate): ${docs.length}  (${mb(totalLegacyBytes)} MB)`);

    const { groups, kept, candidates, skippedTooRecent } = selectSupersededLegacyDocs(docs, { minAgeMs });
    const keptBytes = kept.reduce((sum, d) => sum + (Number(d.sizeBytes) || 0), 0);
    const candidateBytes = candidates.reduce((sum, d) => sum + (Number(d.sizeBytes) || 0), 0);

    console.log(`  (userId, country, region) groups: ${groups}`);
    console.log(`  keeping (newest per group):       ${kept.length}  (${mb(keptBytes)} MB)`);
    console.log(`  superseded, kept (too recent):    ${skippedTooRecent}`);
    console.log(`  DELETE candidates:                ${candidates.length}  (${mb(candidateBytes)} MB)`);

    if (candidates.length === 0) {
        return { label, candidates: 0, deleted: 0, reclaimedBytes: 0 };
    }

    // Per-group preview: the shape of the waste (how many duplicates each account has)
    // is what tells you whether the selection is behaving, not the grand total.
    const perGroup = new Map();
    for (const doc of candidates) {
        const key = groupKeyFor(doc);
        perGroup.set(key, (perGroup.get(key) || 0) + 1);
    }
    const worst = [...perGroup.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('  worst groups (duplicates to delete):');
    worst.forEach(([key, count]) => console.log(`    • ${key}  -> ${count}`));
    if (perGroup.size > worst.length) console.log(`    … and ${perGroup.size - worst.length} more groups`);

    if (!willWrite) {
        console.log('  DRY RUN — nothing deleted.');
        return { label, candidates: candidates.length, deleted: 0, reclaimedBytes: candidateBytes };
    }

    let deleted = 0;
    let reclaimedBytes = 0;
    for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        // Re-assert the legacy predicate in the delete filter. If anything wrote a
        // metricDate onto one of these _ids between the scan and now, it is per-day data
        // and must survive — the filter, not the id list, is the last line of defence.
        const res = await Model.deleteMany({
            _id: { $in: batch.map((d) => d._id) },
            $or: [{ metricDate: { $exists: false } }, { metricDate: null }],
        });
        deleted += res.deletedCount || 0;
        reclaimedBytes += batch.reduce((sum, d) => sum + (Number(d.sizeBytes) || 0), 0);
        console.log(`    deleted ${deleted}/${candidates.length} (${mb(reclaimedBytes)} MB)`);
    }

    return { label, candidates: candidates.length, deleted, reclaimedBytes };
}

async function main() {
    const { dryRun, confirm, model, batchSize, minAgeDays } = parseArgs();
    const willWrite = confirm && !dryRun;
    if (!dryRun && !confirm) {
        console.log('No mode passed — defaulting to DRY RUN. Pass --confirm to delete.\n');
    }

    const mongoose = require('mongoose');
    await mongoose.connect(MONGODB_URI);

    console.log(`[PruneLegacyAds] Connected. Mode => ${willWrite ? 'APPLY (DELETES)' : 'DRY RUN'}`);
    console.log(`[PruneLegacyAds] model=${model} batchSize=${batchSize} minAgeDays=${minAgeDays}`);

    const adsKeywordsPerformance = require('../models/amazon-ads/adsKeywordsPerformanceModel.js');
    const SearchTerms = require('../models/amazon-ads/SearchTermsModel.js');

    const targets = [];
    if (model === 'all' || model === 'keywords') {
        targets.push([adsKeywordsPerformance, 'adsKeywordsPerformance']);
    }
    if (model === 'all' || model === 'searchterms') {
        targets.push([SearchTerms, 'searchterms']);
    }
    // Two collections whose migration to an item collection is COMPLETE: neither parent has had a
    // writer since 2026-02-03, and both are read only as a fallback for accounts whose last
    // successful write predates the migration. Measured 2026-08-21:
    //   productwisesponsoredadsdatas  1,346 docs / 2,356MB
    //   ledgersummaryviews              257 docs /    51MB
    // Same conservative rule as the ads collections — keep the newest per (user, country, region)
    // so the fallback still resolves for every account, and delete only the unreachable rest.
    if (model === 'all' || model === 'productwiseads') {
        targets.push([
            require('../models/amazon-ads/ProductWiseSponseredAdsModel.js'),
            'productwisesponsoredadsdatas',
            { userField: 'userId' },
        ]);
    }
    if (model === 'all' || model === 'ledgersummary') {
        targets.push([
            require('../models/finance/LedgerSummaryViewModel.js'),
            'ledgersummaryviews',
            // Finance parents key on `User`, not `userId`.
            { userField: 'User' },
        ]);
    }

    const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
    const results = [];
    for (const [Model, label, opts = {}] of targets) {
        results.push(await pruneModel(Model, label, { willWrite, batchSize, minAgeMs, ...opts }));
    }

    console.log('\n=== Summary ===');
    let totalCandidates = 0;
    let totalDeleted = 0;
    let totalBytes = 0;
    for (const r of results) {
        totalCandidates += r.candidates;
        totalDeleted += r.deleted;
        totalBytes += r.reclaimedBytes;
        console.log(`  ${r.label}: ${r.candidates} candidate(s), ${r.deleted} deleted, ${mb(r.reclaimedBytes)} MB`);
    }
    console.log(`  TOTAL: ${totalCandidates} candidate(s), ${totalDeleted} deleted, ${mb(totalBytes)} MB`);
    if (!willWrite) {
        console.log('\n[PruneLegacyAds] DRY RUN complete. Nothing was deleted. Pass --confirm to apply.');
    } else {
        console.log('\n[PruneLegacyAds] APPLY complete. Deletions are irreversible.');
    }

    await mongoose.disconnect();
}

// Only run when invoked directly, so the pure selection logic can be required by tests.
if (require.main === module) {
    main().catch(async (err) => {
        console.error('[PruneLegacyAds] Error:', err.message);
        try { await require('mongoose').disconnect(); } catch (_) { /* noop */ }
        process.exit(1);
    });
}

module.exports = { selectSupersededLegacyDocs, groupKeyFor };

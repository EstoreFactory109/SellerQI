/**
 * verifyKeywordChunkingForAccount.js  (READ-ONLY)
 *
 * Post-integration smoke check for the keyword-chunking + status fixes.
 * Run BEFORE (baseline) and AFTER a manual integration against the large
 * account to confirm the fix took. Makes NO writes.
 *
 * Checks:
 *   A. Keyword storage — latest Keyword snapshot: isChunked, totalChunks,
 *      chunk-doc count, and that loadKeywordSnapshot reassembles to a non-empty
 *      set whose length equals the sum of the chunk docs.
 *   B. Status rows — parent JobStatus (should be 'completed') and the latest
 *      logging session (should NOT be 'in_progress').
 *   C. Reader sanity — loadKeywordSnapshot returns keywordData the dashboard
 *      readers will see (non-empty).
 *
 * Usage:
 *   node server/scripts/verifyKeywordChunkingForAccount.js
 *   node server/scripts/verifyKeywordChunkingForAccount.js --userId=<id> --country=IN --region=EU
 */

const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');

const KeywordModel = require('../models/amazon-ads/keywordModel.js');
const KeywordChunkModel = require('../models/amazon-ads/keywordChunkModel.js');
const JobStatus = require('../models/system/JobStatusModel.js');
const UserAccountLogs = require('../models/system/ErrorLogs.js');
const { loadKeywordSnapshot } = require('../utils/ppcSnapshotLoader.js');

const MONGODB_URI =
    process.env.DB_URI && process.env.DB_NAME
        ? `${process.env.DB_URI}/${process.env.DB_NAME}`
        : process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/sellerqi';

function arg(name, def) {
    const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=')[1] : def;
}

(async () => {
    const userId = arg('userId', '6a4244c612ce56d674fb46a4');
    const country = arg('country', 'IN');
    const region = arg('region', 'EU');

    await mongoose.connect(MONGODB_URI);
    console.log(`DB: ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@').replace(/\?.*$/, '')}`);
    console.log(`Account: ${userId}  ${country}-${region}\n`);

    // ── A. Keyword storage ───────────────────────────────────────────────
    const primary = await KeywordModel.findOne({ userId, country, region })
        .sort({ metricDate: -1 })
        .select('metricDate isChunked totalChunks keywordData')
        .lean();

    console.log('── A. Keyword storage ──');
    if (!primary) {
        console.log('  ⚠️  No Keyword snapshot doc found for this account.');
    } else {
        const inlineLen = Array.isArray(primary.keywordData) ? primary.keywordData.length : 0;
        console.log(`  primary metricDate : ${primary.metricDate}`);
        console.log(`  isChunked          : ${primary.isChunked === true}`);
        console.log(`  totalChunks        : ${primary.totalChunks}`);
        console.log(`  inline keywordData : ${inlineLen}`);

        const chunkDocs = await KeywordChunkModel.find({ userId, country, region, metricDate: primary.metricDate })
            .select('chunkIndex keywordData')
            .lean();
        const chunkSum = chunkDocs.reduce((n, c) => n + (c.keywordData?.length || 0), 0);
        console.log(`  chunk docs         : ${chunkDocs.length}  (sum of keywords: ${chunkSum})`);
    }

    // ── C. Reader sanity (what the dashboard readers actually get) ───────
    const snap = await loadKeywordSnapshot(userId, country, region);
    const reassembled = snap?.keywordData?.length || 0;
    console.log(`\n── C. Reader (loadKeywordSnapshot) ──`);
    console.log(`  reassembled length : ${reassembled}`);

    // Integrity verdict
    let verdict = '❓ inconclusive';
    if (primary) {
        if (primary.isChunked) {
            const chunkDocs = await KeywordChunkModel.countDocuments({ userId, country, region, metricDate: primary.metricDate });
            const chunkSum = (await KeywordChunkModel.find({ userId, country, region, metricDate: primary.metricDate }).select('keywordData').lean())
                .reduce((n, c) => n + (c.keywordData?.length || 0), 0);
            const okCount = chunkDocs === primary.totalChunks;
            const okSum = chunkSum === reassembled && reassembled > 0;
            verdict = okCount && okSum
                ? `✅ CHUNKED OK — ${reassembled} keywords across ${chunkDocs} chunks, reassembly matches`
                : `❌ CHUNKED MISMATCH — chunks:${chunkDocs}/${primary.totalChunks}, sum:${chunkSum} vs reassembled:${reassembled}`;
        } else {
            verdict = reassembled > 0
                ? `✅ INLINE OK — ${reassembled} keywords (account under chunk threshold this run)`
                : `⚠️  INLINE but 0 keywords (expected non-zero for this account)`;
        }
    }
    console.log(`  VERDICT            : ${verdict}`);

    // ── B. Status rows ───────────────────────────────────────────────────
    console.log(`\n── B. Status rows ──`);
    const parentId = `integration-${userId}-${country}-${region}`;
    const parent = await JobStatus.findOne({ jobId: parentId }).select('status updatedAt').lean();
    console.log(`  parent JobStatus   : ${parent ? parent.status : '(not found)'}  ${parent ? '[' + parentId + ']' : ''}`);
    console.log(`    -> ${parent && parent.status === 'completed' ? '✅ completed' : '⚠️  not completed (spinner if still running)'}`);

    const finalizeRow = await JobStatus.findOne({ jobId: `${parentId}-finalize` }).select('status').lean();
    console.log(`  finalize phase row : ${finalizeRow ? finalizeRow.status : '(not found)'}`);

    const ip = await UserAccountLogs.countDocuments({ userId, sessionStatus: 'in_progress' });
    const latest = await UserAccountLogs.findOne({ userId }).sort({ sessionStartTime: -1 })
        .select('sessionStatus sessionEndTime sessionStartTime sessionId').lean();
    console.log(`  latest session     : ${latest ? latest.sessionStatus : '(none)'}  end=${latest?.sessionEndTime ? new Date(latest.sessionEndTime).toISOString() : '-'}`);
    console.log(`  in_progress count  : ${ip}  ${ip === 0 ? '✅' : '⚠️  (sweeper closes >6h old ones)'}`);

    await mongoose.disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

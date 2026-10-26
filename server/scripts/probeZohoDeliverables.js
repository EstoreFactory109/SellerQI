/**
 * READ-ONLY probe: what do Zoho's attachment / document payloads actually look like?
 *
 * Nothing in this repo has ever read Zoho attachments, so the field names the deliverables
 * feature depends on are unknown. This prints them for a few real tasks — keys and short,
 * truncated samples only; never file contents, never a full download URL.
 *
 * Every call is a GET. Nothing is created, changed or sent to anyone.
 *
 * Usage (from the repo root, with the production .env):
 *   node server/scripts/probeZohoDeliverables.js [projectId] [maxTasks]
 * Without a projectId it uses the first ESF client linked to a Zoho project.
 *
 * Token rules (see memory / ZohoAuth): connect Redis FIRST so the cached access token is
 * reused — otherwise every run mints a new one and Zoho's refresh limit can lock the live
 * server out for ~30 minutes. Never forces a token refresh.
 */
require('dotenv').config();

const mongoose = require('mongoose');
const dbConnect = require('../config/dbConn.js');
const { connectRedis } = require('../config/redisConn.js');

const truncate = (value) => {
    const s = String(value);
    if (/^https?:\/\//.test(s)) return `${s.slice(0, 48)}…(${s.length} chars)`;
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
};

/** Keys and a short sample of each value, one level deep (nested objects listed by key). */
const shape = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = `{ ${Object.keys(v).join(', ')} }`;
        else if (Array.isArray(v)) out[k] = `[${v.length}]${v[0] && typeof v[0] === 'object' ? ` of { ${Object.keys(v[0]).join(', ')} }` : ''}`;
        else out[k] = truncate(v);
    }
    return out;
};

const tryGet = async (label, request) => {
    const { zohoRequest } = require('../Services/Zoho/ZohoProjectsClient.js');
    try {
        const data = await zohoRequest({ method: 'GET', context: label, ...request });
        console.log(`\n✔ ${label}`);
        return data;
    } catch (error) {
        console.log(`\n✘ ${label}: ${error.status || error.response?.status || ''} ${error.code || ''} ${truncate(error.message)}`);
        return null;
    }
};

const firstArray = (data) => {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data)) return data;
    const arr = Object.values(data).find(Array.isArray);
    return arr || [];
};

(async () => {
    await dbConnect();
    await connectRedis();
    const { resolvePortalId } = require('../Services/Zoho/ZohoProjectsClient.js');
    const User = require('../models/user-auth/userModel.js');
    const ZohoProjectTask = require('../models/system/ZohoProjectTaskModel.js');

    const portalId = await resolvePortalId();
    let projectId = process.argv[2];
    const maxTasks = Number(process.argv[3]) || 3;
    if (!projectId) {
        // The project with the most tasks that have files, per the nightly sync.
        const ranked = await ZohoProjectTask.aggregate([
            { $match: { $or: [{ hasAttachments: true }, { 'comments.attachmentCount': { $gt: 0 } }] } },
            { $group: { _id: '$projectId', tasks: { $sum: 1 } } },
            { $sort: { tasks: -1 } },
            { $limit: 5 },
        ]);
        console.log('projects with files:', ranked.map((r) => `${r._id}:${r.tasks}`).join(', ') || 'none');
        projectId = ranked[0]?._id;
    }
    if (!projectId) throw new Error('No linked Zoho project found; pass a projectId');
    console.log(`portal ${portalId}, project ${projectId}`);

    // Tasks the nightly sync already knows have files (task-level or in comments).
    const tasks = await ZohoProjectTask.find({
        projectId,
        $or: [{ hasAttachments: true }, { 'comments.attachmentCount': { $gt: 0 } }],
    }).select('taskId name hasAttachments comments.commentId comments.attachmentCount').limit(maxTasks).lean();
    console.log(`tasks with files (from the sync): ${tasks.length}`);

    let downloadTried = false;
    for (const t of tasks) {
        console.log(`\n================ task ${t.taskId} — ${truncate(t.name)} (hasAttachments=${t.hasAttachments})`);

        for (const [label, version, path] of [
            ['task attachments v3', 'v3', `/portal/${portalId}/projects/${projectId}/tasks/${t.taskId}/attachments`],
            ['task attachments v2', 'v2', `/portal/${portalId}/projects/${projectId}/tasks/${t.taskId}/attachments/`],
        ]) {
            const data = await tryGet(label, { version, path });
            if (!data) continue;
            console.log('  envelope keys:', Object.keys(data || {}).join(', '));
            const items = firstArray(data);
            console.log(`  ${items.length} item(s); first:`, shape(items[0]));
            const nested = items[0] && Object.values(items[0]).find((v) => v && typeof v === 'object' && !Array.isArray(v));
            if (nested) console.log('  first nested object:', shape(nested));

            // One download attempt, metadata only: does the URL work with our token?
            const url = items[0] && Object.values(items[0]).find((v) => typeof v === 'string' && /^https?:\/\//.test(v));
            if (url && !downloadTried) {
                downloadTried = true;
                try {
                    const u = new URL(url);
                    const { zohoRequest } = require('../Services/Zoho/ZohoProjectsClient.js');
                    const bytes = await zohoRequest({ baseUrl: u.origin, path: `${u.pathname}${u.search}`, responseType: 'arraybuffer', headers: { Accept: '*/*' }, context: 'download probe' });
                    console.log(`  download with OAuth header: OK, ${bytes?.byteLength ?? Buffer.byteLength(bytes || '')} bytes (contents not printed)`);
                } catch (error) {
                    console.log(`  download with OAuth header: FAILED ${error.status || ''} ${truncate(error.message)}`);
                }
            }
        }

        const comments = await tryGet('task comments v3 (raw)', {
            version: 'v3', path: `/portal/${portalId}/projects/${projectId}/tasks/${t.taskId}/comments`,
        });
        const withFiles = firstArray(comments).filter((c) => Array.isArray(c.attachments) && c.attachments.length);
        console.log(`  comments with attachments: ${withFiles.length}`);
        if (withFiles[0]) {
            console.log('  comment keys:', shape(withFiles[0]));
            console.log('  comment attachment[0]:', shape(withFiles[0].attachments[0]));
        }
    }

    if (process.env.PROBE_DOCUMENTS !== 'true') {
        console.log('\n(project documents skipped: they need the documents scope — confirmed 2026-10-27)');
        await mongoose.disconnect();
        process.exit(0);
    }
    console.log('\n================ project documents');
    for (const [label, version, path] of [
        ['documents v2', 'v2', `/portal/${portalId}/projects/${projectId}/documents/`],
        ['folders v2', 'v2', `/portal/${portalId}/projects/${projectId}/folders/`],
        ['documents v3', 'v3', `/portal/${portalId}/projects/${projectId}/documents`],
        ['folders v3', 'v3', `/portal/${portalId}/projects/${projectId}/folders`],
    ]) {
        const data = await tryGet(label, { version, path });
        if (data) {
            const items = firstArray(data);
            console.log(`  envelope keys: ${Object.keys(data).join(', ')}; ${items.length} item(s); first:`, shape(items[0]));
        }
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch(async (e) => {
    console.error('probe failed:', e.message);
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(1);
});

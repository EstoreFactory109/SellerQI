/**
 * PROBE (writes, in a throwaway project): which Zoho Projects API shapes create a subtask,
 * list a task's subtasks, rename a task, and close / reopen one on THIS portal.
 *
 * Nothing in the repo has ever done any of these, and the docs disagree with the portal
 * often enough (see config.js PATHS) that the Fix it subtask sync is written against what
 * this prints, not against the docs.
 *
 * It creates a project named "SellerQI subtask probe <time>", a parent task, tries each
 * candidate, prints the outcome of every call, and deletes the project at the end (v2 —
 * the only generation that deletes projects). Touches no client project.
 *
 * Token rules (see probeZohoDeliverables.js): Redis first so the cached access token is
 * reused; a handful of calls; never loops on a 401.
 *
 * Usage (repo root, production .env):  node server/scripts/probeZohoSubtasks.js
 */
require('dotenv').config();

const mongoose = require('mongoose');
const dbConnect = require('../config/dbConn.js');
const { connectRedis } = require('../config/redisConn.js');

const short = (v) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s && s.length > 400 ? `${s.slice(0, 400)}…` : s;
};

(async () => {
    await dbConnect();
    await connectRedis();
    const { zohoRequest } = require('../Services/Zoho/ZohoProjectsClient.js');
    const Zoho = require('../Services/Zoho/ZohoProjectsService.js');
    const ZohoAuth = require('../Services/Zoho/ZohoAuth.js');
    const conn = await ZohoAuth.getConnection();
    const P = String(conn.portalId);
    const results = [];

    // Every call is recorded; a failure never stops the probe (except auth, below).
    const tryCall = async (label, spec) => {
        try {
            const data = await zohoRequest({ ...spec, context: `probe: ${label}` });
            results.push({ label, ok: true, data: short(data) });
            return data;
        } catch (error) {
            results.push({ label, ok: false, status: error.statusCode, error: short(error.message), fields: error.zohoFields });
            if (error.statusCode === 401) throw new Error(`401 on "${label}" — stopping so no token is burnt`);
            return null;
        }
    };
    const idOf = (obj) => {
        const t = obj?.tasks?.[0] || obj?.task || obj?.subtasks?.[0] || obj;
        return t?.id_string || (t?.id != null ? String(t.id) : null);
    };

    const project = await Zoho.createProject({ name: `SellerQI subtask probe ${new Date().toISOString().slice(0, 16)}`, description: 'Temporary — created and deleted by server/scripts/probeZohoSubtasks.js' });
    const PR = String(project.id);
    console.log(`scratch project ${PR}`);
    try {
        const parent = await Zoho.createTask({ projectId: PR, name: 'Probe parent' });
        const PT = String(parent.id);
        console.log(`parent task ${PT}`);
        const base3 = `/portal/${P}/projects/${PR}/tasks`;
        const base2 = `/portal/${P}/projects/${PR}/tasks`;

        // ── Create a subtask ──
        const a = await tryCall('create v3 POST tasks/{id}/subtasks', { method: 'POST', version: 'v3', path: `${base3}/${PT}/subtasks`, data: { name: 'Sub A (v3 /subtasks)' } });
        const b = await tryCall('create v3 POST tasks + parental_info', { method: 'POST', version: 'v3', path: base3, data: { name: 'Sub B (v3 parental_info)', parental_info: { parent_task_id: PT } } });
        const c = await tryCall('create v2 POST tasks/{id}/subtasks/', { method: 'POST', version: 'v2', path: `${base2}/${PT}/subtasks/`, data: { name: 'Sub C (v2 /subtasks/)' }, form: true });
        const ids = { A: idOf(a), B: idOf(b), C: idOf(c) };
        console.log('created ids', ids);

        // ── Which of them really are subtasks? ──
        const flat = await tryCall('list v3 tasks (flat)', { method: 'GET', version: 'v3', path: base3, params: { page: 1, per_page: 50 } });
        for (const t of flat?.tasks || []) {
            results.push({ label: `  flat: ${t.name}`, ok: true, data: short({ id: t.id_string || t.id, depth: t.depth, parental_info: t.parental_info, status: t.status }) });
        }
        await tryCall('list v3 tasks/{id}/subtasks', { method: 'GET', version: 'v3', path: `${base3}/${PT}/subtasks` });
        await tryCall('list v2 tasks/{id}/subtasks/', { method: 'GET', version: 'v2', path: `${base2}/${PT}/subtasks/` });

        const sub = ids.C || ids.A || ids.B;
        if (sub) {
            // ── Read one task (for its status object) ──
            const one3 = await tryCall('read v3 tasks/{id}', { method: 'GET', version: 'v3', path: `${base3}/${sub}` });
            await tryCall('read v2 tasks/{id}/', { method: 'GET', version: 'v2', path: `${base2}/${sub}/` });
            console.log('status of a new task:', short(one3?.tasks?.[0]?.status || one3?.status));

            // ── Rename ──
            await tryCall('update v3 PATCH name/description', { method: 'PATCH', version: 'v3', path: `${base3}/${sub}`, data: { name: 'Sub renamed (v3)', description: 'updated by probe' } });
            await tryCall('update v2 POST name', { method: 'POST', version: 'v2', path: `${base2}/${sub}/`, data: { name: 'Sub renamed (v2)' }, form: true });

            // ── Close / reopen ──
            await tryCall('close v2 percent_complete=100', { method: 'POST', version: 'v2', path: `${base2}/${sub}/`, data: { percent_complete: '100' }, form: true });
            const afterClose = await tryCall('read v3 after v2 close', { method: 'GET', version: 'v3', path: `${base3}/${sub}` });
            console.log('after v2 percent_complete=100:', short(afterClose?.tasks?.[0]?.status || afterClose?.status), 'is_completed', afterClose?.tasks?.[0]?.is_completed);
            await tryCall('reopen v2 percent_complete=0', { method: 'POST', version: 'v2', path: `${base2}/${sub}/`, data: { percent_complete: '0' }, form: true });

            // Status ids: the project's task statuses (several known shapes), for a v3 PATCH status.
            await tryCall('statuses v3 task layout', { method: 'GET', version: 'v3', path: `/portal/${P}/projects/${PR}/tasklayouts` });
            await tryCall('statuses v3 /tasks/statuses', { method: 'GET', version: 'v3', path: `/portal/${P}/projects/${PR}/task-statuses` });
            await tryCall('statuses v2 /tasks/statuses', { method: 'GET', version: 'v2', path: `/portal/${P}/projects/${PR}/statuses/` });
            // Status by ID (v3 refuses a status by name). Ids read off this portal's tasks.
            const statusOf = async (id) => { const r = await tryCall(`read status of ${id}`, { method: 'GET', version: 'v3', path: `${base3}/${id}` }); return r?.tasks?.[0]?.status || r?.status; };
            const closedId = (await statusOf(sub))?.id;           // closed by the v2 call above
            const sub2 = ids.B && ids.B !== sub ? ids.B : null;
            const openId = sub2 ? (await statusOf(sub2))?.id : null;
            console.log('status ids:', { openId, closedId });
            if (openId) {
                await tryCall('reopen v3 PATCH status {id: open}', { method: 'PATCH', version: 'v3', path: `${base3}/${sub}`, data: { status: { id: openId } } });
                console.log('after v3 reopen:', short(await statusOf(sub)));
            }
            if (closedId) {
                await tryCall('close v3 PATCH status {id: closed}', { method: 'PATCH', version: 'v3', path: `${base3}/${sub}`, data: { status: { id: closedId } } });
                console.log('after v3 close:', short(await statusOf(sub)));
            }
            if (sub2 && closedId) {
                await tryCall('close sub B v3 PATCH status {id: closed}', { method: 'PATCH', version: 'v3', path: `${base3}/${sub2}`, data: { status: { id: closedId } } });
                console.log('sub B after close:', short(await statusOf(sub2)));
            }
        }
    } finally {
        await tryCall('delete scratch project (v2)', { method: 'DELETE', version: 'v2', path: `/portal/${P}/projects/${PR}/` });
        console.log('\n──── results ────');
        for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.label}${r.ok ? '' : ` [${r.status}${r.fields?.length ? ` ${r.fields.join(',')}` : ''}] ${r.error}`}${r.ok && r.data ? ` => ${r.data}` : ''}`);
        await mongoose.disconnect();
        process.exit(0);
    }
})().catch(async (error) => {
    console.error('FAILED:', error.message);
    try { await mongoose.disconnect(); } catch (_) { /* ignore */ }
    process.exit(1);
});

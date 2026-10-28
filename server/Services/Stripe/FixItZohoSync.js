/**
 * Keeps a Fix it work order's Zoho subtasks and the seller's SellerQI tasks in step.
 *
 * One parent Zoho task per engagement (FixItWorkOrder); under it, the seller's
 * highest-value open SellerQI tasks as subtasks, up to what they have paid for (the
 * work order's quota). Each run, under a per-work-order lock:
 *
 *   1. read the parent's subtasks from Zoho
 *   2. status, by TRANSITION only (the mapping remembers what was last synced, so a change
 *      is never bounced back):
 *        closed in Zoho                       -> SellerQI task completed (completedBy esf_team)
 *        reopened in Zoho                     -> SellerQI task pending
 *        completed / resolved / gone in SellerQI -> Zoho subtask closed
 *        reopened in SellerQI                 -> Zoho subtask reopened
 *   3. content: a SellerQI task whose text or amount changed updates its subtask
 *   4. top-up (active work orders only): unmapped open tasks, best first, until the quota
 *      is used. No duplicates, in either system:
 *        - a SellerQI task is claimed in the mapping (unique per work order AND across the
 *          seller's work orders) before anything is created;
 *        - an existing subtask is adopted instead of creating one when it carries our marker
 *          [SQI:<taskId>] (a crash after creating, before saving), has the same title, or the
 *          AI says the team already made it by hand (FixItSubtaskMatcher).
 *   5. the parent's description: "N of M done".
 *
 * Never throws to its caller (payment, reconcile, cron): failures are recorded on the work order.
 */
const crypto = require('crypto');
const FixItWorkOrder = require('../../models/system/FixItWorkOrderModel.js');
const FixItSubtask = require('../../models/system/FixItSubtaskModel.js');
const TaskItem = require('../../models/MCP/TaskItemModel.js');
const ZohoProjectsService = require('../Zoho/ZohoProjectsService.js');
const { matchSubtasks } = require('../AI/FixItSubtaskMatcher.js');
const { acquireLock } = require('../../utils/mongoLock.js');
const logger = require('../../utils/Logger.js');

const LOCK_TTL_MS = 10 * 60 * 1000;
// A Trial is over when its tasks are all done, or this long after it was bought.
const TRIAL_MAX_DAYS = 30;
const CLAIM_STALE_MS = 10 * 60 * 1000;
const ENDED_GRACE_DAYS = 30;
const MAX_CREATES_PER_RUN = 80; // a big first batch finishes on the next run, not in one burst
const OPEN = new Set(['pending', 'in_progress']);
const DONE = new Set(['completed', 'resolved']);

const marker = (taskId) => `[SQI:${taskId}]`;
// Everything SellerQI writes into Zoho says so, so the team can tell it from a person.
const SELLERQI_MESSAGE = 'SellerQI message';
const daysBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000));

/** Why SellerQI reopened a subtask the team had closed — posted as a comment on it. */
const reopenComment = (task, mapping, now) => {
    const detail = plain(require('../Calculations/CreateTasksService.js').renderTaskIfNeeded(task).error || task.error);
    const bySystem = task.reopenedAt && mapping.closedAt && new Date(task.reopenedAt) >= new Date(mapping.closedAt);
    if (!bySystem) return `${SELLERQI_MESSAGE}: reopened — the seller marked this as not done in SellerQI.`;
    switch (task.reopenReason) {
        case 'escalated':
            return `${SELLERQI_MESSAGE}: reopened — this has got worse on Amazon since it was closed. Now: ${detail}`;
        case 'reappeared':
            return `${SELLERQI_MESSAGE}: reopened — the problem came back on Amazon. Now: ${detail}`;
        default:
            return `${SELLERQI_MESSAGE}: reopened — Amazon still shows this ${daysBetween(mapping.closedAt, now)} days after it was closed. This is a follow-up, not a mistake: please check it again. Now: ${detail}`;
    }
};

/** Why SellerQI closed a subtask — posted as a comment on it. */
const closeComment = (task) => {
    if (!task) return `${SELLERQI_MESSAGE}: closed — this is no longer one of the seller's SellerQI tasks.`;
    if (task.status === 'resolved') return `${SELLERQI_MESSAGE}: closed — Amazon no longer shows this problem.`;
    return `${SELLERQI_MESSAGE}: closed — the seller marked this done in SellerQI.`;
};
const normTitle = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hashOf = (...parts) => crypto.createHash('sha1').update(parts.map((p) => String(p ?? '')).join('\u001f')).digest('hex').slice(0, 16);
const money = (n) => (Number(n) > 0 ? `$${Math.round(Number(n)).toLocaleString('en-US')}` : null);
const isClosedInZoho = (z) => Boolean(z.statusIsClosed || z.isCompleted);
const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Same order the Tasks page shows: money first, then impact, then the quickest, then id. */
const byValue = (meta) => (a, b) => {
    const am = Number(a.amount) || 0;
    const bm = Number(b.amount) || 0;
    if (bm !== am) return bm - am;
    const ma = meta(a);
    const mb = meta(b);
    if ((mb.impactWeight || 0) !== (ma.impactWeight || 0)) return (mb.impactWeight || 0) - (ma.impactWeight || 0);
    if ((ma.effortMinutes || 0) !== (mb.effortMinutes || 0)) return (ma.effortMinutes || 0) - (mb.effortMinutes || 0);
    return String(a.taskId).localeCompare(String(b.taskId));
};

/** What a subtask says about a SellerQI task: a short title, the detail, and our marker. */
const subtaskContent = (task) => {
    const rendered = require('../Calculations/CreateTasksService.js').renderTaskIfNeeded(task);
    const error = plain(rendered.error || task.error);
    const label = error.split(':')[0].replace(/\s*\|\s*/g, ' – ').trim() || task.errorType;
    const subject = task.productName && !/^(account health|\d+ listings)$/i.test(task.productName)
        ? `${task.productName}${task.asin && /^B0/i.test(task.asin) ? ` (${task.asin})` : ''}`
        : task.productName || '';
    const title = `${label}${subject ? ` — ${subject}` : ''}`.slice(0, 240);
    const amount = money(task.amount);
    const description = [
        `${SELLERQI_MESSAGE} — added automatically from the seller's SellerQI tasks.`,
        '',
        error,
        plain(rendered.solution || task.solution) ? `How to fix: ${plain(rendered.solution || task.solution)}` : null,
        amount ? `Worth about ${amount}/month to the seller.` : null,
        '',
        `From SellerQI (task ${task.taskId}). Close this subtask when it is done — the seller sees it as done in SellerQI.`,
        marker(task.taskId),
    ].filter((l) => l !== null).join('\n');
    return { title, description, hash: hashOf(title, description) };
};

const parentDescription = (wo, done, total, openTitles) => [
    `${SELLERQI_MESSAGE} — kept up to date automatically.`,
    '',
    `Fix it ${wo.packageName}${wo.kind === 'subscription' ? ` subscription — ${wo.tasksPerPeriod} tasks a month, month ${wo.monthsPaid}` : ` — ${wo.tasksPerPeriod} tasks`}.`,
    `Progress: ${done} of ${total} done (paid for ${wo.quota}).`,
    wo.status !== 'active' ? (wo.status === 'ending' ? 'The seller has cancelled: no new tasks will be added after this month.' : 'The subscription has ended.') : null,
    '',
    'Each subtask is one of the seller\'s SellerQI tasks, highest value first. Closing a subtask marks it done for the seller in SellerQI; if the seller fixes one themselves, SellerQI closes the subtask here.',
    openTitles.length ? `\nStill open:\n${openTitles.slice(0, 30).map((t) => `• ${t}`).join('\n')}` : null,
    '',
    `Managed by SellerQI [SQI-WO:${wo.key}]`,
].filter((l) => l !== null).join('\n');

const completeInSellerQI = async (task, now) => TaskItem.updateOne(
    { _id: task._id, status: task.status },
    { $set: { status: 'completed', completedAt: now, stillDetected: false, completedBy: 'esf_team' } }
);
const reopenInSellerQI = async (task) => TaskItem.updateOne(
    { _id: task._id, status: task.status },
    { $set: { status: 'pending', stillDetected: false }, $unset: { completedAt: '', completedBy: '' } }
);

/**
 * @param {object} wo  a FixItWorkOrder (plain)
 * @returns {Promise<object>} what changed
 */
async function syncWorkOrder(wo, { now = new Date() } = {}) {
    const summary = { workOrderId: String(wo._id), created: 0, adopted: 0, closedInZoho: 0, completedInSellerQI: 0, reopenedInZoho: 0, reopenedInSellerQI: 0, contentUpdated: 0, removed: 0, skipped: null };
    if (!wo.zohoParentTaskId) { summary.skipped = 'no parent task yet'; return summary; }
    if (wo.status === 'ended' && wo.endedAt && now - new Date(wo.endedAt) > ENDED_GRACE_DAYS * 86400000) { summary.skipped = 'ended'; return summary; }

    const release = await acquireLock(`fixit-zoho:${wo._id}`, LOCK_TTL_MS, 'fixit-zoho-sync');
    if (!release) { summary.skipped = 'locked'; return summary; }
    try {
        const zoho = { projectId: wo.zohoProjectId, portalId: wo.portalId };
        // A comment that fails to post never undoes the status change it explains.
        const comment = (taskId, text) => Promise.resolve()
            .then(() => ZohoProjectsService.postTaskComment({ ...zoho, taskId, comment: text }))
            .catch((error) => logger.warn(`[FixItZohoSync] comment on ${taskId} not posted: ${error.message}`));
        const subtasks = await ZohoProjectsService.listSubtasks({ ...zoho, parentTaskId: wo.zohoParentTaskId });
        const zById = new Map(subtasks.map((z) => [String(z.id), z]));
        const mappings = await FixItSubtask.find({ workOrderId: wo._id }).lean();
        const tasks = await TaskItem.find({ userId: wo.userId, country: wo.country, region: wo.region }).lean();
        const taskById = new Map(tasks.map((t) => [t.taskId, t]));
        const markerOwner = (z) => {
            const m = String(z.description || '').match(/\[SQI:([^\]]+)\]/);
            return m ? m[1] : null;
        };

        // ── 1. Claims left half-done by a crash: adopt the subtask we made, else free the claim ──
        for (const m of mappings.filter((x) => x.state === 'creating')) {
            const made = subtasks.find((z) => markerOwner(z) === m.taskId);
            if (made) {
                await FixItSubtask.updateOne({ _id: m._id }, { $set: { zohoSubtaskId: String(made.id), state: isClosedInZoho(made) ? 'closed' : 'open', adoptedBy: 'marker', lastSyncedAt: now } });
                Object.assign(m, { zohoSubtaskId: String(made.id), state: isClosedInZoho(made) ? 'closed' : 'open' });
            } else if (now - new Date(m.claimedAt || m.createdAt) > CLAIM_STALE_MS) {
                await FixItSubtask.deleteOne({ _id: m._id, state: 'creating' });
                m.state = 'released';
            }
        }

        // ── 2 & 3. Status both ways, then content ──
        for (const m of mappings.filter((x) => x.state === 'open' || x.state === 'closed')) {
            const z = zById.get(String(m.zohoSubtaskId));
            if (!z) {
                // Deleted by the team: never recreated (it still used up its place in the quota).
                await FixItSubtask.updateOne({ _id: m._id }, { $set: { state: 'removed', lastSyncedAt: now } });
                summary.removed++;
                continue;
            }
            const task = taskById.get(m.taskId);
            const zClosed = isClosedInZoho(z);
            const tDone = !task || DONE.has(task.status);
            let state = m.state;
            let closedBy = m.closedBy || null;

            if (m.state === 'open') {
                if (zClosed && !tDone) {
                    await completeInSellerQI(task, now);
                    state = 'closed'; closedBy = 'zoho'; summary.completedInSellerQI++;
                } else if (!zClosed && tDone) {
                    await ZohoProjectsService.closeTask({ ...zoho, taskId: m.zohoSubtaskId });
                    await comment(m.zohoSubtaskId, closeComment(task));
                    state = 'closed'; closedBy = 'sellerqi'; summary.closedInZoho++;
                } else if (zClosed && tDone) {
                    state = 'closed'; closedBy = closedBy || 'zoho';
                }
            } else if (m.state === 'closed') {
                if (!zClosed && tDone && task) {
                    await reopenInSellerQI(task);
                    state = 'open'; closedBy = null; summary.reopenedInSellerQI++;
                } else if (zClosed && !tDone && wo.zohoOpenStatusId) {
                    await ZohoProjectsService.reopenTask({ ...zoho, taskId: m.zohoSubtaskId, openStatusId: wo.zohoOpenStatusId });
                    await comment(m.zohoSubtaskId, reopenComment(task, m, now));
                    state = 'open'; closedBy = null; summary.reopenedInZoho++;
                } else if (!zClosed && !tDone) {
                    state = 'open'; closedBy = null;
                }
            }

            const set = {};
            if (state !== m.state) Object.assign(set, { state, closedBy, ...(state === 'closed' ? { closedAt: now } : {}) });
            if (state === 'open' && task) {
                const content = subtaskContent(task);
                if (content.hash !== m.contentHash) {
                    await ZohoProjectsService.updateTask({ ...zoho, taskId: m.zohoSubtaskId, name: content.title, description: content.description });
                    Object.assign(set, { title: content.title, contentHash: content.hash });
                    summary.contentUpdated++;
                }
            }
            if (Object.keys(set).length) await FixItSubtask.updateOne({ _id: m._id }, { $set: { ...set, lastSyncedAt: now } });
            m.state = state;
        }

        // ── 4. Top-up ──
        if (wo.status === 'active') {
            const live = mappings.filter((m) => m.state !== 'released');
            let slots = Math.max(0, (wo.quota || 0) - live.length);
            if (slots > 0) {
                // Never the same SellerQI task twice: not in this work order, nor in another of the seller's.
                const taken = new Set((await FixItSubtask.find({ userId: wo.userId }).select('identityKey taskId').lean()).flatMap((m) => [m.identityKey, m.taskId]));
                const { getTaskPriorityMeta } = require('../Calculations/TaskPrioritizationService.js');
                const meta = (t) => getTaskPriorityMeta(t) || {};
                const candidates = tasks
                    .filter((t) => OPEN.has(t.status) && !taken.has(t.taskId) && !taken.has(t.identityKey || t.taskId))
                    .sort(byValue(meta))
                    .slice(0, Math.min(slots, MAX_CREATES_PER_RUN));

                const mapped = new Set(mappings.map((m) => String(m.zohoSubtaskId)).filter(Boolean));
                const unmapped = subtasks.filter((z) => !mapped.has(String(z.id)) && !markerOwner(z));
                const byTitle = new Map(unmapped.map((z) => [normTitle(z.name), z]));
                const contents = new Map(candidates.map((t) => [t.taskId, subtaskContent(t)]));
                const aiMatches = await matchSubtasks(
                    candidates.filter((t) => !byTitle.has(normTitle(contents.get(t.taskId).title))).map((t) => ({ key: t.taskId, title: contents.get(t.taskId).title, detail: plain(t.error) })),
                    unmapped.map((z) => ({ id: String(z.id), name: z.name }))
                );
                const usedZ = new Set();

                for (const task of candidates) {
                    if (slots <= 0) break;
                    const content = contents.get(task.taskId);
                    let claim;
                    try {
                        claim = await FixItSubtask.create({ workOrderId: wo._id, userId: wo.userId, taskId: task.taskId, identityKey: task.identityKey || task.taskId, state: 'creating', title: content.title, claimedAt: now });
                    } catch (error) {
                        if (error?.code === 11000) continue; // another run claimed it
                        throw error;
                    }
                    const sameTitle = byTitle.get(normTitle(content.title));
                    const aiId = aiMatches.get(task.taskId);
                    const adopt = (sameTitle && !usedZ.has(String(sameTitle.id)) && { z: sameTitle, by: 'title' })
                        || (aiId && !usedZ.has(aiId) && zById.get(aiId) && { z: zById.get(aiId), by: 'ai' })
                        || null;
                    if (adopt) {
                        usedZ.add(String(adopt.z.id));
                        await FixItSubtask.updateOne({ _id: claim._id }, { $set: { zohoSubtaskId: String(adopt.z.id), state: isClosedInZoho(adopt.z) ? 'closed' : 'open', adoptedBy: adopt.by, lastSyncedAt: now } });
                        summary.adopted++;
                    } else {
                        const made = await ZohoProjectsService.createSubtask({ ...zoho, parentTaskId: wo.zohoParentTaskId, name: content.title, description: content.description });
                        await FixItSubtask.updateOne({ _id: claim._id }, { $set: { zohoSubtaskId: String(made.id), state: 'open', contentHash: content.hash, lastSyncedAt: now } });
                        summary.created++;
                    }
                    slots--;
                }
            }
        }

        // ── 5. The parent's progress ──
        const after = await FixItSubtask.find({ workOrderId: wo._id, state: { $in: ['open', 'closed'] } }).select('state title').lean();
        const done = after.filter((m) => m.state === 'closed').length;
        const description = parentDescription(wo, done, after.length, after.filter((m) => m.state === 'open').map((m) => m.title));
        const parentHash = hashOf(description);
        const woSet = { lastSyncAt: now, lastSyncError: null };
        if (parentHash !== wo.parentContentHash) {
            await ZohoProjectsService.updateTask({ ...zoho, taskId: wo.zohoParentTaskId, description });
            woSet.parentContentHash = parentHash;
        }
        // A Trial ends when the team has done its tasks (or after TRIAL_MAX_DAYS): the seller
        // stops being an ESF client unless they have something else running.
        const trialOver = wo.kind === 'trial' && wo.status === 'active'
            && ((after.length > 0 && done === after.length) || (wo.createdAt && now - new Date(wo.createdAt) > TRIAL_MAX_DAYS * 86400000));
        if (trialOver) Object.assign(woSet, { status: 'ended', endedAt: now });
        await FixItWorkOrder.updateOne({ _id: wo._id }, { $set: woSet });
        if (trialOver) {
            summary.trialEnded = true;
            await require('./FixItEsfClient.js').release(wo.userId);
        }
        Object.assign(summary, { done, total: after.length });
        if (summary.created || summary.adopted || summary.completedInSellerQI || summary.closedInZoho || summary.reopenedInZoho || summary.reopenedInSellerQI) {
            logger.info('[FixItZohoSync] synced', summary);
        }
        return summary;
    } catch (error) {
        logger.error(`[FixItZohoSync] work order ${wo._id} failed: ${error.message}`);
        await FixItWorkOrder.updateOne({ _id: wo._id }, { $set: { lastSyncError: String(error.message).slice(0, 300), lastSyncAt: now } }).catch(() => {});
        return { ...summary, error: error.message };
    } finally {
        await release();
    }
}

const syncWorkOrderById = async (id) => {
    const wo = await FixItWorkOrder.findById(id).lean();
    return wo ? syncWorkOrder(wo) : null;
};

/** Every work order of a seller's marketplace (after their tasks were reconciled). */
const syncForMarketplace = async (userId, country, region) => {
    const orders = await FixItWorkOrder.find({ userId, country, region, status: { $in: ['active', 'ending', 'ended'] } }).lean();
    const out = [];
    for (const wo of orders) out.push(await syncWorkOrder(wo));
    return out;
};

/** The work order a SellerQI task is mirrored in, if any (the seller just changed its status). */
const syncForTask = async (userId, taskId) => {
    const mapping = await FixItSubtask.findOne({ userId, taskId, state: { $in: ['open', 'closed'] } }).select('workOrderId').lean();
    return mapping ? syncWorkOrderById(mapping.workOrderId) : null;
};

/** Background, never throws: for hooks that must not wait on Zoho. */
const syncInBackground = (fn, label) => {
    setImmediate(() => {
        Promise.resolve().then(fn).catch((error) => logger.warn(`[FixItZohoSync] ${label} failed: ${error.message}`));
    });
};

/** The 30-minute sweep: every work order still syncing. */
const syncAll = async ({ now = new Date() } = {}) => {
    const cutoff = new Date(now.getTime() - ENDED_GRACE_DAYS * 86400000);
    const orders = await FixItWorkOrder.find({ $or: [{ status: { $in: ['active', 'ending'] } }, { status: 'ended', endedAt: { $gte: cutoff } }] }).lean();
    const results = [];
    for (const wo of orders) results.push(await syncWorkOrder(wo, { now }));
    return results;
};

module.exports = {
    syncWorkOrder,
    syncWorkOrderById,
    syncForMarketplace,
    syncForTask,
    syncInBackground,
    syncAll,
    subtaskContent,
    parentDescription,
    marker,
    reopenComment,
    closeComment,
    SELLERQI_MESSAGE,
    ENDED_GRACE_DAYS,
};

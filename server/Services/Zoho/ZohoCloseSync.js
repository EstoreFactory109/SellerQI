/**
 * When the team closes a Zoho task, mark the client's SellerQI tasks it fixed as done.
 *
 * For ESF clients added by staff, whose team works from its own Zoho tasks. (Fix it buyers'
 * tasks are Zoho subtasks with their own two-way sync — FixItZohoSync — and are left out.)
 * Called by ZohoTaskSync.syncProject with the tasks that went from open to closed since the
 * last sync; never throws into it.
 *
 * ZOHO_CLOSE_MATCH_MODE:
 *   dry_run (default)  record what WOULD be closed (ESF portal → Auto-closed tasks), change nothing
 *   on                 also complete the matched tasks (completedBy 'esf_team', so the 30-day
 *                      minimum before a still-detected task reopens applies) and say so in a
 *                      "SellerQI message" comment on the Zoho task
 *   off                nothing
 */
const UserModel = require('../../models/user-auth/userModel.js');
const TaskItem = require('../../models/MCP/TaskItemModel.js');
const FixItSubtask = require('../../models/system/FixItSubtaskModel.js');
const ZohoCloseMatch = require('../../models/system/ZohoCloseMatchModel.js');
const ZohoProjectsService = require('./ZohoProjectsService.js');
const { shortlist, matchClosedTask } = require('../AI/ZohoCloseMatcher.js');
const logger = require('../../utils/Logger.js');

const OPEN = ['pending', 'in_progress'];
const modeOf = (env = process.env) => {
    const mode = String(env.ZOHO_CLOSE_MATCH_MODE || 'dry_run').trim().toLowerCase();
    return ['off', 'dry_run', 'on'].includes(mode) ? mode : 'dry_run';
};

const titleOf = (task) => require('../Stripe/FixItZohoSync.js').subtaskContent(task).title;

/**
 * @param {{ projectId: string, portalId?: string, closedTasks: Array<object>, now?: Date }} args
 *        closedTasks: normalised Zoho tasks that just went from open to closed
 */
async function handleClosedTasks({ projectId, portalId, closedTasks = [], now = new Date() }) {
    const mode = modeOf();
    const summary = { mode, closedTasks: closedTasks.length, recorded: 0, completed: 0 };
    if (mode === 'off' || !closedTasks.length) return summary;

    const clients = await UserModel.find({ isEsfClient: true, 'zohoProject.projectId': String(projectId) }).select('_id').lean();
    if (!clients.length) return summary;
    const render = (t) => ({ ...t, ...require('../Calculations/CreateTasksService.js').renderTaskIfNeeded(t) });

    for (const client of clients) {
        // Fix it buyers' mirrored tasks are synced by FixItZohoSync, never here.
        const mirrored = new Set((await FixItSubtask.find({ userId: client._id }).select('taskId').lean()).map((m) => m.taskId));
        let open = (await TaskItem.find({ userId: client._id, status: { $in: OPEN } }).lean())
            .filter((t) => !mirrored.has(t.taskId))
            .map(render);

        for (const z of closedTasks) {
            const closedAt = z.lastUpdatedAt ? new Date(z.lastUpdatedAt) : now;
            const key = { projectId: String(projectId), zohoTaskId: String(z.id), closedAt };
            if (await ZohoCloseMatch.exists(key)) continue;

            const candidates = shortlist(z, open);
            const matched = candidates.length ? await matchClosedTask(z, candidates) : [];
            const byId = new Map(open.map((t) => [t.taskId, t]));
            const matches = matched.map((m) => {
                const t = byId.get(m.taskId);
                return { taskId: m.taskId, taskTitle: titleOf(t), country: t.country, region: t.region, reason: m.reason };
            });

            let row;
            try {
                row = await ZohoCloseMatch.create({ ...key, zohoTaskName: z.name, userId: client._id, mode, matches, considered: candidates.length });
            } catch (error) {
                if (error?.code === 11000) continue; // another sync recorded it
                throw error;
            }
            summary.recorded++;
            if (mode !== 'on' || !matches.length) continue;

            const done = [];
            for (const m of matches) {
                const t = byId.get(m.taskId);
                const r = await TaskItem.updateOne(
                    { _id: t._id, status: { $in: OPEN } },
                    { $set: { status: 'completed', completedAt: now, stillDetected: false, completedBy: 'esf_team' } }
                );
                if (r?.modifiedCount) done.push(m);
            }
            summary.completed += done.length;
            await ZohoCloseMatch.updateOne({ _id: row._id }, { $set: { appliedAt: now } });
            // Each task closes once: a later closed Zoho task in this run must not claim it again.
            const doneIds = new Set(done.map((m) => m.taskId));
            open = open.filter((t) => !doneIds.has(t.taskId));

            if (done.length) {
                const text = [
                    `SellerQI message: marked ${done.length === 1 ? 'this SellerQI task' : `these ${done.length} SellerQI tasks`} done for the client, as fixed by this task:`,
                    ...done.map((m) => `• ${m.taskTitle}`),
                    'If one of these was not part of this work, the client can mark it not done in SellerQI.',
                ].join('\n');
                await Promise.resolve()
                    .then(() => ZohoProjectsService.postTaskComment({ projectId, portalId, taskId: String(z.id), comment: text }))
                    .catch((error) => logger.warn(`[ZohoCloseSync] comment on ${z.id} not posted: ${error.message}`));
            }
        }
    }
    if (summary.recorded) logger.info('[ZohoCloseSync] closed Zoho tasks matched', { projectId, ...summary });
    return summary;
}

/** The seller marked a task not done again: if a close here had done it, note the undo. */
async function noteUndone(userId, taskId) {
    await ZohoCloseMatch.updateOne(
        { userId, mode: 'on', 'matches.taskId': taskId, undoneTaskIds: { $ne: taskId } },
        { $push: { undoneTaskIds: taskId } }
    );
}

module.exports = { handleClosedTasks, noteUndone, modeOf };

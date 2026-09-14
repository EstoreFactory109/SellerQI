/**
 * ZohoTaskSync.js — pull tasks for every linked Zoho project into Mongo.
 *
 * Runs once a day from BackgroundJobs/zohoTaskSyncStandalone.js. The client's
 * Status page reads the synced rows, never Zoho directly, so the page is fast
 * and survives Zoho being slow or rate-limiting.
 *
 * SECTION RULES (In progress / Coming Up / Completed)
 * Zoho has no "not started" state, and each portal names its statuses however
 * it likes — this one uses Open/Content/Design, none of which mean anything
 * portable. So the split is driven by the two fields that do carry meaning
 * everywhere:
 *
 *   Completed  — is_completed, or the status is a closed-type one
 *   Coming Up  — start date is in the future (work that has not begun)
 *   In progress— everything else, INCLUDING tasks with no dates at all
 *
 * The no-dates case is why the default is "in progress" rather than "coming
 * up": in this portal a task like "SOW" carries no dates but has comments and
 * attachments, and calling that "not started" would be plainly wrong.
 *
 * Classification happens at READ time (see classifyTask), not sync time. A
 * stored section would silently go stale the moment a start date passed —
 * within a day, but wrong is wrong, and the comparison is free.
 */

const UserModel = require('../../models/user-auth/userModel.js');
const ZohoProjectTask = require('../../models/system/ZohoProjectTaskModel.js');
const ZohoProjectsService = require('./ZohoProjectsService.js');
const { mapWithConcurrency } = ZohoProjectsService;
const ZohoTaskSummaryService = require('../AI/ZohoTaskSummaryService.js');
const ZohoAuth = require('./ZohoAuth.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');

const SECTIONS = {
    IN_PROGRESS: 'in_progress',
    COMING_UP: 'coming_up',
    COMPLETED: 'completed',
};

/** Safety net: one runaway project must not stall the whole nightly run. */
const MAX_TASKS_PER_PROJECT = 200;

/** How many comment threads are summarised at once. These are OpenAI calls. */
const SUMMARY_CONCURRENCY = 4;

/**
 * Which of the three lists a task belongs in.
 * `now` is injectable so tests do not depend on the wall clock.
 */
const classifyTask = (task, now = new Date()) => {
    if (task.isCompleted || task.statusIsClosed) return SECTIONS.COMPLETED;
    if (task.startDate && new Date(task.startDate).getTime() > now.getTime()) return SECTIONS.COMING_UP;
    return SECTIONS.IN_PROGRESS;
};

/** Every distinct Zoho project an ESF client is currently linked to. */
const linkedProjects = async () => {
    const clients = await UserModel.find({
        isEsfClient: true,
        'zohoProject.projectId': { $ne: null },
    }).select('zohoProject').lean();

    const byProject = new Map();
    for (const client of clients) {
        const { projectId, projectName, portalId } = client.zohoProject || {};
        if (!projectId) continue;
        if (!byProject.has(projectId)) {
            byProject.set(projectId, { projectId, projectName, portalId, clientCount: 0 });
        }
        byProject.get(projectId).clientCount += 1;
    }
    return [...byProject.values()];
};

/**
 * Sync one project's tasks (with their comments) into Mongo.
 * Returns a summary rather than throwing on partial failure, so the caller can
 * log per-project outcomes and keep going.
 */
const syncProject = async ({ projectId, projectName, portalId }) => {
    const updates = await ZohoProjectsService.getProjectTaskUpdates(projectId, {
        includeComments: true,
        maxTasks: MAX_TASKS_PER_PROJECT,
    });

    const tasks = updates.tasks || [];

    // What we already hold, so an unchanged comment thread reuses its stored
    // summary instead of paying to regenerate identical text.
    const existing = tasks.length
        ? await ZohoProjectTask.find({ projectId, taskId: { $in: tasks.map((t) => t.id) } })
            .select('taskId commentSummary').lean()
        : [];
    const priorByTask = new Map(existing.map((row) => [row.taskId, row.commentSummary || {}]));

    // Bounded concurrency: these are network calls to OpenAI, and a 200-task
    // project firing them all at once would hit rate limits rather than finish
    // faster.
    const summaries = await mapWithConcurrency(tasks, SUMMARY_CONCURRENCY, async (task) => {
        const prior = priorByTask.get(task.id) || {};
        return ZohoTaskSummaryService.summariseTask(task, {
            previousHash: prior.sourceHash,
            previousText: prior.text,
        });
    });
    const summaryByTask = new Map(tasks.map((task, i) => [task.id, summaries[i]]));

    if (tasks.length) {
        // One round trip for the whole project rather than a write per task.
        await ZohoProjectTask.bulkWrite(
            tasks.map((task) => ({
                updateOne: {
                    filter: { projectId, taskId: task.id },
                    update: {
                        $set: {
                            portalId: portalId || updates.portalId,
                            projectId,
                            projectName: projectName || null,
                            taskId: task.id,
                            name: task.name,
                            status: task.status,
                            statusIsClosed: task.statusIsClosed,
                            isCompleted: task.isCompleted,
                            priority: task.priority,
                            percentComplete: task.percentComplete,
                            ownerNames: task.ownerNames || [],
                            tasklist: task.tasklist,
                            milestone: task.milestone,
                            createdByName: task.createdByName,
                            updatedByName: task.updatedByName,
                            startDate: task.startDate,
                            endDate: task.endDate,
                            taskCreatedAt: task.createdAt,
                            taskUpdatedAt: task.lastUpdatedAt,
                            hasAttachments: task.hasAttachments,
                            commentSummary: (() => {
                                const sum = summaryByTask.get(task.id);
                                return sum ? {
                                    text: sum.text,
                                    // A reused summary keeps whatever produced it originally.
                                    generatedBy: sum.reused
                                        ? (priorByTask.get(task.id)?.generatedBy || 'reused')
                                        : sum.generatedBy,
                                    model: sum.model || priorByTask.get(task.id)?.model || null,
                                    sourceHash: sum.sourceHash,
                                    commentCount: sum.commentCount,
                                    generatedAt: sum.reused
                                        ? (priorByTask.get(task.id)?.generatedAt || new Date())
                                        : new Date(),
                                } : undefined;
                            })(),
                            comments: (task.comments || []).map((c) => ({
                                commentId: c.id,
                                content: c.content,
                                authorName: c.authorName,
                                createdAt: c.createdAt,
                                attachmentCount: c.attachmentCount,
                            })),
                            syncedAt: new Date(),
                        },
                    },
                    upsert: true,
                },
            })),
            { ordered: false }
        );
    }

    // Drop rows for tasks deleted in Zoho, so the page cannot show work that no
    // longer exists. Scoped to this project only.
    const liveIds = tasks.map((t) => t.id);
    const removed = await ZohoProjectTask.deleteMany({
        projectId,
        ...(liveIds.length ? { taskId: { $nin: liveIds } } : {}),
    });

    return {
        projectId,
        projectName,
        tasks: tasks.length,
        comments: tasks.reduce((sum, t) => sum + (t.comments?.length || 0), 0),
        summarised: summaries.filter((s) => s.generatedBy === 'ai').length,
        summariesReused: summaries.filter((s) => s.reused).length,
        removed: removed.deletedCount || 0,
        truncated: Boolean(updates.truncated),
    };
};

/**
 * Drop rows for projects no client is linked to any more.
 *
 * Without this, unlinking a client (or re-pointing them at a different project)
 * would leave that project's tasks in the collection forever — invisible, but
 * growing, and re-appearing if the project is ever linked again with stale data.
 */
const pruneUnlinkedProjects = async (liveProjectIds) => {
    const result = await ZohoProjectTask.deleteMany(
        liveProjectIds.length ? { projectId: { $nin: liveProjectIds } } : {}
    );
    const removed = result.deletedCount || 0;
    if (removed) logger.info(`[ZohoTaskSync] pruned ${removed} rows from unlinked projects`);
    return removed;
};

/**
 * Sync every linked project.
 *
 * Per-project try/catch: one project failing (deleted in Zoho, permissions
 * changed) must not end the sweep for the others.
 */
const syncAllProjects = async ({ deadlineAt = null } = {}) => {
    const connection = await ZohoAuth.getConnection();
    if (!connection || !connection.portalId) {
        throw new ApiError(428, 'Zoho Projects is not connected — nothing to sync');
    }

    const projects = await linkedProjects();
    const results = [];
    let skippedForTime = 0;

    for (const project of projects) {
        if (deadlineAt && Date.now() > deadlineAt) {
            skippedForTime += 1;
            continue;
        }
        try {
            const summary = await syncProject(project);
            results.push({ ok: true, ...summary });
            logger.info(
                `[ZohoTaskSync] ${summary.projectName || summary.projectId}: `
                + `${summary.tasks} tasks, ${summary.comments} comments, `
                + `${summary.summarised} summarised (${summary.summariesReused} reused)`
                + `${summary.removed ? `, ${summary.removed} removed` : ''}`
                + `${summary.truncated ? ' (TRUNCATED at the per-project cap)' : ''}`
            );
        } catch (error) {
            results.push({ ok: false, projectId: project.projectId, projectName: project.projectName, error: error.message });
            logger.error(new ApiError(error.statusCode || 500,
                `[ZohoTaskSync] ${project.projectName || project.projectId} failed: ${error.message}`));
        }
    }

    // Only safe once every project has been attempted: pruning against a
    // partial list would delete rows for projects that merely timed out.
    const pruned = skippedForTime === 0
        ? await pruneUnlinkedProjects(projects.map((p) => p.projectId))
        : 0;

    return {
        projects: projects.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        skippedForTime,
        pruned,
        tasks: results.reduce((sum, r) => sum + (r.tasks || 0), 0),
        comments: results.reduce((sum, r) => sum + (r.comments || 0), 0),
        summarised: results.reduce((sum, r) => sum + (r.summarised || 0), 0),
        summariesReused: results.reduce((sum, r) => sum + (r.summariesReused || 0), 0),
        results,
    };
};

/**
 * The three lists for one project, ready for the Status page.
 * Ordering mirrors what each section is for: active work by most recent
 * activity, upcoming work by when it starts, finished work by most recent.
 */
const getTaskBoard = async (projectId, { now = new Date(), completedSinceDays = 30 } = {}) => {
    const rows = await ZohoProjectTask.find({ projectId }).lean();

    const board = { inProgress: [], comingUp: [], completed: [] };
    const completedCutoff = new Date(now.getTime() - completedSinceDays * 86400000);

    for (const row of rows) {
        const section = classifyTask(row, now);
        if (section === SECTIONS.COMPLETED) {
            // "Completed, last 30 days" — older finished work stays out of the
            // page rather than growing the list forever.
            if (row.taskUpdatedAt && new Date(row.taskUpdatedAt) < completedCutoff) continue;
            board.completed.push(row);
        } else if (section === SECTIONS.COMING_UP) {
            board.comingUp.push(row);
        } else {
            board.inProgress.push(row);
        }
    }

    const byUpdated = (a, b) => new Date(b.taskUpdatedAt || 0) - new Date(a.taskUpdatedAt || 0);
    board.inProgress.sort(byUpdated);
    board.completed.sort(byUpdated);
    board.comingUp.sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0));

    return {
        ...board,
        syncedAt: rows.reduce(
            (latest, r) => (!latest || (r.syncedAt && r.syncedAt > latest) ? r.syncedAt : latest),
            null
        ),
        totalTasks: rows.length,
    };
};

module.exports = {
    SECTIONS,
    MAX_TASKS_PER_PROJECT,
    classifyTask,
    linkedProjects,
    pruneUnlinkedProjects,
    syncProject,
    syncAllProjects,
    getTaskBoard,
};

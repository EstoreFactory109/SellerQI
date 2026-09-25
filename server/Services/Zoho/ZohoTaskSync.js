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
const EsfSuggestedWork = require('../../models/system/EsfSuggestedWorkModel.js');
const EsfUntapped = require('../../models/system/EsfUntappedModel.js');
const TopOpportunities = require('../../models/system/TopOpportunitiesModel.js');
const ZohoOpportunityMatchService = require('../AI/ZohoOpportunityMatchService.js');
const ZohoProjectsService = require('./ZohoProjectsService.js');
const { mapWithConcurrency } = ZohoProjectsService;
const ZohoTaskSummaryService = require('../AI/ZohoTaskSummaryService.js');
const { parseOpportunity, PARSER_VERSION } = require('../AI/UntappedParserService.js');
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

/**
 * The tasklist the Untapped page is built from. Compared lower-cased and trimmed,
 * because this is typed by hand in Zoho and "untapped " is the same tasklist.
 */
const UNTAPPED_TASKLIST = 'untapped';

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
            .select('taskId commentSummary waitingOnClient team').lean()
        : [];
    const priorByTask = new Map(existing.map((row) => [row.taskId, {
        ...(row.commentSummary || {}),
        ask: row.waitingOnClient?.ask ? row.waitingOnClient : null,
        team: row.team || null,
    }]));

    // Bounded concurrency: these are network calls to OpenAI, and a 200-task
    // project firing them all at once would hit rate limits rather than finish
    // faster.
    const summaries = await mapWithConcurrency(tasks, SUMMARY_CONCURRENCY, async (task) => {
        const prior = priorByTask.get(task.id) || {};
        return ZohoTaskSummaryService.summariseTask(task, {
            previousHash: prior.sourceHash,
            previousText: prior.text,
            previousVersion: prior.promptVersion,
            previousAsk: prior.ask,
            previousTeam: prior.team,
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
                            team: summaryByTask.get(task.id)?.team || null,
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
                                    promptVersion: sum.promptVersion,
                                    commentCount: sum.commentCount,
                                    generatedAt: sum.reused
                                        ? (priorByTask.get(task.id)?.generatedAt || new Date())
                                        : new Date(),
                                } : undefined;
                            })(),
                            waitingOnClient: (() => {
                                const ask = summaryByTask.get(task.id)?.waitingOnClient;
                                if (!ask) return { ask: null, kind: null, since: null };
                                // Dated from the thread itself rather than asked of
                                // the model, which cannot be trusted with dates.
                                const latest = (task.comments || []).reduce(
                                    (newest, c) => (!newest || new Date(c.createdAt || 0) > new Date(newest.createdAt || 0) ? c : newest),
                                    null
                                );
                                return { ask: ask.ask, kind: ask.kind, since: latest?.createdAt || null };
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

    const suggested = await refreshSuggestedWork(projectId, tasks);
    const untapped = await refreshUntapped(projectId, tasks, { projectName });

    return {
        projectId,
        projectName,
        tasks: tasks.length,
        suggested,
        untapped,
        comments: tasks.reduce((sum, t) => sum + (t.comments?.length || 0), 0),
        summarised: summaries.filter((s) => s.generatedBy === 'ai').length,
        waitingOnClient: summaries.filter((s) => s.waitingOnClient).length,
        summariesReused: summaries.filter((s) => s.reused).length,
        removed: removed.deletedCount || 0,
        truncated: Boolean(updates.truncated),
    };
};

/**
 * Work out which of the Dashboard's "Top things to fix" the team is NOT already on,
 * and store them for this project's Coming up list.
 *
 * Runs here rather than at request time for the usual reason — it costs an LLM call,
 * and the Status page is meant to be a plain database read.
 *
 * Matched against OPEN tasks only, never completed ones. If the team finished a piece
 * of work and the audit still reports the problem, that is worth surfacing again
 * rather than suppressing as "already done".
 *
 * Never throws: a failure here must not take down a task sync that already succeeded.
 */
const refreshSuggestedWork = async (projectId, tasks, now = new Date()) => {
    try {
        const client = await UserModel.findOne({
            isEsfClient: true,
            'zohoProject.projectId': projectId,
        }).select('_id').lean();

        if (!client) return { skipped: 'no linked client' };

        /*
         * TopOpportunities is stored per (user, country, region) but the Status page has
         * no marketplace dimension, so take the most recently written one. For a typical
         * ESF client that is their only marketplace; for a multi-marketplace seller it is
         * the one whose data moved last, which is the closest thing to "current" available
         * without inventing a primary-marketplace concept here.
         */
        const opportunityDoc = await TopOpportunities.findOne({ userId: client._id })
            .sort({ updatedAt: -1 })
            .lean();

        const opportunities = (opportunityDoc?.opportunities || []).map((o) => ({
            candidateId: o.candidateId,
            rank: o.rank,
            title: o.title,
            action: o.action,
            category: o.category,
            issueType: o.issueType,
            amount: o.amount,
            count: o.count,
        }));

        if (opportunities.length === 0) {
            await EsfSuggestedWork.deleteOne({ projectId });
            return { suggestions: 0, skipped: 'no opportunities' };
        }

        const openTasks = (tasks || [])
            .filter((task) => classifyTask({
                isCompleted: task.isCompleted,
                statusIsClosed: task.statusIsClosed,
                startDate: task.startDate,
            }, now) !== SECTIONS.COMPLETED)
            .map((task) => ({ taskId: task.id, name: task.name, tasklist: task.tasklist }));

        const prior = await EsfSuggestedWork.findOne({ projectId }).lean();
        const result = await ZohoOpportunityMatchService.matchOpportunities({
            opportunities,
            tasks: openTasks,
            previous: {
                hash: prior?.sourceHash,
                version: prior?.promptVersion,
                matches: prior?.suggestions?.map((s) => ({
                    candidateId: s.candidateId,
                    covered: s.covered,
                    coveredByTaskId: s.coveredByTaskId,
                    coveredByTaskName: s.coveredByTaskName,
                    matchedBy: s.matchedBy,
                })),
            },
        });

        const matchById = new Map(result.matches.map((m) => [String(m.candidateId), m]));

        await EsfSuggestedWork.updateOne(
            { projectId },
            {
                $set: {
                    projectId,
                    userId: client._id,
                    country: opportunityDoc?.country || null,
                    region: opportunityDoc?.region || null,
                    currencyCode: opportunityDoc?.currencyCode || 'USD',
                    suggestions: opportunities.map((o) => {
                        const match = matchById.get(String(o.candidateId)) || {};
                        return {
                            ...o,
                            covered: Boolean(match.covered),
                            coveredByTaskId: match.coveredByTaskId || null,
                            coveredByTaskName: match.coveredByTaskName || null,
                            matchedBy: match.matchedBy || 'none',
                        };
                    }),
                    sourceHash: result.sourceHash,
                    promptVersion: result.promptVersion,
                    generatedBy: result.generatedBy,
                    generatedAt: new Date(),
                },
            },
            { upsert: true }
        );

        const covered = result.matches.filter((m) => m.covered).length;
        return {
            suggestions: opportunities.length,
            covered,
            surfaced: opportunities.length - covered,
            matchedBy: result.generatedBy,
        };
    } catch (error) {
        logger.warn(`[ZohoTaskSync] Suggested work for project ${projectId} failed: ${error.message}`);
        return { error: error.message };
    }
};

/**
 * Rebuild the client's Untapped page from the tasks we already fetched.
 *
 * The shape in Zoho is a tasklist called "Untapped" holding two tasks — "Within Amazon"
 * and "Off Amazon" — whose SUBTASKS are the opportunities. Nothing here makes an extra
 * Zoho call: subtasks come back in the ordinary task list as rows with `depth: 1` and a
 * `parentTaskId`, which is just as well, because the tasklists endpoint needs a scope
 * this connection does not have and the v3 subtasks endpoint answers
 * URL_RULE_NOT_CONFIGURED.
 *
 * Like refreshSuggestedWork, this never throws. A project whose Untapped tasklist is
 * malformed must not take the whole nightly sync down with it.
 */
const refreshUntapped = async (projectId, tasks, { projectName = null } = {}) => {
    try {
        const inTasklist = (tasks || []).filter(
            (t) => String(t.tasklist || '').trim().toLowerCase() === UNTAPPED_TASKLIST
        );

        // No tasklist yet is the ordinary state for a client nobody has written
        // opportunities for. Clear any previous doc so a deleted tasklist empties the
        // page rather than leaving yesterday's cards up forever.
        if (!inTasklist.length) {
            await EsfUntapped.deleteOne({ projectId });
            return { opportunities: 0, cleared: true };
        }

        const sectionOf = (name) => {
            const text = String(name || '').toLowerCase();
            if (/within\s+amazon/.test(text)) return 'within';
            if (/off\s+amazon/.test(text)) return 'off';
            return null;
        };

        // The two section headings. Matched on NAME, so a rename in Zoho silently
        // empties a section — hence the warning below rather than a quiet skip.
        const sectionByTaskId = new Map();
        for (const task of inTasklist) {
            const section = sectionOf(task.name);
            if (section && !task.parentTaskId) sectionByTaskId.set(String(task.id), section);
        }

        if (!sectionByTaskId.size) {
            logger.warn(
                `[ZohoTaskSync] project ${projectId} has an "Untapped" tasklist but no `
                + '"Within Amazon" / "Off Amazon" task in it — nothing to show'
            );
        }

        const candidates = inTasklist.filter((task) => {
            if (!task.parentTaskId) return false;
            if (!sectionByTaskId.has(String(task.parentTaskId))) return false;
            // A closed opportunity is no longer untapped.
            return !task.isCompleted && !task.statusIsClosed;
        });

        const orphans = inTasklist.filter(
            (t) => t.parentTaskId && !sectionByTaskId.has(String(t.parentTaskId))
        );
        if (orphans.length) {
            logger.warn(
                `[ZohoTaskSync] project ${projectId}: ${orphans.length} Untapped subtask(s) `
                + 'sit under a task that is neither "Within Amazon" nor "Off Amazon"'
            );
        }

        const capped = candidates.slice(0, EsfUntapped.MAX_OPPORTUNITIES);

        const opportunities = [];
        let currencyCode = null;
        for (const [index, task] of capped.entries()) {
            // Sequential on purpose: the parser only reaches the network in the rare
            // case the pattern fails, so there is nothing here worth parallelising.
            const parsed = await parseOpportunity(task.description);
            // One currency for the page — the first real one wins. Mixed currencies in
            // a single project would be a data problem in Zoho, not a thing to render.
            if (!currencyCode && parsed.currencyCode) currencyCode = parsed.currencyCode;
            opportunities.push({
                taskId: String(task.id),
                parentTaskId: String(task.parentTaskId),
                section: sectionByTaskId.get(String(task.parentTaskId)),
                title: task.name || null,
                body: parsed.body || '',
                amount: parsed.amount,
                period: parsed.period,
                amountLabel: parsed.amountLabel,
                rank: index,
                parsedBy: parsed.parsedBy,
            });
        }

        await EsfUntapped.updateOne(
            { projectId },
            {
                $set: {
                    projectId,
                    projectName: projectName || null,
                    userId: (await UserModel.findOne({ 'zohoProject.projectId': projectId })
                        .select('_id').lean())?._id || null,
                    currencyCode: currencyCode || 'USD',
                    opportunities,
                    parserVersion: PARSER_VERSION,
                    syncedAt: new Date(),
                },
            },
            { upsert: true }
        );

        const unparsed = opportunities.filter((o) => o.parsedBy === 'none').length;
        if (unparsed) {
            logger.warn(
                `[ZohoTaskSync] project ${projectId}: ${unparsed} of ${opportunities.length} `
                + 'Untapped descriptions had no readable price — check the format in Zoho'
            );
        }

        return {
            opportunities: opportunities.length,
            within: opportunities.filter((o) => o.section === 'within').length,
            off: opportunities.filter((o) => o.section === 'off').length,
            unparsed,
        };
    } catch (error) {
        logger.warn(`[ZohoTaskSync] Untapped for project ${projectId} failed: ${error.message}`);
        return { error: error.message };
    }
};

/**
 * Drop rows for projects no client is linked to any more.
 *
 * Without this, unlinking a client (or re-pointing them at a different project)
 * would leave that project's tasks in the collection forever — invisible, but
 * growing, and re-appearing if the project is ever linked again with stale data.
 */
const pruneUnlinkedProjects = async (liveProjectIds) => {
    const scope = liveProjectIds.length ? { projectId: { $nin: liveProjectIds } } : {};

    const result = await ZohoProjectTask.deleteMany(scope);
    // The Untapped page is per-project too, and describes the client's business in
    // detail — leaving it behind on an unlinked project is the same leak this function
    // exists to prevent, one collection over.
    const untapped = await EsfUntapped.deleteMany(scope);

    const removed = result.deletedCount || 0;
    if (removed) logger.info(`[ZohoTaskSync] pruned ${removed} rows from unlinked projects`);
    if (untapped.deletedCount) {
        logger.info(`[ZohoTaskSync] pruned untapped for ${untapped.deletedCount} unlinked project(s)`);
    }
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
                + `${summary.summarised} summarised (${summary.summariesReused} reused), `
                + `${summary.waitingOnClient} waiting on the client`
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
        waitingOnClient: results.reduce((sum, r) => sum + (r.waitingOnClient || 0), 0),
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
        /**
         * The Untapped tasklist is not work, and must not appear here.
         *
         * Its tasks are synced like any other — they come from the same task list — so
         * without this the client's Status page shows "Within Amazon", "Off Amazon" and
         * every opportunity subtask as work in progress. That overstates what the team
         * is actually doing, which is close to the worst thing this page can get wrong.
         * They belong on the Untapped page, and only there.
         */
        if (String(row.tasklist || '').trim().toLowerCase() === UNTAPPED_TASKLIST) continue;

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

    // Audit findings the team has no open task for. Stored by the nightly sync, so
    // this stays a plain read — see refreshSuggestedWork.
    const suggestedDoc = await EsfSuggestedWork.findOne({ projectId }).lean();
    const suggested = (suggestedDoc?.suggestions || [])
        .filter((s) => !s.covered)
        .sort((a, b) => (a.rank || 99) - (b.rank || 99))
        .map((s) => ({ ...s, currencyCode: suggestedDoc?.currencyCode || 'USD' }));

    return {
        ...board,
        suggested,
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
    refreshSuggestedWork,
    refreshUntapped,
    UNTAPPED_TASKLIST,
    syncProject,
    syncAllProjects,
    getTaskBoard,
};

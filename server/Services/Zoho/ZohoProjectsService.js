/**
 * ZohoProjectsService.js — the business operations exposed over /api/zoho.
 *
 *   listPortals()             resolve which portal to operate on (connect time only)
 *   listProjects()            all projects in the connected portal
 *   createProject()           create a new project
 *   getProjectTaskUpdates()   tasks + their comments + activity feed + status posts
 *
 * Everything returns a normalised shape rather than raw Zoho payloads, so a future UI
 * is not coupled to Zoho's field naming (which differs between v2 and v3 for the same
 * resource — e.g. `created_time` vs `created_time_long`).
 */

const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const { zohoRequest, paginate, unwrap, resolvePortalId } = require('./ZohoProjectsClient.js');
const {
    PATHS,
    PAGE_SIZE,
    MAX_TASKS_DEFAULT,
    COMMENT_FETCH_CONCURRENCY
} = require('./config.js');

/**
 * Run `fn` over `items` with at most `limit` in flight.
 *
 * Written locally rather than using p-limit: the root package.json has p-limit@6, but
 * v6 is ESM-only and require() on it throws in this CommonJS codebase, and nothing under
 * server/ uses it today.
 */
const mapWithConcurrency = async (items, limit, fn) => {
    const results = new Array(items.length);
    let cursor = 0;

    const worker = async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await fn(items[index], index);
        }
    };

    const size = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: size }, worker));

    return results;
};

/**
 * Zoho returns ids as numbers in v3 and strings in v2; normalise to string.
 * Nullish-aware rather than truthy-aware: `id || id_string` would discard a legitimate
 * numeric 0 or an empty-string id and quietly yield null.
 */
const asId = (...candidates) => {
    for (const value of candidates) {
        if (value !== undefined && value !== null && value !== '') {
            return String(value);
        }
    }
    return null;
};

/** Zoho date fields vary: ISO string, epoch millis, or a `_long` sibling. Return an ISO string. */
const asDate = (...candidates) => {
    for (const value of candidates) {
        if (value === undefined || value === null || value === '') {
            continue;
        }
        if (typeof value === 'number') {
            return new Date(value).toISOString();
        }
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return new Date(parsed).toISOString();
        }
    }
    return null;
};

const normaliseProject = (project = {}) => ({
    id: asId(project.id, project.id_string),
    name: project.name || null,
    description: project.description || null,
    status: project.status || null,
    ownerName: project.owner_name || (project.created_by_details && project.created_by_details.name) || null,
    createdAt: asDate(project.created_date_long, project.created_time_long, project.created_date, project.created_time),
    startDate: asDate(project.start_date_long, project.start_date),
    endDate: asDate(project.end_date_long, project.end_date),
    taskCount: (project.task_count && (project.task_count.open + project.task_count.closed)) || null,
    url: (project.link && project.link.self && project.link.self.url) || project.url || null
});

const normaliseTask = (task = {}) => ({
    id: asId(task.id, task.id_string),
    key: task.key || null,
    name: task.name || null,
    description: task.description || null,
    status: (task.status && (task.status.name || task.status)) || null,
    priority: task.priority || null,
    percentComplete: task.percent_complete !== undefined ? Number(task.percent_complete) : null,
    ownerNames: Array.isArray(task.details && task.details.owners)
        ? task.details.owners.map((o) => o.name).filter(Boolean)
        : [],
    createdAt: asDate(task.created_time_long, task.created_time, task.created_date),
    lastUpdatedAt: asDate(task.last_updated_time_long, task.last_updated_time),
    startDate: asDate(task.start_date_long, task.start_date),
    endDate: asDate(task.end_date_long, task.end_date),
    url: (task.link && task.link.self && task.link.self.url) || null
});

const normaliseComment = (comment = {}) => ({
    id: asId(comment.id, comment.id_string),
    content: comment.content || comment.comment || null,
    authorName: comment.added_by_name || comment.added_by || null,
    createdAt: asDate(comment.created_time_long, comment.created_time, comment.added_time),
    attachmentCount: Array.isArray(comment.attachments) ? comment.attachments.length : 0
});

const normaliseActivity = (activity = {}) => ({
    id: asId(activity.id, activity.id_string),
    name: activity.name || null,
    activityBy: activity.activity_by || null,
    activityFor: activity.activity_for || null,
    state: activity.state || null,
    time: asDate(activity.time_long, activity.time),
    displayName: activity.display_name || null
});

const normaliseStatus = (status = {}) => ({
    id: asId(status.id, status.id_string),
    content: status.content || null,
    postedBy: status.posted_by || status.posted_person || null,
    postedAt: asDate(status.created_time_long, status.created_time, status.posted_time)
});

/**
 * List the portals this Zoho account can see.
 * Used once during connect to pick and persist a portalId — every other operation reads
 * the persisted one.
 */
const listPortals = async () => {
    const payload = await zohoRequest({
        path: PATHS.portals.path(),
        version: PATHS.portals.version,
        context: 'Listing Zoho portals'
    });

    return unwrap(payload, PATHS.portals.envelope).map((portal) => ({
        id: asId(portal.id, portal.id_string),
        name: portal.name || null,
        isDefault: Boolean(portal.default),
        role: portal.role || null
    }));
};

/**
 * All projects in the connected portal.
 * `status` filters Zoho-side ('active' | 'archived' | 'template'); omit for all.
 */
const listProjects = async ({ status, limit } = {}) => {
    const portalId = await resolvePortalId();

    const params = {};
    if (status) {
        params.status = status;
    }

    const projects = await paginate({
        path: PATHS.projects.path(portalId),
        version: PATHS.projects.version,
        envelope: PATHS.projects.envelope,
        pageSize: PAGE_SIZE.projects,
        params,
        maxItems: limit || Infinity,
        context: 'Listing Zoho projects'
    });

    return projects.map(normaliseProject);
};

/**
 * Create a project. `name` is the only field Zoho requires.
 * Dates are passed through as given — Zoho expects MM-DD-YYYY on v2 and ISO on v3.
 */
const createProject = async ({ name, description, startDate, endDate, ownerId }) => {
    if (!name || !String(name).trim()) {
        const error = new ApiError(400, 'Project name is required');
        logger.error(error);
        throw error;
    }

    const portalId = await resolvePortalId();

    const body = { name: String(name).trim() };
    if (description) body.description = description;
    if (startDate) body.start_date = startDate;
    if (endDate) body.end_date = endDate;
    if (ownerId) body.owner = ownerId;

    const payload = await zohoRequest({
        method: 'POST',
        path: PATHS.projects.path(portalId),
        version: PATHS.projects.version,
        data: body,
        // v2 requires form-encoded writes; v3 takes JSON.
        form: PATHS.projects.version === 'v2',
        context: 'Creating a Zoho project'
    });

    // Zoho echoes the created project inside the same envelope it uses for lists.
    const created = unwrap(payload, PATHS.projects.envelope)[0] || payload;
    logger.info(`[ZohoProjects] Created project "${body.name}" in portal ${portalId}`);

    return normaliseProject(created);
};

/**
 * The composite "everything happening on this project" read:
 *   1. the task list
 *   2. each task's comments  <- one request per task (N+1), bounded below
 *   3. the project activity feed (audit stream of who changed what)
 *   4. the posted project status updates
 *
 * Steps 3 and 4 are best-effort: a portal on a plan without those endpoints, or a
 * documented-path drift between API generations, should not fail the whole call — the
 * tasks and comments are the part the caller actually asked for.
 */
const getProjectTaskUpdates = async (projectId, { includeComments = true, maxTasks = MAX_TASKS_DEFAULT } = {}) => {
    if (!projectId) {
        const error = new ApiError(400, 'Project ID is required');
        logger.error(error);
        throw error;
    }

    const portalId = await resolvePortalId();
    const taskCap = Math.max(1, Number(maxTasks) || MAX_TASKS_DEFAULT);

    // Fetch one extra task so we can tell "exactly at the cap" from "actually truncated".
    const rawTasks = await paginate({
        path: PATHS.tasks.path(portalId, projectId),
        version: PATHS.tasks.version,
        envelope: PATHS.tasks.envelope,
        pageSize: PAGE_SIZE.tasks,
        maxItems: taskCap + 1,
        context: `Listing tasks for Zoho project ${projectId}`
    });

    const truncated = rawTasks.length > taskCap;
    const tasks = rawTasks.slice(0, taskCap).map(normaliseTask);

    if (includeComments && tasks.length > 0) {
        // N+1 by necessity — Zoho has no bulk comment endpoint. Bounded by taskCap above
        // and by the concurrency limit here so a large project cannot saturate the
        // connection pool or trip Zoho's rate limiter.
        const commentSets = await mapWithConcurrency(tasks, COMMENT_FETCH_CONCURRENCY, async (task) => {
            if (!task.id) {
                return [];
            }
            try {
                const comments = await paginate({
                    path: PATHS.taskComments.path(portalId, projectId, task.id),
                    version: PATHS.taskComments.version,
                    envelope: PATHS.taskComments.envelope,
                    pageSize: PAGE_SIZE.comments,
                    context: `Fetching comments for Zoho task ${task.id}`
                });
                return comments.map(normaliseComment);
            } catch (error) {
                // One unreadable task must not sink the whole response.
                logger.warn(`[ZohoProjects] Could not fetch comments for task ${task.id}: ${error.message}`);
                return [];
            }
        });

        tasks.forEach((task, i) => {
            task.comments = commentSets[i] || [];
        });
    } else {
        tasks.forEach((task) => {
            task.comments = [];
        });
    }

    const [activities, statuses] = await Promise.all([
        paginate({
            path: PATHS.activities.path(portalId, projectId),
            version: PATHS.activities.version,
            envelope: PATHS.activities.envelope,
            pageSize: PAGE_SIZE.activities,
            maxItems: PAGE_SIZE.activities,
            context: `Fetching activities for Zoho project ${projectId}`
        }).catch((error) => {
            logger.warn(`[ZohoProjects] Activity feed unavailable for project ${projectId}: ${error.message}`);
            return null;
        }),
        paginate({
            path: PATHS.statuses.path(portalId, projectId),
            version: PATHS.statuses.version,
            envelope: PATHS.statuses.envelope,
            pageSize: PAGE_SIZE.statuses,
            maxItems: PAGE_SIZE.statuses,
            context: `Fetching status updates for Zoho project ${projectId}`
        }).catch((error) => {
            logger.warn(`[ZohoProjects] Status feed unavailable for project ${projectId}: ${error.message}`);
            return null;
        })
    ]);

    return {
        projectId: asId(projectId),
        portalId,
        tasks,
        taskCount: tasks.length,
        // null (not []) distinguishes "the feed failed" from "the feed is empty".
        activities: activities ? activities.map(normaliseActivity) : null,
        statuses: statuses ? statuses.map(normaliseStatus) : null,
        truncated
    };
};

module.exports = {
    listPortals,
    listProjects,
    createProject,
    getProjectTaskUpdates,
    mapWithConcurrency
};

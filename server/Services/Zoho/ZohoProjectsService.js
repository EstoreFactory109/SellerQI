/**
 * ZohoProjectsService.js — the business operations exposed over /api/zoho.
 *
 *   listPortals()             resolve which portal to operate on (connect time only)
 *   listProjects()            all projects in the connected portal
 *   createProject()           create a new project
 *   getProjectTaskUpdates()   tasks + their comments + activity feed + status posts
 *   postTaskComment()        write a comment onto a task
 *   uploadTaskAttachment()   attach one file to a task
 *
 * Everything returns a normalised shape rather than raw Zoho payloads, so a future UI
 * is not coupled to Zoho's field naming (which differs between v2 and v3 for the same
 * resource — e.g. `created_time` vs `created_time_long`).
 */

const FormData = require('form-data');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const { zohoRequest, paginate, unwrap, resolvePortalId } = require('./ZohoProjectsClient.js');
const { toPlainText, toPlainLabel } = require('./zohoRichText.js');
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
/**
 * A calendar date in the form the v3 write API accepts.
 *
 * Reads from the live portal come back as `"2026-05-05T13:30:00.000Z"`, and a bare
 * `YYYY-MM-DD` is refused with INVALID_PARAMETER_VALUE. Midday UTC because a due date
 * has no time of day and midnight would land on the previous date in any portal west
 * of UTC. Anything already carrying a time is passed through untouched.
 */
const zohoDate = (value) => {
    if (!value) return value;
    const text = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    return `${text}T12:00:00.000Z`;
};

/** The same dates in the v2 dialect, for the single retry in createTask. */
const legacyDates = (body) => {
    const toLegacy = (value) => {
        if (!value) return undefined;
        const [y, m, d] = String(value).slice(0, 10).split('-');
        return y && m && d ? `${m}-${d}-${y}` : undefined;
    };
    const out = {};
    if (body.start_date) out.start_date = toLegacy(body.start_date);
    if (body.end_date) out.end_date = toLegacy(body.end_date);
    return Object.keys(out).length ? out : null;
};

/**
 * Whether Zoho refused this specifically because a date was the wrong SHAPE.
 *
 * Deliberately narrow. Retrying a rejection that was about anything else — a missing
 * field, a permission, an unknown project — would just make the same wrong call twice
 * and bury the real reason under the second failure.
 */
const isDateFormatRejection = (error) => error?.statusCode === 400
    && /input format mismatch|INVALID_PARAMETER_VALUE/i.test(String(error.message || ''));

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
    // Zoho returns HTML here (the UI's rich-text field), not plain text.
    description: project.description || null,
    // v3 nests status as an object with its own id/name/colour; the bare value is
    // "[object Object]" if used directly.
    status: (project.status && project.status.name) || project.status_name || null,
    // Separate from status: 'active' | 'archived' | 'template'.
    projectType: project.project_type || null,
    ownerName: (project.owner && (project.owner.full_name || project.owner.name))
        || (project.created_by && project.created_by.full_name)
        || null,
    ownerEmail: (project.owner && project.owner.email) || null,
    createdAt: asDate(project.created_time, project.created_time_long, project.created_date),
    modifiedAt: asDate(project.modified_time, project.last_modified_time),
    startDate: asDate(project.start_date, project.start_date_long),
    endDate: asDate(project.end_date, project.end_date_long),
    percentComplete: project.percent_complete !== undefined ? Number(project.percent_complete) : null,
    // v3 shape is tasks:{open_count,closed_count}; keep the split as well as the total,
    // since "18 open of 18" and "0 open of 18" are very different at a glance.
    taskCount: project.tasks
        ? (Number(project.tasks.open_count || 0) + Number(project.tasks.closed_count || 0))
        : null,
    openTaskCount: project.tasks ? Number(project.tasks.open_count || 0) : null,
    url: (project.link && project.link.self && project.link.self.url) || project.url || null
});

/**
 * Field names verified against a live v3 payload — the docs' flat names are not
 * what the API actually returns. Owners live under `owners_and_work.owners`
 * (not `details.owners`), percent is `completion_percentage` (not
 * `percent_complete`), and the modified stamp is `last_modified_time` (not
 * `last_updated_time`). All three silently returned empty before this.
 */
const normaliseTask = (task = {}) => ({
    id: asId(task.id, task.id_string),
    key: task.key || null,
    name: toPlainLabel(task.name),
    description: task.description || null,
    status: (task.status && (task.status.name || task.status)) || null,
    // Whether the task's status counts as "done" in this portal. Portals define
    // their own status names (this one uses Open/Content/Design), so the boolean
    // is the only portable signal — never match on the name.
    statusIsClosed: Boolean(task.status && task.status.is_closed_type),
    isCompleted: Boolean(task.is_completed),
    priority: task.priority || null,
    percentComplete: task.completion_percentage !== undefined
        ? Number(task.completion_percentage)
        : (task.percent_complete !== undefined ? Number(task.percent_complete) : null),
    ownerNames: Array.isArray(task.owners_and_work && task.owners_and_work.owners)
        ? task.owners_and_work.owners
            // Task owners carry first_name/last_name but no full_name (unlike
            // comment authors), and `name` is often a username — "suyog1987"
            // rather than "Suyog Athavale".
            .map((o) => o.full_name || `${o.first_name || ''} ${o.last_name || ''}`.trim() || o.name)
            // Zoho uses a literal "Unassigned User" placeholder rather than an empty list.
            .filter((name) => name && name !== 'Unassigned User')
        : [],
    tasklist: toPlainLabel(task.tasklist && task.tasklist.name),

    /**
     * Where this task sits in the subtask tree: 0 is top level, 1 is a subtask of one.
     *
     * Kept because subtasks arrive as ordinary rows in this same flat list — there is no
     * working subtasks endpoint on this connection (v3 answers URL_RULE_NOT_CONFIGURED)
     * and no scope for the tasklists one, so these two fields are the only way to
     * reconstruct the tree. The Untapped page is built entirely out of them.
     *
     * `parental_info` is what the live v3 API returns today and is absent on top-level
     * tasks. It is not in Zoho's published schema, so treat a sudden run of nulls here
     * as the API changing under us rather than as a project with no subtasks.
     */
    depth: Number(task.depth) || 0,
    parentTaskId: (task.parental_info && asId(task.parental_info.parent_task_id)) || null,

    // "None" is Zoho's placeholder milestone, not a real one.
    milestone: toPlainLabel((task.milestone && task.milestone.name !== 'None' && task.milestone.name) || null),
    createdByName: (task.created_by && (task.created_by.full_name || task.created_by.name)) || null,
    updatedByName: (task.updated_by && (task.updated_by.full_name || task.updated_by.name)) || null,
    hasComments: Boolean(task.association_info && task.association_info.has_comments),
    hasAttachments: Boolean(task.association_info && task.association_info.has_attachments),
    createdAt: asDate(task.created_time, task.created_time_long, task.created_date),
    lastUpdatedAt: asDate(task.last_modified_time, task.last_updated_time_long, task.last_updated_time),
    startDate: asDate(task.start_date, task.start_date_long),
    endDate: asDate(task.end_date, task.end_date_long),
    url: (task.link && task.link.self && task.link.self.url) || null
});

/**
 * The body arrives as `comment` (not `content`) and is HTML carrying Zoho's own
 * inline styling and `zp[@zpuser#id#Name]zp` mention markup. It is converted to
 * plain text here so nothing downstream ever stores or renders third-party HTML
 * — see zohoRichText.js.
 */
const normaliseComment = (comment = {}) => ({
    id: asId(comment.id, comment.id_string),
    content: toPlainText(comment.comment || comment.content || ''),
    authorName: (comment.created_by && (comment.created_by.full_name || comment.created_by.name))
        || comment.added_by_name || comment.added_by || null,
    createdAt: asDate(comment.created_time, comment.created_time_long, comment.added_time),
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
        id: asId(portal.id, portal.id_string, portal.zsoid),
        // v3 keys are portal_name / is_default_portal — `name` and `default` are absent,
        // which is why the portal name came back null on the first live connect.
        name: portal.portal_name || portal.org_name || portal.name || null,
        isDefault: Boolean(portal.is_default_portal || portal.default),
        // The caller's PROFILE in this portal (e.g. "Read Only", "Administrator"). This is
        // the ceiling on what the integration can do, whatever the OAuth scopes allow.
        role: (portal.profile && portal.profile.name) || portal.role || null,
        url: portal.portal_url || null
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

/**
 * Post a comment onto a task.
 *
 * The field is `comment`, not `content` — sending `content` returns a
 * FIELDS_VALIDATION_ERROR naming the missing `comment`. This matches the read side,
 * where normaliseComment() already reads comment.comment.
 *
 * Everything written here is authored in Zoho by the single org-wide connected
 * account, so the CALLER is responsible for putting attribution in the text. Nothing
 * in Zoho will otherwise say a client wrote it.
 */
/**
 * Create a task in a Zoho project.
 *
 * ── THE FIELD NAMES HERE ARE THE RISKY PART ──
 * `postTaskComment` below carries a scar worth heeding: its body field must be `comment`,
 * and `content` — the obvious guess, and what the docs imply — returns
 * FIELDS_VALIDATION_ERROR. Task creation is the same class of guess, so the payload is
 * kept minimal (name plus optional description and end date) and every optional field is
 * omitted when absent rather than sent empty. A rejected create is loud; a create that
 * silently ignores a field is not.
 *
 * ── end_date IS NOT ACCEPTED ON ITS OWN ──
 * Zoho's task API documents end_date as requiring start_date to be set, and rejects the
 * pair when only the end is given. This is why a request carrying a needed-by date could
 * not be accepted at all while a dateless one could: the write was refused before a task
 * ever existed. Both dates are therefore sent together or neither is.
 *
 * ── A DATE-ONLY STRING IS NOT A DATE TO THIS API ──
 * `YYYY-MM-DD` is rejected with INVALID_PARAMETER_VALUE / "input format mismatch" naming
 * end_date. v3 wants a full ISO 8601 datetime: reading tasks back from the live portal
 * returns `"2026-05-05T13:30:00.000Z"`, and what it emits is what it takes. (The v2
 * generation wants MM-DD-YYYY — do not copy a v2 example into a v3 call. If this ever
 * flips, DATE_FORMATS below is the one place to change.)
 *
 * Midday UTC, not midnight: a due date carries no time, and midnight lands on the
 * previous calendar day in any portal west of UTC. Noon is the same day everywhere
 * anyone runs this.
 *
 * Note that a date here does NOT decide which column the client sees.
 * ZohoTaskSync.classifyTask reads startDate alone: a start date in the future is
 * "Coming up", anything else is "In progress". end_date is the due date and nothing more.
 *
 * Like every write here, this is authored in Zoho by the single org-wide connected
 * account — so the CALLER is responsible for putting attribution in the description.
 */
const createTask = async ({ projectId, name, description, startDate, endDate, portalId }) => {
    if (!projectId) {
        throw new ApiError(400, 'A project is required to create a task');
    }

    const title = typeof name === 'string' ? name.trim() : '';
    if (!title) {
        throw new ApiError(400, 'Task name is required');
    }

    const resolvedPortal = await resolvePortalId(portalId);
    const spec = PATHS.tasks;

    const body = { name: title };
    if (description) body.description = String(description);
    /**
     * Sent as a pair, never end alone — see the header. A caller that supplies only an
     * end date gets both, starting today, because "due by X" with no start is exactly
     * the shape Zoho refuses. A start on its own is fine and passes straight through.
     */
    if (endDate) {
        // Clamped so the start can never sit after the end, which Zoho also refuses —
        // a client asking for something by a date that has already passed is a support
        // question, not a reason for the accept to fail.
        const todayIso = new Date().toISOString().slice(0, 10);
        body.start_date = zohoDate(startDate || (endDate < todayIso ? endDate : todayIso));
        body.end_date = zohoDate(endDate);
    } else if (startDate) {
        body.start_date = zohoDate(startDate);
    }

    /**
     * One retry in the other dialect, and only on the error that says the format is
     * wrong.
     *
     * Not defensive habit — this exact call has now been refused twice on the shape of a
     * date, and the cost of being wrong a third time is not a log line: createTask
     * throws before TaskRequestService sets the status, so the request silently stays in
     * the admin's queue with no task created. A 400 creates nothing, so replaying it is
     * safe, and whichever dialect this portal wants, one of the two is it.
     */
    const send = (dates) => zohoRequest({
        method: 'POST',
        path: spec.path(resolvedPortal, projectId),
        version: spec.version,
        data: { ...body, ...dates },
        // v2 requires form-encoded writes; v3 takes JSON. Mirrors createProject.
        form: spec.version === 'v2',
        context: `Creating a Zoho task in project ${projectId}`
    });

    let response;
    try {
        response = await send({});
    } catch (error) {
        const alternate = body.end_date || body.start_date ? legacyDates(body) : null;
        if (!alternate || !isDateFormatRejection(error)) throw error;

        logger.warn(
            `[ZohoProjects] task create refused the ISO dates — retrying once as MM-DD-YYYY (project ${projectId})`
        );
        response = await send(alternate);
    }

    const created = unwrap(response, spec.envelope)[0] || response;
    const task = normaliseTask(created);

    if (!task.id) {
        // Zoho answered 2xx without an id, which means the write did not land the way we
        // think it did. Surfaced rather than returning a task nothing can refer to.
        throw new ApiError(502, 'Zoho accepted the task but returned no task id');
    }

    logger.info(`[ZohoProjects] Created task ${task.id} in project ${projectId}`);
    return task;
};

const postTaskComment = async ({ projectId, taskId, comment, portalId }) => {
    if (!projectId || !taskId) {
        throw new ApiError(400, 'A project and task are required to post a comment');
    }

    const text = typeof comment === 'string' ? comment.trim() : '';
    if (!text) {
        throw new ApiError(400, 'Comment text is required');
    }

    const resolvedPortal = await resolvePortalId(portalId);
    const spec = PATHS.taskComments;

    const response = await zohoRequest({
        method: 'POST',
        path: spec.path(resolvedPortal, projectId, taskId),
        version: spec.version,
        data: { comment: text },
        context: `Posting a comment on Zoho task ${taskId}`
    });

    const posted = unwrap(response, spec.envelope);
    const created = Array.isArray(posted) ? posted[0] : posted;

    return {
        commentId: created ? String(created.id_string || created.id || '') || null : null,
        raw: created || null
    };
};

/**
 * Attach one file to a task.
 *
 * v2 only. The v3 attachments path routes but rejects every multipart POST with
 * 400 UPLOAD_RULE_NOT_CONFIGURED regardless of field name; v2 takes the same upload
 * as `uploaddoc`. Both verified against the live portal.
 *
 * `file` is { buffer, filename, contentType }.
 *
 * Built with the form-data package rather than Node's global FormData: this v2 endpoint
 * answers 6500 General Error to what axios produces from a native FormData/Blob, and
 * accepts the classic multipart body form-data emits. A Buffer rather than a stream
 * because zohoRequest replays the request once on a 401, and a consumed stream would
 * replay as an empty upload; files here are capped at 50MB and sent one at a time.
 */
const uploadTaskAttachment = async ({ projectId, taskId, file, portalId, timeout }) => {
    if (!projectId || !taskId) {
        throw new ApiError(400, 'A project and task are required to attach a file');
    }
    if (!file || !file.buffer || !file.filename) {
        throw new ApiError(400, 'A file is required');
    }

    const resolvedPortal = await resolvePortalId(portalId);
    const spec = PATHS.taskAttachments;

    const form = new FormData();
    form.append(spec.fileField, file.buffer, {
        filename: file.filename,
        contentType: file.contentType || 'application/octet-stream',
        knownLength: file.buffer.length
    });

    const response = await zohoRequest({
        method: 'POST',
        path: spec.path(resolvedPortal, projectId, taskId),
        version: spec.version,
        data: form,
        multipart: true,
        // Carries the generated boundary; without it Zoho rejects the body.
        headers: form.getHeaders(),
        timeout,
        context: `Attaching ${file.filename} to Zoho task ${taskId}`
    });

    const attached = unwrap(response, spec.envelope);
    const created = Array.isArray(attached) ? attached[0] : attached;

    return {
        attachmentId: created ? String(created.id_string || created.id || '') || null : null,
        raw: created || null
    };
};

module.exports = {
    listPortals,
    listProjects,
    createProject,
    getProjectTaskUpdates,
    createTask,
    postTaskComment,
    uploadTaskAttachment,
    mapWithConcurrency
};

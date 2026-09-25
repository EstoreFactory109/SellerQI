/**
 * TaskRequestService.js — a client asking for work, and the decision on it.
 *
 * Both halves live here rather than in the controllers because each one spans several
 * systems (Gmail, Mongo, Zoho) and the ordering between them is load-bearing in ways a
 * controller should not be responsible for remembering.
 */

const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const TaskRequest = require('../../models/system/TaskRequestModel.js');
const { MAX_PENDING_REQUESTS } = require('../../models/system/TaskRequestModel.js');
const { buildIdentityBundle, redactAll } = require('../Email/identityRedaction.js');
const { toPlainLabel } = require('../Email/emailRichText.js');

const MAX_TITLE_CHARS = 150;
const MAX_DESCRIPTION_CHARS = 5000;
const MAX_REASON_CHARS = 500;

/**
 * Above this many tasklists, never create another one.
 *
 * Not a Zoho limit — a judgement. A project already carrying this many lists has a
 * navigation problem, and the router adding one more per unusual request is how that
 * becomes unusable. The live project runs on five.
 */
const MAX_TASKLISTS_PER_PROJECT = 25;

/** "Nitesh Kumar brief.pdf" names the client in a label, exactly as a body would. */
const redactFilename = (filename, bundle) => {
    let out = String(filename || '');
    (bundle?.names || []).forEach((name) => { out = out.split(name).join('[name]'); });
    return out;
};

/**
 * Submit a request.
 *
 * ── THE EMAIL IS SENT BEFORE THE ROW IS WRITTEN, AND THAT ORDER IS THE DESIGN ──
 * Zoho cannot accept attachments on this portal, and we store no bytes ourselves, so the
 * request email is the only place a client's documents will ever exist. Writing the row
 * first and mailing second would, on a mail failure, leave an admin looking at a request
 * that lists two attachments nobody can open — worse than an honest failure, because it
 * looks complete.
 */
const submitTaskRequest = async ({ user, title, description, neededBy, files = [] }) => {
    const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ');
    const cleanDescription = String(description || '').trim();

    if (!cleanTitle) throw new ApiError(400, 'Tell us what you need');
    if (cleanTitle.length > MAX_TITLE_CHARS) {
        throw new ApiError(400, `Keep the task name under ${MAX_TITLE_CHARS} characters`);
    }
    if (!cleanDescription) throw new ApiError(400, 'Please describe what you need in a bit more detail');
    if (cleanDescription.length > MAX_DESCRIPTION_CHARS) {
        throw new ApiError(400, `Keep the description under ${MAX_DESCRIPTION_CHARS} characters`);
    }

    /**
     * A cap on PENDING requests, not on requests per hour. Sprawl is the failure mode —
     * twenty open asks about the same thing buries the queue and helps nobody — and
     * hitting it tells the client to wait for a decision, which is the behaviour we want.
     */
    const pending = await TaskRequest.countDocuments({ userId: user._id, status: 'pending' });
    if (pending >= MAX_PENDING_REQUESTS) {
        throw new ApiError(
            409,
            `You already have ${pending} requests awaiting a decision. Please wait for those `
            + 'before adding another.'
        );
    }

    const { sendTaskRequestEmail } = require('../Gmail/GmailSendService.js');

    // Throws on failure. See the header: a row without its email is a request whose
    // evidence does not exist.
    const { gmailMessageId } = await sendTaskRequestEmail({
        user,
        title: cleanTitle,
        description: cleanDescription,
        neededBy,
        files,
    });

    const bundle = buildIdentityBundle(user);

    const request = await TaskRequest.create({
        userId: user._id,
        // Raw for Zoho, redacted for the portal — see the model header for why the two
        // must differ rather than sharing one redacted copy.
        titleRaw: cleanTitle,
        descriptionRaw: cleanDescription,
        title: toPlainLabel(redactAll(cleanTitle, bundle).text) || '(untitled request)',
        description: redactAll(cleanDescription, bundle).text,
        neededBy: neededBy ? new Date(neededBy) : null,
        attachments: files.map((file) => ({
            filenameRedacted: toPlainLabel(redactFilename(file.originalname, bundle)) || 'Attachment',
            mimeType: file.mimetype,
            size: file.size,
        })),
        gmailMessageId,
        status: 'pending',
        requestedAt: new Date(),
    });

    logger.info(`[TaskRequest] ${user._id} requested "${request.title}"`);
    return request;
};

/**
 * Accept a request: create the Zoho task, then refresh that project.
 *
 * The task is created from the RAW text. Zoho is the agency's own workspace and sits
 * outside the portal's staff/client boundary, and the redacted copy would arrive with
 * every URL stripped — a request saying "update amazon.com/dp/B08…" would lose the one
 * thing that makes it actionable.
 */
const acceptTaskRequest = async ({ requestId, staffUserId }) => {
    const request = await TaskRequest.findById(requestId).select('+titleRaw +descriptionRaw');
    if (!request) throw new ApiError(404, 'Request not found');
    if (request.status !== 'pending') {
        throw new ApiError(409, `That request was already ${request.status}`);
    }

    const UserModel = require('../../models/user-auth/userModel.js');
    const client = await UserModel.findById(request.userId).select('zohoProject').lean();

    const projectId = client?.zohoProject?.projectId;
    if (!projectId) {
        throw new ApiError(
            409,
            'This client is not linked to a Zoho project, so there is nowhere to create the task. '
            + 'Link a project on the Clients page first.'
        );
    }

    const ZohoProjectsService = require('../Zoho/ZohoProjectsService.js');
    const { buildTaskBrief } = require('../AI/TaskBriefService.js');
    const TasklistRouter = require('../AI/TasklistRouterService.js');

    /**
     * Rewrite the client's words into something the team can work from — and strip their
     * contact details on the way.
     *
     * This is the only place the raw description is transformed. Everywhere else it is
     * passed through verbatim precisely because a rewrite risks changing meaning; here
     * clarity is the point, so TaskBriefService guards it structurally instead (every
     * identifier preserved, negations counted, contacts checked) and falls back to the
     * cleaned original whenever the result fails those checks.
     */
    const clientUser = await UserModel.findById(request.userId)
        .select('firstName lastName email additionalEmails phone whatsapp')
        .lean();
    const bundle = buildIdentityBundle(clientUser || {});

    const brief = await buildTaskBrief({
        title: request.titleRaw,
        description: request.descriptionRaw || '',
        bundle,
    });

    /**
     * Attribution in the description, because everything written to Zoho is authored by
     * the single org-wide connected account — the same reason buildComment prefixes
     * client replies. Without it the task looks like the agency wrote it to itself.
     */
    const description = [
        'Requested by the client through the SellerQI portal.',
        '',
        brief.description,
        ...(request.attachments.length
            // Said explicitly because the files CANNOT be attached here: Zoho uploads are
            // not provisioned on this portal, so the email is where they are.
            ? ['', `${request.attachments.length} file(s) were attached to the request email.`]
            : []),
        /**
         * The client's own words, kept below the brief whenever the brief is a rewrite.
         *
         * This is what makes a bad rewrite recoverable rather than silent. The
         * validation above catches a brief that drops an ASIN or a negation, but not one
         * that is subtly off — and whoever does the work can settle it here in two
         * seconds instead of asking the client to repeat themselves.
         */
        ...(brief.generatedBy === 'ai'
            ? ['', '--- as the client wrote it ---', brief.original]
            : []),
    ].join('\n');

    /**
     * Which tasklist to file it under.
     *
     * Wrapped whole, because every step of it is optional. Reading the lists can fail,
     * the model can be unavailable, a proposed name can be unusable, creating a list can
     * be refused — and none of those are reasons to refuse a client's approved work. Any
     * of them lands on `filing`'s initial value and the task is created unfiled, which is
     * exactly where every accepted request went before this existed.
     */
    let filing = { tasklistId: null, tasklistName: null, chosenBy: 'none' };
    try {
        const tasklists = await ZohoProjectsService.listTasklists({
            projectId,
            portalId: client?.zohoProject?.portalId || null,
        });

        if (tasklists.length) {
            const routed = await TasklistRouter.route({
                title: brief.title,
                description: brief.description,
                tasklists,
                bundle,
            });

            if (routed.tasklistId) {
                filing = {
                    tasklistId: routed.tasklistId,
                    tasklistName: routed.tasklistName,
                    chosenBy: routed.chosenBy,
                };
            } else if (routed.newTasklistName) {
                /**
                 * Before creating anything, check the name against the real ones.
                 *
                 * The model proposing "Graphics" when a "graphics" list already exists is
                 * the single likeliest way this clutters a project, and it would look
                 * like two lists that differ only in case. Cheaper to catch here than to
                 * merge by hand later.
                 */
                const existing = tasklists.find(
                    (l) => l.name.trim().toLowerCase() === routed.newTasklistName.trim().toLowerCase()
                );

                if (existing) {
                    filing = { tasklistId: existing.id, tasklistName: existing.name, chosenBy: 'ai' };
                } else if (tasklists.length >= MAX_TASKLISTS_PER_PROJECT) {
                    // A project this cluttered does not need another list; the router's
                    // second choice is better than growing the mess.
                    logger.warn(
                        `[TaskRequest] project ${projectId} already has ${tasklists.length} tasklists — `
                        + `not creating "${routed.newTasklistName}"`
                    );
                } else {
                    const created = await ZohoProjectsService.createTasklist({
                        projectId,
                        name: routed.newTasklistName,
                        portalId: client?.zohoProject?.portalId || null,
                    });
                    filing = { tasklistId: created.id, tasklistName: created.name, chosenBy: 'created' };
                }
            }
        }
    } catch (error) {
        logger.warn(
            `[TaskRequest] could not choose a tasklist for request ${requestId} `
            + `(creating it unfiled): ${error.message}`
        );
    }

    const task = await ZohoProjectsService.createTask({
        projectId,
        name: brief.title,
        description,
        tasklistId: filing.tasklistId,
        /**
         * The client's "NEEDED BY", carried through as the task's due date.
         *
         * This used to claim it filed the task under "Coming up" instead of leaving a
         * dateless task in "In progress". It never did: ZohoTaskSync.classifyTask reads
         * startDate alone, so end_date has no bearing on the column at all. The date is
         * still worth sending — it is the deadline the client asked for — but createTask
         * is what pairs it with a start date, because Zoho refuses an end on its own.
         */
        endDate: request.neededBy ? new Date(request.neededBy).toISOString().slice(0, 10) : null,
    });

    request.status = 'accepted';
    request.decidedBy = staffUserId;
    request.decidedAt = new Date();
    request.zohoTaskId = task.id;
    request.zohoProjectId = projectId;
    /**
     * Read back off the created task where possible, not from what we asked for. If the
     * create retried without the tasklist — which it does when Zoho refuses the field —
     * then what we requested and where it landed are different things, and the record
     * should say the second one.
     */
    request.zohoTasklistId = task.tasklistId || (task.tasklistId === null ? null : filing.tasklistId);
    request.zohoTasklistName = task.tasklist || filing.tasklistName;
    request.tasklistChosenBy = request.zohoTasklistId ? filing.chosenBy : 'none';
    await request.save();

    /**
     * Deliberately NOT awaited.
     *
     * The client's Status page reads Mongo, which the nightly sweep fills — so without
     * this the task they just had approved would not appear for up to 24 hours. But a
     * full project sync measured ~30s on the linked project (76 tasks, 1,062 comments),
     * which is far too long to hold an HTTP response open.
     *
     * A failure costs latency, not data: the nightly run reconciles regardless.
     */
    const ZohoTaskSync = require('../Zoho/ZohoTaskSync.js');
    ZohoTaskSync.syncProject({
        projectId,
        projectName: client?.zohoProject?.projectName || null,
        portalId: client?.zohoProject?.portalId || null,
    })
        .then(() => logger.info(`[TaskRequest] re-synced project ${projectId} after accepting ${requestId}`))
        .catch((error) => logger.error(
            `[TaskRequest] task ${task.id} created but the follow-up sync failed `
            + `(it will appear after the nightly run): ${error.message}`
        ));

    logger.info(`[TaskRequest] ${staffUserId} accepted ${requestId} -> Zoho task ${task.id}`);
    return request;
};

/** Reject with a reason the client actually sees. */
const rejectTaskRequest = async ({ requestId, staffUserId, reason }) => {
    const text = String(reason || '').trim();
    if (!text) throw new ApiError(400, 'Give the client a reason, so they know what to do next');
    if (text.length > MAX_REASON_CHARS) {
        throw new ApiError(400, `Keep the reason under ${MAX_REASON_CHARS} characters`);
    }

    const request = await TaskRequest.findById(requestId);
    if (!request) throw new ApiError(404, 'Request not found');
    if (request.status !== 'pending') {
        throw new ApiError(409, `That request was already ${request.status}`);
    }

    request.status = 'rejected';
    request.decidedBy = staffUserId;
    request.decidedAt = new Date();
    request.rejectionReason = text;
    await request.save();

    logger.info(`[TaskRequest] ${staffUserId} rejected ${requestId}`);
    return request;
};

module.exports = {
    submitTaskRequest,
    acceptTaskRequest,
    rejectTaskRequest,
    MAX_TITLE_CHARS,
    MAX_DESCRIPTION_CHARS,
    MAX_REASON_CHARS,
    MAX_TASKLISTS_PER_PROJECT,
};

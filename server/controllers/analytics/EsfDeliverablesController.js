/**
 * Deliverables on the client's Status page: download a file, download a task's files as a zip,
 * and (staff only) show or hide a file the AI judged.
 *
 *   GET  /api/pagewise/esf/project-status/files/:key           ?preview=1 for a thumbnail
 *   GET  /api/pagewise/esf/project-status/tasks/:taskId/files.zip
 *   POST /api/pagewise/esf/project-status/files/:key/visibility { visibility: 'show'|'hide'|'auto' }
 *
 * Every lookup is scoped to the signed-in client's OWN Zoho project (user.zohoProject), as the
 * reply controller does, and a client may only fetch a file that is shown to them. Staff
 * (ESF staff or super admin logged in as the client) may also fetch hidden ones, to check them.
 */
const archiver = require('archiver');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const ZohoProjectTask = require('../../models/system/ZohoProjectTaskModel.js');
const zohoConfig = require('../../Services/Zoho/config.js');
const { candidatesForTask, isShown } = require('../../Services/Zoho/zohoDeliverables.js');
const { canDownloadFiles, downloadDeliverableFile } = require('../../Services/Zoho/ZohoProjectsService.js');
const { sendAttachment } = require('../../Services/Gmail/GmailAttachmentService.js');
const { classifyActor } = require('../../Services/Activity/actor.js');

const KEY_PATTERN = /^(f_[A-Za-z0-9]{1,64}|l_[A-Za-z0-9]{1,64}_[a-f0-9]{12})$/;
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/;
const ZIP_MAX_FILES = 50;

const reply = (res, status, message) => res.status(status).json(new ApiResponse(status, null, message));

const isStaff = async (req) => ['esf_staff', 'super_admin'].includes((await classifyActor(req)).kind);

const projectOf = async (userId) => {
    const user = await UserModel.findById(userId).select('zohoProject').lean();
    return user?.zohoProject?.projectId || null;
};

/** The task in this project that carries `key`, and the candidate itself. */
const findDeliverable = async (projectId, key) => {
    const id = key.slice(2).split('_')[0];
    const query = key.startsWith('f_')
        ? { projectId, 'comments.attachments.fileId': id }
        : { projectId, 'comments.commentId': id };
    const task = await ZohoProjectTask.findOne(query).lean();
    if (!task) return null;
    const candidate = candidatesForTask(task).find((c) => c.key === key);
    if (!candidate) return null;
    const decision = (task.deliverableDecisions || []).find((d) => d.key === key)?.decision;
    const override = (task.deliverableOverrides || []).find((o) => o.key === key)?.visibility;
    return { task, candidate, shown: isShown(decision, override) };
};

/** The stored file record (urls) for a file candidate. */
const fileRecord = (task, candidate) => {
    for (const c of task.comments || []) {
        if (c.commentId !== candidate.commentId) continue;
        const file = (c.attachments || []).find((f) => `f_${String(f.fileId).replace(/[^A-Za-z0-9]/g, '')}` === candidate.key);
        if (file) return file;
    }
    return null;
};

const guard = async (req, res) => {
    if (!zohoConfig.DELIVERABLES_ENABLED) { reply(res, 404, 'Not found'); return null; }
    const projectId = await projectOf(req.userId);
    if (!projectId) { reply(res, 404, 'No project is linked to this account'); return null; }
    return projectId;
};

/** GET …/files/:key — one file, through our server (Zoho needs our token). */
const downloadDeliverable = asyncHandler(async (req, res) => {
    const projectId = await guard(req, res);
    if (!projectId) return undefined;
    const { key } = req.params;
    if (!KEY_PATTERN.test(key) || !key.startsWith('f_')) return reply(res, 404, 'File not found');

    const found = await findDeliverable(projectId, key);
    if (!found || (!found.shown && !(await isStaff(req)))) return reply(res, 404, 'File not found');

    if (!(await canDownloadFiles())) {
        return reply(res, 503, 'Files can\'t be downloaded yet — your team is finishing the setup.');
    }
    const file = fileRecord(found.task, found.candidate);
    if (!file) return reply(res, 404, 'File not found');

    try {
        const preview = req.query.preview === '1';
        const buffer = await downloadDeliverableFile(file, { preview });
        const mimeType = file.mimeType && /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) ? file.mimeType : 'application/octet-stream';
        return sendAttachment(res, {
            buffer,
            filename: file.name,
            mimeType: preview ? (mimeType.startsWith('image/') ? mimeType : 'image/jpeg') : mimeType,
            inline: preview || INLINE_TYPES.test(mimeType),
        });
    } catch (error) {
        logger.warn(`[EsfDeliverables] download failed for ${key}: ${error.message}`);
        return reply(res, 502, 'Could not get this file from Zoho right now. Please try again shortly.');
    }
});

/** GET …/tasks/:taskId/files.zip — every shown file on the task, zipped. */
const downloadTaskZip = asyncHandler(async (req, res) => {
    const projectId = await guard(req, res);
    if (!projectId) return undefined;
    const task = await ZohoProjectTask.findOne({ projectId, taskId: String(req.params.taskId) }).lean();
    if (!task) return reply(res, 404, 'Task not found');
    if (!(await canDownloadFiles())) {
        return reply(res, 503, 'Files can\'t be downloaded yet — your team is finishing the setup.');
    }

    const decisions = new Map((task.deliverableDecisions || []).map((d) => [d.key, d.decision]));
    const overrides = new Map((task.deliverableOverrides || []).map((o) => [o.key, o.visibility]));
    const files = candidatesForTask(task)
        .filter((c) => c.kind === 'file' && isShown(decisions.get(c.key), overrides.get(c.key)))
        .slice(0, ZIP_MAX_FILES)
        .map((c) => fileRecord(task, c))
        .filter(Boolean);
    if (!files.length) return reply(res, 404, 'No files to download for this task');

    // Fetch first, then stream: a failed file must not leave a half-written zip.
    const fetched = [];
    for (const file of files) {
        try {
            fetched.push({ name: file.name, buffer: await downloadDeliverableFile(file) });
        } catch (error) {
            logger.warn(`[EsfDeliverables] zip: skipped ${file.fileId}: ${error.message}`);
        }
    }
    if (!fetched.length) return reply(res, 502, 'Could not get these files from Zoho right now. Please try again shortly.');

    const zipName = `${String(task.name || 'deliverables').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'deliverables'}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', (error) => { logger.error(`[EsfDeliverables] zip failed: ${error.message}`); res.destroy(error); });
    zip.pipe(res);
    const used = new Map();
    for (const f of fetched) {
        // Same name twice in one zip would overwrite: number the repeats.
        const n = used.get(f.name) || 0;
        used.set(f.name, n + 1);
        const name = n ? f.name.replace(/(\.[^.]*)?$/, ` (${n + 1})$1`) : f.name;
        zip.append(f.buffer, { name: name.replace(/[\\/]/g, '_') });
    }
    await zip.finalize();
    return undefined;
});

/** POST …/files/:key/visibility — staff correct the AI. Survives every later sync. */
const setDeliverableVisibility = asyncHandler(async (req, res) => {
    const projectId = await guard(req, res);
    if (!projectId) return undefined;
    if (!(await isStaff(req))) return reply(res, 403, 'Only the Estore Factory team can change this');
    const { key } = req.params;
    const visibility = req.body?.visibility;
    if (!KEY_PATTERN.test(key) || !['show', 'hide', 'auto'].includes(visibility)) return reply(res, 400, 'Invalid request');

    const found = await findDeliverable(projectId, key);
    if (!found) return reply(res, 404, 'File not found');

    const actor = await classifyActor(req);
    await ZohoProjectTask.updateOne({ _id: found.task._id }, { $pull: { deliverableOverrides: { key } } });
    if (visibility !== 'auto') {
        await ZohoProjectTask.updateOne(
            { _id: found.task._id },
            { $push: { deliverableOverrides: { key, visibility, by: actor.id || actor.kind, at: new Date() } } }
        );
    }
    logger.info(`[EsfDeliverables] ${actor.kind} ${actor.id || ''} set ${key} → ${visibility} on task ${found.task.taskId}`);
    return res.status(200).json(new ApiResponse(200, { key, visibility }, 'Saved'));
});

module.exports = { downloadDeliverable, downloadTaskZip, setDeliverableVisibility, KEY_PATTERN };

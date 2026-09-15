/**
 * EsfProjectReplyController.js
 *
 * The write half of the client Status page: when the "Waiting on you" section says the
 * team needs photos or an answer, this is how the client sends it without leaving the
 * portal. The reply lands as a comment on the Zoho task, and files land as attachments
 * on that same task.
 *
 * ATTRIBUTION IS NOT OPTIONAL HERE. Every write goes through the single org-wide Zoho
 * connection, so Zoho records the connected admin account as the author no matter who
 * actually typed it. Without the prefix this adds, the agency would see their own admin
 * account posting things clients said. The prefix is the only thing that distinguishes
 * them in the thread.
 *
 * Access is gated by esfClientOnly on the route, and separately by the project check
 * below — the route guard proves you are an ESF client, the task lookup proves the task
 * is in YOUR project.
 */

const fs = require('fs');
const fsp = require('fs/promises');

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const ZohoProjectTask = require('../../models/system/ZohoProjectTaskModel.js');
const ZohoProjectsService = require('../../Services/Zoho/ZohoProjectsService.js');
const { ATTACHMENTS_ENABLED } = require('../../Services/Zoho/config.js');

const MAX_MESSAGE_CHARS = 5000;
// Uploads are minutes-scale on a client's home connection, unlike every read in this
// integration, so they do not share the default request timeout.
const UPLOAD_TIMEOUT_MS = 180000;

/** Best-effort temp cleanup. A failure here must never fail a reply that already landed. */
const discardTempFiles = async (files) => {
    await Promise.all((files || []).map(async (file) => {
        try {
            await fsp.unlink(file.path);
        } catch (error) {
            logger.warn(`[EsfProjectReply] Could not remove temp file ${file.path}: ${error.message}`);
        }
    }));
};

/**
 * Wrap the client's words so the agency can tell at a glance who actually wrote them.
 * Plain text, because comments are stored and rendered as plain text end to end
 * (see Services/Zoho/zohoRichText.js) and injecting HTML here would break that.
 */
const buildComment = ({ message, user, fileNames }) => {
    const who = user?.name || user?.email || 'Client';
    const email = user?.email && user.email !== who ? ` (${user.email})` : '';

    const lines = [`Client reply from ${who}${email} — sent via the SellerQI portal`, ''];

    if (message) {
        lines.push(message);
    } else {
        lines.push('(No message — see the attached files.)');
    }

    if (fileNames.length > 0) {
        lines.push('', `Attached: ${fileNames.join(', ')}`);
    }

    return lines.join('\n');
};

/**
 * POST /api/pagewise/esf/project-status/tasks/:taskId/reply
 *
 * Accepts multipart: an optional `message` field and up to 5 files.
 */
const postEsfTaskReply = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { taskId } = req.params;
    const files = req.files || [];
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    try {
        if (!message && files.length === 0) {
            return res.status(400).json(new ApiResponse(400, '', 'Write a message or attach a file'));
        }

        // Refused up front rather than attempted and reported as failed: Zoho is not
        // provisioned for API uploads (see ATTACHMENTS_ENABLED), so every one of these
        // would fail, and a reply that claims to carry photos but does not is worse
        // than a clear refusal.
        if (files.length > 0 && !ATTACHMENTS_ENABLED) {
            return res.status(400).json(new ApiResponse(400, '', 'Sending files here is not available yet — please write a message, or send files to your account manager'));
        }

        if (message.length > MAX_MESSAGE_CHARS) {
            return res.status(400).json(
                new ApiResponse(400, '', `Please keep your message under ${MAX_MESSAGE_CHARS} characters`)
            );
        }

        const user = await UserModel.findById(userId).select('zohoProject name email').lean();
        const projectId = user?.zohoProject?.projectId;

        if (!projectId) {
            return res.status(400).json(new ApiResponse(400, '', 'No Zoho project is linked to this account'));
        }

        // THE authorization check. Scoping the lookup by the caller's own projectId is
        // what stops a client replying onto a task in another client's project by
        // guessing an id — a task that is not theirs simply does not exist here.
        const task = await ZohoProjectTask.findOne({ projectId, taskId }).select('taskId name').lean();
        if (!task) {
            return res.status(404).json(new ApiResponse(404, '', 'That task is not part of your project'));
        }

        const comment = buildComment({
            message,
            user,
            fileNames: files.map((f) => f.originalname),
        });

        let commentId = null;
        try {
            ({ commentId } = await ZohoProjectsService.postTaskComment({ projectId, taskId, comment }));
        } catch (error) {
            // The comment is the reply. If it fails there is nothing worth keeping, so
            // this is the one failure that fails the whole request.
            logger.error(new ApiError(502, `[EsfProjectReply] Comment failed on task ${taskId}: ${error.message}`));
            return res.status(502).json(new ApiResponse(502, '', 'We could not send your reply. Please try again.'));
        }

        // Files are attached one at a time and independently: one rejected video should
        // not discard a reply that is already in the thread, so each is recorded with
        // whether it actually landed.
        const attachments = [];
        for (const file of files) {
            try {
                // Read one at a time, not all up front: a buffer is needed because the
                // client replays the upload once on a 401 and a consumed stream would
                // replay empty, but holding five 50MB files at once is not.
                await ZohoProjectsService.uploadTaskAttachment({
                    projectId,
                    taskId,
                    file: {
                        buffer: await fsp.readFile(file.path),
                        filename: file.originalname,
                        contentType: file.mimetype,
                    },
                    timeout: UPLOAD_TIMEOUT_MS,
                });

                attachments.push({ name: file.originalname, size: file.size, uploaded: true });
            } catch (error) {
                logger.error(new ApiError(502, `[EsfProjectReply] Attachment "${file.originalname}" failed on task ${taskId}: ${error.message}`));
                attachments.push({ name: file.originalname, size: file.size, uploaded: false });
            }
        }

        // Recorded so the page can show "you already answered this" before the next
        // nightly sync pulls the comment back from Zoho.
        await ZohoProjectTask.updateOne(
            { projectId, taskId },
            {
                $push: {
                    clientResponses: {
                        text: message,
                        attachments,
                        zohoCommentId: commentId,
                        respondedAt: new Date(),
                        respondedByUserId: userId,
                        respondedByName: user?.name || null,
                    },
                },
            }
        );

        const failed = attachments.filter((a) => !a.uploaded);
        logger.info(`[EsfProjectReply] Reply sent on task ${taskId} (${attachments.length - failed.length}/${attachments.length} files)`);

        return res.status(200).json(new ApiResponse(200, {
            taskId,
            respondedAt: new Date(),
            attachmentsSent: attachments.filter((a) => a.uploaded).map((a) => a.name),
            attachmentsFailed: failed.map((a) => a.name),
        }, failed.length > 0
            ? `Your reply was sent, but ${failed.length} file(s) could not be uploaded`
            : 'Your reply was sent to the team'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfProjectReply] ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not send your reply'));
    } finally {
        // Runs on every path, including the early validation returns above.
        await discardTempFiles(files);
    }
});

module.exports = { postEsfTaskReply, buildComment };

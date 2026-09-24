/**
 * esfTaskRequests.js — the staff queue of tasks clients have asked for.
 *
 * Owner and admin only. Accepting a request writes a real task into the shared Zoho
 * portal on a client's behalf, which is the same bar as changing the Zoho connection
 * itself — see canManageTaskRequests in Services/User/esfRoles.js.
 *
 * ── THE ACCESS CHECK IS EXPLICIT HERE, AND HAS TO BE ──
 * esfPageGuard runs on /api/pagewise and engages only inside an impersonated client
 * session. It does nothing for /app/esf routes, so without the check below every staff
 * member reaches this controller regardless of role. Forgetting exactly this is the hole
 * that existed on the Billing API.
 *
 * ── THE CLIENT IS NAMED BY PROJECT, NOT BY PERSON ──
 * Same rule as the Messages page: the queue shows the Zoho project, else brand, else a
 * stored reference. The title and description are served already redacted — the model
 * keeps the client's raw words behind `select: false` and nothing here opts in, because
 * only the Zoho write needs them.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const SellerModel = require('../../models/user-auth/sellerCentralModel.js');
const TaskRequest = require('../../models/system/TaskRequestModel.js');
const { esfClientLabel } = require('../../Services/User/esfClientLabel.js');
const { canManageTaskRequests } = require('../../Services/User/esfRoles.js');

const REQUESTS_PER_PAGE = 100;

/** Responds and returns false when the caller may not be here. */
const requireManager = (req, res) => {
    if (canManageTaskRequests(req.esfUser)) return true;
    logger.warn(`ESF user ${req.esfUserId} (${req.esfRole}) attempted to act on task requests`);
    res.status(403).json(
        new ApiResponse(403, '', 'Only the portal owner and admins can review task requests')
    );
    return false;
};

/**
 * Labels for a set of requests, in two queries rather than two per row.
 *
 * Deliberately does NOT select firstName/lastName/email: this controller has no
 * legitimate use for them, and not loading them is what stops them being serialised by
 * accident.
 */
const labelsFor = async (requests) => {
    const userIds = [...new Set(requests.map((r) => String(r.userId)))];
    if (userIds.length === 0) return new Map();

    const users = await UserModel.find({ _id: { $in: userIds } })
        .select('_id zohoProject esfClientRef sellerCentral')
        .lean();

    const sellerIds = users.map((u) => u.sellerCentral).filter(Boolean);
    const sellers = sellerIds.length
        ? await SellerModel.find({ _id: { $in: sellerIds } }).select('_id brand').lean()
        : [];
    const brandBySeller = new Map(sellers.map((s) => [String(s._id), s.brand]));

    return new Map(users.map((user) => [
        String(user._id),
        {
            label: esfClientLabel(user, { brand: brandBySeller.get(String(user.sellerCentral)) }).label,
            // Surfaced so the queue can warn BEFORE someone clicks accept, rather than
            // failing at the Zoho call with a client they cannot fix from this page.
            hasProject: Boolean(user.zohoProject?.projectId),
        },
    ]));
};

const present = (request, meta) => ({
    id: String(request._id),
    client: meta?.label || 'Unknown client',
    clientHasProject: Boolean(meta?.hasProject),
    title: request.title,
    description: request.description,
    neededBy: request.neededBy,
    attachments: (request.attachments || []).map((file, index) => ({
        index,
        name: file.filenameRedacted,
        mimeType: file.mimeType,
        size: file.size,
    })),
    status: request.status,
    // Surfaced so an admin deciding whether to create real work knows whether a human
    // typed this or a model inferred it from a conversation.
    source: request.source || 'portal',
    aiConfidence: request.aiConfidence,
    threadId: request.sourceThreadId ? String(request.sourceThreadId) : null,
    missingDetails: request.missingDetails || [],
    detailsRequestedAt: request.detailsRequestedAt,
    /**
     * A decision read out of the conversation but NOT applied. The admin confirms it
     * with one click; nothing reached Zoho on the model's say-so.
     */
    stagedDecision: request.stagedDecision?.intent
        ? {
            intent: request.stagedDecision.intent,
            reason: request.stagedDecision.reason,
            confidence: request.stagedDecision.confidence,
            detectedAt: request.stagedDecision.detectedAt,
        }
        : null,
    requestedAt: request.requestedAt,
    decidedAt: request.decidedAt,
    rejectionReason: request.rejectionReason,
    zohoTaskId: request.zohoTaskId,
});

/**
 * GET /app/esf/task-requests
 *
 * Pending first and oldest-first within that, because this is a queue: the request
 * waiting longest is the one most likely to have been forgotten.
 */
const listTaskRequests = asyncHandler(async (req, res) => {
    try {
        if (!requireManager(req, res)) return undefined;

        const includeDecided = req.query.decided === 'true';

        const requests = await TaskRequest
            .find(includeDecided ? {} : { status: 'pending' })
            .sort({ status: 1, requestedAt: 1 })
            .limit(REQUESTS_PER_PAGE)
            .lean();

        const labels = await labelsFor(requests);

        return res.status(200).json(new ApiResponse(200, {
            requests: requests.map((request) => present(request, labels.get(String(request.userId)))),
            pendingCount: await TaskRequest.countDocuments({ status: 'pending' }),
        }, 'Task requests fetched'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfTaskRequests] list failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not load task requests'));
    }
});

/** Shared shape for the three write handlers, which differ only in the call they make. */
const decide = (verb, run) => asyncHandler(async (req, res) => {
    try {
        if (!requireManager(req, res)) return undefined;

        const result = await run(req);
        const labels = await labelsFor([result]);

        return res.status(200).json(new ApiResponse(
            200,
            present(result, labels.get(String(result.userId))),
            `Request ${verb}`
        ));
    } catch (error) {
        // 4xx here describe our own rules ("not linked to a Zoho project", "already
        // accepted") and are worth showing verbatim. Anything else is generic.
        if (error.statusCode && error.statusCode < 500) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, '', error.message));
        }
        logger.error(new ApiError(500, `[EsfTaskRequests] ${verb} failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', `Could not ${verb.replace(/ed$/, '')} that request`));
    }
});

const acceptTaskRequest = decide('accepted', (req) => {
    const { acceptTaskRequest: accept } = require('../../Services/User/TaskRequestService.js');
    return accept({ requestId: req.params.requestId, staffUserId: req.esfUserId });
});

const rejectTaskRequest = decide('rejected', (req) => {
    const { rejectTaskRequest: reject } = require('../../Services/User/TaskRequestService.js');
    return reject({
        requestId: req.params.requestId,
        staffUserId: req.esfUserId,
        reason: req.body?.reason,
    });
});

/**
 * PATCH /app/esf/task-requests/:requestId/dismiss-suggestion
 *
 * Throw away a staged decision without acting on it — the AI read the reply wrong, and
 * the request goes back to waiting.
 *
 * Exists so the only way past a wrong suggestion is not to accept or reject something
 * the admin did not mean. Without it the staged banner would be a nag with two wrong
 * answers.
 */
const dismissStagedDecision = asyncHandler(async (req, res) => {
    try {
        if (!requireManager(req, res)) return undefined;

        const updated = await TaskRequest.findByIdAndUpdate(
            req.params.requestId,
            { $set: { 'stagedDecision.intent': null, 'stagedDecision.reason': null } },
            { new: true }
        ).lean();

        if (!updated) return res.status(404).json(new ApiResponse(404, '', 'Request not found'));

        const labels = await labelsFor([updated]);
        return res.status(200).json(new ApiResponse(
            200, present(updated, labels.get(String(updated.userId))), 'Suggestion dismissed'
        ));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfTaskRequests] dismiss failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not dismiss that suggestion'));
    }
});

/**
 * DELETE /app/esf/task-requests/:requestId
 *
 * A hard delete. Nothing of record is lost: the request email, with its attachments, is
 * still in the shared inbox — and that email, not this row, is the durable copy.
 */
const deleteTaskRequest = asyncHandler(async (req, res) => {
    try {
        if (!requireManager(req, res)) return undefined;

        const removed = await TaskRequest.findByIdAndDelete(req.params.requestId).lean();
        if (!removed) return res.status(404).json(new ApiResponse(404, '', 'Request not found'));

        logger.info(`[EsfTaskRequests] ${req.esfUserId} deleted request ${req.params.requestId}`);
        return res.status(200).json(new ApiResponse(200, { id: req.params.requestId }, 'Request deleted'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfTaskRequests] delete failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not delete that request'));
    }
});

/**
 * GET /app/esf/task-requests/:requestId/attachments/:index
 *
 * The filename is redacted; the FILE is not, and cannot be — a letterhead or a
 * photographed business card identifies the client whatever we do to its name. That
 * exception was accepted knowingly when Messages was built and applies unchanged here.
 */
const downloadTaskRequestAttachment = asyncHandler(async (req, res) => {
    try {
        if (!requireManager(req, res)) return undefined;

        const request = await TaskRequest.findById(req.params.requestId)
            .select('gmailMessageId attachments')
            .lean();
        if (!request) return res.status(404).json(new ApiResponse(404, '', 'Request not found'));

        const record = (request.attachments || [])[Number(req.params.index)];
        if (!record) return res.status(404).json(new ApiResponse(404, '', 'Attachment not found'));

        const { fetchAttachmentBytes, sendAttachment } = require('../../Services/Gmail/GmailAttachmentService.js');

        const file = await fetchAttachmentBytes({
            gmailMessageId: request.gmailMessageId,
            index: req.params.index,
            record,
        });

        return sendAttachment(res, file);
    } catch (error) {
        if (error.statusCode && error.statusCode < 500) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, '', error.message));
        }
        logger.error(new ApiError(500, `[EsfTaskRequests] attachment failed: ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not download that file'));
    }
});

module.exports = {
    listTaskRequests,
    acceptTaskRequest,
    rejectTaskRequest,
    deleteTaskRequest,
    dismissStagedDecision,
    downloadTaskRequestAttachment,
};

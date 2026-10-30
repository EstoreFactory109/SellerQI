/**
 * /api/actions - changes on Amazon from SellerQI's screens, always previewed first
 * and sent only after the seller approves (Services/Actions/ChangeRequestService.js).
 *
 *   GET    /api/actions/capabilities           which changes this account can make
 *   GET    /api/actions/history?feature=        recent changes
 *   POST   /api/actions/:feature/preview        { actionType, input, source? } -> draft
 *   POST   /api/actions/:feature/:id/approve    send it
 *   POST   /api/actions/:feature/approve-many   { ids }
 *   GET    /api/actions/:feature/:id            status (pending changes are polled)
 *   DELETE /api/actions/:feature/:id            cancel a draft
 *
 * The feature is part of the path so the page guards (esfPageGuard, memberPageGuard)
 * apply: approving needs the "amazon-changes" page (Services/User/esfPages.js).
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const ChangeRequestService = require('../../Services/Actions/ChangeRequestService.js');

const approverOf = (req) => ({
    userId: req.userId, memberId: req.memberId, adminId: req.adminId,
    superAdminId: req.superAdminId, esfUserId: req.esfUserId
});
const scope = (req) => ({ userId: req.userId, country: req.country, region: req.region });

/** Runs a handler; refusals become their HTTP status with a readable message. */
const handle = (fn) => asyncHandler(async (req, res) => {
    try {
        const data = await fn(req);
        return res.status(200).json(new ApiResponse(200, data, 'OK'));
    } catch (error) {
        const status = error.statusCode || (error.isUserError ? 400 : 500);
        if (status >= 500) logger.error('[AmazonActions] request failed', { path: req.originalUrl, error: error.message });
        return res.status(status).json(new ApiResponse(status, null, status >= 500 ? 'Something went wrong preparing this change.' : error.message));
    }
});

const getCapabilities = handle(async (req) => ChangeRequestService.capabilities(req.userId));

const getHistory = handle(async (req) => ({
    changes: await ChangeRequestService.list({ ...scope(req), feature: req.query.feature || null, limit: req.query.limit })
}));

const preview = handle(async (req) => {
    const { actionType, input, source } = req.body || {};
    if (!actionType) throw Object.assign(new Error('actionType is required'), { statusCode: 400 });
    return ChangeRequestService.createPreview({
        ...scope(req), feature: req.params.feature, actionType, input: input || {},
        source: ['screen', 'qmate', 'bulk'].includes(source) ? source : 'screen',
        createdBy: approverOf(req)
    });
});

const approve = handle(async (req) => ChangeRequestService.approve({
    ...scope(req), id: req.params.id, feature: req.params.feature, approvedBy: approverOf(req)
}));

const approveMany = handle(async (req) => ({
    results: await ChangeRequestService.approveMany({
        ...scope(req), ids: req.body?.ids, feature: req.params.feature, approvedBy: approverOf(req)
    })
}));

const getOne = handle(async (req) => ChangeRequestService.get({ ...scope(req), id: req.params.id }));

const cancel = handle(async (req) => ChangeRequestService.cancelDraft({ ...scope(req), id: req.params.id }));

module.exports = { getCapabilities, getHistory, preview, approve, approveMany, getOne, cancel, approverOf };

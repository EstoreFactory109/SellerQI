const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { recordPageView, recordHeartbeat } = require('../../Services/Activity/activityTracker.js');
const { listActivity, userActivity } = require('../../Services/Activity/activityReport.js');
const { canSeeClientIdentity } = require('../../Services/User/esfRoles.js');

/**
 * POST /app/activity — the seller app reporting its own use.
 * Body: { type: 'page_view' | 'heartbeat', pageKey, seconds? }
 * Who it is comes from the session (see activityTracker.actorFor), never the body.
 */
const trackActivity = asyncHandler(async (req, res) => {
    const { type, pageKey, seconds } = req.body || {};
    if (type === 'page_view') await recordPageView(req, pageKey);
    else if (type === 'heartbeat') await recordHeartbeat(req, pageKey, seconds);
    return res.status(204).end();
});

/* ------------------------------------------------ super admin (all sellers) */

// Sellers only: the people the tool is for. Staff, agencies and admins are not.
const SELLERS = { accessType: 'user' };

/** GET /app/auth/admin/activity?days&search&page&limit */
const getAdminActivityList = asyncHandler(async (req, res) => {
    const data = await listActivity({ userMatch: SELLERS, ...req.query });
    return res.status(200).json(new ApiResponse(200, data, 'Activity fetched'));
});

/** GET /app/auth/admin/activity/:userId?days&tz */
const getAdminUserActivity = asyncHandler(async (req, res) => {
    const data = await userActivity({ userId: req.params.userId, userMatch: SELLERS, days: req.query.days, timezone: req.query.tz });
    if (!data) return res.status(404).json(new ApiResponse(404, '', 'User not found'));
    return res.status(200).json(new ApiResponse(200, data, 'User activity fetched'));
});

/* --------------------------------------------------- ESF portal (ESF clients) */

const ESF_CLIENTS = { isEsfClient: true };

/**
 * Owner and admins only. Members are not shown who a client is (see
 * getEsfClients), and a per-client activity page would hand them exactly that.
 */
const requireIdentityAccess = (req, res) => {
    if (canSeeClientIdentity(req.esfUser)) return true;
    res.status(403).json(new ApiResponse(403, '', 'Only the owner and admins can see client activity'));
    return false;
};

/** GET /app/esf/activity?days&search&page&limit */
const getEsfActivityList = asyncHandler(async (req, res) => {
    if (!requireIdentityAccess(req, res)) return;
    const data = await listActivity({ userMatch: ESF_CLIENTS, ...req.query });
    return res.status(200).json(new ApiResponse(200, data, 'Client activity fetched'));
});

/** GET /app/esf/activity/:userId?days&tz */
const getEsfClientActivity = asyncHandler(async (req, res) => {
    if (!requireIdentityAccess(req, res)) return;
    const data = await userActivity({ userId: req.params.userId, userMatch: ESF_CLIENTS, days: req.query.days, timezone: req.query.tz });
    if (!data) return res.status(404).json(new ApiResponse(404, '', 'Client not found'));
    return res.status(200).json(new ApiResponse(200, data, 'Client activity fetched'));
});

module.exports = {
    trackActivity,
    getAdminActivityList,
    getAdminUserActivity,
    getEsfActivityList,
    getEsfClientActivity,
};

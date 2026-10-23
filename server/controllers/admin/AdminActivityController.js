/**
 * Super admin: seller activity (who is active now, last active, pages viewed).
 *   GET /app/auth/admin/activity?since=24h|7d&search=
 *   GET /app/auth/admin/activity/users/:userId?days=7
 * Sees every customer account; platform and ESF staff are not tracked as sellers.
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { requireSuperAdmin } = require('./admin.js');
const { getOverview, getTimeline } = require('../../Services/Activity/activityService.js');

const SINCE = { '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 };
const CUSTOMERS = { accessType: { $nin: ['superAdmin', 'esfUser'] } };

const getActivityOverview = asyncHandler(async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return undefined;
    const data = await getOverview(CUSTOMERS, {
        sinceMs: SINCE[req.query.since] || SINCE['24h'],
        search: req.query.search,
    });
    return res.status(200).json(new ApiResponse(200, data, 'OK'));
});

const getUserActivity = asyncHandler(async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return undefined;
    const data = await getTimeline(req.params.userId, { days: req.query.days });
    if (!data) return res.status(404).json(new ApiResponse(404, null, 'User not found'));
    return res.status(200).json(new ApiResponse(200, data, 'OK'));
});

module.exports = { getActivityOverview, getUserActivity, SINCE };

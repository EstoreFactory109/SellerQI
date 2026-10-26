/**
 * ESF portal: client activity (who is active now, last active, pages viewed).
 *   GET /app/esf/activity?since=24h|7d&search=
 *   GET /app/esf/activity/clients/:clientId?days=7
 * Owner and admins only (canViewClientActivity); members get 403. Only ESF clients — anything
 * else is a 404, so the endpoint cannot be used to look at other SellerQI accounts.
 */
const mongoose = require('mongoose');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const UserModel = require('../../models/user-auth/userModel.js');
const { canViewClientActivity } = require('../../Services/User/esfRoles.js');
const { ESF_CLIENT_QUERY } = require('../../Services/User/ManagedClientService.js');
const { scopeClientQuery } = require('../../Services/User/esfClientScope.js');
const { getOverview, getTimeline } = require('../../Services/Activity/activityService.js');
const { SINCE } = require('../admin/AdminActivityController.js');

const forbidden = (res) => res.status(403).json(new ApiResponse(403, null, 'Only the portal owner and admins can see client activity'));

const getClientActivityOverview = asyncHandler(async (req, res) => {
    if (!canViewClientActivity(req.esfUser)) return forbidden(res);
    const data = await getOverview(scopeClientQuery(ESF_CLIENT_QUERY, req.esfUser), {
        sinceMs: SINCE[req.query.since] || SINCE['24h'],
        search: req.query.search,
    });
    return res.status(200).json(new ApiResponse(200, data, 'OK'));
});

const getClientActivity = asyncHandler(async (req, res) => {
    if (!canViewClientActivity(req.esfUser)) return forbidden(res);
    const { clientId } = req.params;
    const isClient = mongoose.Types.ObjectId.isValid(clientId)
        && await UserModel.exists(scopeClientQuery({ _id: clientId, ...ESF_CLIENT_QUERY }, req.esfUser));
    if (!isClient) return res.status(404).json(new ApiResponse(404, null, 'Client not found'));
    const data = await getTimeline(clientId, { days: req.query.days });
    return res.status(200).json(new ApiResponse(200, data, 'OK'));
});

module.exports = { getClientActivityOverview, getClientActivity };

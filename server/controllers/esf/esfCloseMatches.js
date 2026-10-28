/**
 * ESF portal: Zoho tasks the team closed, and the clients' SellerQI tasks they were matched to
 * (Services/Zoho/ZohoCloseSync.js) — so the matching can be checked before it is switched on
 * (ZOHO_CLOSE_MATCH_MODE), and watched after.
 *   GET /app/esf/close-matches   owner, admins and platform super admins (same rule as billing)
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const ZohoCloseMatch = require('../../models/system/ZohoCloseMatchModel.js');
const UserModel = require('../../models/user-auth/userModel.js');
const { canManageBilling } = require('../../Services/User/esfRoles.js');
const { modeOf } = require('../../Services/Zoho/ZohoCloseSync.js');

const getCloseMatches = asyncHandler(async (req, res) => {
    if (!canManageBilling(req.esfUser)) {
        return res.status(403).json(new ApiResponse(403, '', 'Only the portal owner and admins can see this'));
    }
    const rows = await ZohoCloseMatch.find({}).sort({ createdAt: -1 }).limit(200).lean();
    const users = await UserModel.find({ _id: { $in: [...new Set(rows.map((r) => String(r.userId)))] } })
        .select('firstName lastName email zohoProject.projectName').lean();
    const nameOf = new Map(users.map((u) => [String(u._id), {
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
        projectName: u.zohoProject?.projectName || null,
    }]));
    const items = rows.map((r) => ({
        id: String(r._id),
        client: nameOf.get(String(r.userId)) || { name: 'Unknown client', projectName: null },
        zohoTaskName: r.zohoTaskName,
        closedAt: r.closedAt,
        mode: r.mode,
        applied: Boolean(r.appliedAt),
        considered: r.considered || 0,
        matches: (r.matches || []).map((m) => ({ ...m, undone: (r.undoneTaskIds || []).includes(m.taskId) })),
    }));
    const matched = items.reduce((n, i) => n + i.matches.length, 0);
    return res.status(200).json(new ApiResponse(200, {
        mode: modeOf(),
        items,
        stats: {
            closedTasks: items.length,
            withMatches: items.filter((i) => i.matches.length).length,
            matched,
            undone: items.reduce((n, i) => n + i.matches.filter((m) => m.undone).length, 0),
        },
    }, 'OK'));
});

module.exports = { getCloseMatches };

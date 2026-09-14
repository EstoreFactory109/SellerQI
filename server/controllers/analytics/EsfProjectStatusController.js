/**
 * EsfProjectStatusController.js
 *
 * The client-facing Status page: what their eStore Factory team is working on,
 * read from the nightly Zoho task sync (Services/Zoho/ZohoTaskSync.js) rather
 * than from Zoho directly.
 *
 * Access is gated by esfClientOnly on the route — the same rule as the ESF
 * client dashboard — so a self-serve seller or agency client can never reach it.
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/user-auth/userModel.js');
const ZohoTaskSync = require('../../Services/Zoho/ZohoTaskSync.js');

/**
 * Only what the page renders.
 *
 * The raw comment thread is deliberately NOT shipped. It is the agency's own
 * internal discussion — staff coordination, half-finished thoughts, @mentions —
 * and the client is shown the AI progress summary generated at sync time
 * instead (Services/AI/ZohoTaskSummaryService.js). Only `updateCount` and the
 * date of the latest update leak out, so the page can say how much activity
 * sits behind the summary without reproducing any of it.
 *
 * Also never ships portalId or any Zoho identifier the client has no use for.
 */
const toClientTask = (task) => {
    const comments = task.comments || [];
    const latest = comments.reduce(
        (newest, c) => (!newest || new Date(c.createdAt || 0) > new Date(newest.createdAt || 0) ? c : newest),
        null
    );

    return {
        id: task.taskId,
        name: task.name,
        status: task.status,
        priority: task.priority && task.priority !== 'none' ? task.priority : null,
        percentComplete: task.percentComplete,
        owners: task.ownerNames || [],
        tasklist: task.tasklist,
        startDate: task.startDate,
        endDate: task.endDate,
        updatedAt: task.taskUpdatedAt,
        hasAttachments: task.hasAttachments,
        summary: task.commentSummary?.text || null,
        updateCount: comments.length,
        lastUpdateAt: latest?.createdAt || null,
    };
};

/**
 * GET /api/pagewise/esf/project-status
 *
 * Returns the three lists the Status page renders. A client with no linked
 * project gets an explicit `linked: false` rather than empty arrays, so the
 * page can say why it is empty instead of implying there is no work.
 */
const getEsfProjectStatus = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        const user = await UserModel.findById(userId).select('zohoProject').lean();
        const projectId = user?.zohoProject?.projectId;

        if (!projectId) {
            return res.status(200).json(new ApiResponse(200, {
                linked: false,
                projectName: null,
                inProgress: [],
                comingUp: [],
                completed: [],
                syncedAt: null,
            }, 'No Zoho project is linked to this account'));
        }

        const board = await ZohoTaskSync.getTaskBoard(projectId);

        return res.status(200).json(new ApiResponse(200, {
            linked: true,
            projectName: user.zohoProject.projectName || null,
            inProgress: board.inProgress.map(toClientTask),
            comingUp: board.comingUp.map(toClientTask),
            completed: board.completed.map(toClientTask),
            // Surfaced so the page can say how fresh this is — it is a nightly
            // sync, and silently showing day-old data as live would be worse.
            syncedAt: board.syncedAt,
            totalTasks: board.totalTasks,
        }, 'Project status fetched successfully'));
    } catch (error) {
        logger.error(new ApiError(500, `[EsfProjectStatus] ${error.message}`));
        return res.status(500).json(new ApiResponse(500, '', 'Could not load your project status'));
    }
});

module.exports = { getEsfProjectStatus };

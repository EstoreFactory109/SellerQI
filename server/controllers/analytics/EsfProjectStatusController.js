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
        waitingOnYou: task.waitingOnClient?.ask
            ? { ask: task.waitingOnClient.ask, kind: task.waitingOnClient.kind, since: task.waitingOnClient.since }
            : null,
        // The client's own replies, so the page can show that an ask was already
        // answered. Safe to return in full: this is the client's own text, not the
        // agency's internal discussion. The ask itself is left in place until the next
        // sync re-reads the thread and decides it is satisfied.
        yourReplies: (task.clientResponses || [])
            .map((r) => ({
                text: r.text || '',
                at: r.respondedAt,
                attachments: (r.attachments || []).filter((a) => a.uploaded).map((a) => a.name),
            }))
            .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0)),
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
                waitingOnYou: [],
                inProgress: [],
                comingUp: [],
                completed: [],
                syncedAt: null,
            }, 'No Zoho project is linked to this account'));
        }

        const board = await ZohoTaskSync.getTaskBoard(projectId);

        const inProgress = board.inProgress.map(toClientTask);

        /**
         * Coming up is two different things in one list: work the team has actually
         * scheduled in Zoho, and problems the audit found that nobody has picked up
         * yet. They are merged because the client's question is the same for both
         * ("what happens next?"), but `source` keeps them honestly distinguishable —
         * a recommendation has no owner and no start date, and showing one as though
         * it were booked work would be a lie.
         *
         * Anything the team already has an open task for was filtered out at sync
         * time (see ZohoTaskSync.refreshSuggestedWork), so this list cannot repeat
         * what is already underway.
         */
        const comingUp = [
            ...board.comingUp.map(toClientTask).map((t) => ({ ...t, source: 'scheduled' })),
            ...(board.suggested || []).map((s) => ({
                id: `suggested:${s.candidateId}`,
                name: s.title,
                action: s.action || null,
                tasklist: 'Recommended',
                priority: null,
                owners: [],
                startDate: null,
                endDate: null,
                percentComplete: null,
                summary: null,
                updateCount: 0,
                lastUpdateAt: null,
                waitingOnYou: null,
                yourReplies: [],
                source: 'suggested',
                // What the Dashboard already tells them this is worth, carried over
                // rather than recomputed so the two surfaces cannot disagree.
                amount: s.amount || 0,
                count: s.count || 0,
                currencyCode: s.currencyCode || 'USD',
            })),
        ];

        // Tasks blocked on the client, surfaced as their own list AND left in
        // place below — the same task legitimately appears in both, which is
        // what the design intends: the banner is the call to action, the table
        // is where the work lives. Completed tasks are excluded: whatever was
        // once needed clearly arrived.
        const waitingOnYou = [...inProgress, ...comingUp]
            .filter((t) => t.waitingOnYou)
            .map((t) => ({
                taskId: t.id,
                taskName: t.name,
                tasklist: t.tasklist,
                owners: t.owners,
                ...t.waitingOnYou,
                yourReplies: t.yourReplies,
            }))
            .sort((a, b) => new Date(a.since || 0) - new Date(b.since || 0));

        return res.status(200).json(new ApiResponse(200, {
            linked: true,
            projectName: user.zohoProject.projectName || null,
            waitingOnYou,
            inProgress,
            comingUp,
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

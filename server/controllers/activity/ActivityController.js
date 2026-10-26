/**
 * POST /app/activity/ping — the seller's browser reports a page open or a heartbeat.
 *
 * Fire-and-forget from the client: always 204, never an error body the app has to deal with.
 * What is recorded, and whether it counts as the seller being active, is decided in
 * Services/Activity (actor.js, activityService.js).
 */
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const { classifyActor } = require('../../Services/Activity/actor.js');
const { recordPing, isEnabled } = require('../../Services/Activity/activityService.js');

const ping = asyncHandler(async (req, res) => {
    if (!isEnabled()) return res.status(204).end();
    try {
        const { visitId, activityId, path } = req.body || {};
        const actor = await classifyActor(req);
        await recordPing({ userId: req.userId, actor, visitId, activityId, path });
    } catch (error) {
        logger.warn(`[Activity] ping not recorded for ${req.userId}: ${error.message}`);
    }
    return res.status(204).end();
});

module.exports = { ping };

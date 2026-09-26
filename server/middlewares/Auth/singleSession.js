const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const { resolveActiveSession } = require('../../Services/User/activeSession.js');

/**
 * Put in front of an endpoint that signs someone in. Refuses when the browser is
 * already signed in to a portal other than the ones listed.
 *
 * The login pages already redirect away in this case; this is the same rule held
 * on the server, so a second tab, a stale page or a direct API call cannot stack a
 * second session on the first.
 *
 *   refuseIfOtherSession('esf')  - an ESF re-login may replace an ESF session
 *   refuseIfOtherSession()       - any active session refuses
 */
const refuseIfOtherSession = (...allowedKinds) =>
    asyncHandler(async (req, res, next) => {
        const session = await resolveActiveSession(req.cookies || {});
        if (!session || allowedKinds.includes(session.kind)) return next();

        logger.warn(`Refused ${req.method} ${req.originalUrl}: browser already signed in to the ${session.label}`);
        return res.status(409).json(
            new ApiResponse(
                409,
                { activeSession: session.kind, home: session.home },
                `You are already signed in to the ${session.label}. Log out there first to sign in with another account.`
            )
        );
    });

module.exports = { refuseIfOtherSession };

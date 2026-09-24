const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { resolveActiveSession } = require('../../Services/User/activeSession.js');

/**
 * GET /app/session — PUBLIC.
 *
 * Asked by every login page before it renders: if this browser is already signed
 * in anywhere, the page sends the visitor to that portal instead of showing a form.
 * Always 200, so the axios interceptor never treats "not signed in" as an expired
 * session to refresh.
 */
const getActiveSession = asyncHandler(async (req, res) => {
    const session = await resolveActiveSession(req.cookies || {});
    return res
        .status(200)
        .json(new ApiResponse(200, session, session ? `Signed in to the ${session.label}` : 'No active session'));
});

module.exports = { getActiveSession };

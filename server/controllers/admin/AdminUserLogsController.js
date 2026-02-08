const asyncHandler = require('../../utils/AsyncHandler');
const logger = require('../../utils/Logger.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const AdminUserLogsService = require('../../Services/Admin/AdminUserLogsService.js');

/**
 * Get logging sessions for a specific user (Admin only)
 */
const getAdminUserSessions = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const limit = parseInt(req.query?.limit) || 50;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiResponse(400, null, "User ID is required"));
    }

    try {
        const result = await AdminUserLogsService.getUserSessions(userId, limit);

        return res.status(200).json(new ApiResponse(200, {
            sessions: result.sessions,
            userInfo: result.userInfo,
            totalSessions: result.totalSessions
        }, "User sessions fetched successfully"));

    } catch (error) {
        logger.error("Error fetching user sessions for admin", {
            error: error.message,
            userId
        });

        if (error.message === 'User not found') {
            return res.status(404).json(new ApiResponse(404, null, "User not found"));
        }

        return res.status(500).json(new ApiResponse(500, null, "Failed to fetch user sessions"));
    }
});

/**
 * Get error logs for a specific user (Admin only)
 */
const getAdminUserErrorLogs = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const limit = parseInt(req.query?.limit) || 100;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiResponse(400, null, "User ID is required"));
    }

    try {
        const result = await AdminUserLogsService.getUserErrorLogs(userId, limit);

        return res.status(200).json(new ApiResponse(200, {
            errorLogs: result.errorLogs,
            totalErrors: result.totalErrors
        }, "User error logs fetched successfully"));

    } catch (error) {
        logger.error("Error fetching user error logs for admin", {
            error: error.message,
            userId
        });
        return res.status(500).json(new ApiResponse(500, null, "Failed to fetch user error logs"));
    }
});

/**
 * Get session details for a specific user and session (Admin only)
 */
const getAdminUserSessionDetails = asyncHandler(async (req, res) => {
    const { userId, sessionId } = req.params;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiResponse(400, null, "User ID is required"));
    }

    if (!sessionId) {
        logger.error("Session ID is missing from request");
        return res.status(400).json(new ApiResponse(400, null, "Session ID is required"));
    }

    try {
        const sessionDetails = await AdminUserLogsService.getSessionDetails(userId, sessionId);

        if (!sessionDetails) {
            return res.status(404).json(new ApiResponse(404, null, "Session not found"));
        }

        return res.status(200).json(new ApiResponse(200, sessionDetails, "Session details fetched successfully"));

    } catch (error) {
        logger.error("Error fetching session details for admin", {
            error: error.message,
            userId,
            sessionId
        });
        return res.status(500).json(new ApiResponse(500, null, "Failed to fetch session details"));
    }
});

module.exports = {
    getAdminUserSessions,
    getAdminUserErrorLogs,
    getAdminUserSessionDetails
};

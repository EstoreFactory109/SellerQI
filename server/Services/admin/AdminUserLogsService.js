const UserAccountLogs = require('../../models/system/ErrorLogs.js');
const User = require('../../models/user-auth/userModel.js');
const logger = require('../../utils/Logger.js');

class AdminUserLogsService {
    /**
     * Get all logging sessions for a specific user (for admin view)
     * @param {string} userId - The user ID to get logs for
     * @param {number} limit - Maximum number of sessions to return
     * @returns {Object} Sessions data with user info
     */
    static async getUserSessions(userId, limit = 50) {
        try {
            // Get user info
            const user = await User.findById(userId).select('firstName lastName email packageType');
            
            if (!user) {
                throw new Error('User not found');
            }

            // Get sessions for this user
            const sessions = await UserAccountLogs.find({ userId })
                .sort({ sessionStartTime: -1 })
                .limit(limit)
                .select('sessionId sessionStartTime sessionEndTime sessionStatus overallSummary region country')
                .lean();

            return {
                sessions,
                userInfo: {
                    _id: user._id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    packageType: user.packageType
                },
                totalSessions: sessions.length
            };
        } catch (error) {
            logger.error('Error fetching user sessions for admin', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Get error logs for a specific user (for admin view)
     * @param {string} userId - The user ID to get error logs for
     * @param {number} limit - Maximum number of error logs to return
     * @returns {Object} Error logs data
     */
    static async getUserErrorLogs(userId, limit = 100) {
        try {
            // Get sessions with error logs
            const sessionsWithErrors = await UserAccountLogs.find({
                userId,
                'logs.logType': 'error'
            })
                .sort({ sessionStartTime: -1 })
                .select('sessionId logs region country')
                .lean();

            // Extract and format error logs
            const formattedErrorLogs = [];
            if (sessionsWithErrors && Array.isArray(sessionsWithErrors)) {
                sessionsWithErrors.forEach(session => {
                    if (session && session.logs && Array.isArray(session.logs)) {
                        session.logs.forEach(log => {
                            if (log && log.logType === 'error') {
                                formattedErrorLogs.push({
                                    sessionId: session.sessionId,
                                    functionName: log.functionName,
                                    message: log.message,
                                    timestamp: log.timestamp,
                                    errorDetails: log.errorDetails,
                                    contextData: log.contextData || {
                                        region: session.region,
                                        country: session.country
                                    },
                                    executionTime: log.executionTime
                                });
                            }
                        });
                    }
                });
            }

            // Sort by timestamp (most recent first)
            formattedErrorLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            return {
                errorLogs: formattedErrorLogs.slice(0, limit),
                totalErrors: formattedErrorLogs.length
            };
        } catch (error) {
            logger.error('Error fetching user error logs for admin', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Get detailed session by session ID for a specific user (for admin view)
     * @param {string} userId - The user ID
     * @param {string} sessionId - The session ID to get details for
     * @returns {Object} Session details
     */
    static async getSessionDetails(userId, sessionId) {
        try {
            const session = await UserAccountLogs.findOne({
                userId,
                sessionId
            }).lean();

            if (!session) {
                return null;
            }

            // Format duration
            const formatDuration = (milliseconds) => {
                if (!milliseconds) return 'N/A';
                const seconds = Math.floor(milliseconds / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);

                if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
                if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
                return `${seconds}s`;
            };

            return {
                sessionId: session.sessionId,
                userId: session.userId,
                region: session.region,
                country: session.country,
                sessionStartTime: session.sessionStartTime,
                sessionEndTime: session.sessionEndTime,
                sessionDuration: session.sessionDuration,
                sessionDurationFormatted: formatDuration(session.sessionDuration),
                sessionStatus: session.sessionStatus,
                overallSummary: session.overallSummary,
                criticalFunctions: session.criticalFunctions,
                systemInfo: session.systemInfo,
                logs: session.logs,
                errorLogs: session.logs?.filter(log => log.logType === 'error') || [],
                successLogs: session.logs?.filter(log => log.logType === 'success') || [],
                warningLogs: session.logs?.filter(log => log.logType === 'warning') || [],
                infoLogs: session.logs?.filter(log => log.logType === 'info') || []
            };
        } catch (error) {
            logger.error('Error fetching session details for admin', {
                error: error.message,
                userId,
                sessionId
            });
            throw error;
        }
    }
}

module.exports = AdminUserLogsService;

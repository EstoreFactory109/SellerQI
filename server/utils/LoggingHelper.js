const UserAccountLogs = require('../models/system/ErrorLogs.js');
const logger = require('./Logger.js');

/**
 * Logging Helper Utility for SpApiDataController
 * Provides easy-to-use methods for logging all function calls and their results
 */
class LoggingHelper {
    constructor(userId, region, country, sessionId = null) {
        this.userId = userId;
        this.region = region;
        this.country = country;
        this.sessionId = sessionId || `${userId}_${region}_${country}_${Date.now()}`;
        this.session = null;
        this.functionTimers = new Map();
    }

    /**
     * Initialize a new logging session
     */
    async initSession() {
        try {
            this.session = await UserAccountLogs.createSession(
                this.userId,
                this.region,
                this.country,
                this.sessionId
            );
            
            logger.info(`Logging session initialized: ${this.sessionId}`, {
                userId: this.userId,
                region: this.region,
                country: this.country
            });
            
            return this.session;
        } catch (error) {
            logger.error('Failed to initialize logging session', {
                error: error.message,
                userId: this.userId,
                sessionId: this.sessionId
            });
            throw error;
        }
    }

    /**
     * Log function start
     */
    logFunctionStart(functionName, additionalData = {}) {
        const startTime = new Date();
        this.functionTimers.set(functionName, startTime);
        
        if (this.session) {
            this.session.addLog({
                functionName,
                logType: 'info',
                status: 'started',
                message: `Function ${functionName} started`,
                executionTime: {
                    startTime
                },
                contextData: {
                    userId: this.userId,
                    region: this.region,
                    country: this.country,
                    hasAccessToken: additionalData.hasAccessToken || false,
                    hasAdsToken: additionalData.hasAdsToken || false,
                    marketplaceId: additionalData.marketplaceId,
                    sellerId: additionalData.sellerId,
                    profileId: additionalData.profileId
                },
                additionalData
            });
        }
        
        return startTime;
    }

    /**
     * Log function success
     */
    logFunctionSuccess(functionName, data = null, additionalMetrics = {}) {
        const endTime = new Date();
        const startTime = this.functionTimers.get(functionName);
        const duration = startTime ? endTime - startTime : null;
        
        if (this.session) {
            this.session.addLog({
                functionName,
                logType: 'success',
                status: 'completed',
                message: `Function ${functionName} completed successfully`,
                executionTime: {
                    startTime,
                    endTime,
                    duration
                },
                dataMetrics: {
                    recordsProcessed: additionalMetrics.recordsProcessed || 0,
                    recordsSuccessful: additionalMetrics.recordsSuccessful || 0,
                    recordsFailed: additionalMetrics.recordsFailed || 0,
                    batchSize: additionalMetrics.batchSize,
                    chunkIndex: additionalMetrics.chunkIndex,
                    totalChunks: additionalMetrics.totalChunks
                },
                contextData: {
                    userId: this.userId,
                    region: this.region,
                    country: this.country
                },
                additionalData: {
                    dataSize: data ? (Array.isArray(data) ? data.length : 1) : 0,
                    ...additionalMetrics
                }
            });

            // Update critical function tracking
            this.updateCriticalFunction(functionName, true, true, null, duration);
        }

        this.functionTimers.delete(functionName);
        return duration;
    }

    /**
     * Log function error
     */
    logFunctionError(functionName, error, additionalData = {}) {
        const endTime = new Date();
        const startTime = this.functionTimers.get(functionName);
        const duration = startTime ? endTime - startTime : null;
        
        const errorDetails = {
            errorMessage: error.message || 'Unknown error',
            stackTrace: error.stack,
            httpStatus: error.status || error.statusCode,
            amazonApiError: error.amazonApiError || false,
            tokenRefreshNeeded: error.tokenRefreshNeeded || false,
            errorCode: error.code
        };

        if (this.session) {
            this.session.addLog({
                functionName,
                logType: 'error',
                status: 'failed',
                message: `Function ${functionName} failed: ${error.message}`,
                errorDetails,
                executionTime: {
                    startTime,
                    endTime,
                    duration
                },
                contextData: {
                    userId: this.userId,
                    region: this.region,
                    country: this.country
                },
                additionalData: {
                    originalError: error.name,
                    ...additionalData
                }
            });

            // Update critical function tracking
            this.updateCriticalFunction(functionName, true, false, error.message, duration);
        }

        this.functionTimers.delete(functionName);
        return duration;
    }

    /**
     * Log function warning
     */
    logFunctionWarning(functionName, message, additionalData = {}) {
        if (this.session) {
            this.session.addLog({
                functionName,
                logType: 'warning',
                status: 'partial',
                message: `Function ${functionName} warning: ${message}`,
                contextData: {
                    userId: this.userId,
                    region: this.region,
                    country: this.country
                },
                additionalData
            });
        }
    }

    /**
     * Log function skip
     */
    logFunctionSkipped(functionName, reason, additionalData = {}) {
        if (this.session) {
            this.session.addLog({
                functionName,
                logType: 'info',
                status: 'skipped',
                message: `Function ${functionName} skipped: ${reason}`,
                contextData: {
                    userId: this.userId,
                    region: this.region,
                    country: this.country
                },
                additionalData: {
                    skipReason: reason,
                    ...additionalData
                }
            });

            // Update critical function tracking
            this.updateCriticalFunction(functionName, false, false, `Skipped: ${reason}`, 0);
        }
    }

    /**
     * Update critical function status
     */
    updateCriticalFunction(functionName, attempted, successful, error, duration) {
        if (!this.session) return;

        const criticalFunctionMap = {
            'GET_MERCHANT_LISTINGS_ALL_DATA': 'merchantListings',
            'GET_V2_SELLER_PERFORMANCE_REPORT': 'sellerPerformanceV2',
            'GET_V1_SELLER_PERFORMANCE_REPORT': 'sellerPerformanceV1',
            'getPPCSpendsBySKU': 'ppcSpends',
            'getCampaign': 'campaignData'
        };

        const mappedName = criticalFunctionMap[functionName];
        if (mappedName) {
            this.session.updateCriticalFunction(mappedName, attempted, successful, error, duration);
        }
    }

    /**
     * Log API call details
     */
    logApiCall(functionName, endpoint, method = 'GET', requestData = {}, responseData = {}) {
        if (this.session) {
            this.session.addLog({
                functionName,
                logType: 'info',
                status: 'completed',
                message: `API call to ${endpoint}`,
                apiDetails: {
                    endpoint,
                    method,
                    requestId: responseData.requestId,
                    responseSize: responseData.size || 0,
                    rateLimitRemaining: responseData.rateLimitRemaining
                },
                contextData: {
                    userId: this.userId,
                    region: this.region,
                    country: this.country
                },
                additionalData: {
                    requestData: requestData,
                    responseData: responseData
                }
            });
        }
    }

    /**
     * Log batch processing
     */
    logBatchProcessing(functionName, batchInfo) {
        if (this.session) {
            this.session.addLog({
                functionName: `${functionName}_batch`,
                logType: 'info',
                status: 'completed',
                message: `Batch processing for ${functionName}`,
                dataMetrics: {
                    batchSize: batchInfo.batchSize,
                    chunkIndex: batchInfo.chunkIndex,
                    totalChunks: batchInfo.totalChunks,
                    recordsProcessed: batchInfo.recordsProcessed,
                    recordsSuccessful: batchInfo.recordsSuccessful,
                    recordsFailed: batchInfo.recordsFailed
                },
                contextData: {
                    userId: this.userId,
                    region: this.region,
                    country: this.country
                },
                additionalData: batchInfo
            });
        }
    }

    /**
     * End the logging session
     */
    async endSession(status = 'completed') {
        if (this.session) {
            try {
                this.session.endSession(status);
                await this.session.save();
                
                logger.info(`Logging session ended: ${this.sessionId}`, {
                    status,
                    duration: this.session.sessionDuration,
                    successRate: this.session.overallSummary.successRate,
                    totalFunctions: this.session.overallSummary.totalFunctions,
                    successfulFunctions: this.session.overallSummary.successfulFunctions,
                    failedFunctions: this.session.overallSummary.failedFunctions
                });
                
                return this.session;
            } catch (error) {
                logger.error('Failed to end logging session', {
                    error: error.message,
                    sessionId: this.sessionId
                });
                throw error;
            }
        }
    }

    /**
     * Save current session state
     */
    async saveSession() {
        if (this.session) {
            try {
                await this.session.save();
                return this.session;
            } catch (error) {
                logger.error('Failed to save logging session', {
                    error: error.message,
                    sessionId: this.sessionId
                });
                throw error;
            }
        }
    }

    /**
     * Get session summary
     */
    getSessionSummary() {
        if (!this.session) return null;
        
        return {
            sessionId: this.session.sessionId,
            userId: this.session.userId,
            region: this.session.region,
            country: this.session.country,
            status: this.session.sessionStatus,
            startTime: this.session.sessionStartTime,
            endTime: this.session.sessionEndTime,
            duration: this.session.sessionDuration,
            durationFormatted: this.session.sessionDurationFormatted,
            summary: this.session.overallSummary,
            criticalFunctions: this.session.criticalFunctions,
            totalLogs: this.session.logs.length,
            errorCount: this.session.errorLogs.length,
            successCount: this.session.successLogs.length,
            warningCount: this.session.warningLogs.length
        };
    }

    /**
     * Get logs by type
     */
    getLogsByType(logType) {
        return this.session ? this.session.getLogsByType(logType) : [];
    }

    /**
     * Get logs by function
     */
    getLogsByFunction(functionName) {
        return this.session ? this.session.getLogsByFunction(functionName) : [];
    }

    /**
     * Get logs by status
     */
    getLogsByStatus(status) {
        return this.session ? this.session.getLogsByStatus(status) : [];
    }

    /**
     * Static method to get recent sessions for a user
     */
    static async getRecentSessions(userId, limit = 10) {
        try {
            return await UserAccountLogs.getRecentSessions(userId, limit);
        } catch (error) {
            logger.error('Failed to get recent sessions', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Static method to get session statistics
     */
    static async getSessionStats(userId, days = 30) {
        try {
            const stats = await UserAccountLogs.getSessionStats(userId, days);
            return stats.length > 0 ? stats[0] : null;
        } catch (error) {
            logger.error('Failed to get session stats', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Static method to find session by ID
     */
    static async getSessionById(sessionId) {
        try {
            return await UserAccountLogs.findOne({ sessionId });
        } catch (error) {
            logger.error('Failed to get session by ID', {
                error: error.message,
                sessionId
            });
            throw error;
        }
    }

    /**
     * Static method to get all error logs for a user
     */
    static async getUserErrorLogs(userId, limit = 50) {
        try {
            const sessions = await UserAccountLogs.find({ 
                userId,
                'logs.logType': 'error' // Only get sessions that have error logs
            })
                .sort({ sessionStartTime: -1 })
                .limit(limit)
                .select('sessionId sessionStartTime sessionEndTime sessionStatus logs region country'); // Include logs in the selection
            
            return sessions || [];
        } catch (error) {
            logger.error('Failed to get user error logs', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Wrapper method to execute a function with automatic logging
     */
    async executeWithLogging(functionName, asyncFunction, ...args) {
        this.logFunctionStart(functionName);
        
        try {
            const result = await asyncFunction(...args);
            this.logFunctionSuccess(functionName, result);
            return result;
        } catch (error) {
            this.logFunctionError(functionName, error);
            throw error;
        }
    }
}

module.exports = LoggingHelper;

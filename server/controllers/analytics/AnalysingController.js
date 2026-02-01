const asyncHandler = require('../../utils/AsyncHandler');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { AnalyseService } = require('../../Services/main/Analyse.js');
const LoggingHelper = require('../../utils/LoggingHelper.js');
const KeywordTrackingModel = require('../../models/amazon-ads/KeywordTrackingModel.js');
const { KeywordRecommendations, AsinKeywordRecommendations } = require('../../models/amazon-ads/KeywordRecommendationsModel.js');

// Export the Analyse function from the service for backward compatibility
const Analyse = AnalyseService.Analyse;

const analysingController = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const adminId = req.adminId;
    
    const result = await AnalyseService.Analyse(userId, country, region, adminId);
   
    res.status(result.status).json(new ApiResponse(result.status, result.message, "Data is fetched successfully"));
});

const getDataFromDate = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const startDate = req.query?.startDate;
    const endDate = req.query?.endDate;
    const periodType = req.query?.periodType; // Add periodType parameter
    const result = await AnalyseService.getDataFromDateRange(userId, country, region, startDate, endDate, periodType);
    res.status(result.status).json(new ApiResponse(result.status, result.message, "Data is fetched successfully"));
})

// ===== USER LOGGING DATA ENDPOINTS =====

/**
 * Get recent logging sessions for the logged-in user
 */
const getUserLoggingSessions = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const limit = parseInt(req.query?.limit) || 10;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    try {
        const recentSessions = await LoggingHelper.getRecentSessions(userId, limit);
        
        return res.status(200).json(new ApiResponse(200, {
            sessions: recentSessions || [],
            totalSessions: (recentSessions || []).length
        }, "User logging sessions fetched successfully"));
        
    } catch (error) {
        logger.error("Error fetching user logging sessions", { 
            error: error.message, 
            userId 
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch logging sessions"));
    }
});

/**
 * Get detailed logging session by session ID for the logged-in user
 */
const getLoggingSessionDetails = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const sessionId = req.params?.sessionId;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    if (!sessionId) {
        logger.error("Session ID is missing from request");
        return res.status(400).json(new ApiError(400, "Session id is missing"));
    }

    try {
        const session = await LoggingHelper.getSessionById(sessionId);
        
        if (!session) {
            return res.status(404).json(new ApiError(404, "Session not found"));
        }

        // Verify session belongs to the logged-in user
        if (session.userId.toString() !== userId.toString()) {
            logger.warn("Unauthorized access attempt to session", { 
                sessionId, 
                requestUserId: userId, 
                sessionUserId: session.userId 
            });
            return res.status(403).json(new ApiError(403, "Unauthorized access to session"));
        }

        const sessionSummary = {
            sessionId: session.sessionId,
            userId: session.userId,
            region: session.region,
            country: session.country,
            sessionStartTime: session.sessionStartTime,
            sessionEndTime: session.sessionEndTime,
            sessionDuration: session.sessionDuration,
            sessionDurationFormatted: session.sessionDurationFormatted,
            sessionStatus: session.sessionStatus,
            overallSummary: session.overallSummary,
            criticalFunctions: session.criticalFunctions,
            systemInfo: session.systemInfo,
            logs: session.logs,
            errorLogs: session.logs.filter(log => log.logType === 'error'),
            successLogs: session.logs.filter(log => log.logType === 'success'),
            warningLogs: session.logs.filter(log => log.logType === 'warning'),
            infoLogs: session.logs.filter(log => log.logType === 'info')
        };
        
        return res.status(200).json(new ApiResponse(200, sessionSummary, "Session details fetched successfully"));
        
    } catch (error) {
        logger.error("Error fetching session details", { 
            error: error.message, 
            sessionId, 
            userId 
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch session details"));
    }
});

/**
 * Get user logging statistics for the logged-in user
 */
const getUserLoggingStats = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const days = parseInt(req.query?.days) || 30;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    try {
        const stats = await LoggingHelper.getSessionStats(userId, days);
        
        // Always return a valid stats object, even if no data found
        const defaultStats = {
            totalSessions: 0,
            successfulSessions: 0,
            failedSessions: 0,
            partialSessions: 0,
            avgSuccessRate: 0,
            avgDuration: 0,
            avgDurationFormatted: 'N/A',
            totalErrors: 0,
            totalFunctions: 0,
            period: `Last ${days} days`,
            successRate: 0
        };

        if (!stats) {
            return res.status(200).json(new ApiResponse(200, defaultStats, "No logging data found for the specified period"));
        }

        const formattedStats = {
            totalSessions: stats.totalSessions || 0,
            successfulSessions: stats.successfulSessions || 0,
            failedSessions: stats.failedSessions || 0,
            partialSessions: (stats.totalSessions || 0) - (stats.successfulSessions || 0) - (stats.failedSessions || 0),
            avgSuccessRate: Math.round(stats.avgSuccessRate || 0),
            avgDuration: stats.avgDuration || 0,
            avgDurationFormatted: formatDuration(stats.avgDuration || 0),
            totalErrors: stats.totalErrors || 0,
            totalFunctions: stats.totalFunctions || 0,
            period: `Last ${days} days`,
            successRate: stats.totalSessions > 0 ? Math.round((stats.successfulSessions / stats.totalSessions) * 100) : 0
        };
        
        return res.status(200).json(new ApiResponse(200, formattedStats, "User logging statistics fetched successfully"));
        
    } catch (error) {
        logger.error("Error fetching user logging statistics", { 
            error: error.message, 
            userId, 
            days 
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch logging statistics"));
    }
});

/**
 * Create sample logging data for testing (TEMPORARY - for demo purposes)
 */
const createSampleLoggingData = asyncHandler(async (req, res) => {
    const userId = req.userId;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    try {
        const loggingHelper = new LoggingHelper(userId, 'NA', 'US');
        await loggingHelper.initSession();
        
        // Simulate some function calls
        loggingHelper.logFunctionStart('GET_MERCHANT_LISTINGS_ALL_DATA', { hasAccessToken: true });
        loggingHelper.logFunctionSuccess('GET_MERCHANT_LISTINGS_ALL_DATA', { data: 'sample' }, { recordsProcessed: 10, recordsSuccessful: 10 });
        
        loggingHelper.logFunctionStart('generateAccessTokens', { hasRefreshToken: true });
        loggingHelper.logFunctionSuccess('generateAccessTokens', null, { recordsProcessed: 2, recordsSuccessful: 2 });
        
        loggingHelper.logFunctionStart('listingItems_processing', { totalSkus: 8 });
        loggingHelper.logFunctionWarning('listingItems_processing', 'Some items failed to process');
        
        await loggingHelper.endSession('partial');
        
        return res.status(200).json(new ApiResponse(200, {
            message: 'Sample logging data created successfully',
            sessionId: loggingHelper.sessionId
        }, "Sample data created"));
        
    } catch (error) {
        logger.error("Error creating sample logging data", { 
            error: error.message, 
            userId 
        });
        return res.status(500).json(new ApiError(500, "Failed to create sample data"));
    }
});

/**
 * Get user error logs for the logged-in user
 */
const getUserErrorLogs = asyncHandler(async (req, res) => {
    const userId = req.userId;
    console.log("userId in the getUserErrorLogs: ",userId);
    const limit = parseInt(req.query?.limit) || 50;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    try {
        const errorLogs = await LoggingHelper.getUserErrorLogs(userId, limit);
        // Extract and format error logs
        const formattedErrorLogs = [];
        if (errorLogs && Array.isArray(errorLogs)) {
            errorLogs.forEach(session => {
                if (session && session.logs && Array.isArray(session.logs)) {
                    session.logs.forEach(log => {
                        if (log && log.logType === 'error') {
                            formattedErrorLogs.push({
                                sessionId: session.sessionId,
                                functionName: log.functionName,
                                message: log.message,
                                timestamp: log.timestamp,
                                errorDetails: log.errorDetails,
                                contextData: log.contextData,
                                executionTime: log.executionTime
                            });
                        }
                    });
                }
            });
        }

        // Sort by timestamp (most recent first)
        formattedErrorLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        return res.status(200).json(new ApiResponse(200, {
            errorLogs: formattedErrorLogs.slice(0, limit),
            totalErrors: formattedErrorLogs.length
        }, "User error logs fetched successfully"));
        
    } catch (error) {
        logger.error("Error fetching user error logs", { 
            error: error.message, 
            userId 
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch error logs"));
    }
});

/**
 * Get user email logs for the logged-in user
 */
const getUserEmailLogs = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const limit = parseInt(req.query?.limit) || 50;
    const emailType = req.query?.type; // Optional filter by email type
    const status = req.query?.status; // Optional filter by status

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    try {
        // Import EmailLogs model
        const EmailLogs = require('../../models/system/EmailLogsModel.js');
        
        // Build query filters
        const queryFilters = {};
        
        // Only show logs for this user (if receiverId is set) or logs without receiverId
        queryFilters.$or = [
            { receiverId: userId },
            { receiverId: null, receiverEmail: { $exists: true } } // For emails without user context
        ];
        
        // Add optional filters
        if (emailType) {
            queryFilters.emailType = emailType.toUpperCase();
        }
        
        if (status) {
            queryFilters.status = status.toUpperCase();
        }

        // Fetch email logs
        const emailLogs = await EmailLogs.find(queryFilters)
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('receiverId', 'firstName lastName email', 'User', { strictPopulate: false })
            .select('emailType receiverEmail receiverId status sentDate sentTime errorMessage subject emailProvider retryCount createdAt updatedAt');

        // Format the email logs for frontend
        const formattedEmailLogs = emailLogs.map(log => ({
            id: log._id,
            emailType: log.emailType,
            receiverEmail: log.receiverEmail,
            receiverId: log.receiverId?._id || null,
            receiverName: log.receiverId ? `${log.receiverId.firstName} ${log.receiverId.lastName}` : 'Unknown User',
            status: log.status,
            subject: log.subject,
            emailProvider: log.emailProvider,
            sentDate: log.sentDate,
            sentTime: log.sentTime,
            errorMessage: log.errorMessage,
            retryCount: log.retryCount,
            createdAt: log.createdAt,
            updatedAt: log.updatedAt
        }));

        // Get email statistics
        const stats = await EmailLogs.aggregate([
            { 
                $match: { 
                    $or: [
                        { receiverId: userId },
                        { receiverId: null, receiverEmail: { $exists: true } }
                    ]
                }
            },
            {
                $group: {
                    _id: {
                        emailType: '$emailType',
                        status: '$status'
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: '$_id.emailType',
                    statuses: {
                        $push: {
                            status: '$_id.status',
                            count: '$count'
                        }
                    },
                    totalCount: { $sum: '$count' }
                }
            },
            { $sort: { totalCount: -1 } }
        ]);

        return res.status(200).json(new ApiResponse(200, {
            emailLogs: formattedEmailLogs,
            stats: stats,
            totalLogs: formattedEmailLogs.length,
            filters: {
                emailType,
                status,
                limit
            }
        }, "Email logs fetched successfully"));
        
    } catch (error) {
        logger.error("Error fetching user email logs", { 
            error: error.message, 
            userId 
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch email logs"));
    }
});

/**
 * Get payment logs for the logged-in user
 */
const getMyPaymentLogs = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const limit = parseInt(req.query?.limit) || 50;
    const page = parseInt(req.query?.page) || 1;
    const eventType = req.query?.eventType;
    const status = req.query?.status;
    const startDate = req.query?.startDate;
    const endDate = req.query?.endDate;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    try {
        const PaymentLogs = require('../../models/system/PaymentLogsModel.js');
        const skip = (page - 1) * limit;

        const logs = await PaymentLogs.getLogsByUser(userId, {
            limit,
            skip,
            eventType,
            status,
            startDate,
            endDate
        });

        const totalCount = await PaymentLogs.countByUser(userId, {
            eventType,
            status,
            startDate,
            endDate
        });

        const stats = await PaymentLogs.getUserPaymentStats(userId);

        return res.status(200).json(new ApiResponse(200, {
            logs,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalCount / limit),
                totalCount,
                limit
            },
            stats
        }, "Payment logs fetched successfully"));
    } catch (error) {
        logger.error("Error fetching user payment logs", {
            error: error.message,
            userId
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch payment logs"));
    }
});

// Helper function to format duration
function formatDuration(milliseconds) {
    if (!milliseconds) return 'N/A';
    
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

/**
 * Get keyword tracking data for the logged-in user
 */
const getKeywordTrackingData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    if (!country || !region) {
        logger.error("Country or Region is missing from request");
        return res.status(400).json(new ApiError(400, "Country or Region is missing"));
    }

    try {
        const keywordTrackingData = await KeywordTrackingModel.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!keywordTrackingData) {
            return res.status(200).json(new ApiResponse(200, {
                keywords: [],
                totalKeywords: 0,
                message: "No keyword tracking data found for this user, country, and region"
            }, "Keyword tracking data fetched successfully"));
        }

        return res.status(200).json(new ApiResponse(200, {
            keywords: keywordTrackingData.keywords || [],
            totalKeywords: keywordTrackingData.keywords?.length || 0,
            userId: keywordTrackingData.userId,
            country: keywordTrackingData.country,
            region: keywordTrackingData.region,
            createdAt: keywordTrackingData.createdAt,
            updatedAt: keywordTrackingData.updatedAt
        }, "Keyword tracking data fetched successfully"));

    } catch (error) {
        logger.error("Error fetching keyword tracking data", {
            error: error.message,
            userId,
            country,
            region
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch keyword tracking data"));
    }
});

/**
 * Get keyword recommendations data for the logged-in user
 */
const getKeywordRecommendations = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    if (!country || !region) {
        logger.error("Country or Region is missing from request");
        return res.status(400).json(new ApiError(400, "Country or Region is missing"));
    }

    try {
        const keywordRecommendationsData = await KeywordRecommendations.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!keywordRecommendationsData) {
            return res.status(200).json(new ApiResponse(200, {
                keywordRecommendationData: {
                    keywordTargetList: []
                },
                totalKeywords: 0,
                message: "No keyword recommendations data found for this user, country, and region"
            }, "Keyword recommendations data fetched successfully"));
        }

        const keywordTargetList = keywordRecommendationsData.keywordRecommendationData?.keywordTargetList || [];
        
        return res.status(200).json(new ApiResponse(200, {
            keywordRecommendationData: keywordRecommendationsData.keywordRecommendationData,
            totalKeywords: keywordTargetList.length,
            userId: keywordRecommendationsData.userId,
            country: keywordRecommendationsData.country,
            region: keywordRecommendationsData.region,
            createdAt: keywordRecommendationsData.createdAt,
            updatedAt: keywordRecommendationsData.updatedAt
        }, "Keyword recommendations data fetched successfully"));

    } catch (error) {
        logger.error("Error fetching keyword recommendations data", {
            error: error.message,
            userId,
            country,
            region
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch keyword recommendations data"));
    }
});

/**
 * Get list of ASINs that have keyword recommendations stored
 */
const getKeywordRecommendationsAsins = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    if (!country || !region) {
        logger.error("Country or Region is missing from request");
        return res.status(400).json(new ApiError(400, "Country or Region is missing"));
    }

    try {
        const allAsinKeywords = await AsinKeywordRecommendations.findAllForUser(userId, country, region);
        
        // Extract unique ASINs with their metadata
        const asinsList = allAsinKeywords.map(item => ({
            asin: item.asin,
            keywordCount: item.totalKeywords,
            fetchedAt: item.fetchedAt
        }));

        return res.status(200).json(new ApiResponse(200, {
            asins: asinsList,
            totalAsins: asinsList.length
        }, "ASINs list fetched successfully"));

    } catch (error) {
        logger.error("Error fetching ASINs list", {
            error: error.message,
            userId,
            country,
            region
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch ASINs list"));
    }
});

/**
 * Get keyword recommendations for a specific ASIN with pagination support
 * 
 * Query params:
 * - asin: ASIN to get recommendations for (required)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 200)
 * - summaryOnly: If true, return only counts (default: false)
 */
const getKeywordRecommendationsByAsin = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    const { asin, summaryOnly } = req.query;
    
    // Pagination parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

    if (!userId) {
        logger.error("User ID is missing from request");
        return res.status(400).json(new ApiError(400, "User id is missing"));
    }

    if (!country || !region) {
        logger.error("Country or Region is missing from request");
        return res.status(400).json(new ApiError(400, "Country or Region is missing"));
    }

    if (!asin) {
        logger.error("ASIN is missing from request");
        return res.status(400).json(new ApiError(400, "ASIN is required"));
    }

    try {
        const asinKeywordData = await AsinKeywordRecommendations.findByAsin(userId, country, region, asin);

        if (!asinKeywordData) {
            return res.status(200).json(new ApiResponse(200, {
                keywordRecommendationData: {
                    keywordTargetList: []
                },
                totalKeywords: 0,
                asin: asin,
                pagination: {
                    page,
                    limit,
                    totalItems: 0,
                    totalPages: 0,
                    hasMore: false
                },
                message: `No keyword recommendations found for ASIN: ${asin}`
            }, "Keyword recommendations data fetched successfully"));
        }

        const allKeywords = asinKeywordData.keywordTargetList || [];
        const totalKeywords = allKeywords.length;
        
        // If only summary is requested, return counts only
        if (summaryOnly === 'true') {
            return res.status(200).json(new ApiResponse(200, {
                keywordRecommendationData: {
                    keywordTargetList: []
                },
                totalKeywords: totalKeywords,
                asin: asinKeywordData.asin,
                pagination: {
                    page,
                    limit,
                    totalItems: totalKeywords,
                    totalPages: Math.ceil(totalKeywords / limit),
                    hasMore: false
                },
                fetchedAt: asinKeywordData.fetchedAt
            }, "Keyword recommendations summary fetched successfully"));
        }

        // Apply pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedKeywords = allKeywords.slice(startIndex, endIndex);
        const totalPages = Math.ceil(totalKeywords / limit);
        const hasMore = page < totalPages;

        return res.status(200).json(new ApiResponse(200, {
            keywordRecommendationData: {
                keywordTargetList: paginatedKeywords
            },
            totalKeywords: totalKeywords,
            asin: asinKeywordData.asin,
            userId: asinKeywordData.userId,
            country: asinKeywordData.country,
            region: asinKeywordData.region,
            pagination: {
                page,
                limit,
                totalItems: totalKeywords,
                totalPages,
                hasMore
            },
            fetchedAt: asinKeywordData.fetchedAt,
            createdAt: asinKeywordData.createdAt,
            updatedAt: asinKeywordData.updatedAt
        }, "Keyword recommendations data fetched successfully"));

    } catch (error) {
        logger.error("Error fetching keyword recommendations by ASIN", {
            error: error.message,
            userId,
            country,
            region,
            asin
        });
        return res.status(500).json(new ApiError(500, "Failed to fetch keyword recommendations data"));
    }
});

module.exports = { 
    analysingController, 
    getDataFromDate, 
    Analyse, // Export for backward compatibility
    getUserLoggingSessions,
    getLoggingSessionDetails,
    getUserLoggingStats,
    getUserErrorLogs,
    getUserEmailLogs,
    getMyPaymentLogs,
    createSampleLoggingData,
    getKeywordTrackingData,
    getKeywordRecommendations,
    getKeywordRecommendationsAsins,
    getKeywordRecommendationsByAsin
};
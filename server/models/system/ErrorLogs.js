const mongoose = require('mongoose');

// Define schema for individual log entries
const LogEntrySchema = new mongoose.Schema({
    functionName: {
        type: String,
        required: true,
        index: true,
        trim: true
    },
    logType: {
        type: String,
        required: true,
        enum: ['error', 'success', 'warning', 'info'],
        index: true
    },
    status: {
        type: String,
        required: true,
        enum: ['started', 'completed', 'failed', 'skipped', 'partial'],
        index: true
    },
    message: {
        type: String,
        required: true,
        trim: true
    },
    errorDetails: {
        errorCode: String,
        errorMessage: String,
        stackTrace: String,
        httpStatus: Number,
        amazonApiError: Boolean,
        tokenRefreshNeeded: Boolean
    },
    executionTime: {
        startTime: Date,
        endTime: Date,
        duration: Number // in milliseconds
    },
    apiDetails: {
        endpoint: String,
        method: String,
        requestId: String,
        responseSize: Number,
        rateLimitRemaining: Number
    },
    dataMetrics: {
        recordsProcessed: {
            type: Number,
            default: 0
        },
        recordsSuccessful: {
            type: Number,
            default: 0
        },
        recordsFailed: {
            type: Number,
            default: 0
        },
        batchSize: Number,
        chunkIndex: Number,
        totalChunks: Number
    },
    contextData: {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        region: {
            type: String,
            required: true,
            index: true
        },
        country: {
            type: String,
            required: true,
            index: true
        },
        marketplaceId: String,
        sellerId: String,
        profileId: String,
        hasAccessToken: Boolean,
        hasAdsToken: Boolean
    },
    additionalData: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    _id: true,
    timestamps: false // We're using custom timestamp
});

// Main schema for user account logs
const UserAccountLogsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    region: {
        type: String,
        required: true,
        index: true
    },
    country: {
        type: String,
        required: true,
        index: true
    },
    sessionId: {
        type: String,
        required: true,
        index: true,
        unique: true
    },
    sessionStartTime: {
        type: Date,
        default: Date.now,
        index: true
    },
    sessionEndTime: Date,
    sessionDuration: Number, // in milliseconds
    sessionStatus: {
        type: String,
        enum: ['in_progress', 'completed', 'failed', 'partial'],
        default: 'in_progress',
        index: true
    },
    overallSummary: {
        totalFunctions: {
            type: Number,
            default: 0
        },
        successfulFunctions: {
            type: Number,
            default: 0
        },
        failedFunctions: {
            type: Number,
            default: 0
        },
        skippedFunctions: {
            type: Number,
            default: 0
        },
        warningFunctions: {
            type: Number,
            default: 0
        },
        successRate: {
            type: Number,
            min: 0,
            max: 100
        }
    },
    // Array of individual log entries
    logs: [LogEntrySchema],
    
    // Quick access arrays for different log types
    errorLogs: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'UserAccountLogs.logs'
    }],
    successLogs: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'UserAccountLogs.logs'
    }],
    warningLogs: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'UserAccountLogs.logs'
    }],
    
    // Critical function tracking
    criticalFunctions: {
        merchantListings: {
            attempted: { type: Boolean, default: false },
            successful: { type: Boolean, default: false },
            error: String,
            duration: Number
        },
        sellerPerformanceV2: {
            attempted: { type: Boolean, default: false },
            successful: { type: Boolean, default: false },
            error: String,
            duration: Number
        },
        sellerPerformanceV1: {
            attempted: { type: Boolean, default: false },
            successful: { type: Boolean, default: false },
            error: String,
            duration: Number
        },
        financialEvents: {
            attempted: { type: Boolean, default: false },
            successful: { type: Boolean, default: false },
            error: String,
            duration: Number
        },
        amazonFees: {
            attempted: { type: Boolean, default: false },
            successful: { type: Boolean, default: false },
            error: String,
            duration: Number
        },
        ppcSpends: {
            attempted: { type: Boolean, default: false },
            successful: { type: Boolean, default: false },
            error: String,
            duration: Number
        },
        campaignData: {
            attempted: { type: Boolean, default: false },
            successful: { type: Boolean, default: false },
            error: String,
            duration: Number
        }
    },
    
    // System information
    systemInfo: {
        nodeVersion: String,
        memoryUsage: {
            heapUsed: Number,
            heapTotal: Number,
            external: Number
        },
        serverRegion: String,
        requestOrigin: String
    }
}, {
    timestamps: true,
    collection: 'userAccountLogs'
});

// Compound indexes for efficient querying
UserAccountLogsSchema.index({ userId: 1, region: 1, country: 1 });
UserAccountLogsSchema.index({ userId: 1, sessionStartTime: -1 });
UserAccountLogsSchema.index({ sessionStatus: 1, sessionStartTime: -1 });
UserAccountLogsSchema.index({ 'logs.functionName': 1, 'logs.logType': 1 });
UserAccountLogsSchema.index({ 'logs.timestamp': -1 });
UserAccountLogsSchema.index({ 'logs.status': 1, 'logs.functionName': 1 });

// Virtual for session duration in human readable format
UserAccountLogsSchema.virtual('sessionDurationFormatted').get(function() {
    if (!this.sessionDuration) return 'N/A';
    
    const seconds = Math.floor(this.sessionDuration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
});

// Instance methods
UserAccountLogsSchema.methods.addLog = function(logData) {
    const logEntry = {
        ...logData,
        timestamp: new Date()
    };
    
    this.logs.push(logEntry);
    
    // Update quick access arrays
    const logId = this.logs[this.logs.length - 1]._id;
    switch (logData.logType) {
        case 'error':
            this.errorLogs.push(logId);
            break;
        case 'success':
            this.successLogs.push(logId);
            break;
        case 'warning':
            this.warningLogs.push(logId);
            break;
    }
    
    // Update summary counts
    this.updateSummary();
    
    return logId;
};

UserAccountLogsSchema.methods.updateSummary = function() {
    const summary = {
        totalFunctions: 0,
        successfulFunctions: 0,
        failedFunctions: 0,
        skippedFunctions: 0,
        warningFunctions: 0
    };
    
    // Count by status
    const statusCounts = {};
    this.logs.forEach(log => {
        statusCounts[log.status] = (statusCounts[log.status] || 0) + 1;
    });
    
    summary.totalFunctions = this.logs.length;
    summary.successfulFunctions = statusCounts.completed || 0;
    summary.failedFunctions = statusCounts.failed || 0;
    summary.skippedFunctions = statusCounts.skipped || 0;
    summary.warningFunctions = this.logs.filter(log => log.logType === 'warning').length;
    
    // Calculate success rate
    if (summary.totalFunctions > 0) {
        summary.successRate = Math.round((summary.successfulFunctions / summary.totalFunctions) * 100);
    } else {
        summary.successRate = 0;
    }
    
    this.overallSummary = summary;
};

UserAccountLogsSchema.methods.endSession = function(status = 'completed') {
    this.sessionEndTime = new Date();
    this.sessionDuration = this.sessionEndTime - this.sessionStartTime;
    this.sessionStatus = status;
    this.updateSummary();
};

UserAccountLogsSchema.methods.updateCriticalFunction = function(functionName, attempted, successful, error, duration) {
    if (this.criticalFunctions[functionName]) {
        this.criticalFunctions[functionName].attempted = attempted;
        this.criticalFunctions[functionName].successful = successful;
        if (error) this.criticalFunctions[functionName].error = error;
        if (duration) this.criticalFunctions[functionName].duration = duration;
    }
};

UserAccountLogsSchema.methods.getLogsByType = function(logType) {
    return this.logs.filter(log => log.logType === logType);
};

UserAccountLogsSchema.methods.getLogsByFunction = function(functionName) {
    return this.logs.filter(log => log.functionName === functionName);
};

UserAccountLogsSchema.methods.getLogsByStatus = function(status) {
    return this.logs.filter(log => log.status === status);
};

// Static methods
UserAccountLogsSchema.statics.createSession = function(userId, region, country, sessionId) {
    return this.create({
        userId,
        region,
        country,
        sessionId: sessionId || `${userId}_${region}_${country}_${Date.now()}`,
        systemInfo: {
            nodeVersion: process.version,
            memoryUsage: process.memoryUsage(),
            serverRegion: process.env.AWS_REGION || 'unknown'
        }
    });
};

UserAccountLogsSchema.statics.getRecentSessions = function(userId, limit = 10) {
    return this.find({ userId })
        .sort({ sessionStartTime: -1 })
        .limit(limit)
        .select('sessionId sessionStartTime sessionEndTime sessionStatus overallSummary region country');
};

UserAccountLogsSchema.statics.getSessionStats = function(userId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return this.aggregate([
        {
            $match: {
                userId: new mongoose.Types.ObjectId(userId),
                sessionStartTime: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: null,
                totalSessions: { $sum: 1 },
                successfulSessions: {
                    $sum: { $cond: [{ $eq: ['$sessionStatus', 'completed'] }, 1, 0] }
                },
                failedSessions: {
                    $sum: { $cond: [{ $eq: ['$sessionStatus', 'failed'] }, 1, 0] }
                },
                avgSuccessRate: { $avg: '$overallSummary.successRate' },
                avgDuration: { $avg: '$sessionDuration' },
                totalErrors: { $sum: { $size: '$errorLogs' } },
                totalFunctions: { $sum: '$overallSummary.totalFunctions' }
            }
        }
    ]);
};

// Pre-save middleware to update summary
UserAccountLogsSchema.pre('save', function(next) {
    if (this.isModified('logs')) {
        this.updateSummary();
    }
    next();
});

// Create and export the model
const UserAccountLogs = mongoose.model('UserAccountLogs', UserAccountLogsSchema);

module.exports = UserAccountLogs;

/**
 * DataFetchTrackingModel.js
 * 
 * Tracks when calendar-affecting services run for each user/country/region.
 * 
 * ONLY tracks on Mon/Wed/Fri (days 1, 3, 5) when these services run:
 * - mcpEconomicsData (Total Sales, Gross Profit, Fees, Refunds)
 * - ppcMetricsAggregated (PPC Metrics - SP, SB, SD)
 * - ppcSpendsDateWise (Date-wise PPC Spend)
 * - adsKeywordsPerformanceData (Keywords Performance / Wasted Spend)
 * - searchKeywords (Search Terms)
 * - ppcSpendsBySKU (Product-wise Sponsored Ads)
 * - ppcUnitsSold (PPC Units Sold)
 * - campaignData (Campaign Data)
 * 
 * These are the only services whose data can be filtered by calendar date range
 * in the frontend (Dashboard, Profitability, Sponsored Ads pages).
 */

const mongoose = require('mongoose');

const dataFetchTrackingSchema = new mongoose.Schema({
    User: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    region: {
        type: String,
        required: true,
        enum: ['NA', 'EU', 'FE'],
        index: true
    },
    country: {
        type: String,
        required: true,
        enum: ['US', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'AU', 'IN', 'SG', 'SA', 'ZA', 'BE'],
        index: true
    },
    // When the worker ran (UTC)
    fetchedAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    // Day information (all based on UTC)
    dayOfWeek: {
        type: Number, // 0-6, where 0 = Sunday
        required: true
    },
    dayName: {
        type: String, // "Sunday", "Monday", etc.
        required: true,
        enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    },
    // Date in YYYY-MM-DD format (UTC date)
    dateString: {
        type: String,
        required: true
    },
    // Time in HH:MM:SS format (UTC time)
    timeString: {
        type: String,
        required: true
    },
    // The data date range that was fetched
    dataRange: {
        startDate: {
            type: String, // YYYY-MM-DD format
            required: true
        },
        endDate: {
            type: String, // YYYY-MM-DD format
            required: true
        }
    },
    // Note: All calendar-affecting services run together on Mon/Wed/Fri
    // No need to track individual services - just tracking the day is sufficient
    // Services that run: mcpEconomicsData, ppcMetricsAggregated, ppcSpendsDateWise,
    // adsKeywordsPerformanceData, searchKeywords, ppcSpendsBySKU, ppcUnitsSold, campaignData
    // Status of the fetch
    status: {
        type: String,
        enum: ['started', 'completed', 'failed', 'partial'],
        default: 'started'
    },
    // Error message if failed
    errorMessage: {
        type: String,
        default: null
    },
    // Session ID for correlation with UserAccountLogs
    sessionId: {
        type: String,
        index: true
    }
}, {
    timestamps: true,
    collection: 'dataFetchTracking'
});

// Compound indexes for efficient queries
dataFetchTrackingSchema.index({ User: 1, country: 1, region: 1, fetchedAt: -1 });
dataFetchTrackingSchema.index({ User: 1, country: 1, region: 1, status: 1 });

// Static method to find latest fetch for a user/country/region
dataFetchTrackingSchema.statics.findLatest = function(userId, country, region) {
    return this.findOne({
        User: userId,
        country: country,
        region: region,
        status: 'completed'
    }).sort({ fetchedAt: -1 });
};

// Static method to get fetch history for a user
dataFetchTrackingSchema.statics.getFetchHistory = function(userId, country, region, limit = 10) {
    return this.find({
        User: userId,
        country: country,
        region: region
    })
    .sort({ fetchedAt: -1 })
    .limit(limit);
};

// Static method to create a new tracking entry
// Note: No servicesRan parameter - all calendar-affecting services run on Mon/Wed/Fri
dataFetchTrackingSchema.statics.createTrackingEntry = async function(userId, country, region, dataRange, sessionId = null) {
    const mongoose = require('mongoose');
    const now = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Convert userId to ObjectId if needed
    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch (err) {
        throw new Error(`Invalid User ID format: ${userId}`);
    }
    
    const entry = new this({
        User: userObjectId,
        country: country,
        region: region,
        fetchedAt: now,
        dayOfWeek: now.getUTCDay(),
        dayName: dayNames[now.getUTCDay()],
        dateString: now.toISOString().split('T')[0], // YYYY-MM-DD
        timeString: now.toISOString().split('T')[1].split('.')[0], // HH:MM:SS
        dataRange: {
            startDate: dataRange.startDate,
            endDate: dataRange.endDate
        },
        status: 'started',
        sessionId: sessionId
    });
    
    return await entry.save();
};

// Instance method to mark as completed
dataFetchTrackingSchema.methods.markCompleted = async function() {
    this.status = 'completed';
    return await this.save();
};

// Instance method to mark as failed
dataFetchTrackingSchema.methods.markFailed = async function(errorMessage) {
    this.status = 'failed';
    this.errorMessage = errorMessage;
    return await this.save();
};

const DataFetchTracking = mongoose.model('DataFetchTracking', dataFetchTrackingSchema);

module.exports = DataFetchTracking;


/**
 * IssueSummary Model
 * 
 * Stores precomputed issue counts for each user's seller account.
 * This allows the dashboard to fetch issue counts instantly without
 * running the full analysis pipeline every time.
 * 
 * The data is refreshed:
 * 1. After first-time integration (integration worker)
 * 2. After scheduled data fetches that affect issue calculations
 */

const mongoose = require('mongoose');

const IssueSummarySchema = new mongoose.Schema({
    // User reference
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    
    // Marketplace identification
    country: {
        type: String,
        required: true,
        index: true
    },
    region: {
        type: String,
        required: true,
        enum: ['NA', 'EU', 'FE'],
        index: true
    },
    
    // Total issues (sum of all 6 categories)
    totalIssues: {
        type: Number,
        default: 0
    },
    
    // Individual issue category counts
    // These match exactly the calculations in DashboardCalculation.js
    
    // 1. Profitability errors: Products with profit margin < 10% or negative profit
    totalProfitabilityErrors: {
        type: Number,
        default: 0
    },
    
    // 2. Sponsored Ads errors: High ACOS campaigns (>40%) + wasted spend keywords
    totalSponsoredAdsErrors: {
        type: Number,
        default: 0
    },
    
    // 3. Inventory errors: Planning (long-term storage, unfulfillable), stranded, non-compliance, replenishment
    totalInventoryErrors: {
        type: Number,
        default: 0
    },
    
    // 4. Ranking errors: Title, bullet points, description issues per product
    totalRankingErrors: {
        type: Number,
        default: 0
    },
    
    // 5. Conversion errors: A+, images, video, rating, buybox, brand story
    totalConversionErrors: {
        type: Number,
        default: 0
    },
    
    // 6. Account errors: Account health issues (from V1/V2 seller performance reports)
    totalAccountErrors: {
        type: Number,
        default: 0
    },
    
    // Number of products with at least one issue
    numberOfProductsWithIssues: {
        type: Number,
        default: 0
    },
    
    // Total active products at time of calculation
    totalActiveProducts: {
        type: Number,
        default: 0
    },
    
    // Timestamp when the issues were last calculated
    lastCalculatedAt: {
        type: Date,
        default: Date.now
    },
    
    // Source that triggered the calculation
    calculationSource: {
        type: String,
        enum: ['integration', 'schedule', 'manual', 'fallback'],
        default: 'integration'
    },
    
    // Flag to indicate if the data is stale and needs refresh
    isStale: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Compound index for efficient lookups by user + country + region
IssueSummarySchema.index({ userId: 1, country: 1, region: 1 }, { unique: true });

// Index for finding stale records that need refresh
IssueSummarySchema.index({ isStale: 1, lastCalculatedAt: 1 });

/**
 * Static method to upsert issue summary
 * @param {ObjectId} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region (NA, EU, FE)
 * @param {Object} issueData - Issue counts object
 * @param {String} source - Source of calculation
 * @returns {Promise<Document>} Updated document
 */
IssueSummarySchema.statics.upsertIssueSummary = async function(userId, country, region, issueData, source = 'integration') {
    const updateData = {
        totalIssues: issueData.totalIssues || 0,
        totalProfitabilityErrors: issueData.totalProfitabilityErrors || 0,
        totalSponsoredAdsErrors: issueData.totalSponsoredAdsErrors || 0,
        totalInventoryErrors: issueData.totalInventoryErrors || 0,
        totalRankingErrors: issueData.totalRankingErrors || 0,
        totalConversionErrors: issueData.totalConversionErrors || 0,
        totalAccountErrors: issueData.totalAccountErrors || 0,
        numberOfProductsWithIssues: issueData.numberOfProductsWithIssues || 0,
        totalActiveProducts: issueData.totalActiveProducts || 0,
        lastCalculatedAt: new Date(),
        calculationSource: source,
        isStale: false
    };
    
    return this.findOneAndUpdate(
        { userId, country, region },
        { $set: updateData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

/**
 * Static method to get issue summary for a user
 * @param {ObjectId} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region (NA, EU, FE)
 * @returns {Promise<Document|null>} Issue summary document or null
 */
IssueSummarySchema.statics.getIssueSummary = async function(userId, country, region) {
    return this.findOne({ userId, country, region }).lean();
};

/**
 * Static method to mark a summary as stale
 * @param {ObjectId} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region (NA, EU, FE)
 * @returns {Promise<Document>} Updated document
 */
IssueSummarySchema.statics.markAsStale = async function(userId, country, region) {
    return this.findOneAndUpdate(
        { userId, country, region },
        { $set: { isStale: true } },
        { new: true }
    );
};

/**
 * Static method to get all stale summaries
 * @param {Number} limit - Max number of records to return
 * @returns {Promise<Array>} Array of stale summaries
 */
IssueSummarySchema.statics.getStaleSummaries = async function(limit = 100) {
    return this.find({ isStale: true })
        .sort({ lastCalculatedAt: 1 })
        .limit(limit)
        .lean();
};

const IssueSummary = mongoose.model('IssueSummary', IssueSummarySchema);

module.exports = IssueSummary;

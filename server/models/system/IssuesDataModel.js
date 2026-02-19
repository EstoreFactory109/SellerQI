/**
 * IssuesData Model
 * 
 * Stores precomputed detailed issues data for each user's seller account.
 * This allows the Issues page to fetch data instantly without running
 * the full analysis pipeline every time.
 * 
 * The data is refreshed:
 * 1. After first-time integration (integration worker)
 * 2. After scheduled data fetches that affect issue calculations
 * 3. When user forces a refresh
 * 
 * This model stores the full issue arrays needed by:
 * - Category.jsx (Issues by Category page)
 * - IssuesByProduct.jsx (Issues by Product page)
 */

const mongoose = require('mongoose');

const IssuesDataSchema = new mongoose.Schema({
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
    
    // ============================================
    // ISSUE COUNTS (for quick access without parsing arrays)
    // ============================================
    totalRankingErrors: { type: Number, default: 0 },
    totalConversionErrors: { type: Number, default: 0 },
    totalInventoryErrors: { type: Number, default: 0 },
    totalAccountErrors: { type: Number, default: 0 },
    totalProfitabilityErrors: { type: Number, default: 0 },
    totalSponsoredAdsErrors: { type: Number, default: 0 },
    
    // ============================================
    // DETAILED ISSUE DATA (for Issues pages)
    // These are stored as Mixed type to allow flexible structure
    // ============================================
    
    // Product-wise error data (main product list with errors)
    productWiseError: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    
    // Ranking issues per product
    rankingProductWiseErrors: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    
    // Conversion issues per product
    conversionProductWiseErrors: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    
    // Inventory issues per product
    inventoryProductWiseErrors: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    
    // Account-level errors (for Account tab)
    AccountErrors: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    accountHealthPercentage: {
        type: mongoose.Schema.Types.Mixed,
        default: { Percentage: 0, status: 'Unknown' }
    },
    
    // Buy Box data
    buyBoxData: {
        type: mongoose.Schema.Types.Mixed,
        default: { asinBuyBoxData: [] }
    },
    
    // Profitability error details
    profitabilityErrorDetails: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    
    // Sponsored Ads error details
    sponsoredAdsErrorDetails: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    
    // Top error products (first, second, third, fourth)
    topErrorProducts: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    
    // Total products list (for lookups)
    TotalProduct: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    
    // Active products list
    ActiveProducts: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    
    // ============================================
    // METADATA
    // ============================================
    
    // Timestamp when the data was last calculated
    lastCalculatedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    
    // Source that triggered the calculation
    calculationSource: {
        type: String,
        enum: ['integration', 'schedule', 'manual', 'request'],
        default: 'integration'
    },
    
    // Version for tracking data structure changes
    dataVersion: {
        type: Number,
        default: 1
    }
}, {
    timestamps: true,
    // Issues data can be large for accounts with many products
    strict: false
});

// Compound index for efficient lookups by user + country + region
IssuesDataSchema.index({ userId: 1, country: 1, region: 1 }, { unique: true });

/**
 * Static method to upsert issues data
 */
IssuesDataSchema.statics.upsertIssuesData = async function(userId, country, region, issuesData, source = 'integration') {
    const updateData = {
        // Counts
        totalRankingErrors: issuesData.TotalRankingerrors || issuesData.totalRankingErrors || 0,
        totalConversionErrors: issuesData.totalErrorInConversion || issuesData.totalConversionErrors || 0,
        totalInventoryErrors: issuesData.totalInventoryErrors || 0,
        totalAccountErrors: issuesData.totalErrorInAccount || issuesData.totalAccountErrors || 0,
        totalProfitabilityErrors: issuesData.totalProfitabilityErrors || 0,
        totalSponsoredAdsErrors: issuesData.totalSponsoredAdsErrors || 0,
        
        // Detailed arrays
        productWiseError: issuesData.productWiseError || [],
        rankingProductWiseErrors: issuesData.rankingProductWiseErrors || [],
        conversionProductWiseErrors: issuesData.conversionProductWiseErrors || [],
        inventoryProductWiseErrors: issuesData.inventoryProductWiseErrors || [],
        
        // Account data
        AccountErrors: issuesData.AccountErrors || {},
        accountHealthPercentage: issuesData.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
        
        // Other data
        buyBoxData: issuesData.buyBoxData || { asinBuyBoxData: [] },
        profitabilityErrorDetails: issuesData.profitabilityErrorDetails || [],
        sponsoredAdsErrorDetails: issuesData.sponsoredAdsErrorDetails || [],
        topErrorProducts: {
            first: issuesData.first || null,
            second: issuesData.second || null,
            third: issuesData.third || null,
            fourth: issuesData.fourth || null
        },
        TotalProduct: issuesData.TotalProduct || [],
        ActiveProducts: issuesData.ActiveProducts || [],
        
        // Metadata
        lastCalculatedAt: new Date(),
        calculationSource: source,
        dataVersion: 1
    };
    
    return this.findOneAndUpdate(
        { userId, country, region },
        { $set: updateData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

/**
 * Static method to get issues data for a user
 */
IssuesDataSchema.statics.getIssuesData = async function(userId, country, region) {
    return this.findOne({ userId, country, region }).lean();
};

const IssuesData = mongoose.model('IssuesData', IssuesDataSchema);

module.exports = IssuesData;

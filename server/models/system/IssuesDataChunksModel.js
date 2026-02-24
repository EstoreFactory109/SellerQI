/**
 * IssuesDataChunks Model (Unified)
 * 
 * SINGLE SOURCE OF TRUTH for all issues data.
 * 
 * This model now serves TWO purposes:
 * 1. METADATA chunk (fieldName: '_metadata'): Stores counts, metadata, and small objects
 *    - One per (userId, country, region)
 *    - Replaces the old IssuesData model
 * 2. ARRAY chunks: Stores chunked array data to avoid 16MB limit
 *    - Multiple per array field when data is large
 * 
 * Migration: IssuesData documents are migrated into this unified model.
 * After migration, IssuesData model is deprecated and only IssuesDataChunks is used.
 */

const mongoose = require('mongoose');

const CHUNK_SIZE = 200; // Max items per chunk (tuned for safety margin under 16MB)

// List of all array field names
const ARRAY_FIELD_NAMES = [
    'productWiseError',
    'rankingProductWiseErrors',
    'conversionProductWiseErrors',
    'inventoryProductWiseErrors',
    'profitabilityErrorDetails',
    'sponsoredAdsErrorDetails',
    'TotalProduct',
    'ActiveProducts'
];

// All valid field names including metadata
const ALL_FIELD_NAMES = ['_metadata', ...ARRAY_FIELD_NAMES];

const IssuesDataChunksSchema = new mongoose.Schema({
    // User reference for direct queries
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
    
    // Field name this chunk belongs to
    // '_metadata' = counts + metadata (one per user/country/region)
    // Others = array data chunks
    fieldName: {
        type: String,
        required: true,
        enum: ALL_FIELD_NAMES,
        index: true
    },
    
    // Chunk index (0-based) for ordering when reconstructing arrays
    // For _metadata chunks, this is always 0
    chunkIndex: {
        type: Number,
        required: true,
        default: 0
    },
    
    // Total number of chunks for this field (1 for _metadata)
    totalChunks: {
        type: Number,
        required: true,
        default: 1
    },
    
    // The actual data for this chunk
    // For _metadata: object with counts, metadata, small fields
    // For arrays: array slice
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        default: []
    },
    
    // Number of items in this chunk (0 for _metadata)
    itemCount: {
        type: Number,
        required: true,
        default: 0
    }
}, {
    timestamps: true
});

// Compound index for efficient lookups
IssuesDataChunksSchema.index({ userId: 1, country: 1, region: 1, fieldName: 1, chunkIndex: 1 });

/**
 * Static method to save an array as chunks
 * @param {Object} params - Parameters
 * @param {ObjectId} params.userId - User ID
 * @param {String} params.country - Country code
 * @param {String} params.region - Region code
 * @param {String} params.fieldName - Field name being chunked
 * @param {Array} params.data - The array to chunk and save
 * @param {Number} params.chunkSize - Items per chunk (optional, defaults to CHUNK_SIZE)
 */
IssuesDataChunksSchema.statics.saveAsChunks = async function(params) {
    const {
        userId,
        country,
        region,
        fieldName,
        data,
        chunkSize = CHUNK_SIZE
    } = params;
    
    // Ensure userId is ObjectId for consistency
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    // Delete existing chunks for this field
    await this.deleteMany({ userId: userObjectId, country, region, fieldName });
    
    if (!data || !Array.isArray(data) || data.length === 0) {
        // Save empty chunk to indicate no data
        return this.create({
            userId: userObjectId,
            country,
            region,
            fieldName,
            chunkIndex: 0,
            totalChunks: 1,
            data: [],
            itemCount: 0
        });
    }
    
    const totalChunks = Math.ceil(data.length / chunkSize);
    const chunks = [];
    
    for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, data.length);
        const chunkData = data.slice(start, end);
        
        chunks.push({
            userId: userObjectId,
            country,
            region,
            fieldName,
            chunkIndex: i,
            totalChunks,
            data: chunkData,
            itemCount: chunkData.length
        });
    }
    
    // Insert all chunks
    return this.insertMany(chunks, { ordered: true });
};

/**
 * Static method to reconstruct an array from chunks
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @param {String} fieldName - Field name to reconstruct
 * @returns {Array} The reconstructed array
 */
IssuesDataChunksSchema.statics.getFieldData = async function(userId, country, region, fieldName) {
    // Ensure userId is ObjectId for query
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    const chunks = await this.find({ userId: userObjectId, country, region, fieldName })
        .sort({ chunkIndex: 1 })
        .lean();
    
    if (!chunks || chunks.length === 0) {
        return [];
    }
    
    // Concatenate all chunk data in order
    let result = [];
    for (const chunk of chunks) {
        if (chunk.data && Array.isArray(chunk.data)) {
            result = result.concat(chunk.data);
        }
    }
    
    return result;
};

/**
 * Static method to get all chunked fields for a user/country/region
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @returns {Object} Object with all field data reconstructed
 */
IssuesDataChunksSchema.statics.getAllFieldsData = async function(userId, country, region) {
    // Ensure userId is ObjectId for query
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    const chunks = await this.find({ userId: userObjectId, country, region })
        .sort({ fieldName: 1, chunkIndex: 1 })
        .lean();
    
    if (!chunks || chunks.length === 0) {
        return {};
    }
    
    const result = {};
    
    for (const chunk of chunks) {
        if (!result[chunk.fieldName]) {
            result[chunk.fieldName] = [];
        }
        if (chunk.data && Array.isArray(chunk.data)) {
            result[chunk.fieldName] = result[chunk.fieldName].concat(chunk.data);
        }
    }
    
    return result;
};

/**
 * Static method to get paginated data for a field
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @param {String} fieldName - Field name
 * @param {Number} skip - Items to skip
 * @param {Number} limit - Items to return
 * @returns {Object} { data: Array, total: Number }
 */
IssuesDataChunksSchema.statics.getPaginatedFieldData = async function(userId, country, region, fieldName, skip = 0, limit = 50) {
    // Ensure userId is ObjectId for query
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    // Get total count from first chunk's metadata or by summing itemCount
    const countAgg = await this.aggregate([
        { $match: { userId: userObjectId, country, region, fieldName } },
        { $group: { _id: null, total: { $sum: '$itemCount' } } }
    ]);
    
    const total = countAgg[0]?.total || 0;
    
    if (total === 0 || skip >= total) {
        return { data: [], total };
    }
    
    // Get all data and slice (for now - can optimize with chunk math later)
    const fullData = await this.getFieldData(userId, country, region, fieldName);
    const data = fullData.slice(skip, skip + limit);
    
    return { data, total };
};

/**
 * Static method to delete all chunks for a user/country/region
 */
IssuesDataChunksSchema.statics.deleteAllForUser = async function(userId, country, region) {
    // Ensure userId is ObjectId for query
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    return this.deleteMany({ userId: userObjectId, country, region });
};

/**
 * Static method to get chunk statistics for a field
 */
IssuesDataChunksSchema.statics.getChunkStats = async function(userId, country, region, fieldName) {
    const stats = await this.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId), country, region, fieldName } },
        {
            $group: {
                _id: null,
                totalChunks: { $first: '$totalChunks' },
                totalItems: { $sum: '$itemCount' },
                avgItemsPerChunk: { $avg: '$itemCount' }
            }
        }
    ]);
    
    return stats[0] || { totalChunks: 0, totalItems: 0, avgItemsPerChunk: 0 };
};

// ============================================
// UNIFIED MODEL METHODS (replacing IssuesData)
// ============================================

/**
 * Save or update metadata chunk (counts, metadata, small fields)
 * This replaces IssuesData.upsertIssuesData
 * 
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @param {Object} metadata - Object containing counts, metadata, small fields
 * @returns {Promise<Object>} Saved metadata chunk
 */
IssuesDataChunksSchema.statics.upsertMetadata = async function(userId, country, region, metadata) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    const metadataDoc = {
        totalRankingErrors: metadata.totalRankingErrors || 0,
        totalConversionErrors: metadata.totalConversionErrors || 0,
        totalInventoryErrors: metadata.totalInventoryErrors || 0,
        totalAccountErrors: metadata.totalAccountErrors || 0,
        totalProfitabilityErrors: metadata.totalProfitabilityErrors || 0,
        totalSponsoredAdsErrors: metadata.totalSponsoredAdsErrors || 0,
        AccountErrors: metadata.AccountErrors || {},
        accountHealthPercentage: metadata.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
        buyBoxData: metadata.buyBoxData || { asinBuyBoxData: [] },
        topErrorProducts: metadata.topErrorProducts || {},
        lastCalculatedAt: metadata.lastCalculatedAt || new Date(),
        calculationSource: metadata.calculationSource || 'integration',
        numberOfProductsWithIssues: metadata.numberOfProductsWithIssues || 0,
        totalIssues: metadata.totalIssues || 0
    };
    
    return this.findOneAndUpdate(
        { userId: userObjectId, country, region, fieldName: '_metadata' },
        {
            $set: {
                userId: userObjectId,
                country,
                region,
                fieldName: '_metadata',
                chunkIndex: 0,
                totalChunks: 1,
                data: metadataDoc,
                itemCount: 0
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

/**
 * Get metadata chunk (counts, metadata, small fields)
 * This replaces reading from IssuesData
 * 
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @returns {Promise<Object|null>} Metadata object or null
 */
IssuesDataChunksSchema.statics.getMetadata = async function(userId, country, region) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    const metadataChunk = await this.findOne({
        userId: userObjectId,
        country,
        region,
        fieldName: '_metadata'
    }).lean();
    
    if (!metadataChunk || !metadataChunk.data) {
        return null;
    }
    
    return {
        ...metadataChunk.data,
        _id: metadataChunk._id,
        userId: metadataChunk.userId,
        country: metadataChunk.country,
        region: metadataChunk.region,
        updatedAt: metadataChunk.updatedAt,
        createdAt: metadataChunk.createdAt
    };
};

/**
 * Check if issues data exists for a user/country/region
 * 
 * Checks both:
 * 1. Metadata chunk exists
 * 2. At least one array chunk has actual items (to avoid false positives from empty migrations)
 * 
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @returns {Promise<Boolean>}
 */
IssuesDataChunksSchema.statics.hasIssuesData = async function(userId, country, region) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    // Check if metadata exists
    const hasMetadata = await this.countDocuments({
        userId: userObjectId,
        country,
        region,
        fieldName: '_metadata'
    });
    
    if (!hasMetadata) {
        return false;
    }
    
    // Check if there's at least one array chunk with actual data
    // This prevents returning true for empty migrated data
    const hasArrayData = await this.countDocuments({
        userId: userObjectId,
        country,
        region,
        fieldName: { $ne: '_metadata' },
        itemCount: { $gt: 0 }
    });
    
    return hasArrayData > 0;
};

/**
 * Upsert complete issues data (metadata + all arrays)
 * This is the main write method that replaces IssuesData.upsertIssuesData
 * 
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @param {Object} issuesData - Full issues data object
 * @param {String} source - Source of calculation
 * @returns {Promise<Object>} Result with metadata and chunk counts
 */
IssuesDataChunksSchema.statics.upsertIssuesData = async function(userId, country, region, issuesData, source = 'integration') {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    // Build metadata object
    const metadata = {
        totalRankingErrors: issuesData.TotalRankingerrors || issuesData.totalRankingErrors || 0,
        totalConversionErrors: issuesData.totalErrorInConversion || issuesData.totalConversionErrors || 0,
        totalInventoryErrors: issuesData.totalInventoryErrors || 0,
        totalAccountErrors: issuesData.totalErrorInAccount || issuesData.totalAccountErrors || 0,
        totalProfitabilityErrors: issuesData.totalProfitabilityErrors || 0,
        totalSponsoredAdsErrors: issuesData.totalSponsoredAdsErrors || 0,
        AccountErrors: issuesData.AccountErrors || {},
        accountHealthPercentage: issuesData.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
        buyBoxData: issuesData.buyBoxData || { asinBuyBoxData: [] },
        topErrorProducts: {
            first: issuesData.first || issuesData.topErrorProducts?.first || null,
            second: issuesData.second || issuesData.topErrorProducts?.second || null,
            third: issuesData.third || issuesData.topErrorProducts?.third || null,
            fourth: issuesData.fourth || issuesData.topErrorProducts?.fourth || null
        },
        lastCalculatedAt: new Date(),
        calculationSource: source,
        numberOfProductsWithIssues: issuesData.numberOfProductsWithIssues || 0,
        totalIssues: issuesData.totalIssues || 0
    };
    
    // Save metadata
    await this.upsertMetadata(userId, country, region, metadata);
    
    // Save all array fields as chunks
    const arrayFields = {
        productWiseError: issuesData.productWiseError || [],
        rankingProductWiseErrors: issuesData.rankingProductWiseErrors || [],
        conversionProductWiseErrors: issuesData.conversionProductWiseErrors || [],
        inventoryProductWiseErrors: issuesData.inventoryProductWiseErrors || [],
        profitabilityErrorDetails: issuesData.profitabilityErrorDetails || [],
        sponsoredAdsErrorDetails: issuesData.sponsoredAdsErrorDetails || [],
        TotalProduct: issuesData.TotalProduct || [],
        ActiveProducts: issuesData.ActiveProducts || []
    };
    
    const chunkResults = {};
    
    for (const [fieldName, data] of Object.entries(arrayFields)) {
        const chunks = await this.saveAsChunks({
            issuesDataId: null, // Not used in unified model
            userId: userObjectId,
            country,
            region,
            fieldName,
            data
        });
        chunkResults[fieldName] = Array.isArray(chunks) ? chunks.length : 1;
    }
    
    return {
        metadata,
        chunkCounts: chunkResults
    };
};

/**
 * Get complete issues data (metadata + all arrays)
 * This replaces reading from IssuesData with dataVersion >= 2 handling
 * 
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @returns {Promise<Object|null>} Complete issues data or null
 */
IssuesDataChunksSchema.statics.getIssuesData = async function(userId, country, region) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    
    // Get metadata
    const metadata = await this.getMetadata(userId, country, region);
    if (!metadata) {
        return null;
    }
    
    // Get all array fields
    const allFieldsData = await this.getAllFieldsData(userId, country, region);
    
    // Combine metadata and array fields
    return {
        ...metadata,
        productWiseError: allFieldsData.productWiseError || [],
        rankingProductWiseErrors: allFieldsData.rankingProductWiseErrors || [],
        conversionProductWiseErrors: allFieldsData.conversionProductWiseErrors || [],
        inventoryProductWiseErrors: allFieldsData.inventoryProductWiseErrors || [],
        profitabilityErrorDetails: allFieldsData.profitabilityErrorDetails || [],
        sponsoredAdsErrorDetails: allFieldsData.sponsoredAdsErrorDetails || [],
        TotalProduct: allFieldsData.TotalProduct || [],
        ActiveProducts: allFieldsData.ActiveProducts || [],
        dataVersion: 3 // Unified model version
    };
};

/**
 * Get issue counts only (fast, for dashboard)
 * 
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @returns {Promise<Object|null>} Counts object or null
 */
IssuesDataChunksSchema.statics.getIssueCounts = async function(userId, country, region) {
    const metadata = await this.getMetadata(userId, country, region);
    if (!metadata) {
        return null;
    }
    
    return {
        totalRankingErrors: metadata.totalRankingErrors || 0,
        totalConversionErrors: metadata.totalConversionErrors || 0,
        totalInventoryErrors: metadata.totalInventoryErrors || 0,
        totalAccountErrors: metadata.totalAccountErrors || 0,
        totalProfitabilityErrors: metadata.totalProfitabilityErrors || 0,
        totalSponsoredAdsErrors: metadata.totalSponsoredAdsErrors || 0,
        totalIssues: metadata.totalIssues || 0,
        numberOfProductsWithIssues: metadata.numberOfProductsWithIssues || 0,
        lastCalculatedAt: metadata.lastCalculatedAt
    };
};

/**
 * Delete all issues data for a user/country/region
 * 
 * @param {ObjectId|String} userId - User ID
 * @param {String} country - Country code
 * @param {String} region - Region code
 * @returns {Promise<Object>} Delete result
 */
IssuesDataChunksSchema.statics.deleteIssuesData = async function(userId, country, region) {
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    return this.deleteMany({ userId: userObjectId, country, region });
};

const IssuesDataChunks = mongoose.model('IssuesDataChunks', IssuesDataChunksSchema);

// Export both the model and constants
module.exports = IssuesDataChunks;
module.exports.CHUNK_SIZE = CHUNK_SIZE;
module.exports.ARRAY_FIELD_NAMES = ARRAY_FIELD_NAMES;
module.exports.ALL_FIELD_NAMES = ALL_FIELD_NAMES;

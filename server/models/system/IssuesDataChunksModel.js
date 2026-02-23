/**
 * IssuesDataChunks Model
 * 
 * Stores chunked array data from IssuesData to avoid the 16MB MongoDB document limit.
 * 
 * Large arrays (rankingProductWiseErrors, conversionProductWiseErrors, etc.) are split
 * into multiple chunk documents. Each chunk stores a portion of the array along with
 * metadata to reconstruct the full array when reading.
 * 
 * This model works alongside IssuesData (which stores only counts and metadata).
 */

const mongoose = require('mongoose');

const CHUNK_SIZE = 200; // Max items per chunk (tuned for safety margin under 16MB)

const IssuesDataChunksSchema = new mongoose.Schema({
    // Reference to the parent IssuesData
    issuesDataId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IssuesData',
        required: true,
        index: true
    },
    
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
    
    // Field name this chunk belongs to (e.g., 'rankingProductWiseErrors')
    fieldName: {
        type: String,
        required: true,
        enum: [
            'productWiseError',
            'rankingProductWiseErrors',
            'conversionProductWiseErrors',
            'inventoryProductWiseErrors',
            'profitabilityErrorDetails',
            'sponsoredAdsErrorDetails',
            'TotalProduct',
            'ActiveProducts'
        ],
        index: true
    },
    
    // Chunk index (0-based) for ordering when reconstructing
    chunkIndex: {
        type: Number,
        required: true,
        default: 0
    },
    
    // Total number of chunks for this field
    totalChunks: {
        type: Number,
        required: true,
        default: 1
    },
    
    // The actual data for this chunk
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        default: []
    },
    
    // Number of items in this chunk
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
IssuesDataChunksSchema.index({ issuesDataId: 1, fieldName: 1, chunkIndex: 1 });

/**
 * Static method to save an array as chunks
 * @param {Object} params - Parameters
 * @param {ObjectId} params.issuesDataId - Reference to parent IssuesData document
 * @param {ObjectId} params.userId - User ID
 * @param {String} params.country - Country code
 * @param {String} params.region - Region code
 * @param {String} params.fieldName - Field name being chunked
 * @param {Array} params.data - The array to chunk and save
 * @param {Number} params.chunkSize - Items per chunk (optional, defaults to CHUNK_SIZE)
 */
IssuesDataChunksSchema.statics.saveAsChunks = async function(params) {
    const {
        issuesDataId,
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
            issuesDataId,
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
            issuesDataId,
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

const IssuesDataChunks = mongoose.model('IssuesDataChunks', IssuesDataChunksSchema);

// Export both the model and the chunk size constant
module.exports = IssuesDataChunks;
module.exports.CHUNK_SIZE = CHUNK_SIZE;

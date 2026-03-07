/**
 * ListingFixStatus Model
 * 
 * Tracks when a user has applied a fix to a listing issue via the "Fix It" button.
 * This allows the UI to show "Applied" / disabled state for issues that have been acted on.
 * 
 * The fix status is keyed by:
 * - userId, country, region (marketplace context)
 * - asin, sku (product identity)
 * - attribute (which field was fixed: title, description, bulletpoints, generic_keyword)
 * 
 * This model is separate from IssuesDataChunks because:
 * - IssuesDataChunks is recalculated periodically and would lose user-interaction state
 * - Fix status is user action state, not derived analysis data
 */

const mongoose = require('mongoose');

const ListingFixStatusSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    
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
    
    asin: {
        type: String,
        required: true,
        index: true
    },
    
    sku: {
        type: String,
        required: true,
        index: true
    },
    
    attribute: {
        type: String,
        required: true,
        enum: ['title', 'description', 'bulletpoints', 'generic_keyword'],
        index: true
    },
    
    fixed: {
        type: Boolean,
        default: true
    },
    
    fixedAt: {
        type: Date,
        default: Date.now
    },
    
    valueApplied: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    }
}, {
    timestamps: true
});

ListingFixStatusSchema.index(
    { userId: 1, country: 1, region: 1, asin: 1, sku: 1, attribute: 1 },
    { unique: true }
);

ListingFixStatusSchema.statics.markAsFixed = async function(params) {
    const { userId, country, region, asin, sku, attribute, valueApplied } = params;
    
    const userObjectId = typeof userId === 'string' 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
    
    return this.findOneAndUpdate(
        { userId: userObjectId, country, region, asin, sku, attribute },
        { 
            $set: { 
                fixed: true, 
                fixedAt: new Date(),
                valueApplied: valueApplied || null
            }
        },
        { upsert: true, new: true }
    );
};

ListingFixStatusSchema.statics.getFixedStatusForProducts = async function(userId, country, region, productKeys) {
    if (!productKeys || productKeys.length === 0) {
        return new Map();
    }
    
    const userObjectId = typeof userId === 'string' 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
    
    const conditions = productKeys.map(pk => ({
        userId: userObjectId,
        country,
        region,
        asin: pk.asin,
        sku: pk.sku,
        attribute: pk.attribute
    }));
    
    const results = await this.find({ $or: conditions, fixed: true }).lean();
    
    const fixedMap = new Map();
    results.forEach(doc => {
        const key = `${doc.asin}|${doc.sku}|${doc.attribute}`;
        fixedMap.set(key, {
            fixed: doc.fixed,
            fixedAt: doc.fixedAt
        });
    });
    
    return fixedMap;
};

ListingFixStatusSchema.statics.getFixedAttributesForProduct = async function(userId, country, region, asin, sku) {
    const userObjectId = typeof userId === 'string' 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
    
    const results = await this.find({
        userId: userObjectId,
        country,
        region,
        asin,
        sku,
        fixed: true
    }).lean();
    
    const attributeMap = {};
    results.forEach(doc => {
        attributeMap[doc.attribute] = {
            fixed: true,
            fixedAt: doc.fixedAt
        };
    });
    
    return attributeMap;
};

const ListingFixStatus = mongoose.model('ListingFixStatus', ListingFixStatusSchema);

module.exports = ListingFixStatus;

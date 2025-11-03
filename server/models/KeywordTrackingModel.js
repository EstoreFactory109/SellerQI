const mongoose = require('mongoose');

const keywordTrackingSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    country: {
        type: String,
        required: true
    },
    region: {
        type: String,
        required: true
    },
    keywords: [{
        asin: {
            type: String,
            required: true
        },
        keyword: {
            type: String,
            required: true
        },
        // Reverse ASIN data
        searchVolume: {
            type: Number,
            default: 0
        },
        competition: {
            type: String,
            default: 'unknown',
            enum: ['low', 'medium', 'high', 'unknown']
        },
        difficulty: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        },
        cpc: {
            type: Number,
            default: 0
        },
        // Keyword tracking data (if available)
        rank: {
            type: Number,
            default: null
        },
        pageRank: {
            type: Number,
            default: null
        },
        isIndexed: {
            type: Boolean,
            default: null
        },
        isSponsored: {
            type: Boolean,
            default: false
        },
        lastChecked: {
            type: Date,
            default: null
        },
        // Additional tracking metrics
        impressions: {
            type: Number,
            default: 0
        },
        clicks: {
            type: Number,
            default: 0
        },
        ctr: {
            type: Number,
            default: 0
        },
        // Metadata
        createdAt: {
            type: Date,
            default: Date.now
        },
        updatedAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true // Adds createdAt and updatedAt fields to the main document
});

// Update the updatedAt field for individual keywords when they are modified
keywordTrackingSchema.pre('save', function(next) {
    if (this.isModified('keywords')) {
        this.keywords.forEach(keyword => {
            keyword.updatedAt = new Date();
        });
    }
    next();
});

// Index for better query performance
keywordTrackingSchema.index({ userId: 1, country: 1, region: 1 });
keywordTrackingSchema.index({ 'keywords.asin': 1 });
keywordTrackingSchema.index({ 'keywords.keyword': 1 });

const KeywordTrackingModel = mongoose.model('KeywordTrackingModel', keywordTrackingSchema);

module.exports = KeywordTrackingModel;

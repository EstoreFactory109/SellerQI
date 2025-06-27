const mongoose = require('mongoose');

const ipSearchSchema = new mongoose.Schema({
    ipAddress: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    searchCount: {
        type: Number,
        default: 0,
        max: 3
    },
    lastResetDate: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Method to check if this IP needs monthly reset
ipSearchSchema.methods.needsReset = function() {
    const now = new Date();
    const monthsAgo = new Date(this.lastResetDate);
    monthsAgo.setMonth(monthsAgo.getMonth() + 1);
    return now >= monthsAgo;
};

// Method to reset searches for this IP
ipSearchSchema.methods.resetSearches = function() {
    this.searchCount = 0;
    this.lastResetDate = new Date();
    return this.save();
};

// Method to use a search
ipSearchSchema.methods.useSearch = function() {
    this.searchCount += 1;
    return this.save();
};

// Method to get remaining searches
ipSearchSchema.methods.getRemainingSearches = function() {
    return Math.max(0, 3 - this.searchCount);
};

const IPSearch = mongoose.model('IPSearch', ipSearchSchema);

module.exports = IPSearch; 
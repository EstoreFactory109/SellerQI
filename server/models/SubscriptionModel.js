const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    stripeSubscriptionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    stripeCustomerId: {
        type: String,
        required: true,
        index: true
    },
    planType: {
        type: String,
        required: true,
        enum: ['LITE', 'PRO', 'AGENCY'],
        default: 'LITE'
    },
    status: {
        type: String,
        required: true,
        enum: [
            'active',
            'canceled',
            'incomplete',
            'incomplete_expired',
            'past_due',
            'trialing',
            'unpaid'
        ],
        default: 'active'
    },
    currentPeriodStart: {
        type: Date,
        required: true
    },
    currentPeriodEnd: {
        type: Date,
        required: true
    },
    cancelAtPeriodEnd: {
        type: Boolean,
        default: false
    },
    canceledAt: {
        type: Date,
        default: null
    },
    endedAt: {
        type: Date,
        default: null
    },
    trialStart: {
        type: Date,
        default: null
    },
    trialEnd: {
        type: Date,
        default: null
    },
    // Pricing information
    priceId: {
        type: String,
        required: false
    },
    amount: {
        type: Number,
        required: false,
        default: 0
    },
    currency: {
        type: String,
        required: false,
        default: 'usd'
    },
    interval: {
        type: String,
        enum: ['month', 'year', 'week', 'day', null],
        default: 'month'
    },
    // Metadata for additional information
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for better query performance
subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ stripeSubscriptionId: 1 });
subscriptionSchema.index({ stripeCustomerId: 1 });
subscriptionSchema.index({ planType: 1, status: 1 });
subscriptionSchema.index({ currentPeriodEnd: 1 });

// Virtual to check if subscription is active
subscriptionSchema.virtual('isActive').get(function() {
    return this.status === 'active' || this.status === 'trialing';
});

// Virtual to check if subscription is expired
subscriptionSchema.virtual('isExpired').get(function() {
    return new Date() > this.currentPeriodEnd && this.status !== 'active';
});

// Static method to find active subscription for user
subscriptionSchema.statics.findActiveForUser = function(userId) {
    return this.findOne({
        userId: userId,
        status: { $in: ['active', 'trialing'] }
    }).sort({ createdAt: -1 });
};

// Static method to find all subscriptions for user
subscriptionSchema.statics.findAllForUser = function(userId) {
    return this.find({ userId: userId }).sort({ createdAt: -1 });
};

// Method to check if user has access to features based on plan
subscriptionSchema.methods.hasFeatureAccess = function(requiredPlans) {
    if (!Array.isArray(requiredPlans)) {
        requiredPlans = [requiredPlans];
    }
    
    // LITE is always available
    if (requiredPlans.includes('LITE')) {
        return true;
    }
    
    // Check if current plan is in required plans and subscription is active
    return this.isActive && requiredPlans.includes(this.planType);
};

// Pre-save middleware to validate data
subscriptionSchema.pre('save', function(next) {
    // Ensure LITE plans have appropriate settings
    if (this.planType === 'LITE') {
        this.amount = 0;
        this.currency = 'usd';
        this.interval = null;
    }
    
    // Validate period dates
    if (this.currentPeriodStart >= this.currentPeriodEnd) {
        next(new Error('Current period start must be before end date'));
    }
    
    next();
});

const SubscriptionModel = mongoose.model('Subscription', subscriptionSchema);

module.exports = SubscriptionModel; 
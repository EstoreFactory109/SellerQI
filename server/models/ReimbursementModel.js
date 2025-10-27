const mongoose = require('mongoose');

/**
 * Reimbursement Model - Stores all Amazon FBA reimbursement data
 * Supports multiple reimbursement types and marketplace-specific handling
 * 
 * Reimbursement Types:
 * - LOST: Items lost in Amazon fulfillment centers
 * - DAMAGED: Items damaged at Amazon facilities
 * - CUSTOMER_RETURN: Customer returns not restocked properly
 * - FEE_CORRECTION: Overcharged FBA fees, storage fees, referral fees
 * - INBOUND_SHIPMENT: Shipment discrepancies (shipped vs received)
 * - REMOVAL_ORDER: Items lost during removal process
 * - WAREHOUSE_DAMAGE: Items damaged during warehouse operations
 * - OTHER: Other reimbursement types
 */

const reimbursementItemSchema = new mongoose.Schema({
    // Amazon reimbursement identifiers
    reimbursementId: {
        type: String,
        required: false,
        index: true
    },
    
    // Product identifiers
    asin: {
        type: String,
        required: false,
        index: true
    },
    sku: {
        type: String,
        required: false,
        index: true
    },
    fnsku: {
        type: String,
        required: false
    },
    
    // Reimbursement details
    reimbursementType: {
        type: String,
        enum: [
            'LOST',
            'DAMAGED', 
            'CUSTOMER_RETURN',
            'FEE_CORRECTION',
            'INBOUND_SHIPMENT',
            'REMOVAL_ORDER',
            'WAREHOUSE_DAMAGE',
            'INVENTORY_DIFFERENCE',
            'OTHER'
        ],
        required: true,
        default: 'OTHER'
    },
    
    // Financial data
    amount: {
        type: Number,
        required: true,
        default: 0
    },
    currency: {
        type: String,
        required: true,
        default: 'USD'
    },
    quantity: {
        type: Number,
        required: false,
        default: 0
    },
    
    // Amazon case details
    reasonCode: {
        type: String,
        required: false
    },
    reasonDescription: {
        type: String,
        required: false
    },
    caseId: {
        type: String,
        required: false
    },
    
    // Status tracking
    status: {
        type: String,
        enum: ['APPROVED', 'PENDING', 'DENIED', 'POTENTIAL', 'EXPIRED'],
        required: true,
        default: 'APPROVED'
    },
    
    // Dates
    approvalDate: {
        type: Date,
        required: false
    },
    reimbursementDate: {
        type: Date,
        required: false,
        index: true
    },
    claimDate: {
        type: Date,
        required: false
    },
    discoveryDate: {
        type: Date,
        required: false,
        default: Date.now
    },
    expiryDate: {
        type: Date,
        required: false
    },
    
    // Claim window tracking (Amazon's 60-day policy)
    daysToDeadline: {
        type: Number,
        required: false
    },
    
    // Automation tracking
    isAutomated: {
        type: Boolean,
        required: false,
        default: false,
        comment: 'Whether Amazon automatically reimbursed or manual claim'
    },
    
    // Cost-based reimbursement (Amazon's 2025 policy)
    productCost: {
        type: Number,
        required: false,
        comment: 'Manufacturing/sourcing cost for cost-based reimbursement'
    },
    retailValue: {
        type: Number,
        required: false,
        comment: 'Retail value at time of loss/damage'
    },
    
    // Marketplace
    marketplace: {
        type: String,
        required: false
    },
    
    // Shipment reference (for inbound shipment discrepancies)
    shipmentId: {
        type: String,
        required: false
    },
    shipmentName: {
        type: String,
        required: false
    },
    
    // Additional metadata
    notes: {
        type: String,
        required: false
    },
    documentationUrls: [{
        type: String
    }]
}, { _id: true });

const reimbursementSchema = new mongoose.Schema({
    // User reference
    User: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    
    // Region and country
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
    
    // Array of reimbursement items
    reimbursements: [reimbursementItemSchema],
    
    // Summary statistics
    summary: {
        // Total amounts
        totalReceived: {
            type: Number,
            default: 0,
            comment: 'Total reimbursements received (APPROVED status)'
        },
        totalPending: {
            type: Number,
            default: 0,
            comment: 'Total pending claims'
        },
        totalPotential: {
            type: Number,
            default: 0,
            comment: 'Total potential claims identified but not yet filed'
        },
        totalDenied: {
            type: Number,
            default: 0,
            comment: 'Total denied claims'
        },
        
        // Counts by type
        countByType: {
            LOST: { type: Number, default: 0 },
            DAMAGED: { type: Number, default: 0 },
            CUSTOMER_RETURN: { type: Number, default: 0 },
            FEE_CORRECTION: { type: Number, default: 0 },
            INBOUND_SHIPMENT: { type: Number, default: 0 },
            REMOVAL_ORDER: { type: Number, default: 0 },
            WAREHOUSE_DAMAGE: { type: Number, default: 0 },
            INVENTORY_DIFFERENCE: { type: Number, default: 0 },
            OTHER: { type: Number, default: 0 }
        },
        
        // Amounts by type
        amountByType: {
            LOST: { type: Number, default: 0 },
            DAMAGED: { type: Number, default: 0 },
            CUSTOMER_RETURN: { type: Number, default: 0 },
            FEE_CORRECTION: { type: Number, default: 0 },
            INBOUND_SHIPMENT: { type: Number, default: 0 },
            REMOVAL_ORDER: { type: Number, default: 0 },
            WAREHOUSE_DAMAGE: { type: Number, default: 0 },
            INVENTORY_DIFFERENCE: { type: Number, default: 0 },
            OTHER: { type: Number, default: 0 }
        },
        
        // Time period statistics
        last7Days: {
            type: Number,
            default: 0
        },
        last30Days: {
            type: Number,
            default: 0
        },
        last90Days: {
            type: Number,
            default: 0
        },
        
        // Claim window tracking
        claimsExpiringIn7Days: {
            type: Number,
            default: 0,
            comment: 'Number of potential claims expiring within 7 days'
        },
        claimsExpiringIn30Days: {
            type: Number,
            default: 0,
            comment: 'Number of potential claims expiring within 30 days'
        },
        
        // Automation statistics
        automatedCount: {
            type: Number,
            default: 0,
            comment: 'Number of automatically reimbursed items'
        },
        manualCount: {
            type: Number,
            default: 0,
            comment: 'Number of manually claimed items'
        }
    },
    
    // Last update tracking
    lastFetchDate: {
        type: Date,
        default: Date.now
    },
    
    // Data source information
    dataSource: {
        type: String,
        enum: ['SP_API', 'SHIPMENT_CALCULATION', 'MANUAL', 'INVENTORY_REPORT'],
        default: 'SP_API'
    }
    
}, { timestamps: true });

// Indexes for performance
reimbursementSchema.index({ User: 1, region: 1, country: 1 });
reimbursementSchema.index({ 'reimbursements.asin': 1 });
reimbursementSchema.index({ 'reimbursements.sku': 1 });
reimbursementSchema.index({ 'reimbursements.status': 1 });
reimbursementSchema.index({ 'reimbursements.reimbursementDate': -1 });
reimbursementSchema.index({ 'reimbursements.reimbursementType': 1 });
reimbursementSchema.index({ createdAt: -1 });

// Method to calculate summary statistics
reimbursementSchema.methods.calculateSummary = function() {
    const summary = {
        totalReceived: 0,
        totalPending: 0,
        totalPotential: 0,
        totalDenied: 0,
        countByType: {
            LOST: 0, DAMAGED: 0, CUSTOMER_RETURN: 0, FEE_CORRECTION: 0,
            INBOUND_SHIPMENT: 0, REMOVAL_ORDER: 0, WAREHOUSE_DAMAGE: 0,
            INVENTORY_DIFFERENCE: 0, OTHER: 0
        },
        amountByType: {
            LOST: 0, DAMAGED: 0, CUSTOMER_RETURN: 0, FEE_CORRECTION: 0,
            INBOUND_SHIPMENT: 0, REMOVAL_ORDER: 0, WAREHOUSE_DAMAGE: 0,
            INVENTORY_DIFFERENCE: 0, OTHER: 0
        },
        last7Days: 0,
        last30Days: 0,
        last90Days: 0,
        claimsExpiringIn7Days: 0,
        claimsExpiringIn30Days: 0,
        automatedCount: 0,
        manualCount: 0
    };

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    this.reimbursements.forEach(item => {
        const amount = item.amount || 0;
        const type = item.reimbursementType || 'OTHER';
        const date = item.reimbursementDate || item.discoveryDate;

        // Status totals
        if (item.status === 'APPROVED') {
            summary.totalReceived += amount;
        } else if (item.status === 'PENDING') {
            summary.totalPending += amount;
        } else if (item.status === 'POTENTIAL') {
            summary.totalPotential += amount;
        } else if (item.status === 'DENIED') {
            summary.totalDenied += amount;
        }

        // Type counts and amounts
        if (summary.countByType[type] !== undefined) {
            summary.countByType[type]++;
            summary.amountByType[type] += amount;
        }

        // Time period calculations
        if (date) {
            if (date >= sevenDaysAgo) summary.last7Days += amount;
            if (date >= thirtyDaysAgo) summary.last30Days += amount;
            if (date >= ninetyDaysAgo) summary.last90Days += amount;
        }

        // Expiry tracking
        if (item.status === 'POTENTIAL' && item.expiryDate) {
            if (item.expiryDate <= sevenDaysFromNow) {
                summary.claimsExpiringIn7Days++;
            }
            if (item.expiryDate <= thirtyDaysFromNow) {
                summary.claimsExpiringIn30Days++;
            }
        }

        // Automation tracking
        if (item.isAutomated) {
            summary.automatedCount++;
        } else {
            summary.manualCount++;
        }
    });

    this.summary = summary;
    return summary;
};

// Static method to find recent reimbursements
reimbursementSchema.statics.findRecentByUser = function(userId, country, region, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    return this.findOne({
        User: userId,
        country: country,
        region: region,
        'reimbursements.reimbursementDate': { $gte: startDate }
    }).sort({ createdAt: -1 });
};

// Virtual for total reimbursement count
reimbursementSchema.virtual('totalCount').get(function() {
    return this.reimbursements ? this.reimbursements.length : 0;
});

module.exports = mongoose.model('Reimbursement', reimbursementSchema);


/**
 * AsinWiseSalesForBigAccountsModel.js
 * 
 * Model for storing ASIN-wise sales data for big accounts (totalSales > 5000)
 * Each document stores ASIN sales data for a single date, linked to the main EconomicsMetrics document.
 * This approach prevents the 16MB MongoDB document size limit for users with many ASINs.
 */

const mongoose = require('mongoose');

// Schema for individual ASIN sales data (same as in EconomicsMetricsModel)
const asinSalesItemSchema = new mongoose.Schema({
    asin: {
        type: String,
        required: true
    },
    parentAsin: {
        type: String,
        required: false,
        default: null
    },
    sales: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    grossProfit: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    unitsSold: {
        type: Number,
        required: true,
        default: 0
    },
    refunds: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    ppcSpent: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    fbaFees: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    storageFees: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    totalFees: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    amazonFees: {
        amount: {
            type: Number,
            required: true,
            default: 0
        },
        currencyCode: {
            type: String,
            required: true,
            default: 'USD'
        }
    },
    feeBreakdown: [{
        feeType: {
            type: String,
            required: true
        },
        amount: {
            type: Number,
            required: true,
            default: 0
        }
    }]
}, { _id: false });

// Main schema for ASIN-wise sales per date
const asinWiseSalesForBigAccountsSchema = new mongoose.Schema({
    // Reference to the main EconomicsMetrics document
    metricsId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EconomicsMetrics',
        required: true,
        index: true
    },
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
        index: true
    },
    // The specific date this document covers
    date: {
        type: String,
        required: true,
        index: true
    },
    // All ASIN sales data for this specific date
    asinSales: {
        type: [asinSalesItemSchema],
        default: []
    }
}, {
    timestamps: true
});

// Compound indexes for efficient queries
asinWiseSalesForBigAccountsSchema.index({ metricsId: 1, date: 1 }, { unique: true });
asinWiseSalesForBigAccountsSchema.index({ User: 1, region: 1, country: 1, date: 1 });
asinWiseSalesForBigAccountsSchema.index({ User: 1, region: 1, country: 1, createdAt: -1 });

// Static method to find all ASIN sales for a metrics document
asinWiseSalesForBigAccountsSchema.statics.findByMetricsId = function(metricsId) {
    return this.find({ metricsId: metricsId }).sort({ date: 1 });
};

// Static method to find ASIN sales by date range
asinWiseSalesForBigAccountsSchema.statics.findByDateRange = function(userId, region, country, startDate, endDate) {
    return this.find({
        User: userId,
        region: region,
        country: country,
        date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });
};

// Static method to find latest ASIN sales for a user
asinWiseSalesForBigAccountsSchema.statics.findLatestForUser = function(userId, region, country) {
    return this.find({
        User: userId,
        region: region,
        country: country
    }).sort({ createdAt: -1 });
};

// Static method to delete all ASIN sales for a metrics document
asinWiseSalesForBigAccountsSchema.statics.deleteByMetricsId = function(metricsId) {
    return this.deleteMany({ metricsId: metricsId });
};

/**
 * OPTIMIZED: Get top ASINs by total sales for a metrics document
 * Uses MongoDB aggregation pipeline to:
 * 1. Match documents by metricsId
 * 2. Unwind asinSales array
 * 3. Group by ASIN and sum sales
 * 4. Sort by total sales descending
 * 5. Limit to specified count
 * 
 * This is much faster than fetching all data and processing in Node.js
 * @param {ObjectId} metricsId - The EconomicsMetrics document ID
 * @param {number} limit - Maximum number of ASINs to return (default 100)
 * @returns {Promise<Array>} Array of { asin, totalSales, unitsSold } sorted by totalSales desc
 */
asinWiseSalesForBigAccountsSchema.statics.getTopAsinsBySales = async function(metricsId, limit = 100) {
    return this.aggregate([
        { $match: { metricsId: metricsId } },
        { $unwind: '$asinSales' },
        { 
            $group: {
                _id: '$asinSales.asin',
                totalSales: { $sum: '$asinSales.sales.amount' },
                unitsSold: { $sum: '$asinSales.unitsSold' },
                parentAsin: { $first: '$asinSales.parentAsin' }
            }
        },
        { $sort: { totalSales: -1 } },
        { $limit: limit },
        { 
            $project: {
                _id: 0,
                asin: '$_id',
                totalSales: 1,
                unitsSold: 1,
                parentAsin: 1
            }
        }
    ]);
};

/**
 * OPTIMIZED: Get all ASIN sales totals for a metrics document
 * Uses MongoDB aggregation to sum sales across all dates per ASIN
 * Returns a Map for O(1) lookup
 * @param {ObjectId} metricsId - The EconomicsMetrics document ID
 * @returns {Promise<Map>} Map of asin -> { totalSales, unitsSold }
 */
asinWiseSalesForBigAccountsSchema.statics.getAsinSalesMap = async function(metricsId) {
    const results = await this.aggregate([
        { $match: { metricsId: metricsId } },
        { $unwind: '$asinSales' },
        { 
            $group: {
                _id: '$asinSales.asin',
                totalSales: { $sum: '$asinSales.sales.amount' },
                unitsSold: { $sum: '$asinSales.unitsSold' }
            }
        },
        { 
            $project: {
                _id: 0,
                asin: '$_id',
                totalSales: 1,
                unitsSold: 1
            }
        }
    ]);
    
    return new Map(results.map(r => [r.asin, { totalSales: r.totalSales, unitsSold: r.unitsSold }]));
};

/**
 * OPTIMIZED: Get full profitability data per ASIN for a metrics document
 * Uses MongoDB aggregation to sum all profitability fields across all dates per ASIN
 * Returns a Map for O(1) lookup - includes all fields needed for recommendations
 * 
 * This is much faster than findByMetricsId + JS aggregation because:
 * 1. Aggregation happens in MongoDB (no data transfer of all date docs)
 * 2. Returns only one aggregated row per ASIN instead of many date rows
 * 
 * @param {ObjectId} metricsId - The EconomicsMetrics document ID
 * @returns {Promise<Map>} Map of asin -> { sales, grossProfit, ads, amzFee, fbaFees, storageFees, totalFees, unitsSold, refunds, parentAsin }
 */
asinWiseSalesForBigAccountsSchema.statics.getProfitabilityMapByMetricsId = async function(metricsId) {
    const results = await this.aggregate([
        { $match: { metricsId: metricsId } },
        { $unwind: '$asinSales' },
        { 
            $group: {
                _id: '$asinSales.asin',
                parentAsin: { $first: '$asinSales.parentAsin' },
                sales: { $sum: '$asinSales.sales.amount' },
                grossProfit: { $sum: '$asinSales.grossProfit.amount' },
                ads: { $sum: '$asinSales.ppcSpent.amount' },
                amzFee: { $sum: '$asinSales.amazonFees.amount' },
                fbaFees: { $sum: '$asinSales.fbaFees.amount' },
                storageFees: { $sum: '$asinSales.storageFees.amount' },
                totalFees: { $sum: '$asinSales.totalFees.amount' },
                unitsSold: { $sum: '$asinSales.unitsSold' },
                refunds: { $sum: '$asinSales.refunds.amount' }
            }
        },
        { 
            $project: {
                _id: 0,
                asin: '$_id',
                parentAsin: 1,
                sales: 1,
                grossProfit: 1,
                ads: 1,
                amzFee: 1,
                fbaFees: 1,
                storageFees: 1,
                totalFees: 1,
                unitsSold: 1,
                refunds: 1
            }
        }
    ]);
    
    const map = new Map();
    results.forEach(r => {
        map.set(r.asin, {
            asin: r.asin,
            parentAsin: r.parentAsin || r.asin,
            sales: r.sales || 0,
            grossProfit: r.grossProfit || 0,
            ads: r.ads || 0,
            amzFee: r.amzFee || 0,
            fbaFees: r.fbaFees || 0,
            storageFees: r.storageFees || 0,
            totalFees: r.totalFees || 0,
            unitsSold: r.unitsSold || 0,
            refunds: r.refunds || 0
        });
    });
    return map;
};

/**
 * OPTIMIZED: Get paginated parent profitability data for profitability table
 * Groups by parentAsin, sums metrics, sorts by total sales desc, applies skip/limit
 * 
 * This enables TRUE backend pagination - only fetches the data needed for the requested page
 * 
 * @param {ObjectId} metricsId - The EconomicsMetrics document ID
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @param {Set} activeAsinSet - Optional set of active ASINs to filter (if null, no filtering)
 * @returns {Promise<Object>} { parents: Array, totalParents: number, totalChildren: number }
 */
asinWiseSalesForBigAccountsSchema.statics.getPaginatedParentProfitability = async function(metricsId, page = 1, limit = 10, activeAsinSet = null) {
    const skip = (page - 1) * limit;
    
    // Build match stage - optionally filter by active ASINs
    const matchStage = { metricsId: metricsId };
    
    // First: aggregate all child ASINs grouped by parentAsin
    const pipeline = [
        { $match: matchStage },
        { $unwind: '$asinSales' },
        // Group by child ASIN first to sum metrics per child
        {
            $group: {
                _id: '$asinSales.asin',
                parentAsin: { $first: '$asinSales.parentAsin' },
                sales: { $sum: '$asinSales.sales.amount' },
                grossProfit: { $sum: '$asinSales.grossProfit.amount' },
                ads: { $sum: '$asinSales.ppcSpent.amount' },
                amzFee: { $sum: '$asinSales.amazonFees.amount' },
                fbaFees: { $sum: '$asinSales.fbaFees.amount' },
                storageFees: { $sum: '$asinSales.storageFees.amount' },
                totalFees: { $sum: '$asinSales.totalFees.amount' },
                unitsSold: { $sum: '$asinSales.unitsSold' },
                refunds: { $sum: '$asinSales.refunds.amount' }
            }
        },
        // Add computed parentAsin (use self if null)
        {
            $addFields: {
                effectiveParentAsin: { $ifNull: ['$parentAsin', '$_id'] }
            }
        },
        // Group by parentAsin to get parent totals and children array
        {
            $group: {
                _id: '$effectiveParentAsin',
                totalSales: { $sum: '$sales' },
                totalQuantity: { $sum: '$unitsSold' },
                totalAds: { $sum: '$ads' },
                totalFees: { $sum: '$totalFees' },
                totalAmazonFees: { $sum: '$amzFee' },
                totalFbaFees: { $sum: '$fbaFees' },
                totalStorageFees: { $sum: '$storageFees' },
                totalGrossProfit: { $sum: '$grossProfit' },
                children: {
                    $push: {
                        asin: '$_id',
                        sales: '$sales',
                        quantity: '$unitsSold',
                        ads: '$ads',
                        totalFees: '$totalFees',
                        amazonFees: '$amzFee',
                        fbaFees: '$fbaFees',
                        storageFees: '$storageFees',
                        grossProfit: '$grossProfit'
                    }
                }
            }
        },
        // Sort by total sales descending
        { $sort: { totalSales: -1 } },
        // Use $facet to get both paginated data and total count in one query
        {
            $facet: {
                paginatedResults: [
                    { $skip: skip },
                    { $limit: limit },
                    {
                        $project: {
                            _id: 0,
                            parentAsin: '$_id',
                            totalSales: 1,
                            totalQuantity: 1,
                            totalAds: 1,
                            totalFees: 1,
                            totalAmazonFees: 1,
                            totalFbaFees: 1,
                            totalStorageFees: 1,
                            totalGrossProfit: 1,
                            children: 1,
                            childrenCount: { $size: '$children' }
                        }
                    }
                ],
                totalCount: [
                    { $count: 'count' }
                ],
                totalChildrenCount: [
                    { $unwind: '$children' },
                    { $count: 'count' }
                ]
            }
        }
    ];
    
    const results = await this.aggregate(pipeline);
    
    const facetResult = results[0] || {};
    const parents = facetResult.paginatedResults || [];
    const totalParents = facetResult.totalCount?.[0]?.count || 0;
    const totalChildren = facetResult.totalChildrenCount?.[0]?.count || 0;
    
    // Filter children to exclude self (parent appears in its own children)
    parents.forEach(parent => {
        const actualChildren = parent.children.filter(child => child.asin !== parent.parentAsin);
        parent.children = actualChildren.sort((a, b) => b.sales - a.sales);
        parent.childrenCount = actualChildren.length;
    });
    
    return {
        parents,
        totalParents,
        totalChildren
    };
};

/**
 * Get total counts for profitability table (parents and children)
 * Lightweight aggregation that only returns counts, not data
 * 
 * @param {ObjectId} metricsId - The EconomicsMetrics document ID
 * @returns {Promise<Object>} { totalParents, totalChildren, totalAsins }
 */
asinWiseSalesForBigAccountsSchema.statics.getProfitabilityCounts = async function(metricsId) {
    const results = await this.aggregate([
        { $match: { metricsId: metricsId } },
        { $unwind: '$asinSales' },
        // Group by child ASIN to get unique ASINs
        {
            $group: {
                _id: '$asinSales.asin',
                parentAsin: { $first: '$asinSales.parentAsin' }
            }
        },
        // Add effective parent
        {
            $addFields: {
                effectiveParentAsin: { $ifNull: ['$parentAsin', '$_id'] }
            }
        },
        // Group by parent to count
        {
            $group: {
                _id: '$effectiveParentAsin',
                childCount: { $sum: 1 }
            }
        },
        // Facet to get both counts
        {
            $facet: {
                parentCount: [{ $count: 'count' }],
                totalAsins: [
                    { $group: { _id: null, total: { $sum: '$childCount' } } }
                ]
            }
        }
    ]);
    
    const facetResult = results[0] || {};
    const totalParents = facetResult.parentCount?.[0]?.count || 0;
    const totalAsins = facetResult.totalAsins?.[0]?.total || 0;
    // totalChildren = total ASINs minus parents (children that are not parents themselves)
    // Actually for simplicity: totalChildren = totalAsins (all ASINs including parents when counting as children)
    
    return {
        totalParents,
        totalChildren: totalAsins,
        totalAsins
    };
};

/**
 * Get profitability error count and top N errors
 * Calculates low margin / negative profit ASINs via aggregation
 * 
 * @param {ObjectId} metricsId - The EconomicsMetrics document ID
 * @param {number} errorLimit - Max number of error details to return (default 10)
 * @returns {Promise<Object>} { totalErrors, errorDetails }
 */
asinWiseSalesForBigAccountsSchema.statics.getProfitabilityErrors = async function(metricsId, errorLimit = 10) {
    const results = await this.aggregate([
        { $match: { metricsId: metricsId } },
        { $unwind: '$asinSales' },
        // Group by child ASIN to sum metrics
        {
            $group: {
                _id: '$asinSales.asin',
                sales: { $sum: '$asinSales.sales.amount' },
                ads: { $sum: '$asinSales.ppcSpent.amount' },
                totalFees: { $sum: '$asinSales.totalFees.amount' }
            }
        },
        // Calculate net profit and margin
        {
            $addFields: {
                netProfit: { $subtract: [{ $subtract: ['$sales', '$ads'] }, '$totalFees'] },
                profitMargin: {
                    $cond: {
                        if: { $gt: ['$sales', 0] },
                        then: {
                            $multiply: [
                                { $divide: [{ $subtract: [{ $subtract: ['$sales', '$ads'] }, '$totalFees'] }, '$sales'] },
                                100
                            ]
                        },
                        else: 0
                    }
                }
            }
        },
        // Filter to errors only (margin < 10% or negative profit)
        {
            $match: {
                $or: [
                    { profitMargin: { $lt: 10 } },
                    { netProfit: { $lt: 0 } }
                ]
            }
        },
        // Use facet for count and top N
        {
            $facet: {
                totalCount: [{ $count: 'count' }],
                topErrors: [
                    { $sort: { netProfit: 1 } }, // Worst first
                    { $limit: errorLimit },
                    {
                        $project: {
                            _id: 0,
                            asin: '$_id',
                            sales: 1,
                            netProfit: 1,
                            profitMargin: 1,
                            errorType: {
                                $cond: {
                                    if: { $lt: ['$netProfit', 0] },
                                    then: 'negative_profit',
                                    else: 'low_margin'
                                }
                            }
                        }
                    }
                ]
            }
        }
    ]);
    
    const facetResult = results[0] || {};
    return {
        totalErrors: facetResult.totalCount?.[0]?.count || 0,
        errorDetails: facetResult.topErrors || []
    };
};

const AsinWiseSalesForBigAccounts = mongoose.model('AsinWiseSalesForBigAccounts', asinWiseSalesForBigAccountsSchema);

module.exports = AsinWiseSalesForBigAccounts;

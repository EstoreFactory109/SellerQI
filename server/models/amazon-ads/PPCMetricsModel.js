const mongoose = require("mongoose");

// Schema for campaign type breakdown (SP, SB, SD)
const campaignTypeMetricsSchema = new mongoose.Schema({
    sales: {
        type: Number,
        default: 0
    },
    spend: {
        type: Number,
        default: 0
    },
    impressions: {
        type: Number,
        default: 0
    },
    clicks: {
        type: Number,
        default: 0
    },
    acos: {
        type: Number,
        default: 0
    }
}, { _id: false });

// Schema for date-wise metrics
const dateWiseMetricsSchema = new mongoose.Schema({
    date: {
        type: String,
        required: true
    },
    sales: {
        type: Number,
        default: 0
    },
    spend: {
        type: Number,
        default: 0
    },
    impressions: {
        type: Number,
        default: 0
    },
    clicks: {
        type: Number,
        default: 0
    },
    acos: {
        type: Number,
        default: 0
    },
    roas: {
        type: Number,
        default: 0
    },
    ctr: {
        type: Number,
        default: 0
    },
    cpc: {
        type: Number,
        default: 0
    }
}, { _id: false });

// Main PPC Metrics schema
const ppcMetricsSchema = new mongoose.Schema({
    userId: {
        type: String,
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
        enum: ["NA", "EU", "FE"],
        index: true
    },
    profileId: {
        type: String,
        required: false
    },
    dateRange: {
        startDate: {
            type: String,
            required: true
        },
        endDate: {
            type: String,
            required: true
        }
    },
    summary: {
        totalSales: {
            type: Number,
            default: 0
        },
        totalSpend: {
            type: Number,
            default: 0
        },
        totalImpressions: {
            type: Number,
            default: 0
        },
        totalClicks: {
            type: Number,
            default: 0
        },
        overallAcos: {
            type: Number,
            default: 0
        },
        overallRoas: {
            type: Number,
            default: 0
        },
        ctr: {
            type: Number,
            default: 0
        },
        cpc: {
            type: Number,
            default: 0
        }
    },
    campaignTypeBreakdown: {
        sponsoredProducts: {
            type: campaignTypeMetricsSchema,
            default: () => ({})
        },
        sponsoredBrands: {
            type: campaignTypeMetricsSchema,
            default: () => ({})
        },
        sponsoredDisplay: {
            type: campaignTypeMetricsSchema,
            default: () => ({})
        }
    },
    dateWiseMetrics: {
        type: [dateWiseMetricsSchema],
        default: []
    },
    processedCampaignTypes: {
        type: [String],
        default: []
    }
}, { timestamps: true });

// Compound index for efficient queries
ppcMetricsSchema.index({ userId: 1, country: 1, region: 1, 'dateRange.startDate': 1, 'dateRange.endDate': 1 });

// Index for finding latest record for a user/country/region
ppcMetricsSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });

// Static method to find latest metrics for a user
ppcMetricsSchema.statics.findLatestForUser = async function(userId, country, region) {
    return this.findOne({ userId, country, region })
        .sort({ createdAt: -1 })
        .lean();
};

// Static method to find metrics by date range
ppcMetricsSchema.statics.findByDateRange = async function(userId, country, region, startDate, endDate) {
    return this.findOne({
        userId,
        country,
        region,
        'dateRange.startDate': startDate,
        'dateRange.endDate': endDate
    }).lean();
};

// Static method to upsert metrics (update if exists, create if not)
ppcMetricsSchema.statics.upsertMetrics = async function(userId, country, region, startDate, endDate, metricsData) {
    return this.findOneAndUpdate(
        {
            userId,
            country,
            region,
            'dateRange.startDate': startDate,
            'dateRange.endDate': endDate
        },
        {
            $set: {
                userId,
                country,
                region,
                ...metricsData
            }
        },
        {
            upsert: true,
            new: true,
            runValidators: true
        }
    );
};

// Static method to calculate metrics for a custom date range from ALL stored documents
// Searches through historical data, not just the latest document
ppcMetricsSchema.statics.calculateMetricsForDateRange = async function(userId, country, region, startDate, endDate) {
    const userIdStr = userId?.toString() || userId;
    
    // Helper function to normalize date to YYYY-MM-DD format
    const normalizeDate = (dateStr) => {
        if (!dateStr) return null;
        return dateStr.substring(0, 10);
    };
    
    const normalizedStart = normalizeDate(startDate);
    const normalizedEnd = normalizeDate(endDate);
    
    console.log('[PPCMetrics.calculateMetricsForDateRange] userId:', userIdStr, 'country:', country, 'region:', region);
    console.log('[PPCMetrics.calculateMetricsForDateRange] Searching ALL documents for date range:', normalizedStart, 'to', normalizedEnd);
    
    // Find ALL documents for this user/country/region
    // Sort by createdAt DESC so newer documents are processed first (for deduplication preference)
    const allRecords = await this.find({ userId: userIdStr, country, region })
        .sort({ createdAt: -1 })
        .lean();
    
    console.log('[PPCMetrics.calculateMetricsForDateRange] Total documents found:', allRecords.length);
    
    if (!allRecords || allRecords.length === 0) {
        console.log('[PPCMetrics.calculateMetricsForDateRange] No documents found');
        return null;
    }
    
    // Use a Map to deduplicate dates - prefer data from newer documents
    const dateDataMap = new Map();
    let documentsWithData = 0;
    
    for (const record of allRecords) {
        if (!record.dateWiseMetrics || record.dateWiseMetrics.length === 0) {
            continue;
        }
        
        // Check if this document's date range overlaps with requested range
        const docStart = normalizeDate(record.dateRange?.startDate);
        const docEnd = normalizeDate(record.dateRange?.endDate);
        
        // Skip if no overlap
        if (docEnd < normalizedStart || docStart > normalizedEnd) {
            continue;
        }
        
        documentsWithData++;
        
        // Extract date-wise data that falls within requested range
        for (const dayData of record.dateWiseMetrics) {
            const itemDate = normalizeDate(dayData.date);
            
            if (itemDate && itemDate >= normalizedStart && itemDate <= normalizedEnd) {
                // Only add if we haven't seen this date yet (prefer newer document's data)
                if (!dateDataMap.has(itemDate)) {
                    dateDataMap.set(itemDate, {
                        date: itemDate,
                        sales: dayData.sales || 0,
                        spend: dayData.spend || 0,
                        impressions: dayData.impressions || 0,
                        clicks: dayData.clicks || 0,
                        acos: dayData.acos || 0,
                        roas: dayData.roas || 0,
                        ctr: dayData.ctr || 0,
                        cpc: dayData.cpc || 0
                    });
                }
            }
        }
    }
    
    console.log('[PPCMetrics.calculateMetricsForDateRange] Documents with overlapping data:', documentsWithData);
    console.log('[PPCMetrics.calculateMetricsForDateRange] Unique dates found:', dateDataMap.size);
    
    if (dateDataMap.size === 0) {
        return {
            found: false,
            dateRange: { startDate, endDate },
            summary: {
                totalSales: 0,
                totalSpend: 0,
                totalImpressions: 0,
                totalClicks: 0,
                overallAcos: 0,
                overallRoas: 0,
                ctr: 0,
                cpc: 0
            },
            dateWiseMetrics: [],
            message: 'No data available for the selected date range',
            dataAvailability: {
                requestedRange: { startDate: normalizedStart, endDate: normalizedEnd },
                documentsSearched: allRecords.length,
                documentsWithData: documentsWithData
            }
        };
    }
    
    // Convert Map to array and sort by date
    const filteredMetrics = Array.from(dateDataMap.values())
        .sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate summary totals
    const totals = filteredMetrics.reduce((acc, day) => {
        acc.sales += day.sales || 0;
        acc.spend += day.spend || 0;
        acc.impressions += day.impressions || 0;
        acc.clicks += day.clicks || 0;
        return acc;
    }, {
        sales: 0,
        spend: 0,
        impressions: 0,
        clicks: 0
    });
    
    // Calculate derived metrics
    const overallAcos = totals.sales > 0 ? (totals.spend / totals.sales) * 100 : 0;
    const overallRoas = totals.spend > 0 ? totals.sales / totals.spend : 0;
    const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    
    return {
        found: true,
        isFiltered: true,
        dateRange: { startDate, endDate },
        summary: {
            totalSales: parseFloat(totals.sales.toFixed(2)),
            totalSpend: parseFloat(totals.spend.toFixed(2)),
            totalImpressions: totals.impressions,
            totalClicks: totals.clicks,
            overallAcos: parseFloat(overallAcos.toFixed(2)),
            overallRoas: parseFloat(overallRoas.toFixed(2)),
            ctr: parseFloat(ctr.toFixed(2)),
            cpc: parseFloat(cpc.toFixed(2))
        },
        dateWiseMetrics: filteredMetrics,
        numberOfDays: filteredMetrics.length,
        dataAvailability: {
            requestedRange: { startDate: normalizedStart, endDate: normalizedEnd },
            documentsSearched: allRecords.length,
            documentsWithData: documentsWithData
        }
    };
};

const PPCMetrics = mongoose.model("PPCMetrics", ppcMetricsSchema);

module.exports = PPCMetrics;


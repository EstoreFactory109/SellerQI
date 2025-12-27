const mongoose = require("mongoose");

// Schema for date-wise units sold data (simplified to only units1d)
const dateWiseUnitsSchema = new mongoose.Schema({
    date: {
        type: String,
        required: true
    },
    units: {
        type: Number,
        default: 0
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
    }
}, { _id: false });

// Main PPC Units Sold schema (simplified)
const ppcUnitsSoldSchema = new mongoose.Schema({
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
    // Total units (1-day attribution only)
    totalUnits: {
        type: Number,
        default: 0
    },
    // Summary statistics
    summary: {
        totalUnits: {
            type: Number,
            default: 0
        },
        averageDailyUnits: {
            type: Number,
            default: 0
        },
        totalSales: {
            type: Number,
            default: 0
        },
        totalSpend: {
            type: Number,
            default: 0
        }
    },
    // Date-wise units data array
    dateWiseUnits: {
        type: [dateWiseUnitsSchema],
        default: []
    },
    processedCampaignTypes: {
        type: [String],
        default: []
    }
}, { timestamps: true });

// Compound index for efficient queries
ppcUnitsSoldSchema.index({ userId: 1, country: 1, region: 1, 'dateRange.startDate': 1, 'dateRange.endDate': 1 });

// Index for finding latest record for a user/country/region
ppcUnitsSoldSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });

// Static method to find latest units sold data for a user
ppcUnitsSoldSchema.statics.findLatestForUser = async function(userId, country, region) {
    const userIdStr = userId?.toString() || userId;
    console.log(`[PPCUnitsSold.findLatestForUser] Querying with userId: ${userIdStr}, country: ${country}, region: ${region}`);
    
    const result = await this.findOne({ userId: userIdStr, country, region })
        .sort({ createdAt: -1 })
        .lean();
    
    console.log(`[PPCUnitsSold.findLatestForUser] Found: ${!!result}`);
    return result;
};

// Static method to find units sold by date range
ppcUnitsSoldSchema.statics.findByDateRange = async function(userId, country, region, startDate, endDate) {
    return this.findOne({
        userId,
        country,
        region,
        'dateRange.startDate': startDate,
        'dateRange.endDate': endDate
    }).lean();
};

// Static method to upsert units sold data (update if exists, create if not)
ppcUnitsSoldSchema.statics.upsertUnitsSold = async function(userId, country, region, startDate, endDate, unitsData) {
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
                ...unitsData
            }
        },
        {
            upsert: true,
            new: true,
            runValidators: true
        }
    );
};

// Static method to calculate units sold for a custom date range from ALL stored documents
// Searches through historical data, not just the latest document
ppcUnitsSoldSchema.statics.calculateUnitsForDateRange = async function(userId, country, region, startDate, endDate) {
    const userIdStr = userId?.toString() || userId;
    
    // Helper function to normalize date to YYYY-MM-DD format
    const normalizeDate = (dateStr) => {
        if (!dateStr) return null;
        return dateStr.substring(0, 10);
    };
    
    const normalizedStart = normalizeDate(startDate);
    const normalizedEnd = normalizeDate(endDate);
    
    console.log('[PPCUnitsSold.calculateUnitsForDateRange] userId:', userIdStr, 'country:', country, 'region:', region);
    console.log('[PPCUnitsSold.calculateUnitsForDateRange] Searching ALL documents for date range:', normalizedStart, 'to', normalizedEnd);
    
    // Find ALL documents for this user/country/region that might contain data for the requested range
    // Sort by createdAt DESC so newer documents are processed first (for deduplication preference)
    const allRecords = await this.find({ userId: userIdStr, country, region })
        .sort({ createdAt: -1 })
        .lean();
    
    console.log('[PPCUnitsSold.calculateUnitsForDateRange] Total documents found:', allRecords.length);
    
    if (!allRecords || allRecords.length === 0) {
        console.log('[PPCUnitsSold.calculateUnitsForDateRange] No documents found');
        return null;
    }
    
    // Use a Map to deduplicate dates - prefer data from newer documents
    const dateDataMap = new Map();
    let documentsWithData = 0;
    
    for (const record of allRecords) {
        if (!record.dateWiseUnits || record.dateWiseUnits.length === 0) {
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
        for (const dayData of record.dateWiseUnits) {
            const itemDate = normalizeDate(dayData.date);
            
            if (itemDate && itemDate >= normalizedStart && itemDate <= normalizedEnd) {
                // Only add if we haven't seen this date yet (prefer newer document's data)
                if (!dateDataMap.has(itemDate)) {
                    dateDataMap.set(itemDate, {
                        date: itemDate,
                        units: dayData.units || 0,
                        sales: dayData.sales || 0,
                        spend: dayData.spend || 0,
                        impressions: dayData.impressions || 0,
                        clicks: dayData.clicks || 0
                    });
                }
            }
        }
    }
    
    console.log('[PPCUnitsSold.calculateUnitsForDateRange] Documents with overlapping data:', documentsWithData);
    console.log('[PPCUnitsSold.calculateUnitsForDateRange] Unique dates found:', dateDataMap.size);
    
    if (dateDataMap.size === 0) {
        return {
            dateRange: { startDate, endDate },
            totalUnits: 0,
            dateWiseUnits: [],
            message: 'No data available for the selected date range',
            dataAvailability: {
                requestedRange: { startDate: normalizedStart, endDate: normalizedEnd },
                documentsSearched: allRecords.length,
                documentsWithData: documentsWithData
            }
        };
    }
    
    // Convert Map to array and sort by date
    const filteredDates = Array.from(dateDataMap.values())
        .sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate totals
    const totals = filteredDates.reduce((acc, day) => {
        acc.units += day.units || 0;
        acc.sales += day.sales || 0;
        acc.spend += day.spend || 0;
        acc.impressions += day.impressions || 0;
        acc.clicks += day.clicks || 0;
        return acc;
    }, {
        units: 0,
        sales: 0,
        spend: 0,
        impressions: 0,
        clicks: 0
    });
    
    const numDays = filteredDates.length;
    
    return {
        dateRange: { startDate, endDate },
        totalUnits: totals.units,
        summary: {
            totalUnits: totals.units,
            averageDailyUnits: numDays > 0 
                ? parseFloat((totals.units / numDays).toFixed(2))
                : 0,
            totalSales: parseFloat(totals.sales.toFixed(2)),
            totalSpend: parseFloat(totals.spend.toFixed(2))
        },
        dateWiseUnits: filteredDates,
        numberOfDays: numDays,
        dataAvailability: {
            requestedRange: { startDate: normalizedStart, endDate: normalizedEnd },
            documentsSearched: allRecords.length,
            documentsWithData: documentsWithData
        }
    };
};

const PPCUnitsSold = mongoose.model("PPCUnitsSold", ppcUnitsSoldSchema);

module.exports = PPCUnitsSold;

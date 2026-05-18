const mongoose = require("mongoose");

// Schema for campaign type breakdown (SP, SB, SD) — aligns with GetPPCMetrics CAMPAIGN_TYPES (sales1d vs sales, purchases1d vs purchases)
const campaignTypeMetricsSchema = new mongoose.Schema({
    sales: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    acos: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
    unitsSoldClicks1d: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 }
}, { _id: false });

const campaignSummaryRowSchema = new mongoose.Schema({
    campaignId: { type: mongoose.Schema.Types.Mixed, required: true },
    campaignName: { type: String, default: "" },
    campaignStatus: { type: String, default: "" },
    sales: { type: Number, default: 0 },
    spend: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    unitsSoldClicks1d: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 }
}, { _id: false });

/**
 * One document = one calendar day of PPC metrics for user/country/region.
 * metricDate: YYYY-MM-DD
 */
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
    /** Single day this row represents */
    metricDate: {
        type: String,
        required: true,
        index: true
    },
    profileId: {
        type: String,
        required: false
    },
    /** Redundant copy for compatibility (startDate === endDate === metricDate) */
    dateRange: {
        startDate: { type: String, required: true },
        endDate: { type: String, required: true }
    },
    summary: {
        totalSales: { type: Number, default: 0 },
        totalSpend: { type: Number, default: 0 },
        totalImpressions: { type: Number, default: 0 },
        totalClicks: { type: Number, default: 0 },
        overallAcos: { type: Number, default: 0 },
        overallRoas: { type: Number, default: 0 },
        ctr: { type: Number, default: 0 },
        cpc: { type: Number, default: 0 },
        totalUnitsSoldClicks1d: { type: Number, default: 0 },
        /** Order count from report (purchases1d for SP, purchases for SB/SD) */
        totalPurchases: { type: Number, default: 0 }
    },
    campaignTypeBreakdown: {
        sponsoredProducts: { type: campaignTypeMetricsSchema, default: () => ({}) },
        sponsoredBrands: { type: campaignTypeMetricsSchema, default: () => ({}) },
        sponsoredDisplay: { type: campaignTypeMetricsSchema, default: () => ({}) }
    },
    /** Deprecated on per-day docs (empty). Kept for legacy reads / compatibility */
    dateWiseMetrics: {
        type: [mongoose.Schema.Types.Mixed],
        default: []
    },
    processedCampaignTypes: {
        type: [String],
        default: []
    },
    campaignSummaries: {
        sponsoredProducts: { type: [campaignSummaryRowSchema], default: [] },
        sponsoredBrands: { type: [campaignSummaryRowSchema], default: [] },
        sponsoredDisplay: { type: [campaignSummaryRowSchema], default: [] }
    }
}, { timestamps: true });

ppcMetricsSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1 },
    {
        unique: true,
        partialFilterExpression: { metricDate: { $exists: true, $type: "string" } }
    }
);

ppcMetricsSchema.index({ userId: 1, country: 1, region: 1, metricDate: -1 });

/** Most recent calendar day with stored PPC data */
ppcMetricsSchema.statics.findLatestForUser = async function(userId, country, region) {
    const userIdStr = userId?.toString() || userId;
    return this.findOne({ userId: userIdStr, country, region })
        .sort({ metricDate: -1 })
        .lean();
};

/** Exact single-day document */
ppcMetricsSchema.statics.findByMetricDate = async function(userId, country, region, metricDate) {
    const userIdStr = userId?.toString() || userId;
    return this.findOne({ userId: userIdStr, country, region, metricDate }).lean();
};

/** @deprecated Multi-day docs removed — use findByMetricDate */
ppcMetricsSchema.statics.findByDateRange = async function(userId, country, region, startDate, endDate) {
    const userIdStr = userId?.toString() || userId;
    if (startDate === endDate) {
        return this.findOne({ userId: userIdStr, country, region, metricDate: startDate }).lean();
    }
    return this.find({
        userId: userIdStr,
        country,
        region,
        metricDate: { $gte: startDate, $lte: endDate }
    })
        .sort({ metricDate: 1 })
        .lean();
};

/**
 * Upsert one calendar day of metrics (primary storage path).
 */
ppcMetricsSchema.statics.upsertMetricsForDate = async function(userId, country, region, metricDate, metricsData) {
    const userIdStr = userId?.toString() || userId;
    return this.findOneAndUpdate(
        { userId: userIdStr, country, region, metricDate },
        {
            $set: {
                userId: userIdStr,
                country,
                region,
                metricDate,
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

ppcMetricsSchema.statics.calculateMetricsForDateRange = async function(userId, country, region, startDate, endDate) {
    const userIdStr = userId?.toString() || userId;

    const normalizeDate = (dateStr) => {
        if (!dateStr) return null;
        return dateStr.substring(0, 10);
    };

    const normalizedStart = normalizeDate(startDate);
    const normalizedEnd = normalizeDate(endDate);

    console.log("[PPCMetrics.calculateMetricsForDateRange] userId:", userIdStr, "country:", country, "region:", region);
    console.log("[PPCMetrics.calculateMetricsForDateRange] Range:", normalizedStart, "to", normalizedEnd);

    const dailyDocs = await this.find({
        userId: userIdStr,
        country,
        region,
        metricDate: { $gte: normalizedStart, $lte: normalizedEnd }
    })
        .sort({ metricDate: 1 })
        .lean();

    if (dailyDocs.length > 0) {
        const dateWiseMetrics = dailyDocs.map((doc) => {
            const s = doc.summary || {};
            const sales = s.totalSales || 0;
            const spend = s.totalSpend || 0;
            const impressions = s.totalImpressions || 0;
            const clicks = s.totalClicks || 0;
            let acos = s.overallAcos || 0;
            let roas = s.overallRoas || 0;
            let ctr = s.ctr || 0;
            let cpc = s.cpc || 0;
            if (sales > 0 && spend >= 0) {
                acos = parseFloat(((spend / sales) * 100).toFixed(2));
                roas = parseFloat((sales / spend).toFixed(2));
            }
            if (impressions > 0) {
                ctr = parseFloat(((clicks / impressions) * 100).toFixed(2));
            }
            if (clicks > 0) {
                cpc = parseFloat((spend / clicks).toFixed(2));
            }
            return {
                date: doc.metricDate,
                sales,
                spend,
                impressions,
                clicks,
                unitsSoldClicks1d: s.totalUnitsSoldClicks1d || 0,
                purchases: s.totalPurchases || 0,
                acos,
                roas,
                ctr,
                cpc
            };
        });

        const totals = dateWiseMetrics.reduce(
            (acc, day) => {
                acc.sales += day.sales || 0;
                acc.spend += day.spend || 0;
                acc.impressions += day.impressions || 0;
                acc.clicks += day.clicks || 0;
                acc.unitsSoldClicks1d += day.unitsSoldClicks1d || 0;
                acc.purchases += day.purchases || 0;
                return acc;
            },
            { sales: 0, spend: 0, impressions: 0, clicks: 0, unitsSoldClicks1d: 0, purchases: 0 }
        );

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
                totalUnitsSoldClicks1d: Math.round(totals.unitsSoldClicks1d || 0),
                totalPurchases: Math.round(totals.purchases || 0),
                overallAcos: parseFloat(overallAcos.toFixed(2)),
                overallRoas: parseFloat(overallRoas.toFixed(2)),
                ctr: parseFloat(ctr.toFixed(2)),
                cpc: parseFloat(cpc.toFixed(2))
            },
            dateWiseMetrics,
            numberOfDays: dateWiseMetrics.length,
            dataAvailability: {
                requestedRange: { startDate: normalizedStart, endDate: normalizedEnd },
                documentsInRange: dailyDocs.length,
                source: "perDayDocuments"
            }
        };
    }

    // Legacy: older documents stored one row per sync with dateWiseMetrics[] spanning many days
    const allRecords = await this.find({ userId: userIdStr, country, region })
        .sort({ createdAt: -1 })
        .lean();

    console.log("[PPCMetrics.calculateMetricsForDateRange] Legacy path, documents:", allRecords.length);

    if (!allRecords || allRecords.length === 0) {
        return null;
    }

    const dateDataMap = new Map();
    let documentsWithData = 0;

    for (const record of allRecords) {
        if (!record.dateWiseMetrics || record.dateWiseMetrics.length === 0) {
            continue;
        }

        const docStart = normalizeDate(record.dateRange?.startDate);
        const docEnd = normalizeDate(record.dateRange?.endDate);

        if (!docStart || !docEnd || docEnd < normalizedStart || docStart > normalizedEnd) {
            continue;
        }

        documentsWithData++;

        for (const dayData of record.dateWiseMetrics) {
            const itemDate = normalizeDate(dayData.date);

            if (itemDate && itemDate >= normalizedStart && itemDate <= normalizedEnd) {
                if (!dateDataMap.has(itemDate)) {
                    dateDataMap.set(itemDate, {
                        date: itemDate,
                        sales: dayData.sales || 0,
                        spend: dayData.spend || 0,
                        impressions: dayData.impressions || 0,
                        clicks: dayData.clicks || 0,
                        unitsSoldClicks1d: dayData.unitsSoldClicks1d || 0,
                        purchases: dayData.purchases || 0,
                        acos: dayData.acos || 0,
                        roas: dayData.roas || 0,
                        ctr: dayData.ctr || 0,
                        cpc: dayData.cpc || 0
                    });
                }
            }
        }
    }

    if (dateDataMap.size === 0) {
        return {
            found: false,
            dateRange: { startDate, endDate },
            summary: {
                totalSales: 0,
                totalSpend: 0,
                totalImpressions: 0,
                totalClicks: 0,
                totalUnitsSoldClicks1d: 0,
                totalPurchases: 0,
                overallAcos: 0,
                overallRoas: 0,
                ctr: 0,
                cpc: 0
            },
            dateWiseMetrics: [],
            message: "No data available for the selected date range",
            dataAvailability: {
                requestedRange: { startDate: normalizedStart, endDate: normalizedEnd },
                documentsSearched: allRecords.length,
                documentsWithData: documentsWithData
            }
        };
    }

    const filteredMetrics = Array.from(dateDataMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
    );

    const totals = filteredMetrics.reduce(
        (acc, day) => {
            acc.sales += day.sales || 0;
            acc.spend += day.spend || 0;
            acc.impressions += day.impressions || 0;
            acc.clicks += day.clicks || 0;
            acc.unitsSoldClicks1d += day.unitsSoldClicks1d || 0;
            acc.purchases += day.purchases || 0;
            return acc;
        },
        { sales: 0, spend: 0, impressions: 0, clicks: 0, unitsSoldClicks1d: 0, purchases: 0 }
    );

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
            totalUnitsSoldClicks1d: Math.round(totals.unitsSoldClicks1d || 0),
            totalPurchases: Math.round(totals.purchases || 0),
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
            documentsWithData: documentsWithData,
            source: "legacyDateWiseMetrics"
        }
    };
};

/**
 * Roll up per-day documents for the last N calendar days (inclusive of ~31 days when days=30).
 * Matches default GetPPCMetrics sync window (yesterday back through yesterday−30).
 */
ppcMetricsSchema.statics.rollupLastDays = async function(userId, country, region, days = 30) {
    const userIdStr = userId?.toString() || userId;
    const now = new Date();
    const fmt = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const endDate = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    const startDate = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1 - days));
    return this.calculateMetricsForDateRange(userIdStr, country, region, startDate, endDate);
};

const PPCMetrics = mongoose.model("PPCMetrics", ppcMetricsSchema);

module.exports = PPCMetrics;

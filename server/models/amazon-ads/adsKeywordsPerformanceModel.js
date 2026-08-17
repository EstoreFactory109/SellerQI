const mongoose = require('mongoose');
const { toYyyyMmDd, shiftMetricDateKey } = require('../../utils/metricDateKey.js');

const adsKeywordsPerformanceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    region: {
        type: String,
        required: true
    },
    country: {
        type: String,
        required: true
    },
    /** YYYY-MM-DD when this document holds one day of keyword rows (per-day storage). */
    metricDate: {
        type: String,
        required: false,
        index: true
    },
    keywordsData: [{
        date: {
            type: String,
            required: false,
            default: null
        },
        keywordId: {
            type: Number,
            required: true
        },
        attributedSales30d: {
            type: Number,
            required: true
        },
        cost: {
            type: Number,
            required: true
        },
        adGroupName: {
            type: String,
            required: true
        },
        matchType: {
            type: String,
            required: true
        },
        campaignId: {
            type: Number,
            required: true
        },
        clicks: {
            type: Number,
            required: true
        },
        impressions: {
            type: Number,
            required: true
        },
        keyword: {
            type: String,
            required: true
        },
        campaignName: {
            type: String,
            required: true
        },
        adGroupId: {
            type: Number,
            required: true
        },
        adKeywordStatus: {
            type: String,
            required: false
        }
    }]
}, { timestamps: true });

adsKeywordsPerformanceSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
adsKeywordsPerformanceSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1 },
    {
        unique: true,
        partialFilterExpression: { metricDate: { $exists: true, $type: 'string' } }
    }
);

function toUserObjectId(userId) {
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    const s = userId?.toString?.() || userId;
    if (mongoose.Types.ObjectId.isValid(s)) return new mongoose.Types.ObjectId(s);
    return userId;
}

/**
 * Merge per-day documents for optional [startDate, endDate] (YYYY-MM-DD strings).
 * Falls back to legacy single document (no metricDate) when no per-day docs exist.
 *
 * WINDOWING — why `options.lookbackDays` exists
 * This collection holds ONE document per account per day, forever, with no TTL. Callers that
 * passed `{}` therefore loaded every day ever recorded, then `flatMap`ed a second full copy
 * while the first was still live. Measured in production: 78.8 MB of BSON for a single account
 * (62 docs, largest 1.40 MB) inside a ~30-query Promise.all, on heaps of 1536 MB (worker) and
 * 768 MB (api). Cost grew with account age with no upper bound.
 *
 * `lookbackDays` bounds that. It is anchored to the account's LATEST metricDate rather than to
 * today, deliberately: the ingestion pipeline routinely lags by days, so a today-anchored window
 * would return zero rows for a lagging account and silently blank its dashboard — trading a
 * memory bug for a correctness bug.
 *
 * Precedence: explicit startDate+endDate > lookbackDays > unbounded (legacy behaviour, kept so
 * existing callers are unaffected).
 */
adsKeywordsPerformanceSchema.statics.findMergedKeywordsData = async function(userId, country, region, options = {}) {
    const userIdObj = toUserObjectId(userId);
    const { startDate, endDate, lookbackDays } = options;
    const startStr = toYyyyMmDd(startDate);
    const endStr = toYyyyMmDd(endDate);

    const dailyQuery = {
        userId: userIdObj,
        country,
        region,
        metricDate: { $exists: true, $type: 'string', $ne: null }
    };
    if (startStr && endStr) {
        dailyQuery.metricDate = { $gte: startStr, $lte: endStr };
    } else if (Number.isFinite(lookbackDays) && lookbackDays > 0) {
        // Anchor on the newest day this account actually has. Uses the same
        // {userId, country, region, metricDate} index as the range query below.
        const newest = await this.findOne(dailyQuery)
            .sort({ metricDate: -1 })
            .select('metricDate')
            .lean();
        const anchor = toYyyyMmDd(newest?.metricDate);
        // No anchor => no per-day rows at all; leave the query unbounded so the legacy
        // fallback below is still reached instead of returning an empty window.
        if (anchor) {
            const windowStart = shiftMetricDateKey(anchor, -(lookbackDays - 1));
            if (windowStart) {
                dailyQuery.metricDate = { $gte: windowStart, $lte: anchor };
            }
        }
    }

    const dailyDocs = await this.find(dailyQuery).sort({ metricDate: 1 }).lean();
    if (dailyDocs.length > 0) {
        return dailyDocs.flatMap((d) => d.keywordsData || []);
    }

    const legacy = await this.findOne({
        userId: userIdObj,
        country,
        region,
        $or: [{ metricDate: { $exists: false } }, { metricDate: null }]
    })
        .sort({ createdAt: -1 })
        .lean();

    return legacy?.keywordsData || [];
};

/**
 * Upsert one calendar day of keyword performance (replaces that day — no duplicate days).
 */
adsKeywordsPerformanceSchema.statics.upsertKeywordsForDate = async function(userId, country, region, metricDate, keywordsData) {
    const userIdObj = toUserObjectId(userId);
    return this.findOneAndUpdate(
        { userId: userIdObj, country, region, metricDate },
        {
            $set: {
                userId: userIdObj,
                country,
                region,
                metricDate,
                keywordsData: keywordsData || []
            }
        },
        { upsert: true, new: true, runValidators: true }
    );
};

const adsKeywordsPerformanceModel = mongoose.model('adsKeywordsPerformance', adsKeywordsPerformanceSchema);

module.exports = adsKeywordsPerformanceModel;

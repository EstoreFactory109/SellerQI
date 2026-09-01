const mongoose = require("mongoose");
const { toYyyyMmDd, shiftMetricDateKey } = require('../../utils/metricDateKey.js');

/**
 * Date-wise PPC spend — ONE DOCUMENT PER DAY per (account, country, region).
 *
 * WHY THIS IS PER-DAY. This used to be one document per RUN holding the whole 31-day
 * report in `dateWisePPCSpends[]`, written with `.create()` — no upsert, no dedup, no
 * retention. For the largest account that reached 66,451 rows / 13.16MB, and once it
 * crossed the driver's serialization buffer every write failed outright:
 *
 *     RangeError [ERR_OUT_OF_RANGE]: The value of "offset" is out of range.
 *     It must be >= 0 && <= 17825792. Received 17825795
 *
 * 17825792 is bson's internal serialization buffer (17MB). Raising it is NOT a fix — the
 * cluster's `maxBsonObjectSize` is 16MB, so the write would just be rejected server-side
 * instead. The document has to get smaller.
 *
 * The report is `timeUnit: "DAILY"` and every row carries its own `date`, so splitting by
 * day is the natural fix: ~1,600 rows/day ≈ 320KB per document instead of one 13MB blob.
 * Identical shape to adsKeywordsPerformanceModel / SearchTermsModel — see
 * findMergedKeywordsData there for the full rationale behind `lookbackDays`.
 *
 * IT ALSO FIXES A SELLER-VISIBLE BUG. `sched_ads_catchup` fetches a SINGLE day
 * (`dateOpts = { startDate: catchupDate, endDate: catchupDate }`). Under the old
 * one-doc-per-run scheme that produced a one-day document which then won every
 * `findOne().sort({ createdAt: -1 })` read, collapsing the whole PPC chart to that one day
 * until the next full run. Measured 2026-08-21: 22 of 163 accounts were in that state.
 * Per-day upserts remove the class of bug — a catch-up day now merges into the window
 * instead of replacing it.
 */
const getDateWiseSpendsKeywordsSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
    country: {
        type: String,
        required: true,
    },
    region: {
        type: String,
        required: true,
    },
    /** YYYY-MM-DD when this document holds one day of spend rows (per-day storage). */
    metricDate: {
        type: String,
        required: false,
        index: true,
    },
    dateWisePPCSpends:[{
        date: {
            type: Date,
            required: true,
        },
        cost: {
            type: Number,
            required: true,
        },
        campaignId:{
            type: String,
            required: true,
        },
        campaignName:{
            type: String,
            required: true,
        },
        clicks:{
            type: Number,
            required: true,
        },
        impressions:{
            type: Number,
            required: true,
        },
        sales7d:{
            type: String,
            required:true
        },
        sales14d:{
            type: String,
            default: "0"
        },
    }]
},{timestamps:true});

// Compound index for efficient queries. KEPT: legacy documents (no metricDate) are still
// read through the fallback in findMergedDateWiseSpends, which sorts on createdAt.
getDateWiseSpendsKeywordsSchema.index({ userId: 1, country: 1, region: 1, createdAt: -1 });
// One document per (account, day). The partial filter is what lets legacy documents coexist:
// without it every legacy doc has metricDate: null and they would all collide on this unique key.
getDateWiseSpendsKeywordsSchema.index(
    { userId: 1, country: 1, region: 1, metricDate: 1 },
    {
        unique: true,
        partialFilterExpression: { metricDate: { $exists: true, $type: 'string' } }
    }
);

/**
 * Merge the per-day documents into one flat row array, with a legacy fallback.
 *
 * Precedence: explicit startDate+endDate > lookbackDays > unbounded (legacy behaviour).
 * Mirrors SearchTermsModel.findMergedSearchTermData exactly; see the rationale in
 * adsKeywordsPerformanceModel.findMergedKeywordsData.
 */
getDateWiseSpendsKeywordsSchema.statics.findMergedDateWiseSpends = async function(userId, country, region, options = {}) {
    const userIdStr = userId?.toString?.() || String(userId);
    const { startDate, endDate, lookbackDays } = options || {};
    const startStr = toYyyyMmDd(startDate);
    const endStr = toYyyyMmDd(endDate);

    const dailyQuery = {
        userId: userIdStr,
        country,
        region,
        metricDate: { $exists: true, $type: 'string', $ne: null }
    };
    if (startStr && endStr) {
        dailyQuery.metricDate = { $gte: startStr, $lte: endStr };
    } else if (Number.isFinite(lookbackDays) && lookbackDays > 0) {
        // Anchored to the newest day this account HAS, not to today — the pipeline lags, and a
        // today-anchored window would blank the dashboard for any account a few days behind.
        const newest = await this.findOne(dailyQuery)
            .sort({ metricDate: -1 })
            .select('metricDate')
            .lean();
        const anchor = toYyyyMmDd(newest?.metricDate);
        // No anchor => no per-day rows; stay unbounded so the legacy fallback below is reached.
        if (anchor) {
            const windowStart = shiftMetricDateKey(anchor, -(lookbackDays - 1));
            if (windowStart) {
                dailyQuery.metricDate = { $gte: windowStart, $lte: anchor };
            }
        }
    }

    const dailyDocs = await this.find(dailyQuery).sort({ metricDate: 1 }).lean();
    if (dailyDocs.length > 0) {
        return dailyDocs.flatMap((d) => d.dateWisePPCSpends || []);
    }

    const legacy = await this.findOne({
        userId: userIdStr,
        country,
        region,
        $or: [{ metricDate: { $exists: false } }, { metricDate: null }]
    })
        .sort({ createdAt: -1 })
        .lean();

    return legacy?.dateWisePPCSpends || [];
};

/**
 * Upsert exactly one calendar day of spend rows (replaces that day — no duplicate days).
 *
 * `runValidators: true` is safe here only because the caller normalizes rows first
 * (mapDateWiseSpendRow in GetDateWiseSpendKeywords.js): every row field except `sales14d`
 * is `required`, and the raw Amazon payload is not coerced anywhere else.
 */
getDateWiseSpendsKeywordsSchema.statics.upsertDateWiseSpendsForDate = async function(userId, country, region, metricDate, rows) {
    const userIdStr = userId?.toString?.() || String(userId);
    return this.findOneAndUpdate(
        { userId: userIdStr, country, region, metricDate },
        {
            $set: {
                userId: userIdStr,
                country,
                region,
                metricDate,
                dateWisePPCSpends: rows || []
            }
        },
        { upsert: true, new: true, runValidators: true }
    );
};

const GetDateWiseSpendsKeywords = mongoose.model("GetDateWiseSpendsKeywords", getDateWiseSpendsKeywordsSchema);
module.exports = GetDateWiseSpendsKeywords;
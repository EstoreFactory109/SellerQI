/**
 * AsinFinanceWindowService
 *
 * Per-ASIN sales, units and Amazon fees for a date window, read from
 * DailySkuFinance — the live per-SKU finance collection.
 *
 * WHY THIS EXISTS
 * ---------------
 * Profitability and the per-ASIN Sales column were both reading sources that
 * stopped being written:
 *
 *   EconomicsMetrics   newest document 2026-04-06
 *   ProductWiseSales   newest document 2025-12-04
 *
 * With no rows to read, profitability saw `sales: 0` for every product and told
 * sellers a product was "losing money on every sale — Revenue: $0.00" while the
 * same ASIN had real sales. DailySkuFinance is the collection the Profitability
 * page itself already reads (see Services/Finance/FinanceDashboardReadService.js)
 * and is written daily, so it is the source of truth going forward.
 *
 * SHAPE
 * -----
 * Returns the same `{ asin: { sales, unitsSold, totalFees, … } }` map that
 * EconomicsMetrics used to produce, so ProfitabilityCalculation's existing
 * `economicsAsinData` branch consumes it unchanged — this is a source swap, not
 * new arithmetic.
 *
 * SIGN CONVENTION
 * ---------------
 * DailySkuFinance stores revenue positive and fees/expenses NEGATIVE
 * (`totalExpenses: -11.75` for a row whose fees were 7.46 + 4.29). Callers
 * subtract `totalFees` (`grossProfit = sales - adsSpend - totalFees`), so fees
 * are returned here as POSITIVE magnitudes.
 *
 * Tax is deliberately excluded: `totalTax` is pass-through to the government and
 * sits outside `totalExpenses`, and `productSales` is already net of it.
 *
 * Ads spend is NOT read here. It comes from the Amazon Ads API, which remains
 * the primary source for PPC (see ProfitabilityCalculation).
 */

const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');
const DailySkuFinance = require('../../models/finance/DailySkuFinanceModel.js');
const { isEconomicsFresh, ECONOMICS_MAX_AGE_DAYS, toTime } = require('../Calculations/RecoverableAmountUtils.js');

/** Default window: the 30 days ending yesterday (UTC), matching the report-style defaults elsewhere. */
const DEFAULT_WINDOW_DAYS = 30;

/** DailySkuFinance stores `date` as a 'YYYY-MM-DD' STRING — comparing it to a BSON Date matches nothing. */
function toYyyyMmDd(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().split('T')[0];
    }
    return null;
}

function defaultWindow() {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - DEFAULT_WINDOW_DAYS));
    return { startStr: start.toISOString().split('T')[0], endStr: end.toISOString().split('T')[0] };
}

/**
 * Resolve the window, tolerating Dates, 'YYYY-MM-DD' strings, missing values and
 * a reversed pair.
 */
function resolveWindow(startDate, endDate) {
    const s = toYyyyMmDd(startDate);
    const e = toYyyyMmDd(endDate);
    if (s && e) return s <= e ? { startStr: s, endStr: e } : { startStr: e, endStr: s };
    return defaultWindow();
}

/**
 * Per-ASIN finance for a window, aggregated entirely inside MongoDB.
 *
 * One $match + one $group, served by the
 * { User, country, region, asin, date } index — no per-day rows are pulled into
 * Node, which matters because a 30-day window on a large account is tens of
 * thousands of documents.
 *
 * @param {string|ObjectId} userId
 * @param {string} country
 * @param {string} region
 * @param {string|Date} [startDate] - inclusive; defaults to 30 days before yesterday
 * @param {string|Date} [endDate]   - inclusive; defaults to yesterday
 * @returns {Promise<Object>} { [asin]: { sales, unitsSold, totalFees, amazonFees, fbaFees, storageFees, source } }
 *                            Empty object when the account has no rows in the window.
 */
async function getAsinFinanceForWindow(userId, country, region, startDate = null, endDate = null) {
    const { startStr, endStr } = resolveWindow(startDate, endDate);

    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch {
        return {};
    }
    if (!userObjectId || !country || !region) return {};

    let rows;
    try {
        rows = await DailySkuFinance.aggregate([
            {
                $match: {
                    User: userObjectId,
                    country,
                    region,
                    date: { $gte: startStr, $lte: endStr },
                    // Rows with no ASIN cannot be attributed to a product.
                    asin: { $nin: [null, ''] }
                }
            },
            {
                $group: {
                    _id: '$asin',
                    sales: { $sum: { $ifNull: ['$productSales', 0] } },
                    unitsSold: { $sum: { $ifNull: ['$units', 0] } },
                    // Negative in storage; flipped to a positive magnitude below.
                    expenses: { $sum: { $ifNull: ['$totalExpenses', 0] } },
                    fbaFees: { $sum: { $ifNull: ['$fbaFulfillmentFee', 0] } },
                    referralFees: { $sum: { $ifNull: ['$referralCommission', 0] } }
                }
            }
        ]);
    } catch (error) {
        // Never let a finance read break the dashboard; callers fall back.
        logger.error('[AsinFinanceWindow] aggregation failed', {
            error: error.message, userId: String(userId), country, region
        });
        return {};
    }

    const map = {};
    for (const r of rows || []) {
        const asin = r._id;
        if (!asin) continue;
        map[asin] = {
            sales: round2(r.sales),
            unitsSold: Math.round(r.unitsSold || 0),
            // Positive magnitude — callers subtract this.
            totalFees: round2(Math.abs(r.expenses || 0)),
            amazonFees: round2(Math.abs(r.expenses || 0)),
            fbaFees: round2(Math.abs(r.fbaFees || 0)),
            referralFees: round2(Math.abs(r.referralFees || 0)),
            // DailySkuFinance has no per-SKU storage fee; storage is account-level
            // and already inside totalExpenses when Amazon attributes it to a SKU.
            storageFees: 0,
            source: 'dailySkuFinance'
        };
    }

    logger.info('[AsinFinanceWindow] built per-ASIN finance map', {
        userId: String(userId), country, region,
        window: `${startStr}..${endStr}`, asins: Object.keys(map).length
    });
    return map;
}

/**
 * The ONE answer to "what per-ASIN sales/fees should this reader show?".
 *
 * WHY. EconomicsMetrics stopped being written in April 2026, but `findLatest`
 * still returns its last doc, and for big accounts that doc carries a full
 * per-ASIN map. Every reader that took `getAsinPpcSalesFromEconomics(doc)` at
 * face value showed ~6-month-old sales as if current, and the live
 * DailySkuFinance fallback (which only ran on an EMPTY map, and only in
 * DashboardCalculation) never fired for exactly the accounts that had a map.
 * Product details, Issues-by-Product, Optimization, QMate and the legacy
 * profitability endpoint each made that call on their own, so they disagreed
 * with the dashboard and the Profitability page. They now all come here.
 *
 * Rule (identical to the block DashboardCalculation used to carry inline):
 *   1. Per-ASIN map from EconomicsMetrics (the existing ProfitabilityService
 *      logic: normal + big accounts + duplicate rows).
 *   2. Doc older than ECONOMICS_MAX_AGE_DAYS -> the map is DROPPED, loudly.
 *      A stale map is worse than none: it is used as if current.
 *   3. Map empty -> live DailySkuFinance for [startDate, endDate]
 *      (default: the 30 days ending yesterday).
 *
 * Only the per-ASIN map is resolved. Account-level totals (totalSales,
 * totalGrossProfit) are passed through from EconomicsMetrics unchanged so
 * headline figures are not moved by this.
 *
 * @param {Object}  args
 * @param {Object}  [args.economicsMetrics]      - latest EconomicsMetrics doc (lean or hydrated), may be null
 * @param {string|ObjectId} [args.userId]        - required for the live fallback
 * @param {string}  [args.country]
 * @param {string}  [args.region]
 * @param {string|Date} [args.startDate]         - live-fallback window (inclusive)
 * @param {string|Date} [args.endDate]
 * @param {Object}  [args.economicsAsinPpcSales] - a per-ASIN map the caller already built
 *        from `economicsMetrics` (DashboardCalculation builds it in parallel with other
 *        work); skips rebuilding it. The stale rule still applies to it.
 * @returns {Promise<{asinPpcSales:Object, financeFresh:boolean, source:'economicsMetrics'|'dailySkuFinance'|'none', totalSales?:number, totalGrossProfit?:number}>}
 *   `financeFresh` = the map is non-empty after the stale drop, i.e. it is a recent
 *   EconomicsMetrics map or live DailySkuFinance. Profitability verdicts and task
 *   reconcile key off it: no fresh finance -> no verdict.
 */
async function resolveAsinFinance({
    economicsMetrics = null,
    userId = null,
    country = null,
    region = null,
    startDate = null,
    endDate = null,
    economicsAsinPpcSales = null
} = {}) {
    let asinPpcSales = {};
    let totals = {};

    if (economicsAsinPpcSales && typeof economicsAsinPpcSales === 'object') {
        asinPpcSales = economicsAsinPpcSales;
    } else if (economicsMetrics) {
        // Lazy: ProfitabilityService requires this module at load time, so a
        // top-level require here would hand one side a half-built exports object.
        const { getAsinPpcSalesFromEconomics } = require('../Calculations/ProfitabilityService.js');
        const fromEconomics = await getAsinPpcSalesFromEconomics(economicsMetrics);
        asinPpcSales = fromEconomics.asinPpcSales || {};
        totals = { totalSales: fromEconomics.totalSales, totalGrossProfit: fromEconomics.totalGrossProfit };
    }

    let source = Object.keys(asinPpcSales).length > 0 ? 'economicsMetrics' : 'none';

    if (source === 'economicsMetrics' && !isEconomicsFresh(economicsMetrics)) {
        const createdAtMs = toTime(economicsMetrics?.createdAt);
        logger.warn('[AsinFinanceWindow] Ignoring STALE EconomicsMetrics per-ASIN finance; falling back to DailySkuFinance', {
            userId: userId != null ? String(userId) : null, country, region,
            createdAt: economicsMetrics?.createdAt,
            ageDays: Number.isFinite(createdAtMs) ? Math.floor((Date.now() - createdAtMs) / 86400000) : null,
            maxAgeDays: ECONOMICS_MAX_AGE_DAYS,
            staleAsins: Object.keys(asinPpcSales).length
        });
        asinPpcSales = {};
        source = 'none';
    }

    // getAsinFinanceForWindow would mint a random ObjectId from a missing userId,
    // so the fallback only runs with a real account key.
    if (source === 'none' && userId && country && region) {
        try {
            const live = await getAsinFinanceForWindow(userId, country, region, startDate, endDate);
            if (Object.keys(live).length > 0) {
                // grossProfit is not stored per ASIN in DailySkuFinance; give readers
                // that display it the Profitability page's definition
                // (FinanceDashboardReadService: productSales - |expenses|, before ads)
                // instead of a silent $0. ProfitabilityCalculation ignores this field
                // and recomputes with Ads API spend, so the dashboard is unaffected.
                for (const row of Object.values(live)) {
                    row.grossProfit = round2((row.sales || 0) - (row.totalFees || 0));
                }
                asinPpcSales = live;
                source = 'dailySkuFinance';
            }
        } catch (error) {
            // getAsinFinanceForWindow already swallows DB errors; this is belt and
            // braces so a finance read can never fail a page.
            logger.error('[AsinFinanceWindow] live per-ASIN fallback failed', {
                error: error.message, userId: String(userId), country, region
            });
        }
    }

    return {
        asinPpcSales,
        financeFresh: Object.keys(asinPpcSales).length > 0,
        source,
        ...totals
    };
}

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = {
    getAsinFinanceForWindow,
    resolveAsinFinance,
    // exported for tests
    resolveWindow,
    toYyyyMmDd,
    DEFAULT_WINDOW_DAYS
};

/**
 * LiveEconomicsService
 *
 * The ONE loader for "the account's economics for a window" — totals, date-wise
 * series and per-ASIN rows in the EconomicsMetrics document shape.
 *
 * WHY THIS EXISTS
 * ---------------
 * EconomicsMetrics stopped being written (newest production doc 2026-03-25, and
 * only 33 marketplaces ever had one), yet `findLatest` kept handing readers its
 * last doc, so the dashboard, QMate, alerts and product pages showed March
 * numbers as current — or 0 for the 57 live marketplaces that never had a doc.
 * DailySkuFinance is written daily and is what the Profitability page reads.
 *
 * Rule (every reader goes through it, so every surface agrees):
 *   1. A FRESH EconomicsMetrics doc (isEconomicsFresh, 14 days) is returned as is.
 *   2. Otherwise a doc of the same shape is built from DailySkuFinance for the
 *      window (default: the 30 days ending yesterday).
 *   3. Otherwise null. Stale or missing data is "no data", never April numbers
 *      and never a fabricated 0.
 *
 * GROSS PROFIT
 * ------------
 * EconomicsMetrics defines grossProfit as sales - amazonFees - refunds, BEFORE
 * ads (PPC is subtracted downstream). The Profitability page defines it as
 * productSales - |totalExpenses| - ads, i.e. the same thing with ads taken off.
 * The built doc therefore uses productSales - (-totalExpenses), before ads, and
 * splits totalExpenses into `refunds` (the refund-cost group) and `amazonFees`
 * (everything else: fees, promotions, disposal, other) so the doc's own
 * invariant grossProfit = sales - amazonFees - refunds still holds — readers
 * such as Analyse.convertEconomicsToFinanceFormat recompute it that way.
 * Sums are signed (not |sum|) so date-wise and per-ASIN rows add up to the
 * totals; they differ from |sum| only on a net-credit bucket.
 */

const mongoose = require('mongoose');
const logger = require('../../utils/Logger.js');
const DailySkuFinance = require('../../models/finance/DailySkuFinanceModel.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const { isEconomicsFresh } = require('../Calculations/RecoverableAmountUtils.js');
const { resolveWindow, toYyyyMmDd } = require('./AsinFinanceWindowService.js');
const { getCurrencyCode } = require('../../utils/marketplaceCurrency.js');

/** Marks a doc built here, so callers never treat it as a stored EconomicsMetrics doc. */
const LIVE_ECONOMICS_SOURCE = 'daily_sku_finance';

// Signed sums pulled per bucket. Fees and refunds are stored NEGATIVE.
const SUM_FIELDS = [
    'productSales', 'units', 'totalExpenses',
    'fbaFulfillmentFee', 'referralCommission', 'closingFee', 'technologyFee',
    'shippingChargeback', 'giftWrapChargeback', 'fbaDisposalFee', 'fbaReversedReimbursement',
    'refundedAmount', 'refundCommission', 'refundedReferralFee', 'refundedPromotion', 'restockingFee',
    'promotionsDiscount', 'shippingDiscount', 'taxDiscount', 'shippingTaxDiscount',
    'otherExpenses',
];

const REFUND_FIELDS = ['refundedAmount', 'refundCommission', 'refundedReferralFee', 'refundedPromotion', 'restockingFee'];

// Display labels for the Amazon-fee breakdown (refund cost is reported as `refunds`).
const FEE_BREAKDOWN_FIELDS = [
    ['fbaFulfillmentFee', 'FBA Fulfillment Fee'],
    ['referralCommission', 'Referral Commission'],
    ['closingFee', 'Closing Fee'],
    ['technologyFee', 'Technology Fee'],
    ['shippingChargeback', 'Shipping Chargeback'],
    ['giftWrapChargeback', 'Gift Wrap Chargeback'],
    ['fbaDisposalFee', 'FBA Disposal Fee'],
    ['fbaReversedReimbursement', 'Compensated Clawback'],
    ['promotionsDiscount', 'Promotions Discount'],
    ['shippingDiscount', 'Shipping Discount'],
    ['taxDiscount', 'Tax Discount'],
    ['shippingTaxDiscount', 'Shipping Tax Discount'],
    ['otherExpenses', 'Other Expenses'],
];

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

function money(amount, currencyCode) {
    return { amount: round2(amount), currencyCode };
}

function sumGroup(idExpr) {
    const group = { _id: idExpr };
    for (const f of SUM_FIELDS) group[f] = { $sum: `$${f}` };
    return group;
}

/** Positive magnitudes from one bucket of signed sums. */
function deriveBucket(b) {
    const sales = Number(b.productSales) || 0;
    const expenses = -(Number(b.totalExpenses) || 0);
    const refunds = -REFUND_FIELDS.reduce((s, f) => s + (Number(b[f]) || 0), 0);
    const amazonFees = expenses - refunds;
    const feeBreakdown = [];
    for (const [field, feeType] of FEE_BREAKDOWN_FIELDS) {
        const amount = round2(-(Number(b[field]) || 0));
        if (amount !== 0) feeBreakdown.push({ feeType, amount });
    }
    return {
        sales: round2(sales),
        units: Math.round(Number(b.units) || 0),
        fbaFees: round2(-(Number(b.fbaFulfillmentFee) || 0)),
        refunds: round2(refunds),
        amazonFees: round2(amazonFees),
        expenses: round2(expenses),
        grossProfit: round2(sales - expenses),
        feeBreakdown,
    };
}

function toUserObjectId(userId) {
    if (!userId) return null;
    if (userId instanceof mongoose.Types.ObjectId) return userId;
    try {
        return new mongoose.Types.ObjectId(String(userId));
    } catch {
        return null;
    }
}

/**
 * Assemble the EconomicsMetrics-shaped doc from grouped rows. Pure, so the
 * arithmetic is testable without a database.
 *
 * @param {Object} args
 * @param {Array}  args.byDate  - [{ _id: 'YYYY-MM-DD', ...SUM_FIELDS }]
 * @param {Array}  args.byAsin  - [{ _id: asin, ...SUM_FIELDS }]
 * @param {Array}  [args.adsRows] - ProductWiseSponsoredAdsItem.aggregateByAsinAndAdType rows
 * @returns {Object|null} null when there are no rows
 */
function assembleEconomicsDoc({ userId, country, region, startStr, endStr, byDate = [], byAsin = [], adsRows = [] }) {
    if (!Array.isArray(byDate) || byDate.length === 0) return null;
    const currencyCode = getCurrencyCode(country);

    const adsByAsin = new Map();
    let adsTotal = 0;
    for (const row of adsRows || []) {
        const spend = Number(row?.spend) || 0;
        adsTotal += spend;
        if (row?.asin) adsByAsin.set(row.asin, (adsByAsin.get(row.asin) || 0) + spend);
    }

    const totals = { sales: 0, fbaFees: 0, refunds: 0, amazonFees: 0, expenses: 0, grossProfit: 0 };
    const breakdownTotals = new Map();
    const datewiseSales = [];
    const datewiseGrossProfit = [];
    const datewiseFeesAndRefunds = [];
    const datewiseAmazonFees = [];

    const days = [...byDate].filter((r) => r && r._id).sort((a, b) => String(a._id).localeCompare(String(b._id)));
    for (const row of days) {
        const date = String(row._id);
        const d = deriveBucket(row);
        for (const k of Object.keys(totals)) totals[k] += d[k];
        for (const { feeType, amount } of d.feeBreakdown) {
            breakdownTotals.set(feeType, (breakdownTotals.get(feeType) || 0) + amount);
        }
        datewiseSales.push({ date, sales: money(d.sales, currencyCode), grossProfit: money(d.grossProfit, currencyCode) });
        datewiseGrossProfit.push({ date, grossProfit: money(d.grossProfit, currencyCode) });
        datewiseFeesAndRefunds.push({
            date,
            fbaFulfillmentFee: money(d.fbaFees, currencyCode),
            // Storage is billed account-level (DailyOverheadFinance), not per SKU.
            storageFee: money(0, currencyCode),
            // DailySkuFinance has no refund-unit count.
            refunds: { units: 0, amount: d.refunds, currencyCode },
        });
        datewiseAmazonFees.push({ date, totalAmount: money(d.amazonFees, currencyCode), feeBreakdown: d.feeBreakdown });
    }

    const asinWiseSales = [];
    for (const row of byAsin || []) {
        const asin = row?._id;
        // Rows without an ASIN count in the totals but cannot be attributed to a product.
        if (!asin) continue;
        const d = deriveBucket(row);
        asinWiseSales.push({
            date: null,
            asin,
            parentAsin: null,
            sales: money(d.sales, currencyCode),
            grossProfit: money(d.grossProfit, currencyCode),
            unitsSold: d.units,
            refunds: money(d.refunds, currencyCode),
            ppcSpent: money(adsByAsin.get(asin) || 0, currencyCode),
            fbaFees: money(d.fbaFees, currencyCode),
            storageFees: money(0, currencyCode),
            // Everything ProfitabilityCalculation subtracts (sales - ads - totalFees),
            // matching resolveAsinFinance's live rows and the Profitability page.
            totalFees: money(d.expenses, currencyCode),
            amazonFees: money(d.amazonFees, currencyCode),
            feeBreakdown: d.feeBreakdown,
        });
    }
    asinWiseSales.sort((a, b) => b.sales.amount - a.sales.amount);

    return {
        User: userId,
        country,
        region,
        dateRange: { startDate: startStr, endDate: endStr },
        totalSales: money(totals.sales, currencyCode),
        grossProfit: money(totals.grossProfit, currencyCode),
        ppcSpent: money(adsTotal, currencyCode),
        fbaFees: money(totals.fbaFees, currencyCode),
        storageFees: money(0, currencyCode),
        totalFees: money(totals.expenses, currencyCode),
        amazonFees: money(totals.amazonFees, currencyCode),
        amazonFeesBreakdown: [...breakdownTotals.entries()]
            .map(([feeType, amount]) => ({ feeType, amount: round2(amount) }))
            .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
        refunds: money(totals.refunds, currencyCode),
        datewiseSales,
        datewiseGrossProfit,
        datewiseFeesAndRefunds,
        datewiseAmazonFees,
        asinWiseSales,
        isBig: false,
        source: LIVE_ECONOMICS_SOURCE,
        // Built now from live rows; lets isEconomicsFresh-based readers accept it.
        createdAt: new Date(),
        processedAt: new Date(),
    };
}

/**
 * EconomicsMetrics-shaped doc for [startDate, endDate] from DailySkuFinance.
 *
 * @param {string} [args.asin] - limit the doc to one product (served by the
 *        { User, country, region, asin, date } index); totals are then that ASIN's.
 * @returns {Promise<Object|null>} null when the window has no rows (or the read fails)
 */
async function buildEconomicsFromDailyFinance({ userId, country, region, startDate = null, endDate = null, asin = null } = {}) {
    const userObjectId = toUserObjectId(userId);
    if (!userObjectId || !country || !region) return null;
    const { startStr, endStr } = resolveWindow(startDate, endDate);
    const match = { User: userObjectId, country, region, date: { $gte: startStr, $lte: endStr } };
    const onlyAsin = asin ? String(asin).trim().toUpperCase() : null;
    if (onlyAsin) match.asin = onlyAsin;

    try {
        const [byDate, byAsin, adsRows] = await Promise.all([
            DailySkuFinance.aggregate([{ $match: match }, { $group: sumGroup('$date') }]),
            DailySkuFinance.aggregate([{ $match: match }, { $group: sumGroup('$asin') }]),
            Promise.resolve()
                .then(() => ProductWiseSponsoredAdsItem.aggregateByAsinAndAdType(userObjectId, country, region, startStr, endStr))
                .catch(() => []),
        ]);
        return assembleEconomicsDoc({
            userId: userObjectId, country, region, startStr, endStr, byDate, byAsin,
            adsRows: onlyAsin ? (adsRows || []).filter((r) => String(r?.asin || '').toUpperCase() === onlyAsin) : adsRows,
        });
    } catch (error) {
        // A finance read must never fail a page; no rows read = no data.
        logger.error('[LiveEconomics] DailySkuFinance aggregation failed', {
            error: error.message, userId: String(userId), country, region, window: `${startStr}..${endStr}`,
        });
        return null;
    }
}

/** True for a doc assembled here rather than read from EconomicsMetrics. */
function isLiveEconomicsDoc(doc) {
    return !!doc && doc.source === LIVE_ECONOMICS_SOURCE;
}

/**
 * True only for a real stored EconomicsMetrics doc — the only kind whose `_id`
 * keys AsinWiseSalesForBigAccounts rows.
 */
function isStoredEconomicsDoc(doc) {
    return !!doc && !isLiveEconomicsDoc(doc) && doc._id != null;
}

function docCoversWindow(doc, startStr, endStr) {
    const s = toYyyyMmDd(doc?.dateRange?.startDate);
    const e = toYyyyMmDd(doc?.dateRange?.endDate);
    return !!(s && e && s <= startStr && e >= endStr);
}

/**
 * Economics for an account: fresh EconomicsMetrics, else live DailySkuFinance,
 * else null.
 *
 * @param {string|ObjectId} userId
 * @param {string} region
 * @param {string} country
 * @param {Object} [window] - { startDate, endDate } inclusive. When given, a fresh
 *        stored doc is only used if its dateRange covers the window. `asin` limits a
 *        live-built doc to that product (a stored doc is returned whole).
 * @returns {Promise<Object|null>} plain object (lean), EconomicsMetrics shape
 */
async function loadLiveEconomics(userId, region, country, { startDate = null, endDate = null, asin = null } = {}) {
    const explicitWindow = !!(toYyyyMmDd(startDate) && toYyyyMmDd(endDate));
    const { startStr, endStr } = resolveWindow(startDate, endDate);

    try {
        // Header first: a stale doc can carry a 15k-row asinWiseSales array that
        // would be loaded only to be thrown away.
        const head = await EconomicsMetrics.findLatest(userId, region, country)
            .select('_id createdAt dateRange')
            .lean();
        if (head && isEconomicsFresh(head) && (!explicitWindow || docCoversWindow(head, startStr, endStr))) {
            const doc = await EconomicsMetrics.findById(head._id).lean();
            if (doc) return doc;
        }
    } catch (error) {
        logger.warn('[LiveEconomics] EconomicsMetrics lookup failed; using DailySkuFinance', {
            error: error.message, userId: String(userId), country, region,
        });
    }

    return buildEconomicsFromDailyFinance({ userId, country, region, startDate: startStr, endDate: endStr, asin });
}

/** The N days ending yesterday (UTC), as 'YYYY-MM-DD' strings. */
function lastNDaysWindow(days) {
    const n = Math.max(1, Math.floor(Number(days) || 1));
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const start = new Date(end.getTime() - (n - 1) * 86400000);
    return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

/** The window of the same length immediately before [startStr, endStr]. */
function previousWindow(startDate, endDate) {
    const { startStr, endStr } = resolveWindow(startDate, endDate);
    const start = new Date(`${startStr}T00:00:00Z`);
    const end = new Date(`${endStr}T00:00:00Z`);
    const days = Math.round((end - start) / 86400000) + 1;
    const prevEnd = new Date(start.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
    return { startStr: prevStart.toISOString().slice(0, 10), endStr: prevEnd.toISOString().slice(0, 10) };
}

/**
 * Current vs previous window of equal length, both from DailySkuFinance so the
 * two sides are computed the same way (a stored doc only ever describes one
 * fixed window, so it cannot be the "previous" side).
 *
 * @returns {Promise<{current:Object|null, previous:Object|null, currentWindow:Object, previousWindow:Object}>}
 */
async function loadEconomicsComparison(userId, region, country, { startDate = null, endDate = null, asin = null } = {}) {
    const cur = resolveWindow(startDate, endDate);
    const prev = previousWindow(cur.startStr, cur.endStr);
    const [current, previous] = await Promise.all([
        buildEconomicsFromDailyFinance({ userId, country, region, startDate: cur.startStr, endDate: cur.endStr, asin }),
        buildEconomicsFromDailyFinance({ userId, country, region, startDate: prev.startStr, endDate: prev.endStr, asin }),
    ]);
    return {
        current,
        previous,
        currentWindow: { startDate: cur.startStr, endDate: cur.endStr },
        previousWindow: { startDate: prev.startStr, endDate: prev.endStr },
    };
}

module.exports = {
    loadLiveEconomics,
    buildEconomicsFromDailyFinance,
    loadEconomicsComparison,
    previousWindow,
    lastNDaysWindow,
    isLiveEconomicsDoc,
    isStoredEconomicsDoc,
    LIVE_ECONOMICS_SOURCE,
    // exported for tests
    assembleEconomicsDoc,
    SUM_FIELDS,
};

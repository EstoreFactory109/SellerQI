/**
 * KpiInputs — the compact inputs the tasks-logics.xlsx detectors need, built in
 * Analyse and carried on its message as `KpiInputs`.
 *
 * Built only for accounts with a wave enabled (kpiGate), so every other account's
 * Analyse message and its cached copy are unchanged. Kept small on purpose: the
 * message is cached, and the raw documents (one FBA row per SKU, a removal line
 * per order) are reduced to what the rules read.
 *
 * Every date leaves here as an ISO string, because the message passes through the
 * page cache as JSON and the detectors must read it the same either way.
 */

const SuppressedListings = require('../../../models/products/SuppressedListingsModel.js');
const RemovalOrders = require('../../../models/inventory/RemovalOrdersModel.js');
const RemovalReceipt = require('../../../models/inventory/RemovalReceiptModel.js');
const { getAsinFinanceForWindow } = require('../../Finance/AsinFinanceWindowService.js');
const { getFBAReimbursementsData } = require('../../Finance/FBAReimbursementsService.js');
const logger = require('../../../utils/Logger.js');
const { SUPPRESSED_SALES_LOOKBACK_DAYS } = require('./KpiRules.js');
const { freshInventoryReportOrNull } = require('../InventoryReportFreshness.js');

const iso = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * FBA stock per ASIN, summed over its SKUs.
 * @param {Array} rows - FbaInventoryApiDetail documents (lean)
 * @returns {{fetchedAt: string|null, byAsin: Object}|null}
 */
function buildStock(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const byAsin = {};
    let newest = null;
    for (const row of rows) {
        if (!row || !row.asin) continue;
        const entry = byAsin[row.asin] || (byAsin[row.asin] = { fulfillable: 0, inbound: 0, total: 0, skus: [] });
        entry.fulfillable += Number(row.fulfillableQuantity) || 0;
        entry.inbound += (Number(row.inboundWorkingQuantity) || 0)
            + (Number(row.inboundShippedQuantity) || 0)
            + (Number(row.inboundReceivingQuantity) || 0);
        entry.total += Number(row.totalQuantity) || 0;
        if (row.sellerSku) entry.skus.push(row.sellerSku);
        const at = iso(row.fetchedAt || row.updatedAt);
        if (at && (!newest || at > newest)) newest = at;
    }
    return { fetchedAt: newest, byAsin };
}

/**
 * ASINs with a usable unit cost. A zero or blank entry is not a cost.
 * @param {Object} cogsData - CogsService.getCogs result
 * @returns {string[]|null} null when COGS could not be read at all
 */
function buildCogsAsins(cogsData) {
    if (!cogsData || cogsData.success !== true) return null;
    const values = cogsData.data?.cogsValues || {};
    return Object.keys(values).filter(asin => Number(values[asin]) > 0);
}

/**
 * Account Health Rating per report, oldest first. A report with no score is
 * kept as null so the detector can refuse to judge it.
 * @param {Array} history - loadV2History result
 */
function buildAhrHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
        .map(doc => ({
            at: iso(doc?.createdAt),
            score: doc?.ahrScore === null || doc?.ahrScore === undefined || doc?.ahrScore === ''
                ? null
                : Number(doc.ahrScore)
        }))
        .filter(row => row.at)
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Listings Amazon is hiding, newest report. "At risk" rows are still visible to
 * shoppers, so they are left out. An unreadable report is no report.
 * @param {Object|null} doc - SuppressedListings document (lean)
 */
function buildSuppressed(doc) {
    if (!doc || doc.unreadable) return null;
    return {
        createdAt: iso(doc.createdAt),
        items: (doc.items || [])
            .filter(item => item && item.asin && !item.isAtRisk)
            .map(item => ({
                sku: item.sku || '',
                asin: item.asin,
                status: item.status || '',
                reason: item.reason || '',
                issueDescription: item.issueDescription || ''
            }))
    };
}

/**
 * Removal order lines, newest report. An unreadable report is no report.
 * @param {Object|null} doc - RemovalOrders document (lean)
 */
function buildRemovals(doc) {
    if (!doc || doc.unreadable) return null;
    return {
        createdAt: iso(doc.createdAt),
        lines: (doc.lines || [])
            .filter(line => line && line.orderId)
            .map(line => ({
                orderId: line.orderId,
                orderType: line.orderType || '',
                orderStatus: line.orderStatus || '',
                requestDate: line.requestDate || '',
                lastUpdatedDate: line.lastUpdatedDate || '',
                sku: line.sku || '',
                requestedQuantity: Number(line.requestedQuantity) || 0,
                shippedQuantity: Number(line.shippedQuantity) || 0,
                disposedQuantity: Number(line.disposedQuantity) || 0,
                cancelledQuantity: Number(line.cancelledQuantity) || 0,
                inProcessQuantity: Number(line.inProcessQuantity) || 0
            }))
    };
}

/**
 * Per-ASIN sales over the longer suppressed-listing lookback, only ASINs that
 * sold. null when there is nothing to read (the detector then falls back to the
 * dashboard window).
 * @param {Object} financeMap - getAsinFinanceForWindow result
 */
function buildSalesLookback(financeMap) {
    if (!financeMap || typeof financeMap !== 'object') return null;
    const out = {};
    for (const [asin, v] of Object.entries(financeMap)) {
        const sales = Number(v?.sales) || 0;
        const unitsSold = Number(v?.unitsSold) || 0;
        if (asin && (sales > 0 || unitsSold > 0)) out[asin] = { sales, unitsSold };
    }
    return Object.keys(out).length > 0 ? out : null;
}

/**
 * Units Amazon already reimbursed against removal orders, keyed by order id then
 * SKU ('' when the row has no SKU). A removal reimbursement carries the removal
 * order id in `amazon_order_id`, so rows are matched on the ids in the removal
 * report rather than on Amazon's reason wording; customer order ids never collide
 * with removal order ids. Reversals are negative quantities and net off by summing.
 * @param {Object|null} reimbursementsDoc - getFBAReimbursementsData result
 * @param {Set<string>} removalOrderIds - order ids in the removal report
 * @returns {Object|null} null when the report could not be read
 */
function buildRemovalReimbursements(reimbursementsDoc, removalOrderIds = new Set()) {
    if (!reimbursementsDoc || !Array.isArray(reimbursementsDoc.data)) return null;
    const out = {};
    for (const row of reimbursementsDoc.data) {
        const orderId = String(row?.amazon_order_id || '').trim();
        if (!orderId || !removalOrderIds.has(orderId)) continue;
        const qty = Number(row?.quantity_reimbursed_total) || 0;
        if (qty === 0) continue;
        const sku = String(row?.sku || '').trim();
        const bySku = out[orderId] || (out[orderId] = {});
        bySku[sku] = (bySku[sku] || 0) + qty;
    }
    return out;
}

/**
 * The seller's answers to "what arrived from this removal order". null when they
 * could not be read, so the removal rule is held rather than re-asking.
 * @param {Array|null} docs - RemovalReceipt documents (lean)
 */
function buildRemovalReceipts(docs) {
    if (!Array.isArray(docs)) return null;
    return docs
        .filter(d => d && d.orderId)
        .map(d => ({
            orderId: d.orderId,
            sku: d.sku || '',
            shippedQuantity: Number(d.shippedQuantity) || 0,
            receivedQuantity: Number(d.receivedQuantity) || 0
        }));
}

// ════════════════════════════ Wave 2 / 3 inputs ════════════════════════════

const DAY_MS = 24 * 60 * 60 * 1000;
const shiftDayKey = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const toNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
};

/**
 * Per-ASIN sessions and units over the windows the trend rules compare, summed in
 * Mongo so a 1,500-ASIN account's 74 daily documents never come into Node.
 * A day can have more than one document; the newest per day is used.
 *
 *   recent 14 days / the baseline before it (up to 60 days)  -> conversion, traffic
 *   recent 7 days / the 28 days before it                    -> sales drop
 *
 * @returns {Promise<Object|null>} null when there is no daily traffic data
 */
async function loadTrafficTrend(userId, country, region) {
    const BuyBoxData = require('../../../models/MCP/BuyBoxDataModel.js');
    const R = require('./KpiRules.js');
    const User = toObjectId(userId);
    const newestDoc = await BuyBoxData.findOne({ User, country, region, date: { $type: 'string' } })
        .sort({ date: -1 }).select('date').lean();
    const newestDate = newestDoc?.date ? String(newestDoc.date).slice(0, 10) : null;
    if (!newestDate) return null;

    const r14 = shiftDayKey(newestDate, -(R.TRAFFIC_RECENT_DAYS - 1));
    const b0 = shiftDayKey(r14, -R.TRAFFIC_BASELINE_DAYS);
    const r7 = shiftDayKey(newestDate, -(R.SALES_RECENT_DAYS - 1));
    const p28 = shiftDayKey(r7, -R.SALES_BASELINE_DAYS);
    const from = b0 < p28 ? b0 : p28;

    const perDay = [
        { $match: { User, country, region, date: { $gte: from, $lte: newestDate } } },
        { $sort: { date: 1, createdAt: -1 } },
        { $group: { _id: '$date', rows: { $first: '$asinBuyBoxData' } } }
    ];
    const r14End = shiftDayKey(newestDate, 1);

    // Event days (Prime Day, deal days): an account selling over EVENT_DAY_MULTIPLE x
    // its median day. Left out of every window, or a baseline holding one makes the
    // ordinary weeks after it read as drops (seen: 1,415 units on a ~150-unit-a-day
    // account turned 7 products into false "sales drops").
    const dayTotals = await BuyBoxData.aggregate([
        ...perDay,
        { $project: { units: { $sum: { $ifNull: ['$rows.unitsOrdered', []] } } } }
    ]).allowDiskUse(true);
    const sortedUnits = dayTotals.map(d => d.units || 0).sort((a, b) => a - b);
    const median = sortedUnits.length ? sortedUnits[Math.floor(sortedUnits.length / 2)] : 0;
    const eventDays = median > 0
        ? dayTotals.filter(d => (d.units || 0) > median * R.EVENT_DAY_MULTIPLE).map(d => String(d._id))
        : [];
    const usableDays = dayTotals.map(d => String(d._id)).filter(d => !eventDays.includes(d));
    const countIn = (lo, hiExclusive) => usableDays.filter(d => d >= lo && d < hiExclusive).length;
    const days = {
        recent14: countIn(r14, r14End),
        baseline: countIn(b0, r14),
        recent7: countIn(r7, r14End),
        prior28: countIn(p28, r7)
    };

    const sumIf = (lo, hi, field) => ({ $sum: { $cond: [{ $and: [{ $gte: ['$day', lo] }, { $lt: ['$day', hi] }] }, { $ifNull: [field, 0] }, 0] } });
    const rows = await BuyBoxData.aggregate([
        ...perDay,
        { $match: { _id: { $nin: eventDays } } },
        { $unwind: '$rows' },
        { $project: { day: '$_id', asin: '$rows.childAsin', sessions: '$rows.sessions', units: '$rows.unitsOrdered' } },
        { $match: { asin: { $nin: [null, ''] } } },
        {
            $group: {
                _id: '$asin',
                rs: sumIf(r14, r14End, '$sessions'),
                ru: sumIf(r14, r14End, '$units'),
                bs: sumIf(b0, r14, '$sessions'),
                bu: sumIf(b0, r14, '$units'),
                u7: sumIf(r7, r14End, '$units'),
                u28: sumIf(p28, r7, '$units')
            }
        }
    ]).allowDiskUse(true);

    const byAsin = {};
    for (const r of rows) byAsin[r._id] = { rs: r.rs, ru: r.ru, bs: r.bs, bu: r.bu, u7: r.u7, u28: r.u28 };
    return {
        newestDate,
        recent14Days: days.recent14,
        baselineDays: days.baseline,
        recent7Days: days.recent7,
        prior28Days: days.prior28,
        eventDays,
        byAsin
    };
}

/**
 * Daily ad spend and daily total sales for the last 60 days ending on the newest
 * day both have, for the TACoS trend. Spend from the per-day ads documents, sales
 * from DailySkuFinance.
 */
async function loadTacosSeries(userId, country, region, now = new Date()) {
    const GetDateWisePPCspendModel = require('../../../models/amazon-ads/GetDateWisePPCspendModel.js');
    const DailySkuFinance = require('../../../models/finance/DailySkuFinanceModel.js');
    const since = new Date(now.getTime() - 70 * DAY_MS).toISOString().slice(0, 10);
    const [spendRows, salesRows] = await Promise.all([
        GetDateWisePPCspendModel.aggregate([
            { $match: { userId: String(userId), country, region, metricDate: { $type: 'string', $gte: since } } },
            { $unwind: '$dateWisePPCSpends' },
            { $group: { _id: '$metricDate', cost: { $sum: { $ifNull: ['$dateWisePPCSpends.cost', 0] } } } }
        ]),
        DailySkuFinance.aggregate([
            { $match: { User: toObjectId(userId), country, region, date: { $gte: since } } },
            { $group: { _id: '$date', sales: { $sum: { $ifNull: ['$productSales', 0] } } } }
        ])
    ]);
    if (spendRows.length === 0 || salesRows.length === 0) return null;
    const spendByDay = Object.fromEntries(spendRows.map(r => [String(r._id).slice(0, 10), r.cost]));
    const salesByDay = Object.fromEntries(salesRows.map(r => [String(r._id).slice(0, 10), r.sales]));
    const newestSpend = Object.keys(spendByDay).sort().pop();
    const newestSales = Object.keys(salesByDay).sort().pop();
    return { newestDate: newestSpend < newestSales ? newestSpend : newestSales, spendByDay, salesByDay };
}

/**
 * Newest weekly listing scrape and the one closest to 30 days before it, reduced to
 * rating and rating count per ASIN.
 */
async function loadReviewSnapshots(userId, country, region, now = new Date()) {
    const NumberOfProductReviews = require('../../../models/seller-performance/NumberOfProductReviewsModel.js');
    const R = require('./KpiRules.js');
    const docs = await NumberOfProductReviews.find({
        User: toObjectId(userId), country, region,
        createdAt: { $gte: new Date(now.getTime() - (R.RATING_COMPARE_MAX_DAYS + R.REVIEW_SCRAPE_MAX_AGE_DAYS) * DAY_MS) }
    })
        .select({ createdAt: 1, 'Products.asin': 1, 'Products.product_star_ratings': 1, 'Products.product_num_ratings': 1 })
        .sort({ createdAt: -1 })
        .lean();
    if (docs.length === 0) return null;
    const reduce = (doc) => {
        const byAsin = {};
        for (const p of doc.Products || []) {
            if (!p?.asin) continue;
            const rating = toNum(p.product_star_ratings);
            const count = toNum(p.product_num_ratings);
            byAsin[p.asin] = { rating: rating === null ? null : Math.round(rating * 10) / 10, count: count === null ? null : Math.round(count) };
        }
        return { at: iso(doc.createdAt), byAsin };
    };
    const newest = docs[0];
    const target = new Date(newest.createdAt).getTime() - 30 * DAY_MS;
    const older = docs
        .filter(d => {
            const gap = (new Date(newest.createdAt).getTime() - new Date(d.createdAt).getTime()) / DAY_MS;
            return gap >= R.RATING_COMPARE_MIN_DAYS && gap <= R.RATING_COMPARE_MAX_DAYS;
        })
        .sort((a, b) => Math.abs(new Date(a.createdAt) - target) - Math.abs(new Date(b.createdAt) - target))[0];
    return { newest: reduce(newest), older: older ? reduce(older) : null };
}

/** Restock report rows, numbers parsed (the report stores them as strings). */
function buildRestock(doc) {
    if (!doc) return null;
    return {
        createdAt: iso(doc.createdAt),
        rows: (doc.Products || [])
            .filter(p => p && p.asin)
            .map(p => ({
                asin: p.asin,
                sku: p.merchantSku || '',
                available: toNum(p.available) || 0,
                inbound: toNum(p.inbound) || 0,
                unitsSold30: toNum(p.unitsSoldLast30Days) || 0,
                price: toNum(p.price) || 0
            }))
    };
}

/** Low-inventory-fee columns of the planning report (null where Amazon sent none). */
function buildPlanning(doc) {
    if (!doc) return null;
    return {
        createdAt: iso(doc.createdAt),
        headers: Array.isArray(doc.headers) ? doc.headers : [],
        rows: (doc.data || [])
            .filter(r => r && r.asin)
            .map(r => ({
                asin: r.asin,
                short: toNum(r.historical_days_of_supply_short),
                long: toNum(r.historical_days_of_supply_long),
                feeApplied: r.low_inventory_level_fee_applied ?? null
            }))
    };
}

/**
 * The two newest weekly FBA fee-estimate snapshots, per SKU: size tier and the
 * expected per-unit fulfilment fee (the report's column name has changed over time,
 * so the first one present is used).
 */
async function loadFbaFeeSnapshots(userId, country, region) {
    const ProductWiseFBADataItem = require('../../../models/inventory/ProductWiseFBADataItemModel.js');
    const filter = { userId: toObjectId(userId), country, region };
    const batches = await ProductWiseFBADataItem.aggregate([
        { $match: filter },
        { $group: { _id: '$batchId', at: { $max: '$createdAt' } } },
        { $sort: { at: -1 } },
        { $limit: 2 }
    ]);
    if (batches.length === 0) return null;
    const FEE_COLUMNS = ['expected-fulfillment-fee-per-unit', 'expected-domestic-fulfilment-fee-per-unit', 'estimated-pick-pack-fee-per-unit'];
    const snapshot = async (batch) => {
        const items = await ProductWiseFBADataItem.find({ batchId: batch._id }).lean();
        const bySku = {};
        for (const item of items) {
            if (!item.sku) continue;
            const feeKey = FEE_COLUMNS.find(k => toNum(item[k]) !== null);
            bySku[item.sku] = {
                asin: item.asin || '',
                sizeTier: String(item['product-size-tier'] || '').trim(),
                fee: feeKey ? toNum(item[feeKey]) : null
            };
        }
        return { at: iso(batch.at), bySku };
    };
    return {
        newest: await snapshot(batches[0]),
        previous: batches[1] ? await snapshot(batches[1]) : null
    };
}

/** The V2 report's invoice defect fields, keeping "never read" apart from "blank". */
function buildInvoice(v2Data) {
    if (!v2Data) return null;
    if (!Object.prototype.hasOwnProperty.call(v2Data, 'invoiceDefectRateStatus')) return {};
    return { invoiceDefectRateStatus: v2Data.invoiceDefectRateStatus, invoiceDefectRatePct: v2Data.invoiceDefectRatePct ?? null };
}

const toObjectId = (id) => {
    const mongoose = require('mongoose');
    return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
};

/**
 * Pure: raw documents -> KpiInputs.
 */
function buildKpiInputs({ waves = [], fbaInventoryDetailData, cogsData, v2History, suppressedDoc, removalDoc, salesLookback, reimbursementsDoc, receiptDocs }) {
    const removals = buildRemovals(removalDoc);
    const removalOrderIds = new Set((removals?.lines || []).map(line => String(line.orderId).trim()));
    return {
        waves,
        stock: buildStock(fbaInventoryDetailData),
        cogsAsins: buildCogsAsins(cogsData),
        ahrHistory: buildAhrHistory(v2History),
        suppressed: buildSuppressed(suppressedDoc),
        removals,
        salesLookback: buildSalesLookback(salesLookback),
        removalReimbursements: buildRemovalReimbursements(reimbursementsDoc, removalOrderIds),
        removalReceipts: buildRemovalReceipts(receiptDocs)
    };
}

/**
 * Analyse's entry point. Reuses what fetchAllDataModels already read and adds the
 * two reports nothing else loads. A failed read leaves that input null (= not
 * arrived), never empty (= nothing wrong).
 *
 * @param {Object} params
 * @param {number[]} params.waves - enabled waves (kpiGate)
 * @param {Object} params.allData - fetchAllDataModels result
 */
async function loadKpiInputs({ userId, country, region, waves, allData, now = new Date() }) {
    const unavailable = (name) => (error) => {
        logger.warn(`[KpiInputs] ${name} unavailable`, { userId, country, region, error: error.message });
        return null;
    };
    const latest = (Model, name) => Model.findOne({ User: userId, country, region })
        .sort({ createdAt: -1 })
        .lean()
        .catch(unavailable(name));

    // The suppressed-listing rule looks back further than the dashboard window:
    // the N days ending yesterday (UTC).
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const start = new Date(end.getTime() - (SUPPRESSED_SALES_LOOKBACK_DAYS - 1) * 24 * 60 * 60 * 1000);

    const [suppressedDoc, removalDoc, salesLookback, reimbursementsDoc, receiptDocs] = await Promise.all([
        latest(SuppressedListings, 'Suppressed listings'),
        latest(RemovalOrders, 'Removal orders'),
        Promise.resolve()
            .then(() => getAsinFinanceForWindow(userId, country, region, start, end))
            .catch(unavailable('Sales lookback')),
        Promise.resolve()
            .then(() => getFBAReimbursementsData(userId, country, region))
            .catch(unavailable('FBA reimbursements')),
        Promise.resolve()
            .then(() => RemovalReceipt.find({ User: userId, country, region }).lean())
            .catch(unavailable('Removal receipts'))
    ]);

    const inputs = buildKpiInputs({
        waves,
        fbaInventoryDetailData: allData?.fbaInventoryDetailData,
        cogsData: allData?.cogsData,
        v2History: allData?.v2History,
        suppressedDoc,
        removalDoc,
        salesLookback,
        reimbursementsDoc,
        receiptDocs
    });

    // Wave 2: trends and coverage. Each load fails to null on its own.
    if (waves.includes(2)) {
        const [traffic, tacos, reviews] = await Promise.all([
            Promise.resolve().then(() => loadTrafficTrend(userId, country, region)).catch(unavailable('Traffic trend')),
            Promise.resolve().then(() => loadTacosSeries(userId, country, region, now)).catch(unavailable('TACoS series')),
            Promise.resolve().then(() => loadReviewSnapshots(userId, country, region, now)).catch(unavailable('Review snapshots'))
        ]);
        Object.assign(inputs, {
            traffic,
            tacos,
            reviews,
            restock: buildRestock(freshInventoryReportOrNull(allData?.restockInventoryRecommendationsData, 'Restock recommendations (KPI)', { userId, country, region }, now))
        });
    }

    // Wave 3: inputs that needed pipeline work first.
    if (waves.includes(3)) {
        const fbaFees = await Promise.resolve()
            .then(() => loadFbaFeeSnapshots(userId, country, region))
            .catch(unavailable('FBA fee snapshots'));
        Object.assign(inputs, {
            fbaFees,
            planning: buildPlanning(freshInventoryReportOrNull(allData?.inventoryPlanningData, 'Inventory planning (KPI)', { userId, country, region }, now)),
            invoice: buildInvoice(allData?.v2Data)
        });
    }

    return inputs;
}

module.exports = {
    buildKpiInputs,
    loadKpiInputs,
    loadTrafficTrend,
    loadTacosSeries,
    loadReviewSnapshots,
    loadFbaFeeSnapshots,
    buildRestock,
    buildPlanning,
    buildInvoice,
    buildStock,
    buildCogsAsins,
    buildAhrHistory,
    buildSuppressed,
    buildRemovals,
    buildSalesLookback,
    buildRemovalReimbursements,
    buildRemovalReceipts
};

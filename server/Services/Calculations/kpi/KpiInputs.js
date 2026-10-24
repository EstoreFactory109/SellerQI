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
const { getAsinFinanceForWindow } = require('../../Finance/AsinFinanceWindowService.js');
const { getFBAReimbursementsData } = require('../../Finance/FBAReimbursementsService.js');
const logger = require('../../../utils/Logger.js');
const { SUPPRESSED_SALES_LOOKBACK_DAYS } = require('./KpiRules.js');

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
 * Pure: raw documents -> KpiInputs.
 */
function buildKpiInputs({ waves = [], fbaInventoryDetailData, cogsData, v2History, suppressedDoc, removalDoc, salesLookback, reimbursementsDoc }) {
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
        removalReimbursements: buildRemovalReimbursements(reimbursementsDoc, removalOrderIds)
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

    const [suppressedDoc, removalDoc, salesLookback, reimbursementsDoc] = await Promise.all([
        latest(SuppressedListings, 'Suppressed listings'),
        latest(RemovalOrders, 'Removal orders'),
        Promise.resolve()
            .then(() => getAsinFinanceForWindow(userId, country, region, start, end))
            .catch(unavailable('Sales lookback')),
        Promise.resolve()
            .then(() => getFBAReimbursementsData(userId, country, region))
            .catch(unavailable('FBA reimbursements'))
    ]);

    return buildKpiInputs({
        waves,
        fbaInventoryDetailData: allData?.fbaInventoryDetailData,
        cogsData: allData?.cogsData,
        v2History: allData?.v2History,
        suppressedDoc,
        removalDoc,
        salesLookback,
        reimbursementsDoc
    });
}

module.exports = {
    buildKpiInputs,
    loadKpiInputs,
    buildStock,
    buildCogsAsins,
    buildAhrHistory,
    buildSuppressed,
    buildRemovals,
    buildSalesLookback,
    buildRemovalReimbursements
};

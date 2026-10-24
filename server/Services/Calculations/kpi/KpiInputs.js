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
const logger = require('../../../utils/Logger.js');

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
 * Pure: raw documents -> KpiInputs.
 */
function buildKpiInputs({ waves = [], fbaInventoryDetailData, cogsData, v2History, suppressedDoc, removalDoc }) {
    return {
        waves,
        stock: buildStock(fbaInventoryDetailData),
        cogsAsins: buildCogsAsins(cogsData),
        ahrHistory: buildAhrHistory(v2History),
        suppressed: buildSuppressed(suppressedDoc),
        removals: buildRemovals(removalDoc)
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
async function loadKpiInputs({ userId, country, region, waves, allData }) {
    const latest = (Model, name) => Model.findOne({ User: userId, country, region })
        .sort({ createdAt: -1 })
        .lean()
        .catch((error) => {
            logger.warn(`[KpiInputs] ${name} unavailable`, { userId, country, region, error: error.message });
            return null;
        });

    const [suppressedDoc, removalDoc] = await Promise.all([
        latest(SuppressedListings, 'Suppressed listings'),
        latest(RemovalOrders, 'Removal orders')
    ]);

    return buildKpiInputs({
        waves,
        fbaInventoryDetailData: allData?.fbaInventoryDetailData,
        cogsData: allData?.cogsData,
        v2History: allData?.v2History,
        suppressedDoc,
        removalDoc
    });
}

module.exports = {
    buildKpiInputs,
    loadKpiInputs,
    buildStock,
    buildCogsAsins,
    buildAhrHistory,
    buildSuppressed,
    buildRemovals
};

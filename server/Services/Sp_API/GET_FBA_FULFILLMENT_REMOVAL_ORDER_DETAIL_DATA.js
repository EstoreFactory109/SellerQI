/**
 * FBA removal order detail (GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA).
 *
 * Feeds "Pending removals" on the FBA Aged Inventory report: stock already on
 * its way out of Amazon's warehouses, which must not be read as stock still
 * waiting for a decision. Stored in RemovalOrders, one snapshot per fetch.
 *
 * Amazon is known to fail this report intermittently (FATAL / CANCELLED) and
 * succeed on a fresh request, so the inline path re-requests once. The
 * scheduled path does not — its retry is the next day's run, which is soon
 * enough for a monthly report.
 *
 * NOT VERIFIED AGAINST A LIVE RESPONSE (every SP-API account available where
 * this was written returns 401). Headers are read through flatFileFields; a
 * file with no order-id or SKU column is stored as `unreadable`, never as
 * "no removals".
 */
const logger = require('../../utils/Logger');
const { parseAsync } = require('../../utils/asyncCsvParser');
const RemovalOrders = require('../../models/inventory/RemovalOrdersModel.js');
const { mapFlatFileRecords, toCount } = require('./flatFileFields.js');
const {
    createSpApiReport,
    checkSpApiStatusOnceNoDataOnCancel,
    downloadSpApiDocument,
    runSpApiReportInline,
} = require('./spApiReportAdapter.js');

const REPORT_TYPE = 'GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA';

/**
 * How far back removal requests are read. Long enough to catch an order stuck
 * in processing for months — exactly the one worth flagging — rather than only
 * the ones Amazon handles in a normal fortnight.
 */
const WINDOW_DAYS = 180;

/** Keeps a snapshot well inside Mongo's 16MB limit; pending lines are kept first. */
const MAX_LINES = 5000;

const FIELDS = {
    orderId: ['order-id', 'removal-order-id'],
    requestDate: ['request-date'],
    lastUpdatedDate: ['last-updated-date'],
    orderType: ['order-type', 'removal-order-type'],
    orderStatus: ['order-status', 'status'],
    sku: ['sku', 'seller-sku', 'merchant-sku'],
    fnsku: ['fnsku'],
    disposition: ['disposition'],
    requestedQuantity: ['requested-quantity'],
    cancelledQuantity: ['cancelled-quantity'],
    disposedQuantity: ['disposed-quantity'],
    shippedQuantity: ['shipped-quantity'],
    inProcessQuantity: ['in-process-quantity'],
    removalFee: ['removal-fee'],
    currency: ['currency'],
};

const QUANTITIES = ['requestedQuantity', 'cancelledQuantity', 'disposedQuantity', 'shippedQuantity', 'inProcessQuantity', 'removalFee'];

/** An order that will not move again. */
const isClosed = (status) => /complete|cancel/i.test(String(status || ''));

const requestBody = (marketplaceIds, now = new Date()) => ({
    reportType: REPORT_TYPE,
    marketplaceIds,
    dataStartTime: new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString(),
    dataEndTime: now.toISOString(),
});

/**
 * Parse the report body into what is stored. Exported for tests.
 *
 * Pending units are Amazon's in-process figure where it gives one, otherwise
 * what is left of the request once shipped, disposed and cancelled units are
 * taken off. Floored at zero, since those columns are updated at different
 * times and can briefly sum past the request.
 */
const parseRemovalOrders = async (buffer) => {
    const records = await parseAsync(buffer, { delimiter: '\t', columns: true, reportType: REPORT_TYPE });
    const { rows, headers, missing } = mapFlatFileRecords(records, FIELDS);

    const unreadable = records.length > 0 && (missing.includes('orderId') || missing.includes('sku'));
    const lines = unreadable ? [] : rows.filter((row) => row.orderId).map((row) => {
        const line = { ...row };
        for (const field of QUANTITIES) line[field] = toCount(row[field]);
        const remainder = line.requestedQuantity - line.shippedQuantity - line.disposedQuantity - line.cancelledQuantity;
        line.pendingQuantity = isClosed(line.orderStatus) ? 0 : Math.max(line.inProcessQuantity || remainder, 0);
        line.isPending = line.pendingQuantity > 0;
        return line;
    });

    const pending = lines.filter((line) => line.isPending);
    const kept = [...lines]
        .sort((a, b) => Number(b.isPending) - Number(a.isPending) || String(b.requestDate).localeCompare(String(a.requestDate)))
        .slice(0, MAX_LINES);

    return {
        lines: kept,
        lineCount: lines.length,
        pendingOrderCount: new Set(pending.map((line) => line.orderId)).size,
        pendingUnits: pending.reduce((sum, line) => sum + line.pendingQuantity, 0),
        headers,
        unreadable,
    };
};

const EMPTY = { lines: [], lineCount: 0, pendingOrderCount: 0, pendingUnits: 0, headers: [], unreadable: false };

const save = async (userId, country, region, parsed, window) => {
    if (parsed.unreadable) {
        logger.warn(`[${REPORT_TYPE}] no order-id/SKU column in the report; stored as unreadable`, { userId, country, region, headers: parsed.headers });
    }
    const doc = await RemovalOrders.create({
        User: userId,
        country,
        region,
        windowStart: window.dataStartTime,
        windowEnd: window.dataEndTime,
        ...parsed,
    });
    logger.info(`[${REPORT_TYPE}] stored ${parsed.lineCount} line(s), ${parsed.pendingOrderCount} order(s) pending`, { userId, country, region });
    return doc;
};

const getReport = async (accessToken, marketplaceIds, userId, baseuri, country, region) => {
    logger.info(`${REPORT_TYPE} starting`, { userId, country, region });
    if (!accessToken || !marketplaceIds) return false;

    const body = requestBody(marketplaceIds);
    const result = await runSpApiReportInline({ accessToken, baseuri, body, retries: 1 });
    if (result.status === 'FAILED') {
        logger.error(`${REPORT_TYPE} failed: ${result.note}`, { userId, country, region });
        return false;
    }

    try {
        const parsed = result.status === 'NO_DATA' ? EMPTY : await parseRemovalOrders(result.buffer);
        return await save(userId, country, region, parsed, body);
    } catch (error) {
        logger.error(`${REPORT_TYPE} could not be stored: ${error.message}`, { userId, country, region });
        return false;
    }
};

getReport.spApiAsync = {
    serviceName: 'removalOrdersData',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => {
        // Fixed at submit time so the stored window is the one Amazon was asked for.
        const body = requestBody(marketplaceIds);
        return [{
            service: 'removalOrdersData',
            paramsKey: 'default',
            params: {},
            marketplaceId: '',
            submit: async () => await createSpApiReport(accessToken, baseuri, body),
            checkStatusOnce: (reportId) => checkSpApiStatusOnceNoDataOnCancel(accessToken, reportId, baseuri),
            finalize: async (handle) => {
                if (!handle?.reportDocumentId) {
                    await save(userId, country, region, EMPTY, body);
                    return { empty: true };
                }
                const buffer = await downloadSpApiDocument(accessToken, handle.reportDocumentId, baseuri);
                await save(userId, country, region, await parseRemovalOrders(buffer), body);
                return { empty: false };
            },
        }];
    },
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = getReport;
module.exports.parseRemovalOrders = parseRemovalOrders;
module.exports.REPORT_TYPE = REPORT_TYPE;
module.exports.WINDOW_DAYS = WINDOW_DAYS;

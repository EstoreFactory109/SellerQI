/**
 * FBA customer returns (GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA).
 *
 * Feeds the tasks-logics.xlsx "Return reason spike" task: which reasons customers
 * give for returning each product. A standard FBA report under the same access as
 * the other FBA reports already fetched; nothing here is a new Amazon permission.
 *
 * NOT VERIFIED AGAINST A LIVE RESPONSE. Headers are read through flatFileFields; a
 * file with no reason or ASIN column is stored as `unreadable`, never as "no
 * returns". `reasonCounts` keeps the codes Amazon actually sent, so the reason
 * mapping in kpi/KpiRules.js can be checked against the first real run.
 */
const logger = require('../../utils/Logger');
const { parseAsync } = require('../../utils/asyncCsvParser');
const CustomerReturns = require('../../models/inventory/CustomerReturnsModel.js');
const { mapFlatFileRecords, toCount } = require('./flatFileFields.js');
const {
    createSpApiReport,
    checkSpApiStatusOnceNoDataOnCancel,
    downloadSpApiDocument,
    runSpApiReportInline,
} = require('./spApiReportAdapter.js');

const REPORT_TYPE = 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA';

/** 150 days: the 30-day spike rule, the 3-month return rate, and "refund given, item
 *  not returned", which looks for a return up to 120 days after a refund. */
const WINDOW_DAYS = 150;

/** Keeps a snapshot well inside Mongo's 16MB limit; newest returns are kept first. */
const MAX_LINES = 20000;

const FIELDS = {
    returnDate: ['return-date'],
    orderId: ['order-id'],
    sku: ['sku', 'seller-sku'],
    asin: ['asin'],
    fnsku: ['fnsku'],
    quantity: ['quantity'],
    reason: ['reason', 'return-reason'],
    status: ['status'],
    disposition: ['detailed-disposition', 'disposition'],
};

const requestBody = (marketplaceIds, now = new Date()) => ({
    reportType: REPORT_TYPE,
    marketplaceIds,
    dataStartTime: new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString(),
    dataEndTime: now.toISOString(),
});

/** Parse the report body into what is stored. Exported for tests. */
const parseCustomerReturns = async (buffer) => {
    const records = await parseAsync(buffer, { delimiter: '\t', columns: true, reportType: REPORT_TYPE });
    const { rows, headers, missing } = mapFlatFileRecords(records, FIELDS);

    const unreadable = records.length > 0 && (missing.includes('reason') || missing.includes('asin'));
    const lines = unreadable ? [] : rows.filter((row) => row.asin).map((row) => ({
        returnDate: String(row.returnDate || ''),
        orderId: String(row.orderId || ''),
        sku: String(row.sku || ''),
        asin: String(row.asin || '').trim(),
        fnsku: String(row.fnsku || ''),
        quantity: toCount(row.quantity) || 1,
        reason: String(row.reason || '').trim().toUpperCase(),
        status: String(row.status || ''),
        disposition: String(row.disposition || ''),
    }));

    const reasonCounts = {};
    for (const line of lines) reasonCounts[line.reason || 'NONE'] = (reasonCounts[line.reason || 'NONE'] || 0) + line.quantity;

    const kept = [...lines].sort((a, b) => b.returnDate.localeCompare(a.returnDate)).slice(0, MAX_LINES);
    return { lines: kept, lineCount: lines.length, reasonCounts, headers, unreadable };
};

const EMPTY = { lines: [], lineCount: 0, reasonCounts: {}, headers: [], unreadable: false };

const save = async (userId, country, region, parsed, window) => {
    if (parsed.unreadable) {
        logger.warn(`[${REPORT_TYPE}] no reason/ASIN column in the report; stored as unreadable`, { userId, country, region, headers: parsed.headers });
    }
    const doc = await CustomerReturns.create({
        User: userId,
        country,
        region,
        windowStart: window.dataStartTime,
        windowEnd: window.dataEndTime,
        ...parsed,
    });
    logger.info(`[${REPORT_TYPE}] stored ${parsed.lineCount} return line(s)`, { userId, country, region, reasonCounts: parsed.reasonCounts });
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
        const parsed = result.status === 'NO_DATA' ? EMPTY : await parseCustomerReturns(result.buffer);
        return await save(userId, country, region, parsed, body);
    } catch (error) {
        logger.error(`${REPORT_TYPE} could not be stored: ${error.message}`, { userId, country, region });
        return false;
    }
};

getReport.spApiAsync = {
    serviceName: 'customerReturnsData',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => {
        const body = requestBody(marketplaceIds);
        return [{
            service: 'customerReturnsData',
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
                await save(userId, country, region, await parseCustomerReturns(buffer), body);
                return { empty: false };
            },
        }];
    },
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = getReport;
module.exports.parseCustomerReturns = parseCustomerReturns;
module.exports.REPORT_TYPE = REPORT_TYPE;
module.exports.WINDOW_DAYS = WINDOW_DAYS;

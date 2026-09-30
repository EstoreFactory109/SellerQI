/**
 * Suppressed Listings Report (GET_MERCHANTS_LISTINGS_FYP_REPORT).
 *
 * Amazon's own list of the listings it is hiding from shoppers, with the reason
 * for each — the "Fix Your Products" page as a file. It is the recommended
 * source for the ESF catalogue's "Suppressed" count, which the stored listing
 * status (Active / Inactive / Incomplete) cannot supply.
 *
 * Stored in SuppressedListings, one snapshot per fetch. An empty result is
 * stored too: for this report, no rows means nothing is suppressed.
 *
 * NOT VERIFIED AGAINST A LIVE RESPONSE
 * Every SP-API account available where this was written returns 401, so the
 * headers are read through flatFileFields under several spellings. If no SKU
 * column is found the snapshot is stored as `unreadable` with the headers
 * Amazon did send, and the report says the data could not be read rather than
 * reporting zero suppressed listings.
 */
const logger = require('../../utils/Logger');
const { parseAsync } = require('../../utils/asyncCsvParser');
const SuppressedListings = require('../../models/products/SuppressedListingsModel.js');
const { mapFlatFileRecords } = require('./flatFileFields.js');
const {
    createSpApiReport,
    checkSpApiStatusOnceNoDataOnCancel,
    downloadSpApiDocument,
    runSpApiReportInline,
} = require('./spApiReportAdapter.js');

const REPORT_TYPE = 'GET_MERCHANTS_LISTINGS_FYP_REPORT';

/**
 * Keeps one snapshot well inside Mongo's 16MB document limit. A catalogue with
 * more suppressed listings than this has a problem the first 5,000 rows already
 * describe; the true total is kept in itemCount.
 */
const MAX_ITEMS = 5000;

const FIELDS = {
    sku: ['sku', 'seller-sku', 'merchant-sku'],
    asin: ['asin', 'asin1'],
    productName: ['product-name', 'item-name', 'title', 'product name'],
    status: ['status', 'listing-status', 'suppression-status'],
    reason: ['reason', 'status-reason', 'suppression-reason'],
    issueDescription: ['issue-description', 'alert-name', 'field-name', 'description'],
    condition: ['condition', 'item-condition'],
    statusChangeDate: ['status-change-date', 'status-changed-date', 'date'],
};

const requestBody = (marketplaceIds) => ({ reportType: REPORT_TYPE, marketplaceIds });

/** "At Risk" is still visible to shoppers; everything else in the file is not. */
const isAtRisk = (status) => /risk/i.test(String(status || ''));

/**
 * Parse the report body into what is stored. Exported for tests — this is the
 * part that can be checked without a live response.
 */
const parseSuppressedListings = async (buffer) => {
    const records = await parseAsync(buffer, { delimiter: '\t', columns: true, reportType: REPORT_TYPE });
    const { rows, headers, missing } = mapFlatFileRecords(records, FIELDS);

    // Rows without a SKU cannot be tied to a listing, and a file where no
    // column reads as a SKU cannot be interpreted at all.
    const unreadable = records.length > 0 && missing.includes('sku');
    const items = unreadable ? [] : rows.filter((row) => row.sku).map((row) => ({ ...row, isAtRisk: isAtRisk(row.status) }));

    return {
        items: items.slice(0, MAX_ITEMS),
        itemCount: items.length,
        suppressedCount: items.filter((item) => !item.isAtRisk).length,
        atRiskCount: items.filter((item) => item.isAtRisk).length,
        headers,
        unreadable,
    };
};

const save = async (userId, country, region, parsed) => {
    if (parsed.unreadable) {
        logger.warn(`[${REPORT_TYPE}] no SKU column in the report; stored as unreadable`, { userId, country, region, headers: parsed.headers });
    }
    const doc = await SuppressedListings.create({ User: userId, country, region, ...parsed });
    logger.info(`[${REPORT_TYPE}] stored ${parsed.itemCount} row(s), ${parsed.suppressedCount} suppressed`, { userId, country, region });
    return doc;
};

const EMPTY = { items: [], itemCount: 0, suppressedCount: 0, atRiskCount: 0, headers: [], unreadable: false };

const getReport = async (accessToken, marketplaceIds, userId, baseuri, country, region) => {
    logger.info(`${REPORT_TYPE} starting`, { userId, country, region });
    if (!accessToken || !marketplaceIds) return false;

    const result = await runSpApiReportInline({ accessToken, baseuri, body: requestBody(marketplaceIds), retries: 1 });
    if (result.status === 'FAILED') {
        logger.error(`${REPORT_TYPE} failed: ${result.note}`, { userId, country, region });
        return false;
    }

    try {
        const parsed = result.status === 'NO_DATA' ? EMPTY : await parseSuppressedListings(result.buffer);
        return await save(userId, country, region, parsed);
    } catch (error) {
        logger.error(`${REPORT_TYPE} could not be stored: ${error.message}`, { userId, country, region });
        return false;
    }
};

// Non-blocking adapter for the scheduled run, the same shape as the other
// report services. On DONE_NO_DATA the engine calls finalize with no document,
// which is stored as the empty snapshot it is.
getReport.spApiAsync = {
    serviceName: 'suppressedListingsData',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => ([{
        service: 'suppressedListingsData',
        paramsKey: 'default',
        params: {},
        marketplaceId: '',
        submit: async () => await createSpApiReport(accessToken, baseuri, requestBody(marketplaceIds)),
        checkStatusOnce: (reportId) => checkSpApiStatusOnceNoDataOnCancel(accessToken, reportId, baseuri),
        finalize: async (handle) => {
            if (!handle?.reportDocumentId) {
                await save(userId, country, region, EMPTY);
                return { empty: true };
            }
            const buffer = await downloadSpApiDocument(accessToken, handle.reportDocumentId, baseuri);
            await save(userId, country, region, await parseSuppressedListings(buffer));
            return { empty: false };
        },
    }]),
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = getReport;
module.exports.parseSuppressedListings = parseSuppressedListings;
module.exports.REPORT_TYPE = REPORT_TYPE;

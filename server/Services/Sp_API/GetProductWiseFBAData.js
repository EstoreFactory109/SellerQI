/**
 * GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA — Amazon's per-SKU FBA fee estimate: size
 * tier, dimensions, weight and the expected fulfilment fee.
 *
 * Every column is stored as Amazon sends it (ProductWiseFBADataService keeps the
 * last 3 batches), so the "FBA fee increase or size tier change" task compares
 * this week's snapshot with last week's without any header mapping to drift.
 *
 * Runs weekly on the schedule (ScheduleConfig 'fbaFeeEstimatesData'). The inline
 * path uses the shared bounded create -> poll -> download cycle, and the async
 * adapter lets the report engine poll it without holding a worker.
 */

const logger = require("../../utils/Logger");
const { parseAsync } = require('../../utils/asyncCsvParser');
// Use service layer for saving data (handles 16MB limit with separate collection)
const { saveProductWiseFBAData } = require('../inventory/ProductWiseFBADataService');
const { getReportOptions } = require('../../utils/ReportHeaderMapping');
const {
    runSpApiReportInline,
    createSpApiReport,
    checkSpApiStatusOnceNoDataOnCancel,
    downloadSpApiDocument,
} = require('./spApiReportAdapter.js');

const REPORT_TYPE = "GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA";
const WINDOW_DAYS = 30;

const requestBody = (marketplaceIds, now = new Date()) => {
    const end = new Date(now.getTime() - 2 * 60 * 1000);
    const body = {
        reportType: REPORT_TYPE,
        marketplaceIds,
        dataStartTime: new Date(end.getTime() - WINDOW_DAYS * 86400000).toISOString(),
        dataEndTime: end.toISOString(),
    };
    // English headers for non-English marketplaces
    const reportOptions = getReportOptions(REPORT_TYPE);
    if (reportOptions) body.reportOptions = reportOptions;
    return body;
};

/** Report body -> rows, every column kept as-is (blank for missing). Exported for tests. */
const parseFeeRows = async (buffer) => {
    const records = await parseAsync(buffer, { delimiter: '\t', columns: true, reportType: 'GetProductWiseFBAData' });
    return (records || []).map((item) => {
        const row = {};
        for (const key of Object.keys(item)) row[key] = item[key] || "";
        return row;
    });
};

const save = async (userId, country, region, rows) => {
    if (rows.length === 0) {
        logger.info(`[${REPORT_TYPE}] report contains no rows`, { userId, country, region });
        return { success: true, message: "Report completed successfully but contains no data", data: [] };
    }
    const saveResult = await saveProductWiseFBAData(userId, country, region, rows);
    if (!saveResult || !saveResult.success) {
        logger.error(`[${REPORT_TYPE}] could not be stored`, { userId, country, region });
        return { success: false, message: "Error saving report to database" };
    }
    logger.info(`[${REPORT_TYPE}] stored ${rows.length} row(s)`, { userId, country, region });
    return {
        success: true,
        message: "Report fetched and saved successfully",
        data: { userId, country, region, itemCount: saveResult.itemCount, batchId: saveResult.batchId },
    };
};

const getReport = async (accessToken, marketplaceIds, userId, baseuri, country, region) => {
    logger.info(`${REPORT_TYPE} starting`, { userId, country, region });
    if (!accessToken || !marketplaceIds) {
        return { success: false, message: "Credentials are missing" };
    }

    const result = await runSpApiReportInline({ accessToken, baseuri, body: requestBody(marketplaceIds), retries: 1 });
    if (result.status === 'FAILED') {
        logger.error(`${REPORT_TYPE} failed: ${result.note}`, { userId, country, region });
        return { success: false, message: result.note };
    }

    try {
        const rows = result.status === 'NO_DATA' ? [] : await parseFeeRows(result.buffer);
        return await save(userId, country, region, rows);
    } catch (error) {
        logger.error(`${REPORT_TYPE} could not be parsed or stored: ${error.message}`, { userId, country, region });
        return { success: false, message: error.message };
    }
};

getReport.spApiAsync = {
    serviceName: 'fbaFeeEstimatesData',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => {
        const body = requestBody(marketplaceIds);
        return [{
            service: 'fbaFeeEstimatesData',
            paramsKey: 'default',
            params: {},
            marketplaceId: '',
            submit: async () => await createSpApiReport(accessToken, baseuri, body),
            checkStatusOnce: (reportId) => checkSpApiStatusOnceNoDataOnCancel(accessToken, reportId, baseuri),
            finalize: async (handle) => {
                // No document: nothing to store. An empty batch would wipe last week's
                // snapshot out of the 3 kept, and with it the comparison.
                if (!handle?.reportDocumentId) return { empty: true };
                const buffer = await downloadSpApiDocument(accessToken, handle.reportDocumentId, baseuri);
                const rows = await parseFeeRows(buffer);
                await save(userId, country, region, rows);
                return { empty: rows.length === 0 };
            },
        }];
    },
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = getReport;
module.exports.parseFeeRows = parseFeeRows;
module.exports.REPORT_TYPE = REPORT_TYPE;

/**
 * GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA
 *
 * Syncs Amazon's Long-Term Storage Fee report (real per-ASIN fee dollars, not
 * just aging quantities) into LongTermStorageFeesModel.js. Follows the same
 * generate/poll/download/parse/save shape as GET_FBA_INVENTORY_PLANNING_DATA.js.
 *
 * REPORT TYPE — verified. Amazon's FBA report registry lists two distinct
 * reports and an earlier version of this file used the wrong one:
 *   - GET_FBA_STORAGE_FEE_CHARGES_DATA                      → MONTHLY storage fees
 *   - GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA  → LONG-TERM storage fees  ← this file
 *
 * COLUMN MAPPING — still UNVERIFIED. No public source documents this report's
 * exact TSV headers, and it has not yet been run against a live account. The
 * findField() candidate lists below are best-effort, informed by 4 historical
 * rows found in LONG_TERM_STORAGE_FEE_CHARGES_DATA (Sept 2025) whose shape was
 * { asin, productName, snapShotDate, quantity, amount, volume,
 *   surCharge: "271-300" (an aging-tier day range), rate_surCharge }.
 *
 * >>> BEFORE ENABLING THIS IN ScheduleConfig.js:
 * >>> run `node server/scripts/discoverLtsfReportHeaders.js` against a real
 * >>> account to dump the true header row, then correct the mappings here.
 *
 * Until then a mis-mapped column can only produce $0 amounts — never wrong
 * non-zero money — and validateMappedRows() below logs an ERROR with the real
 * headers if that happens, so the failure is loud rather than silent.
 */
const axios = require("axios");
const { parseAsync } = require('../../utils/asyncCsvParser');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const LongTermStorageFees = require('../../models/finance/LongTermStorageFeesModel.js');
const { getReportOptions, normalizeHeaders } = require('../../utils/ReportHeaderMapping');

const REPORT_TYPE = "GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA";

const generateReport = async (accessToken, marketplaceIds, baseuri) => {
    try {
        // Amazon issues this report roughly monthly; pull a wide enough
        // window to catch the latest snapshot regardless of exact billing date.
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000);
        const StartTime = new Date(EndTime.getTime() - 45 * 24 * 60 * 60 * 1000);
        const requestBody = {
            reportType: REPORT_TYPE,
            marketplaceIds: marketplaceIds,
            dataStartTime: StartTime.toISOString(),
            dataEndTime: EndTime.toISOString()
        };

        const reportOptions = getReportOptions(REPORT_TYPE);
        if (reportOptions) {
            requestBody.reportOptions = reportOptions;
        }

        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            requestBody,
            {
                headers: {
                    "x-amz-access-token": accessToken,
                    "Content-Type": "application/json",
                },
            }
        );

        return response.data.reportId;
    } catch (error) {
        logger.error(`Error generating ${REPORT_TYPE} report:`, error.response ? error.response.data : error.message);
        throw new Error("Failed to generate report");
    }
};

const checkReportStatus = async (accessToken, reportId, baseuri) => {
    try {
        const response = await axios.get(
            `https://${baseuri}/reports/2021-06-30/reports/${reportId}`,
            { headers: { "x-amz-access-token": accessToken } }
        );

        const status = response.data.processingStatus;
        const reportDocumentId = response.data.reportDocumentId || null;

        switch (status) {
            case "DONE":
                logger.info(`LTSF Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;
            case "FATAL":
                logger.error("LTSF report failed with a fatal error.");
                return false;
            case "CANCELLED":
                logger.error("LTSF report was cancelled by Amazon.");
                return false;
            case "IN_PROGRESS":
                return null;
            case "IN_QUEUE":
                return null;
            case "DONE_NO_DATA":
                logger.error("LTSF report completed but contains no data.");
                return false;
            case "FAILED":
                logger.error("LTSF report failed for an unknown reason.");
                return false;
            default:
                logger.error(`Unknown LTSF report status: ${status}`);
                return false;
        }
    } catch (error) {
        logger.error("Error checking LTSF report status:", error.response ? error.response.data : error.message);
        throw new Error("Failed to check report status");
    }
};

const getReportLink = async (accessToken, reportDocumentId, baseuri) => {
    try {
        const response = await axios.get(
            `https://${baseuri}/reports/2021-06-30/documents/${reportDocumentId}`,
            { headers: { "x-amz-access-token": accessToken } }
        );

        if (!response.data.url) {
            throw new Error("No valid report URL found");
        }

        return response.data.url;
    } catch (error) {
        logger.error("Error downloading LTSF report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to download report");
    }
};

const getReport = async (accessToken, marketplaceIds, userId, baseuri, Country, Region) => {
    logger.info(`${REPORT_TYPE} starting`);

    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    try {
        const reportId = await generateReport(accessToken, marketplaceIds, baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        let reportDocumentId = null;
        let retries = 30;

        while (!reportDocumentId && retries > 0) {
            logger.info(`Checking LTSF report status... (Retries left: ${retries})`);
            await new Promise((resolve) => setTimeout(resolve, 20000));
            reportDocumentId = await checkReportStatus(accessToken, reportId, baseuri);
            if (reportDocumentId === false) {
                return {
                    success: false,
                    message: "Error in generating the report",
                };
            }
            retries--;
        }

        if (!reportDocumentId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return {
                success: false,
                message: "Report did not complete within 5 minutes",
            };
        }

        return await _processLtsfDocument(accessToken, reportDocumentId, baseuri, userId, Country, Region);

    } catch (error) {
        logger.error(`Error in ${REPORT_TYPE} getReport:`, error.message);
        throw new ApiError(500, error.message);
    }
};

// Extracted post-poll step (download → parse TSV → save). Shared by inline + P8 async.
async function _processLtsfDocument(accessToken, reportDocumentId, baseuri, userId, Country, Region) {
    const reportUrl = await getReportLink(accessToken, reportDocumentId, baseuri);

    const fullReport = await axios({
        method: "GET",
        url: reportUrl,
        responseType: "arraybuffer",
    });

    if (!fullReport || !fullReport.data) {
        throw new ApiError(500, "Internal server error in generating the report");
    }

    const refinedData = await convertTSVToJson(fullReport.data);

    if (!refinedData || refinedData.length === 0) {
        logger.error(new ApiError(408, "LTSF report completed but contains no data"));
        return {
            success: false,
            message: "Report completed but contains no data",
        };
    }

    if (refinedData.length > 0) {
        logger.debug("LTSF - Available fields in report:", {
            fields: Object.keys(refinedData[0]),
            sampleItem: refinedData[0],
            totalRecords: refinedData.length
        });
    }

    const result = [];

    refinedData.forEach((item) => {
        // Missing/empty -> "0" so required String fields on LongTermStorageFeesModel
        // never fail validation, even if a given locale's report omits a column.
        const getValue = (value, fallback = "0") => {
            if (value === null || value === undefined || value === '' || value === 'undefined') {
                return fallback;
            }
            const trimmed = String(value).trim();
            return trimmed === '' ? fallback : trimmed;
        };

        const findField = (item, ...possibleNames) => {
            for (const name of possibleNames) {
                if (item[name] !== undefined) {
                    return item[name];
                }
            }
            return null;
        };

        const asin = item.asin || item.ASIN || item['asin'] || "";
        if (!asin) {
            return; // Skip rows without an ASIN
        }

        result.push({
            asin: asin,
            productName: getValue(findField(item,
                "product_name", "product-name", "productName", "item_name"
            ), "N/A"),
            snapShotDate: getValue(findField(item,
                "snapshot_date", "snapshot-date", "snapshotDate", "date"
            )),
            quantity: getValue(findField(item,
                "qty_charged", "qty-charged", "quantity_charged", "quantity-charged",
                "qty_charged_12_mo_long_term_storage_fee", "qty-charged-12-mo-long-term-storage-fee",
                "qty_charged_long_term_storage_fee", "qty-charged-long-term-storage-fee",
                "quantity", "qty", "units_charged", "units-charged"
            )),
            // The field the feature actually consumes (ltsfAmountMap in Analyse.js).
            amount: getValue(findField(item,
                "amount_charged", "amount-charged", "amount",
                "12_mo_long_term_storage_fee", "12-mo-long-term-storage-fee",
                "long_term_storage_fee", "long-term-storage-fee",
                "long_term_storage_fee_charged", "long-term-storage-fee-charged",
                "estimated_amount", "estimated-amount", "fee_amount", "fee-amount",
                "total_fee", "total-fee", "charge_amount", "charge-amount"
            )),
            volume: getValue(findField(item,
                "per_unit_volume", "per-unit-volume", "volume", "unit_volume",
                "item_volume", "item-volume"
            )),
            // Historical rows stored an aging-tier DAY RANGE here (e.g. "271-300"),
            // not a dollar figure — hence the age/tier candidates alongside surcharge ones.
            surCharge: getValue(findField(item,
                "surcharge_age_tier", "surcharge-age-tier", "inventory_age_tier", "inventory-age-tier",
                "age_range", "age-range", "days_of_supply_range", "surcharge_amount",
                "surcharge-amount", "surcharge", "aged_inventory_surcharge", "aged-inventory-surcharge"
            )),
            rate_surCharge: getValue(findField(item,
                "surcharge_rate", "surcharge-rate", "rate_surcharge", "rate-surcharge",
                "12_mo_surcharge_rate", "12-mo-surcharge-rate",
                "per_unit_fee", "per-unit-fee", "rate", "base_rate", "base-rate"
            )),
        });
    });

    // Fail LOUDLY on a bad column mapping. Without this, an unmatched `amount`
    // column silently becomes "0" for every row and the Top Opportunities
    // feature reports $0 long-term storage fees as if that were the truth.
    validateMappedRows(result, refinedData, { userId, Country, Region });

    const createReport = await LongTermStorageFees.create({
        User: userId,
        region: Region,
        country: Country,
        data: result
    });
    if (!createReport) {
        logger.error(new ApiError(500, "Internal server error in generating the report"));
        return false;
    }

    logger.info("LTSF data saved successfully");
    logger.info(`${REPORT_TYPE} ended`);
    return createReport;
}

/**
 * Warn loudly when the column mapping clearly didn't match the real report.
 * Amazon returned rows, but every mapped amount/quantity came out as "0" —
 * that means the findField() candidates missed, not that the seller owes $0.
 *
 * @param {Array} mapped - rows after field mapping
 * @param {Array} raw - rows straight from the TSV parser
 * @param {Object} ctx - { userId, Country, Region } for the log
 */
function validateMappedRows(mapped, raw, ctx = {}) {
    if (!Array.isArray(mapped) || mapped.length === 0) return;

    const isZero = (v) => v === undefined || v === null || String(v).trim() === '' || Number(v) === 0;
    const allAmountsZero = mapped.every(r => isZero(r.amount));
    const allQtyZero = mapped.every(r => isZero(r.quantity));

    if (!allAmountsZero && !allQtyZero) return;

    logger.error(
        `[LTSF] Column mapping likely FAILED for ${REPORT_TYPE} — Amazon returned ${mapped.length} row(s) ` +
        `but every mapped ${allAmountsZero ? 'amount' : 'quantity'} is zero/absent. ` +
        `Long-term storage fees will read as $0 until the mapping is corrected. ` +
        `Compare the real headers below against the findField() candidates in this file ` +
        `(or run server/scripts/discoverLtsfReportHeaders.js).`,
        {
            ...ctx,
            allAmountsZero,
            allQtyZero,
            actualHeaders: raw && raw[0] ? Object.keys(raw[0]) : [],
            sampleRawRow: raw && raw[0] ? raw[0] : null,
            sampleMappedRow: mapped[0],
        }
    );
}

/**
 * Convert TSV buffer to JSON using the shared async streaming parser.
 */
async function convertTSVToJson(tsvBuffer) {
    try {
        const records = await parseAsync(tsvBuffer, {
            delimiter: '\t',
            columns: true,
            reportType: REPORT_TYPE
        });

        if (records.length > 0) {
            const normalizedRecords = records.map(record => {
                const normalized = {};
                for (const [key, value] of Object.entries(record)) {
                    const normalizedKey = normalizeHeaders([key])[0] || key;
                    normalized[normalizedKey] = value;
                }
                return normalized;
            });
            return normalizedRecords;
        }

        return records;

    } catch (error) {
        logger.error('LTSF TSV parsing failed', {
            error: error.message,
            errorCode: error.code
        });

        logger.info('Attempting fallback TSV parsing...');
        try {
            return convertTSVToJsonLegacy(tsvBuffer);
        } catch (fallbackError) {
            logger.error('Fallback TSV parsing also failed', { error: fallbackError.message });
            return [];
        }
    }
}

function convertTSVToJsonLegacy(tsvBuffer) {
    const tsv = tsvBuffer.toString("utf-8");
    const rows = tsv.split("\n").filter(row => row.trim() !== "");

    if (rows.length === 0) return [];

    const headers = rows[0].split("\t");
    const jsonData = rows.slice(1).map(row => {
        const values = row.split("\t");
        return headers.reduce((obj, header, index) => {
            obj[header] = values[index] || "";
            return obj;
        }, {});
    });

    return jsonData;
}

// P8: Non-blocking async adapter — reuses _processLtsfDocument (same code as inline).
const { checkSpApiStatusOnce } = require('./spApiReportAdapter.js');
getReport.spApiAsync = {
    serviceName: 'ltsfData',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => ([{
        service: 'ltsfData',
        paramsKey: 'default',
        params: {},
        marketplaceId: '',
        submit: async () => await generateReport(accessToken, marketplaceIds, baseuri),
        checkStatusOnce: (reportId) => checkSpApiStatusOnce(accessToken, reportId, baseuri),
        finalize: async (handle) => {
            await _processLtsfDocument(accessToken, handle.reportDocumentId, baseuri, userId, country, region);
            return { empty: false };
        },
    }]),
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

// Default export stays the service function so ScheduleConfig's isDefaultExport
// contract keeps working. The polling primitives are attached as properties so
// scripts/discoverLtsfReportHeaders.js can reuse them instead of duplicating the
// generate/poll/download logic.
getReport.REPORT_TYPE = REPORT_TYPE;
getReport.generateReport = generateReport;
getReport.checkReportStatus = checkReportStatus;
getReport.getReportLink = getReportLink;
getReport.convertTSVToJson = convertTSVToJson;
getReport.validateMappedRows = validateMappedRows;

module.exports = getReport;

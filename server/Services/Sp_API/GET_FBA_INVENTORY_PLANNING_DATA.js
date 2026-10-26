const axios = require("axios");
const { parseAsync, yieldToEventLoop } = require('../../utils/asyncCsvParser');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const FbaInventoryPlanningData = require('../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const UserModel = require('../../models/user-auth/userModel.js');
const { getReportOptions, normalizeHeaders } = require('../../utils/ReportHeaderMapping');

const generateReport = async (accessToken, marketplaceIds, baseuri) => {
    // console.log(baseuri)
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 7 days before end
        const reportType = "GET_FBA_INVENTORY_PLANNING_DATA";
        const requestBody = {
            reportType: reportType,
            marketplaceIds: marketplaceIds,
            dataStartTime: StartTime.toISOString(),
            dataEndTime: EndTime.toISOString()
        };
        
        // Add reportOptions to request English headers (for non-English marketplaces)
        const reportOptions = getReportOptions(reportType);
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
        logger.error("Error generating report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to generate report");
    }
};

const checkReportStatus = async (accessToken, reportId, baseuri) => {
    try {

        const response = await axios.get(
            `https://${baseuri}/reports/2021-06-30/reports/${reportId}`,
            {
                headers: { "x-amz-access-token": accessToken },
            }
        );

        const status = response.data.processingStatus;
        const reportDocumentId = response.data.reportDocumentId || null;

        // console.log(`🔄 Report Status: ${status}`);

                  switch (status) {
              case "DONE":
                logger.info(`Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;

            case "FATAL":
                logger.error("Report failed with a fatal error.");
                return false;

            case "CANCELLED":
                logger.error("Report was cancelled by Amazon.");
                return false;

            case "IN_PROGRESS":
                return null;

            case "IN_QUEUE":
                return null;

            case "DONE_NO_DATA":
                logger.error("Report completed but contains no data.");
                return false;

            case "FAILED":
                logger.error("Report failed for an unknown reason.");
                return false;

            default:
                logger.error(`Unknown report status: ${status}`);
                return false;
        }
    } catch (error) {
        logger.error("Error checking report status:", error.response ? error.response.data : error.message);
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
        logger.error("Error downloading report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to download report");
    }
};

const getReport = async (accessToken, marketplaceIds, userId, baseuri, Country, Region) => {
    logger.info("GET_FBA_INVENTORY_PLANNING_DATA starting");
    
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
            logger.info(`Checking report status... (Retries left: ${retries})`);
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

        return await _processFbaPlanningDocument(accessToken, reportDocumentId, baseuri, userId, Country, Region);

    } catch (error) {
        logger.error("Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

/**
 * One normalised report row -> what is stored. Pure; exported for tests.
 * @returns {Object|null} null for a row without an ASIN
 */
function mapPlanningRow(item) {
    // Helper function to convert empty strings to "0" for required fields
    // Handles null, undefined, empty string, and missing fields
    const getValue = (value) => {
        if (value === null || value === undefined || value === '' || value === 'undefined') {
            return "0";
        }
        const trimmed = String(value).trim();
        return trimmed === '' ? "0" : trimmed;
    };

    // Helper to find field with different possible names (Amazon uses different naming conventions)
    const findField = (item, ...possibleNames) => {
        for (const name of possibleNames) {
            if (item[name] !== undefined) {
                return item[name];
            }
        }
        return null;
    };

    const rawOrNull = (value) => {
        if (value === null || value === undefined) return null;
        const trimmed = String(value).trim();
        return trimmed === '' ? null : trimmed;
    };

    // Skip items without ASIN
    const asin = item.asin || item.ASIN || item['asin'] || "";
    if (!asin) {
        return null; // Skip this item
    }

    return {
        asin: asin,
        quantity_to_be_charged_ais_181_210_days: getValue(findField(item, 
            "quantity-to-be-charged-ais-181-210-days",
            "quantity_to_be_charged_ais_181_210_days",
            "quantityToBeChargedAis181210Days"
        )),
        quantity_to_be_charged_ais_211_240_days: getValue(findField(item,
            "quantity-to-be-charged-ais-211-240-days",
            "quantity_to_be_charged_ais_211_240_days",
            "quantityToBeChargedAis211240Days"
        )),
        quantity_to_be_charged_ais_241_270_days: getValue(findField(item,
            "quantity-to-be-charged-ais-241-270-days",
            "quantity_to_be_charged_ais_241_270_days",
            "quantityToBeChargedAis241270Days"
        )),
        quantity_to_be_charged_ais_271_300_days: getValue(findField(item,
            "quantity-to-be-charged-ais-271-300-days",
            "quantity_to_be_charged_ais_271_300_days",
            "quantityToBeChargedAis271300Days"
        )),
        quantity_to_be_charged_ais_301_330_days: getValue(findField(item,
            "quantity-to-be-charged-ais-301-330-days",
            "quantity_to_be_charged_ais_301_330_days",
            "quantityToBeChargedAis301330Days"
        )),
        quantity_to_be_charged_ais_331_365_days: getValue(findField(item,
            "quantity-to-be-charged-ais-331-365-days",
            "quantity_to_be_charged_ais_331_365_days",
            "quantityToBeChargedAis331365Days"
        )),
        // Amazon's US report (seen live Oct 2026) splits 365+ into 366-455 and
        // 456+; other marketplaces still send 365+. Every reader uses 365+, so
        // the split buckets are summed into it.
        quantity_to_be_charged_ais_365_plus_days: findField(item,
            "quantity-to-be-charged-ais-365-plus-days",
            "quantity_to_be_charged_ais_365_plus_days",
            "quantityToBeChargedAis365PlusDays"
        ) != null
            ? getValue(findField(item, "quantity-to-be-charged-ais-365-plus-days", "quantity_to_be_charged_ais_365_plus_days", "quantityToBeChargedAis365PlusDays"))
            : String((Number(getValue(findField(item, "quantity_to_be_charged_ais_366_455_days", "quantity-to-be-charged-ais-366-455-days"))) || 0)
                + (Number(getValue(findField(item, "quantity_to_be_charged_ais_456_plus_days", "quantity-to-be-charged-ais-456-plus-days"))) || 0)),
        // Amazon's own estimate of the aged inventory surcharge, summed over
        // every estimated-ais-* bucket (tasks-logics.xlsx "Aged inventory
        // surcharge"). null when the report has no estimate columns.
        estimated_ais_total: (() => {
            const keys = Object.keys(item).filter(k => /^estimated[-_]ais[-_]/.test(k));
            if (keys.length === 0) return null;
            return keys.reduce((sum, k) => sum + (Number(String(item[k] || '').replace(/[^0-9.-]/g, '')) || 0), 0);
        })(),
        inv_age_91_to_180_days: rawOrNull(findField(item, "inv-age-91-to-180-days", "inv_age_91_to_180_days")),
        units_shipped_t90: rawOrNull(findField(item, "units-shipped-t90", "units_shipped_t90")),
        unfulfillable_quantity: getValue(findField(item,
            "unfulfillable-quantity",
            "unfulfillable_quantity",
            "unfulfillableQuantity"
        )),
        // Low-inventory-level fee inputs (tasks-logics.xlsx). Amazon's column
        // names are not publicly documented, so null (not "0") when the
        // column is absent: the task must read "no data", not "0 days".
        // The report's real headers are stored on the document (`headers`)
        // to settle the names from the first live run.
        historical_days_of_supply_short: rawOrNull(findField(item,
            "short-term-historical-days-of-supply",
            "short_term_historical_days_of_supply",
            "historical-days-of-supply-short-term"
        )),
        historical_days_of_supply_long: rawOrNull(findField(item,
            "long-term-historical-days-of-supply",
            "long_term_historical_days_of_supply",
            "historical-days-of-supply-long-term"
        )),
        historical_days_of_supply: rawOrNull(findField(item,
            "historical-days-of-supply",
            "historical_days_of_supply"
        )),
        // Live US headers (Oct 2026): "Low-Inventory-Level fee applied in current
        // week?" and "Exempted from Low-Inventory-Level fee?", normalised below.
        low_inventory_level_fee_applied: rawOrNull(findField(item,
            "low_inventory_level_fee_applied_in_current_week?",
            "low-inventory-level-fee-applied",
            "low_inventory_level_fee_applied",
            "low-inventory-level-fee-applied-in-current-week"
        )),
        low_inventory_level_fee_exempt: rawOrNull(findField(item,
            "exempted_from_low_inventory_level_fee?",
            "exempted-from-low-inventory-level-fee"
        )),
    };
}

// Extracted post-poll step (download → parse TSV → save). Shared by inline + P8 async.
async function _processFbaPlanningDocument(accessToken, reportDocumentId, baseuri, userId, Country, Region) {
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
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return {
                success: false,
                message: "Report completed but contains no data",
            };
        }

        // Log the first item's keys to debug field mapping issues
        if (refinedData.length > 0) {
            logger.debug("FBA Inventory Planning - Available fields in report:", {
                fields: Object.keys(refinedData[0]),
                sampleItem: refinedData[0],
                totalRecords: refinedData.length
            });
        }

        const result = [];

        refinedData.forEach((item) => {
            const row = mapPlanningRow(item);
            if (row) result.push(row);
        });

        const createReport = await FbaInventoryPlanningData.create({
            User: userId,
            region: Region,
            country: Country,
            data: result,
            // What Amazon actually sent, so an unmapped column can be diagnosed from the data.
            headers: Object.keys(refinedData[0] || {})
        })
        if (!createReport) {
            logger.error(new ApiError(500, "Internal server error in generating the report"));
            return false;
        }

        logger.info("Data saved successfully");
        logger.info("GET_FBA_INVENTORY_PLANNING_DATA ended");
        return createReport;
}

/**
 * Convert TSV buffer to JSON using async streaming parser.
 * Uses async parsing to prevent blocking the event loop during large file processing.
 */
async function convertTSVToJson(tsvBuffer) {
    try {
        const records = await parseAsync(tsvBuffer, {
            delimiter: '\t',
            columns: true,
            reportType: 'GET_FBA_INVENTORY_PLANNING_DATA'
        });

        // Apply header normalization after parsing
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
        logger.error('TSV parsing failed', { 
            error: error.message,
            errorCode: error.code
        });

        // Fallback to legacy parsing if async parse fails
        logger.info('Attempting fallback TSV parsing...');
        try {
            return convertTSVToJsonLegacy(tsvBuffer);
        } catch (fallbackError) {
            logger.error('Fallback TSV parsing also failed', { error: fallbackError.message });
            return [];
        }
    }
}

/**
 * Legacy TSV parser as fallback
 */
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

// P8: Non-blocking async adapter — reuses _processFbaPlanningDocument (same code as inline).
const { checkSpApiStatusOnce } = require('./spApiReportAdapter.js');
getReport.spApiAsync = {
    serviceName: 'fbaInventoryPlanningData',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => ([{
        service: 'fbaInventoryPlanningData',
        paramsKey: 'default',
        params: {},
        marketplaceId: '',
        submit: async () => await generateReport(accessToken, marketplaceIds, baseuri),
        checkStatusOnce: (reportId) => checkSpApiStatusOnce(accessToken, reportId, baseuri),
        finalize: async (handle) => {
            await _processFbaPlanningDocument(accessToken, handle.reportDocumentId, baseuri, userId, country, region);
            return { empty: false };
        },
    }]),
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = getReport;
module.exports.mapPlanningRow = mapPlanningRow;
module.exports.convertTSVToJson = convertTSVToJson;

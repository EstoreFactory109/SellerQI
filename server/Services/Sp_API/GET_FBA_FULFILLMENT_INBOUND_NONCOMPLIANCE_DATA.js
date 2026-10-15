const axios = require("axios");
const { parseAsync, yieldToEventLoop } = require('../../utils/asyncCsvParser');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Model = require('../../models/inventory/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js');
const { getReportOptions, normalizeHeaders } = require('../../utils/ReportHeaderMapping');


const generateReport = async (accessToken, marketplaceIds,baseuri) => {
    // console.log(marketplaceIds);
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours before now (1 day delay for data accuracy)
        const StartTime = new Date(now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000); // 6 months before now
        const reportType = "GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA";
        const requestBody = {
            reportType: reportType,
            marketplaceIds: marketplaceIds,
            dataStartTime: StartTime.toISOString(),
            dataEndTime: EndTime.toISOString(),
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

// Returned by checkReportStatus for DONE_NO_DATA. Distinct from false (failed)
// and null (still processing) so the poll loop can save an empty snapshot.
const NO_DATA = 'DONE_NO_DATA';

const checkReportStatus = async (accessToken, reportId,baseuri) => {
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
                // Amazon's answer when there are no inbound problems: a result
                // to save as an empty snapshot, not a failure.
                logger.info("Report completed with no data (no inbound issues).");
                return NO_DATA;

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

const getReportLink = async (accessToken, reportDocumentId,baseuri) => {
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

const getReport = async (accessToken, marketplaceIds, userId, baseuri,country, region) => {
    logger.info("GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA starting");
    
    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    try {
        const reportId = await generateReport(accessToken, marketplaceIds,baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        let reportDocumentId = null;
        let retries = 30;

        while (!reportDocumentId && retries > 0) {
            logger.info(`Checking report status... (Retries left: ${retries})`);
            await new Promise((resolve) => setTimeout(resolve, 60000));
            reportDocumentId = await checkReportStatus(accessToken, reportId,baseuri);
            if (reportDocumentId === false) {
                return {
                    success: false,
                    message: "Error in generating the report",
                };
            }
            if (reportDocumentId === NO_DATA) {
                return await _saveInboundErrors([], userId, country, region);
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

        return await _processInboundDocument(accessToken, reportDocumentId, baseuri, userId, country, region);

    } catch (error) {
        logger.error("Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

// Extracted post-poll step (download → parse TSV → save). Shared by inline + P8 async.
// Saves a document even when there are no in-window issues (ErrorData: []).
async function _processInboundDocument(accessToken, reportDocumentId, baseuri, userId, country, region) {
        const reportUrl = await getReportLink(accessToken, reportDocumentId,baseuri);

        const fullReport = await axios({
            method: "GET",
            url: reportUrl,
            responseType: "arraybuffer",
        });

        if (!fullReport || !fullReport.data) {
            throw new ApiError(500, "Internal server error in generating the report");
        }

        const refinedData = await convertTSVToJson(fullReport.data);

        const errorData = [];
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

        refinedData.forEach(item => {
            const dateStr = item["issue-reported-date"];
            if (!dateStr) return;
            const inputDate = new Date(dateStr);
            inputDate.setUTCHours(0, 0, 0, 0);

            if (inputDate >= thirtyDaysAgo && inputDate <= today) {
                errorData.push({
                    issueReportedDate: item["issue-reported-date"],
                    shipmentCreationDate: item["shipment-creation-date"],
                    asin: item["asin"],
                    problemType: item["problem-type"]
                });
            }
        });

        return await _saveInboundErrors(errorData, userId, country, region);
}

// Save step shared by a downloaded report and DONE_NO_DATA. An empty errorData
// is saved too: returning without a write left the last report that HAD issues
// as the newest document, so readers kept showing problems already resolved.
async function _saveInboundErrors(errorData, userId, country, region) {
        if (errorData.length === 0) {
            logger.info("GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA: no issues in the last 30 days; saving an empty snapshot");
        }

        const createData = await GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA_Model.create({
            userId,
            country,
            region,
            ErrorData: errorData
        });

        if (!createData) {
            return false;
        }

        logger.info("Data saved successfully");
        logger.info("GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA ended");
        return createData;
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
            reportType: 'GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA'
        });

        return records;

    } catch (error) {
        logger.error('[GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA] TSV parsing failed', { 
            error: error.message 
        });

        // Fallback to legacy parsing
        try {
            return convertTSVToJsonLegacy(tsvBuffer);
        } catch (fallbackError) {
            logger.error('[GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA] Fallback parsing also failed', { 
                error: fallbackError.message 
            });
            // Thrown, not `return []`: an empty result is now saved as "no
            // problems", so an unreadable report must not be mistaken for one.
            throw new Error(`[GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA] report could not be parsed: ${fallbackError.message}`);
        }
    }
}

function convertTSVToJsonLegacy(tsvBuffer) {
    const tsv = tsvBuffer.toString("utf-8");
    const rows = tsv.split("\n").filter(row => row.trim() !== "");
    if (rows.length === 0) return [];
    const headers = rows[0].split("\t");
    return rows.slice(1).map(row => {
        const values = row.split("\t");
        return headers.reduce((obj, header, index) => {
            obj[header] = values[index] || "";
            return obj;
        }, {});
    });
}

// P8: Non-blocking async adapter — reuses _processInboundDocument (same code as inline).
const { checkSpApiStatusOnce } = require('./spApiReportAdapter.js');
getReport.spApiAsync = {
    serviceName: 'inboundNonComplianceData',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => ([{
        service: 'inboundNonComplianceData',
        paramsKey: 'default',
        params: {},
        marketplaceId: '',
        submit: async () => await generateReport(accessToken, marketplaceIds, baseuri),
        checkStatusOnce: (reportId) => checkSpApiStatusOnce(accessToken, reportId, baseuri),
        finalize: async (handle) => {
            // DONE_NO_DATA arrives here with no document to download. Passing it
            // to the download threw, so the run was recorded FAILED and nothing
            // replaced the stale issues.
            if (!handle?.reportDocumentId) {
                await _saveInboundErrors([], userId, country, region);
                return { empty: true };
            }
            const r = await _processInboundDocument(accessToken, handle.reportDocumentId, baseuri, userId, country, region);
            return { empty: !!r && Array.isArray(r.ErrorData) && r.ErrorData.length === 0 };
        },
    }]),
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = getReport;

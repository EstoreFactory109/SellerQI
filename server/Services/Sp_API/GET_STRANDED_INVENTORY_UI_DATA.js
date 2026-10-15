const axios = require("axios");
const { parseAsync, yieldToEventLoop } = require('../../utils/asyncCsvParser');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
// Use service layer for saving data (handles 16MB limit with separate collection)
const { saveStrandedInventoryUIData } = require('../inventory/StrandedInventoryUIDataService');
const { getReportOptions, normalizeHeaders } = require('../../utils/ReportHeaderMapping');

const generateReport = async (accessToken, marketplaceIds,baseuri) => {
    // console.log(marketplaceIds);
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours before now (1 day delay for data accuracy)
        const StartTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days before now
        const reportType = "GET_STRANDED_INVENTORY_UI_DATA";
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
                // Amazon's answer when nothing is stranded: a result to save as
                // an empty snapshot, not a failure.
                logger.info("Report completed with no data (nothing stranded).");
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

const getReport = async (accessToken, marketplaceIds, userId,baseuri,country,region) => {
    logger.info("GET_STRANDED_INVENTORY_UI_DATA starting");
    
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
            await new Promise((resolve) => setTimeout(resolve, 20000));
            reportDocumentId = await checkReportStatus(accessToken, reportId,baseuri);
            if (reportDocumentId === false) {
                return {
                    success: false,
                    message: "Error in generating the report",
                };
            }
            if (reportDocumentId === NO_DATA) {
                return await _saveStrandedItems([], userId, country, region);
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

        return await _processStrandedDocument(accessToken, reportDocumentId, baseuri, userId, country, region);

    } catch (error) {
        logger.error("Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

// Extracted post-poll step (download → parse TSV → save). Shared by inline + P8 async.
async function _processStrandedDocument(accessToken, reportDocumentId, baseuri, userId, country, region) {
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

        

        let strandedUIdata=[]

        refinedData.forEach((item) => {
            const data={
                asin:item.asin,
                status_primary:item['status-primary'],
                stranded_reason:item['stranded-reason']
            }
            strandedUIdata.push(data)
        })

        return await _saveStrandedItems(strandedUIdata, userId, country, region);
}

// Save step shared by a downloaded report and DONE_NO_DATA. An empty array is
// saved too (as an empty-snapshot marker) — see saveStrandedInventoryUIData.
async function _saveStrandedItems(strandedUIdata, userId, country, region) {
        // Save to database using service layer (handles 16MB limit with separate collection)
        const saveResult = await saveStrandedInventoryUIData(userId, country, region, strandedUIdata);

        if(!saveResult || !saveResult.success){
            logger.error(new ApiError(500, "Error in saving the data"));
            return false;
        }
        logger.info("Data saved successfully");
        logger.info("GET_STRANDED_INVENTORY_UI_DATA ended");
        return {
            _id: saveResult.batchId,
            User: userId,
            region: region,
            country: country,
            itemCount: saveResult.itemCount
        };
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
            reportType: 'GET_STRANDED_INVENTORY_UI_DATA'
        });

        return records;

    } catch (error) {
        logger.error('[GET_STRANDED_INVENTORY_UI_DATA] TSV parsing failed', { 
            error: error.message 
        });

        // Fallback to legacy parsing
        try {
            return convertTSVToJsonLegacy(tsvBuffer);
        } catch (fallbackError) {
            logger.error('[GET_STRANDED_INVENTORY_UI_DATA] Fallback parsing also failed', { 
                error: fallbackError.message 
            });
            // Thrown, not `return []`: an empty result is now saved as "no
            // problems", so an unreadable report must not be mistaken for one.
            throw new Error(`[GET_STRANDED_INVENTORY_UI_DATA] report could not be parsed: ${fallbackError.message}`);
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

// P8: Non-blocking async adapter — reuses _processStrandedDocument (same code as inline).
const { checkSpApiStatusOnce } = require('./spApiReportAdapter.js');
getReport.spApiAsync = {
    serviceName: 'strandedInventoryData',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => ([{
        service: 'strandedInventoryData',
        paramsKey: 'default',
        params: {},
        marketplaceId: '',
        submit: async () => await generateReport(accessToken, marketplaceIds, baseuri),
        checkStatusOnce: (reportId) => checkSpApiStatusOnce(accessToken, reportId, baseuri),
        finalize: async (handle) => {
            // DONE_NO_DATA arrives here with no document to download. It used to
            // be passed straight to the download, which threw and recorded the
            // run as FAILED — and saved nothing, so stale stranded rows lived on.
            if (!handle?.reportDocumentId) {
                await _saveStrandedItems([], userId, country, region);
                return { empty: true };
            }
            const r = await _processStrandedDocument(accessToken, handle.reportDocumentId, baseuri, userId, country, region);
            return { empty: !!r && r.itemCount === 0 };
        },
    }]),
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = getReport;

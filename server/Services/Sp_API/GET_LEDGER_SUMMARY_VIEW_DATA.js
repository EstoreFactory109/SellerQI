const axios = require("axios");
const zlib = require("zlib");
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const { parseAsync, yieldToEventLoop } = require('../../utils/asyncCsvParser');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
// Use service layer for saving data (handles 16MB limit with separate collection)
const { saveLedgerSummaryViewData } = require('../Finance/LedgerSummaryViewService');
const { getReportOptions, normalizeHeaders } = require('../../utils/ReportHeaderMapping');

const generateReport = async (accessToken, marketplaceIds, baseuri) => {
    try {
        // Fixed date range: Last 9 months (for Lost Inventory reimbursement calculations)
        // Custom date ranges are NOT supported - always uses 9 months
            const now = new Date();
        const EndTime = new Date(now);
        EndTime.setHours(23, 59, 59, 999); // End of today
        
        const StartTime = new Date(now);
        StartTime.setMonth(StartTime.getMonth() - 9);
        StartTime.setHours(0, 0, 0, 0); // Start of 9 months ago
        
        const reportType = "GET_LEDGER_SUMMARY_VIEW_DATA";
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

        const requestHeaders = {
            "x-amz-access-token": accessToken,
            "Content-Type": "application/json",
        };

        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            requestBody,
            {
                headers: requestHeaders,
            }
        );

        return response.data.reportId;
    } catch (error) {
        const errorData = error.response ? error.response.data : null;
        logger.error("Error generating report:", errorData || error.message);
        
        // Check if it's an authorization error
        if (errorData && errorData.errors && Array.isArray(errorData.errors)) {
            const authError = errorData.errors.find(err => 
                err.code === 'Unauthorized' || 
                err.message?.toLowerCase().includes('access denied') ||
                err.message?.toLowerCase().includes('unauthorized')
            );
            
            if (authError) {
                const errorMessage = `Access denied to GET_LEDGER_SUMMARY_VIEW_DATA report. This report may require specific permissions or may not be available for your seller account. Please check: 1) SP-API app permissions in Amazon Developer Console, 2) Seller account eligibility for this report type, 3) Marketplace availability. Error: ${authError.message}`;
                logger.error(errorMessage);
                throw new Error(errorMessage);
            }
        }
        
        throw new Error(`Failed to generate report: ${errorData ? JSON.stringify(errorData) : error.message}`);
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

        logger.info(`Report Status: ${status}`);

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

const getReport = async (accessToken, marketplaceIds, userId, baseuri, country, region) => {
    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    if (!userId || !country || !region) {
        throw new ApiError(400, "userId, country, and region are required");
    }

    // Validate baseuri to prevent DNS errors (userId being passed as baseuri)
    if (!baseuri || typeof baseuri !== 'string' || baseuri.length < 10 || !baseuri.includes('amazon')) {
        logger.error("Invalid baseuri detected in GET_LEDGER_SUMMARY_VIEW_DATA", { 
            baseuri, 
            userId, 
            baseuriType: typeof baseuri 
        });
        throw new ApiError(400, `Invalid baseuri: ${baseuri}. Expected Amazon SP-API endpoint.`);
    }

    try {
        logger.info("GET_LEDGER_SUMMARY_VIEW_DATA starting");
        
        // Fixed 9-month date range - no custom dates accepted
        const reportId = await generateReport(accessToken, marketplaceIds, baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "Report generation failed"));
            return {
                success: false,
                message: "Report generation failed"
            };
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
            logger.error(new ApiError(408, "Report did not complete within 10 minutes"));
            return {
                success: false,
                message: "Report did not complete within 10 minutes",
            };
        }

        const reportUrl = await getReportLink(accessToken, reportDocumentId, baseuri);

        const fullReport = await axios({
            method: "GET",
            url: reportUrl,
            responseType: "arraybuffer",
        });

        if (!fullReport || !fullReport.data) {
            throw new ApiError(500, "Internal server error in generating the report");
        }

        // Convert TSV to JSON
        logger.info("🔄 Converting TSV to JSON...");
        logger.info(`📊 Raw data size: ${fullReport.data.length} bytes`);
        
        const refinedData = await convertTSVToJson(fullReport.data);
        
        const mappedData = refinedData.map(item => {
            const mappedItem = { ...item };
            if (mappedItem.hasOwnProperty('warehouse_transfer_in/out')) {
                mappedItem.warehouse_transfer_in_out = mappedItem['warehouse_transfer_in/out'];
                delete mappedItem['warehouse_transfer_in/out'];
            }
            return mappedItem;
        });

        try {
            // Save to database using service layer (handles 16MB limit with separate collection)
            const saveResult = await saveLedgerSummaryViewData(userId, country, region, mappedData);

            if (!saveResult || !saveResult.success) {
                logger.error("Failed to save ledger summary data to database");
                throw new ApiError(500, "Failed to save data to database");
            }

            logger.info("Data saved successfully");
            logger.info("GET_LEDGER_SUMMARY_VIEW_DATA ended");
            return {
                success: true,
                message: "Report fetched and saved successfully",
                data: mappedData,
                recordId: saveResult.recordId,
                totalRecords: mappedData.length
            };
        } catch (dbError) {
            logger.error("Database error:", dbError.message);
            if (dbError.name === 'ValidationError') {
                logger.error("Validation errors:", dbError.errors);
            }
            throw new ApiError(500, `Database error: ${dbError.message}`);
        }

    } catch (error) {
        logger.error("Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

/**
 * Convert TSV buffer to JSON using async streaming parser.
 * Uses async parsing to prevent blocking the event loop during large file processing.
 */
async function convertTSVToJson(tsvBuffer) {
    try {
        const records = await parseAsync(tsvBuffer, {
            delimiter: '\t',
            columns: true,
            reportType: 'GET_LEDGER_SUMMARY_VIEW_DATA'
        });

        // Apply header normalization after parsing
        if (records.length > 0) {
            logger.info('[GET_LEDGER_SUMMARY_VIEW_DATA] Sample record keys:', Object.keys(records[0]).join(', '));
            
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
        logger.error('[GET_LEDGER_SUMMARY_VIEW_DATA] TSV parsing failed', { 
            error: error.message 
        });

        // Fallback to legacy parsing
        try {
            return await convertTSVToJsonLegacy(tsvBuffer);
        } catch (fallbackError) {
            logger.error('[GET_LEDGER_SUMMARY_VIEW_DATA] Fallback parsing also failed', { 
                error: fallbackError.message 
            });
            throw error;
        }
    }
}

async function convertTSVToJsonLegacy(tsvBuffer) {
    let decompressedData;
    const firstBytes = tsvBuffer.slice(0, 2);
    if (firstBytes[0] === 0x1f && firstBytes[1] === 0x8b) {
        decompressedData = await gunzip(tsvBuffer);
    } else {
        decompressedData = tsvBuffer;
    }
    
    const tsv = decompressedData.toString("utf-8");
    const rows = tsv.split("\n").filter(row => row.trim() !== "");
    
    if (rows.length <= 1) return [];

    const headers = rows[0].split("\t").map(h => {
        let header = h.trim();
        if (header.startsWith('"') && header.endsWith('"')) {
            header = header.slice(1, -1);
        }
        return header;
    });

    return rows.slice(1).map((row) => {
        const values = row.split("\t");
        const obj = {};
        headers.forEach((header, index) => {
            let value = values[index] ? values[index].trim() : "";
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            const cleanHeader = header.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
            obj[cleanHeader] = value;
        });
        return obj;
    });
}

module.exports = getReport;


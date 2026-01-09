const axios = require("axios");
const zlib = require("zlib");
const { parse } = require('csv-parse/sync');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const FBAReimbursements = require('../../models/finance/FBAReimbursementsModel');

/**
 * GET_FBA_REIMBURSEMENTS_DATA Report Service
 * 
 * Fetches FBA reimbursements data from Amazon SP-API
 * Used for calculating lost inventory reimbursements
 * 
 * Key fields:
 * - reason: "lost_warehouse" for lost inventory reimbursements
 * - quantity_reimbursed_total: Total units reimbursed for this ASIN
 * 
 * For lost inventory calculation:
 *   DiscrepancyUnits = LostUnits - FoundUnits - ReimbursedUnits
 * 
 * Date Range: Last 9 months (for Lost Inventory reimbursement calculations)
 */

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
        
        const requestBody = {
            reportType: "GET_FBA_REIMBURSEMENTS_DATA",
            marketplaceIds: marketplaceIds,
            dataStartTime: StartTime.toISOString(),
            dataEndTime: EndTime.toISOString()
        };

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
        logger.error("Error generating GET_FBA_REIMBURSEMENTS_DATA report:", errorData || error.message);
        
        // Check if it's an authorization error
        if (errorData && errorData.errors && Array.isArray(errorData.errors)) {
            const authError = errorData.errors.find(err => 
                err.code === 'Unauthorized' || 
                err.message?.toLowerCase().includes('access denied') ||
                err.message?.toLowerCase().includes('unauthorized')
            );
            
            if (authError) {
                const errorMessage = `Access denied to GET_FBA_REIMBURSEMENTS_DATA report. This report may require specific permissions or may not be available for your seller account. Error: ${authError.message}`;
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

        logger.info(`[GET_FBA_REIMBURSEMENTS_DATA] Report Status: ${status}`);

        switch (status) {
            case "DONE":
                logger.info(`[GET_FBA_REIMBURSEMENTS_DATA] Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;

            case "FATAL":
                logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Report failed with a fatal error.");
                return false;

            case "CANCELLED":
                logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Report was cancelled by Amazon.");
                return false;

            case "IN_PROGRESS":
                return null;

            case "IN_QUEUE":
                return null;

            case "DONE_NO_DATA":
                logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Report completed but contains no data.");
                return false;

            case "FAILED":
                logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Report failed for an unknown reason.");
                return false;

            default:
                logger.error(`[GET_FBA_REIMBURSEMENTS_DATA] Unknown report status: ${status}`);
                return false;
        }
    } catch (error) {
        logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Error checking report status:", error.response ? error.response.data : error.message);
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
        logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Error downloading report:", error.response ? error.response.data : error.message);
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
        logger.error("Invalid baseuri detected in GET_FBA_REIMBURSEMENTS_DATA", { 
            baseuri, 
            userId, 
            baseuriType: typeof baseuri 
        });
        throw new ApiError(400, `Invalid baseuri: ${baseuri}. Expected Amazon SP-API endpoint.`);
    }

    try {
        logger.info("GET_FBA_REIMBURSEMENTS_DATA starting");
        
        // Fixed 9-month date range - no custom dates accepted
        const reportId = await generateReport(accessToken, marketplaceIds, baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "GET_FBA_REIMBURSEMENTS_DATA Report generation failed"));
            return {
                success: false,
                message: "Report generation failed"
            };
        }

        let reportDocumentId = null;
        let retries = 30;

        while (!reportDocumentId && retries > 0) {
            logger.info(`[GET_FBA_REIMBURSEMENTS_DATA] Checking report status... (Retries left: ${retries})`);
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
            logger.error(new ApiError(408, "[GET_FBA_REIMBURSEMENTS_DATA] Report did not complete within 10 minutes"));
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
        logger.info("[GET_FBA_REIMBURSEMENTS_DATA] Converting TSV to JSON...");
        logger.info(`[GET_FBA_REIMBURSEMENTS_DATA] Raw data size: ${fullReport.data.length} bytes`);
        
        const refinedData = convertTSVToJson(fullReport.data);
        
        // Map field names to match schema (replace spaces/hyphens with underscores)
        const mappedData = refinedData.map(item => {
            const mappedItem = {};
            for (const [key, value] of Object.entries(item)) {
                // Normalize key: lowercase, replace hyphens and spaces with underscores
                const normalizedKey = key.toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
                mappedItem[normalizedKey] = value;
            }
            return mappedItem;
        });

        try {
            const fbaReimbursementsRecord = await FBAReimbursements.create({
                User: userId,
                country: country,
                region: region,
                data: mappedData
            });

            if (!fbaReimbursementsRecord) {
                logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Failed to save FBA reimbursements data to database");
                throw new ApiError(500, "Failed to save data to database");
            }

            logger.info("[GET_FBA_REIMBURSEMENTS_DATA] Data saved successfully");
            logger.info("GET_FBA_REIMBURSEMENTS_DATA ended");
            return {
                success: true,
                message: "Report fetched and saved successfully",
                data: mappedData,
                recordId: fbaReimbursementsRecord._id,
                totalRecords: mappedData.length
            };
        } catch (dbError) {
            logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Database error:", dbError.message);
            if (dbError.name === 'ValidationError') {
                logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Validation errors:", dbError.errors);
            }
            throw new ApiError(500, `Database error: ${dbError.message}`);
        }

    } catch (error) {
        logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

/**
 * Convert TSV buffer to JSON using csv-parse library
 * Handles gzip decompression and normalizes headers
 */
function convertTSVToJson(tsvBuffer) {
    try {
        // First try to decompress if it's gzipped
        let decompressedData;
        
        // Check if data is gzipped by looking at magic bytes (1F 8B)
        const firstBytes = tsvBuffer.slice(0, 2);
        if (firstBytes[0] === 0x1f && firstBytes[1] === 0x8b) {
            try {
                decompressedData = zlib.gunzipSync(tsvBuffer);
            } catch (decompressError) {
                logger.error("[GET_FBA_REIMBURSEMENTS_DATA] Failed to decompress gzipped data:", decompressError.message);
                throw new Error(`Failed to decompress gzipped data: ${decompressError.message}`);
            }
        } else {
            decompressedData = tsvBuffer;
        }
        
        const tsv = decompressedData.toString("utf-8");
        
        if (!tsv || tsv.trim().length === 0) {
            logger.warn('[GET_FBA_REIMBURSEMENTS_DATA] TSV buffer is empty');
            return [];
        }

        // Log preview for debugging
        if (tsv.length > 0) {
            const preview = tsv.substring(0, 500);
            logger.info(`[GET_FBA_REIMBURSEMENTS_DATA] TSV Preview (first 500 chars): ${preview}`);
        }

        // Use csv-parse with custom column transformation to normalize headers
        const records = parse(tsv, {
            columns: (headers) => headers.map(h => {
                let header = h.trim();
                if (header.startsWith('"') && header.endsWith('"')) {
                    header = header.slice(1, -1);
                }
                // Normalize: lowercase, replace hyphens and spaces with underscores
                return header.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
            }),
            delimiter: '\t',
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true,
            skip_records_with_error: true,
            relax_quotes: true
        });

        logger.info('[GET_FBA_REIMBURSEMENTS_DATA] TSV parsed successfully', { 
            totalRecords: records.length 
        });

        return records;

    } catch (error) {
        logger.error('[GET_FBA_REIMBURSEMENTS_DATA] TSV parsing failed', { 
            error: error.message 
        });

        // Fallback to legacy parsing
        try {
            return convertTSVToJsonLegacy(tsvBuffer);
        } catch (fallbackError) {
            logger.error('[GET_FBA_REIMBURSEMENTS_DATA] Fallback parsing also failed', { 
                error: fallbackError.message 
            });
            throw error;
        }
    }
}

function convertTSVToJsonLegacy(tsvBuffer) {
    let decompressedData;
    const firstBytes = tsvBuffer.slice(0, 2);
    if (firstBytes[0] === 0x1f && firstBytes[1] === 0x8b) {
        decompressedData = zlib.gunzipSync(tsvBuffer);
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


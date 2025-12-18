const axios = require("axios");
const { parse } = require('csv-parse/sync');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const zlib = require('zlib');
const ProductWiseFBAData = require('../../models/inventory/ProductWiseFBADataModel');

const generateReport = async (accessToken, marketplaceIds, baseuri) => {
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days before end

        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            {
                reportType: "GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA",
                marketplaceIds: marketplaceIds,
                dataStartTime: StartTime.toISOString(),
                dataEndTime: EndTime.toISOString(),
            },
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
    logger.info("GetProductWiseFBAData starting");
    
    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    try {
        const reportId = await generateReport(accessToken, marketplaceIds, baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "Report generation failed"));
            return {
                success: false,
                message: "Report generation failed",
            };
        }

        let reportDocumentId = null;
        const retryInterval = 10000;
        let attempt = 0;

        while (true) {
            attempt++;
            logger.info(`Checking report status... (Attempt ${attempt})`);
            reportDocumentId = await checkReportStatus(accessToken, reportId, baseuri);
            
            if (reportDocumentId === false) {
                return {
                    success: false,
                    message: "Report failed or was cancelled",
                };
            }
            
            if (reportDocumentId) {
                break;
            }
            
            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, retryInterval));
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

        const refinedData = convertTSVToJson(fullReport.data);

        if (refinedData.length === 0) {
            logger.info("Report completed but contains no data");
            return {
                success: true,
                message: "Report completed successfully but contains no data",
                data: [],
            };
        }

        // Transform data to match model structure - capture ALL fields from report dynamically
        // This ensures we don't miss any fields that Amazon might add in the future
        const fbaData = refinedData.map((item) => {
            // Create a new object with all fields from the report, preserving exact field names
            const mappedItem = {};
            
            // Iterate through all keys in the item and copy them with their exact names
            for (const key in item) {
                if (item.hasOwnProperty(key)) {
                    // Preserve the exact field name from the report
                    mappedItem[key] = item[key] || "";
                }
            }
            
            return mappedItem;
        });

        // Save to database
        const createProductWiseFBAData = await ProductWiseFBAData.create({
            userId: userId,
            country: country,
            region: region,
            fbaData: fbaData
        });

        if (!createProductWiseFBAData) {
            logger.error(new ApiError(500, "Internal server error in saving the report"));
            return {
                success: false,
                message: "Error saving report to database",
            };
        }

        logger.info("Data saved successfully");
        logger.info("GetProductWiseFBAData ended");
        return {
            success: true,
            message: "Report fetched and saved successfully",
            data: createProductWiseFBAData,
        };
    } catch (error) {
        logger.error("Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

/**
 * Convert TSV buffer to JSON using csv-parse library
 * Handles gzip decompression if needed
 */
function convertTSVToJson(tsvBuffer) {
    try {
        // First try to decompress if it's gzipped
        let decompressedData;
        try {
            decompressedData = zlib.gunzipSync(tsvBuffer);
        } catch (decompressError) {
            // If decompression fails, assume it's already plain text
            decompressedData = tsvBuffer;
        }
        
        const tsv = decompressedData.toString("utf-8");
        
        if (!tsv || tsv.trim().length === 0) {
            logger.warn('[GetProductWiseFBAData] TSV buffer is empty');
            return [];
        }

        const records = parse(tsv, {
            columns: true,
            delimiter: '\t',
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true,
            skip_records_with_error: true
        });

        logger.info('[GetProductWiseFBAData] TSV parsed successfully', { 
            totalRecords: records.length 
        });

        return records;

    } catch (error) {
        logger.error('[GetProductWiseFBAData] TSV parsing failed', { 
            error: error.message 
        });

        // Fallback to legacy parsing
        try {
            return convertTSVToJsonLegacy(tsvBuffer);
        } catch (fallbackError) {
            logger.error('[GetProductWiseFBAData] Fallback parsing also failed', { 
                error: fallbackError.message 
            });
            return [];
        }
    }
}

function convertTSVToJsonLegacy(tsvBuffer) {
    let decompressedData;
    try {
        decompressedData = zlib.gunzipSync(tsvBuffer);
    } catch (decompressError) {
        decompressedData = tsvBuffer;
    }
    const tsv = decompressedData.toString("utf-8");
    const rows = tsv.split("\n").filter(row => row.trim() !== "");
    if (rows.length === 0) return [];
    const headers = rows[0].split("\t");
    return rows.slice(1).map(row => {
        const values = row.split("\t");
        return headers.reduce((obj, header, index) => {
            obj[header.trim()] = values[index] ? values[index].trim() : "";
            return obj;
        }, {});
    });
}

module.exports = getReport;
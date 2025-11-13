const axios = require("axios");
const zlib = require("zlib");
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const LedgerSummaryView = require('../../models/LedgerSummaryViewModel');

const generateReport = async (accessToken, marketplaceIds, baseuri, dataStartTime = null, dataEndTime = null) => {
    try {
        // Use provided dates or default to test dates
        let StartTime, EndTime;
        if (dataStartTime && dataEndTime) {
            StartTime = new Date(dataStartTime);
            EndTime = new Date(dataEndTime);
        } else {
            // Default test dates
            StartTime = new Date("2025-10-01T00:00:00.000Z");
            EndTime = new Date("2025-11-01T23:59:59.999Z");
        }
        
        const requestBody = {
            reportType: "GET_LEDGER_SUMMARY_VIEW_DATA",
            marketplaceIds: marketplaceIds,
            dataStartTime: StartTime.toISOString(),
            dataEndTime: EndTime.toISOString()
        };

        const requestHeaders = {
            "x-amz-access-token": accessToken,
            "Content-Type": "application/json",
        };

        logger.info("📤 Request details:", {
            url: `https://${baseuri}/reports/2021-06-30/reports`,
            reportType: requestBody.reportType,
            marketplaceIds: requestBody.marketplaceIds,
            dataStartTime: requestBody.dataStartTime,
            dataEndTime: requestBody.dataEndTime,
            hasAccessToken: !!accessToken,
            accessTokenLength: accessToken ? accessToken.length : 0
        });
        
        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            requestBody,
            {
                headers: requestHeaders,
            }
        );

        logger.info(`✅ Report Requested! Report ID: ${response.data.reportId}`);
        return response.data.reportId;
    } catch (error) {
        const errorData = error.response ? error.response.data : null;
        console.error("❌ Error generating report:", errorData || error.message);
        
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

        logger.info(`🔄 Report Status: ${status}`);

        switch (status) {
            case "DONE":
                logger.info(`✅ Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;

            case "FATAL":
                console.error("❌ Report failed with a fatal error.");
                return false;

            case "CANCELLED":
                logger.warn("🚫 Report was cancelled by Amazon.");
                return false;

            case "IN_PROGRESS":
                logger.info("⏳ Report is still processing...");
                return null;

            case "IN_QUEUE":
                logger.info("📋 Report is queued for processing...");
                return null;

            case "DONE_NO_DATA":
                console.warn("⚠️ Report completed but contains no data.");
                return false;

            case "FAILED":
                logger.error("❌ Report failed for an unknown reason.");
                return false;

            default:
                console.warn(`⚠️ Unknown report status: ${status}`);
                return false;
        }
    } catch (error) {
        console.error("❌ Error checking report status:", error.response ? error.response.data : error.message);
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
        console.error("❌ Error downloading report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to download report");
    }
};

const getReport = async (accessToken, marketplaceIds, baseuri, userId, country, region, dataStartTime = null, dataEndTime = null) => {
    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    if (!userId || !country || !region) {
        throw new ApiError(400, "userId, country, and region are required");
    }

    try {
        logger.info("📄 Generating GET_LEDGER_SUMMARY_VIEW_DATA Report...");
        const reportId = await generateReport(accessToken, marketplaceIds, baseuri, dataStartTime, dataEndTime);
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
            logger.info(`⏳ Checking report status... (Retries left: ${retries})`);
            await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait 20 seconds
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

        logger.info(`✅ Report Ready! Document ID: ${reportDocumentId}`);

        logger.info("📥 Downloading Report...");
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
        
        const refinedData = convertTSVToJson(fullReport.data);
        
        logger.info(`📊 Parsed ${refinedData.length} records from TSV`);
        if (refinedData.length > 0) {
            logger.info("📋 Sample record (first item):", JSON.stringify(refinedData[0], null, 2));
        }

        // Map field names to match database schema (warehouse_transfer_in/out -> warehouse_transfer_in_out)
        const mappedData = refinedData.map(item => {
            const mappedItem = { ...item };
            // Handle warehouse_transfer_in/out field - convert slash to underscore
            if (mappedItem.hasOwnProperty('warehouse_transfer_in/out')) {
                mappedItem.warehouse_transfer_in_out = mappedItem['warehouse_transfer_in/out'];
                delete mappedItem['warehouse_transfer_in/out'];
            }
            // Also handle if it comes as warehouse_transfer_in_out already
            return mappedItem;
        });

        // Save to database
        logger.info("💾 Saving ledger summary data to database...");
        try {
            const ledgerSummaryRecord = await LedgerSummaryView.create({
                User: userId,
                country: country,
                region: region,
                data: mappedData
            });

            if (!ledgerSummaryRecord) {
                logger.error("❌ Failed to save ledger summary data to database");
                throw new ApiError(500, "Failed to save data to database");
            }

            logger.info(`✅ Successfully saved ${mappedData.length} records to database for user: ${userId}`);
            logger.info(`📊 Database record ID: ${ledgerSummaryRecord._id}`);

            return {
                success: true,
                message: "Report fetched and saved successfully",
                data: mappedData,
                recordId: ledgerSummaryRecord._id,
                totalRecords: mappedData.length
            };
        } catch (dbError) {
            logger.error("❌ Database error:", dbError.message);
            // If it's a validation error, provide more details
            if (dbError.name === 'ValidationError') {
                logger.error("❌ Validation errors:", dbError.errors);
            }
            throw new ApiError(500, `Database error: ${dbError.message}`);
        }

    } catch (error) {
        console.error("❌ Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

function convertTSVToJson(tsvBuffer) {
    try {
        // First try to decompress if it's gzipped
        let decompressedData;
        let isGzipped = false;
        
        // Check if data is gzipped by looking at magic bytes (1F 8B)
        const firstBytes = tsvBuffer.slice(0, 2);
        if (firstBytes[0] === 0x1f && firstBytes[1] === 0x8b) {
            isGzipped = true;
            logger.info("🔓 Detected gzipped data, decompressing...");
            try {
                decompressedData = zlib.gunzipSync(tsvBuffer);
                logger.info(`✅ Successfully decompressed: ${tsvBuffer.length} bytes -> ${decompressedData.length} bytes`);
            } catch (decompressError) {
                logger.error("❌ Failed to decompress gzipped data:", decompressError.message);
                throw new Error(`Failed to decompress gzipped data: ${decompressError.message}`);
            }
        } else {
            // If not gzipped, use as-is
            logger.info("ℹ️ Data is not gzipped, using as plain text");
            decompressedData = tsvBuffer;
        }
        
        const tsv = decompressedData.toString("utf-8");
        
        // Log preview of decompressed data for debugging
        if (tsv.length > 0) {
            const preview = tsv.substring(0, 500);
            logger.info(`📄 Decompressed TSV Preview (first 500 chars): ${preview}`);
        }
        
        const rows = tsv.split("\n").filter(row => row.trim() !== "");
        
        logger.info(`📊 TSV parsing: Found ${rows.length} total rows (including header)`);
        
        if (rows.length === 0) {
            logger.warn("⚠️ No rows found in TSV data");
            return [];
        }

        if (rows.length === 1) {
            logger.warn("⚠️ Only header row found, no data rows");
            logger.info(`📋 Header row: ${rows[0]}`);
            return [];
        }

        const headers = rows[0].split("\t").map(h => {
            let header = h.trim();
            // Remove surrounding quotes from header names if present
            if (header.startsWith('"') && header.endsWith('"')) {
                header = header.slice(1, -1);
            }
            return header;
        });
        logger.info(`📋 Headers found: ${headers.length} columns - ${headers.slice(0, 5).join(", ")}${headers.length > 5 ? "..." : ""}`);

        const jsonData = rows.slice(1).map((row, rowIndex) => {
            const values = row.split("\t");
            const obj = {};
            
            headers.forEach((header, index) => {
                let value = values[index] ? values[index].trim() : "";
                
                // Remove surrounding quotes from values if present
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                }
                
                // Clean header names and convert to lowercase with underscores
                const cleanHeader = header.toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
                
                // Only use cleaned header (lowercase with underscores) to avoid duplicates
                obj[cleanHeader] = value;
            });
            
            // Log first few rows for debugging
            if (rowIndex < 3) {
                logger.info(`📝 Row ${rowIndex + 1} sample:`, JSON.stringify(obj));
            }
            
            return obj;
        });

        logger.info(`✅ Successfully converted ${jsonData.length} rows to JSON`);
        return jsonData;
    } catch (error) {
        logger.error("❌ Error converting TSV to JSON:", error.message);
        logger.error("❌ Error stack:", error.stack);
        throw error;
    }
}

module.exports = getReport;


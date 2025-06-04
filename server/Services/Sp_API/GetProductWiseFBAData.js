const axios = require("axios");
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const ProductWiseFBAData = require('../../models/ProductWiseFBADataModel');
//const ProductWiseFBAFees = require('../../models/ProductWiseFBAFees'); // Updated model name

const generateReport = async (accessToken, marketplaceIds, baseuri) => {
    console.log(marketplaceIds);
    try {
        const now = new Date();
        const EndTime = now; // Current time
        const StartTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days before now

        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            {
                reportType: "GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA", // Changed report type
                marketplaceIds: marketplaceIds,
                dataStartTime: StartTime.toISOString(), // 72 hours ago
                dataEndTime: EndTime.toISOString(), // Now
            },
            {
                headers: {
                    "x-amz-access-token": accessToken,
                    "Content-Type": "application/json",
                },
            }
        );

        console.log(`✅ Report Requested! Report ID: ${response.data.reportId}`);
        return response.data.reportId;
    } catch (error) {
        console.error("❌ Error generating report:", error.response ? error.response.data : error.message);
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

        console.log(`🔄 Report Status: ${status}`);

        switch (status) {
            case "DONE":
                console.log(`✅ Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;

            case "FATAL":
                console.error("❌ Report failed with a fatal error.");
                return false;

            case "CANCELLED":
                logger.warn("🚫 Report was cancelled by Amazon.");
                return false;

            case "IN_PROGRESS":
                console.log("⏳ Report is still processing...");
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

const getReport = async (accessToken, marketplaceIds, userId, baseuri, country, region) => {
    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    try {
        console.log("📄 Generating FBA Fees Report...");
        const reportId = await generateReport(accessToken, marketplaceIds, baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "Report generation failed"));
            return false;
        }

        let reportDocumentId = null;
        let retries = 30;

        while (!reportDocumentId && retries > 0) {
            console.log(`⏳ Checking report status... (Retries left: ${retries})`);
            await new Promise((resolve) => setTimeout(resolve, 60000)); // Wait 60 seconds
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
            logger.error(new ApiError(408, "Report did not complete within 30 minutes"));
            return {
                success: false,
                message: "Report did not complete within 30 minutes",
            };
        }

        console.log(`✅ Report Ready! Document ID: ${reportDocumentId}`);

        console.log("📥 Downloading Report...");
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
        const refinedData = convertTSVToJson(fullReport.data);

        if (refinedData.length === 0) {
            logger.error(new ApiError(204, "No data found in the report"));
            return {
                success: false,
                message: "No data found in the report",
            };
        }

        const fbaData = [];

        refinedData.forEach(item => {
            fbaData.push({
                asin: item.asin,
                totalFba: item["expected_fulfillment_fee_per_unit"],
                totalAmzFee: item["estimated_fee_total"]
            })
        })

        const createProductWiseFBAData = await ProductWiseFBAData.create({
            userId: userId,
            country: country,
            region: region,
            fbaData: fbaData
        })
        if (!createProductWiseFBAData) {
            return {
                success: false,
                message: "Error in creating product wise FBA data",
            };
        }
        return {
            success: true,
            message: "Product wise FBA data fetched successfully",
            data: createProductWiseFBAData
        }
    } catch (error) {
        console.error("❌ Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

function convertTSVToJson(tsvBuffer) {
    const tsv = tsvBuffer.toString("utf-8");
    const rows = tsv.split("\n").filter(row => row.trim() !== "");
    const headers = rows[0].split("\t");

    return rows.slice(1).map(row => {
        const values = row.split("\t");
        return headers.reduce((obj, header, index) => {
            // Clean header names and convert to lowercase with underscores
            const cleanHeader = header.trim().toLowerCase().replace(/-/g, "_");
            obj[cleanHeader] = values[index] ? values[index].trim() : "";
            // Also keep original header for backward compatibility
            obj[header.trim()] = values[index] ? values[index].trim() : "";
            return obj;
        }, {});
    });
}

module.exports = getReport;
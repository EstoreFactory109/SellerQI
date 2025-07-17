const axios = require("axios");
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const SellerModel = require('../../models/sellerCentralModel.js');

const generateReport = async (accessToken, marketplaceIds, baseURI) => {
    logger.info(marketplaceIds);
    // console.log(accessToken)
    // console.log(baseURI)
    try {
        const response = await axios.post(
            `https://${baseURI}/reports/2021-06-30/reports`,
            {
                reportType: "GET_STRANDED_INVENTORY_UI_DATA",
                marketplaceIds: marketplaceIds, // Use dynamic marketplaceIds instead of hardcoded
                dataStartTime: "2025-01-10T00:00:00.000Z",
                dataEndTime: "2025-03-10T23:59:59.999Z",
            },
            {
                headers: {
                    "x-amz-access-token":accessToken,
                    "Content-Type": "application/json",
                },
            }
        );

        logger.info(`✅ Report Requested! Report ID: ${response.data.reportId}`);
        return response.data.reportId;
    } catch (error) {
        logger.error("❌ Error generating report:", error.response ? error.response.data : error.message);
        return false;
    }
};

const checkReportStatus = async (accessToken, reportId, baseURI) => {
    try {
        const response = await axios.get(
            `https://${baseURI}/reports/2021-06-30/reports/${reportId}`,
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
                logger.error("❌ Report failed with a fatal error.");
                return false;
            case "CANCELLED":
                logger.warn("🚫 Report was cancelled by Amazon.");
                return false;
            case "IN_PROGRESS":
                logger.info("⏳ Report is still processing...");
                return null;
            case "DONE_NO_DATA":
                logger.warn("⚠️ Report completed but contains no data.");
                return false;
            case "FAILED":
                logger.error("❌ Report failed for an unknown reason.");
                return false;
            default:
                logger.warn(`⚠️ Unknown report status: ${status}`);
                return false;
        }
    } catch (error) {
        logger.error("❌ Error checking report status:", error.response ? error.response.data : error.message);
        return false;
    }
};

const getReportLink = async (accessToken, reportDocumentId, baseURI) => {
    try {
        const response = await axios.get(
            `https://${baseURI}/reports/2021-06-30/documents/${reportDocumentId}`,
            { headers: { "x-amz-access-token": accessToken } }
        );

        if (!response.data.url) {
            logger.error("No valid report URL found");
            return false;
        }

        return response.data.url;
    } catch (error) {
        logger.error("❌ Error downloading report:", error.response ? error.response.data : error.message);
        return false;
    }
};

const getReport = async (accessToken, marketplaceIds, baseURI) => {
  
    if (!accessToken || !marketplaceIds) {
        logger.error(new ApiError(400, "Credentials are missing"));
        return false;
    }

    try {
        logger.info("📄 Generating Report...");
        const reportId = await generateReport(accessToken, marketplaceIds, baseURI);
        if (!reportId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        let reportDocumentId = null;
        let retries = 30;

        while (!reportDocumentId && retries > 0) {
            logger.info(`⏳ Checking report status... (Retries left: ${retries})`);
            await new Promise((resolve) => setTimeout(resolve, 50000));
            reportDocumentId = await checkReportStatus(accessToken, reportId, baseURI);
            if (reportDocumentId === false) {
                return false;
            }
            retries--;
        }

        if (!reportDocumentId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        logger.info(`✅ Report Ready! Document ID: ${reportDocumentId}`);

        logger.info("📥 Downloading Report...");
        const reportUrl = await getReportLink(accessToken, reportDocumentId, baseURI);

        const fullReport = await axios({
            method: "GET",
            url: reportUrl,
            responseType: "arraybuffer",
        });

        if (!fullReport || !fullReport.data) {
            logger.error(new ApiError(500, "Internal server error in generating the report"));
            return false;
        }

        const refinedData = convertTSVToJson(fullReport.data);

        if (refinedData.length === 0) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        return refinedData;
    } catch (error) {
        logger.error("❌ Error in getReport:", error.message);
        return false;
    }
};

function convertTSVToJson(tsvBuffer) {
    const tsv = tsvBuffer.toString("utf-8");
    const rows = tsv.split("\n").filter(row => row.trim() !== "");
    const headers = rows[0].split("\t");
    return rows.slice(1).map(row => {
        const values = row.split("\t");
        return headers.reduce((obj, header, index) => {
            obj[header] = values[index] || "";
            return obj;
        }, {});
    });
}

module.exports = getReport;

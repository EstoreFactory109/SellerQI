const axios = require("axios");
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const FbaInventoryPlanningData = require('../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const UserModel = require('../../models/user-auth/userModel.js');

const generateReport = async (accessToken, marketplaceIds, baseuri) => {
    // console.log(baseuri)
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 7 days before end
        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            {
                reportType: "GET_FBA_INVENTORY_PLANNING_DATA",
                marketplaceIds: marketplaceIds, // Use array as-is, already passed as array from controller
                dataStartTime: StartTime.toISOString(),
                dataEndTime: EndTime.toISOString()
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

        if (!refinedData || refinedData.length === 0) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return {
                success: false,
                message: "Report completed but contains no data",
            };
        }

        const result = [];

        refinedData.forEach((item) => {
            // Helper function to convert empty strings to "0" for required fields
            const getValue = (value) => {
                if (value === null || value === undefined || value === '') {
                    return "0";
                }
                return String(value).trim();
            };

            result.push({
                asin: item.asin || "",
                quantity_to_be_charged_ais_181_210_days: getValue(item["quantity-to-be-charged-ais-181-210-days"]),
                quantity_to_be_charged_ais_211_240_days: getValue(item["quantity-to-be-charged-ais-211-240-days"]),
                quantity_to_be_charged_ais_241_270_days: getValue(item["quantity-to-be-charged-ais-241-270-days"]),
                quantity_to_be_charged_ais_271_300_days: getValue(item["quantity-to-be-charged-ais-271-300-days"]),
                quantity_to_be_charged_ais_301_330_days: getValue(item["quantity-to-be-charged-ais-301-330-days"]),
                quantity_to_be_charged_ais_331_365_days: getValue(item["quantity-to-be-charged-ais-331-365-days"]),
                quantity_to_be_charged_ais_365_plus_days: getValue(item["quantity-to-be-charged-ais-365-plus-days"]),
                unfulfillable_quantity: getValue(item["unfulfillable-quantity"]),
            });
        });





        const createReport = await FbaInventoryPlanningData.create({
            User: userId,
            region: Region,
            country: Country,
            data: result
        })
        if (!createReport) {
            logger.error(new ApiError(500, "Internal server error in generating the report"));
            return false;
        }

        logger.info("Data saved successfully");
        logger.info("GET_FBA_INVENTORY_PLANNING_DATA ended");
        return createReport;

    } catch (error) {
        logger.error("Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

function convertTSVToJson(tsvBuffer) {
    const tsv = tsvBuffer.toString("utf-8");  // Convert Buffer to string

    const rows = tsv.split("\n").filter(row => row.trim() !== "");
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

module.exports = getReport;

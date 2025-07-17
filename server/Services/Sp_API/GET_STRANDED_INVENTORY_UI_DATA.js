const axios = require("axios");
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model=require('../../models/GET_STRANDED_INVENTORY_UI_DATA_MODEL');

const generateReport = async (accessToken, marketplaceIds,baseuri) => {
    // console.log(marketplaceIds);
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 72 * 60 * 60 * 1000); // 72 hours before now
        const StartTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days before now
        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            {
                reportType: "GET_STRANDED_INVENTORY_UI_DATA",
                marketplaceIds: marketplaceIds, // Use dynamic marketplaceIds instead of hardcoded
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

                  // console.log(`✅ Report Requested! Report ID: ${response.data.reportId}`);
        return response.data.reportId;
    } catch (error) {
        console.error("❌ Error generating report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to generate report");
    }
};

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
                // console.log(`✅ Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;

            case "FATAL":
                console.error("❌ Report failed with a fatal error.");
                return false;

            case "CANCELLED":
                logger.warn("🚫 Report was cancelled by Amazon.");
                return false;

            case "IN_PROGRESS":
                // console.log("⏳ Report is still processing...");
                return null;

            case "IN_QUEUE":
                // console.log("📋 Report is queued for processing...");
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
        console.error("❌ Error downloading report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to download report");
    }
};

const getReport = async (accessToken, marketplaceIds, userId,baseuri,country,region) => {
    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    try {
        // console.log("📄 Generating Report...");
        const reportId = await generateReport(accessToken, marketplaceIds,baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        let reportDocumentId = null;
        let retries = 30; 

        while (!reportDocumentId && retries > 0) {
            // console.log(`⏳ Checking report status... (Retries left: ${retries})`);
            await new Promise((resolve) => setTimeout(resolve, 20000));
            reportDocumentId = await checkReportStatus(accessToken, reportId,baseuri);
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

                  // console.log(`✅ Report Ready! Document ID: ${reportDocumentId}`);
  
          // console.log("📥 Downloading Report...");
        const reportUrl = await getReportLink(accessToken, reportDocumentId,baseuri);

        const fullReport = await axios({
            method: "GET",
            url: reportUrl,
            responseType: "arraybuffer",
        });

        if (!fullReport || !fullReport.data) {
            throw new ApiError(500, "Internal server error in generating the report");
        }

        const refinedData = convertTSVToJson(fullReport.data);

        

        let strandedUIdata=[]

        refinedData.forEach((item) => {
            const data={
                asin:item.asin,
                status_primary:item['status-primary'],
                stranded_reason:item['stranded-reason']
            }
            strandedUIdata.push(data)
        })

        const createStrandedUIdata = await GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.create({
            User:userId,
            region:region,
            country:country,
            strandedUIData:strandedUIdata
        })

        if(!createStrandedUIdata){
            logger.error(new ApiError(500, "Error in saving the data"));
            return false;
        }
        return createStrandedUIdata;

    } catch (error) {
        console.error("❌ Error in getReport:", error.message);
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

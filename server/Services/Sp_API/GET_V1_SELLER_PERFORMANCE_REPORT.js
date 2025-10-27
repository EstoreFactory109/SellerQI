const axios = require("axios");
const xml2js = require("xml2js");
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const GET_V1_SELLER_PERFORMANCE_REPORT = require('../../models/V1_Seller_Performance_Report_Model.js');



const generateReport = async (accessToken, marketplaceIds,baseuri) => {
    // console.log(marketplaceIds);
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 7 days before end
        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            {
                reportType: "GET_V1_SELLER_PERFORMANCE_REPORT",
                marketplaceIds: marketplaceIds, // Use array as-is, already passed as array from controller
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

const getReport = async (accessToken, marketplaceIds, userId, baseuri,country,region) => {
    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    try {
        logger.info(`🚀 [V1_Seller_Performance_Report] Starting for user: ${userId}, country: ${country}, region: ${region}`);
        logger.info(`📊 [V1_Seller_Performance_Report] Marketplace IDs: ${JSON.stringify(marketplaceIds)}`);
        
        logger.info("📄 [V1_Seller_Performance_Report] Generating Report...");
        const reportId = await generateReport(accessToken, marketplaceIds,baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        let reportDocumentId = null;
        let retries = 30; 

        while (!reportDocumentId && retries > 0) {
            logger.info(`⏳ [V1_Seller_Performance_Report] Checking report status... (Retries left: ${retries})`);
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

        logger.info(`✅ [V1_Seller_Performance_Report] Report Ready! Document ID: ${reportDocumentId}`);

        logger.info("📥 [V1_Seller_Performance_Report] Downloading Report...");
        const reportUrl = await getReportLink(accessToken, reportDocumentId, baseuri);
        logger.info(`📄 [V1_Seller_Performance_Report] Report URL obtained: ${reportUrl ? 'Success' : 'Failed'}`);

        const fullReport = await axios({
            method: "GET",
            url: reportUrl,
            responseType: "text",  // Ensure response is in raw text format
        });

        if (!fullReport || !fullReport.data) {
            throw new ApiError(500, "Internal server error in generating the report");
        }

        // Convert XML to JSON
        logger.info("🔄 [V1_Seller_Performance_Report] Converting XML data to JSON...");
        const xmlData = fullReport.data;
        const jsonData = await convertXMLToJson(xmlData);
        logger.info("✅ [V1_Seller_Performance_Report] XML to JSON conversion completed");

        let negativeFeedbacks=null;
        let lateShipmentCount=null
        let preFulfillmentCancellationCount=null
        let refundsCount=null
        let a_z_claims=null
        
        const sortedorderDefectMetricsMetrics= jsonData.sellerPerformanceReports.sellerPerformanceReport.orderDefects.orderDefectMetrics.sort((a, b) => new Date(a.timeFrame.end) - new Date(b.timeFrame.end));

        const negetiveFeedbackData={
            startDate:sortedorderDefectMetricsMetrics[0].timeFrame.start,
            endDate:sortedorderDefectMetricsMetrics[0].timeFrame.end,
            count:sortedorderDefectMetricsMetrics[0].negativeFeedbacks.count
        }
        negativeFeedbacks=negetiveFeedbackData

        const a_z_claims_data={
            startDate:sortedorderDefectMetricsMetrics[0].timeFrame.start,
            endDate:sortedorderDefectMetricsMetrics[0].timeFrame.end,
            count:sortedorderDefectMetricsMetrics[0].a_z_claims.count
        }
        a_z_claims=a_z_claims_data

        
        const sortedcustomerExperienceMetrics= jsonData.sellerPerformanceReports.sellerPerformanceReport.customerExperience.customerExperienceMetrics.sort((a, b) => new Date(a.timeFrame.end) - new Date(b.timeFrame.end));

        const lateShipmentCount_data={
            startDate:sortedcustomerExperienceMetrics[0].timeFrame.start,
            endDate:sortedcustomerExperienceMetrics[0].timeFrame.end,
            count:sortedcustomerExperienceMetrics[0].lateShipment.count
        }
        lateShipmentCount=lateShipmentCount_data

        const preFulfillmentCancellationCount_data={
            startDate:sortedcustomerExperienceMetrics[0].timeFrame.start,
            endDate:sortedcustomerExperienceMetrics[0].timeFrame.end,
            count:sortedcustomerExperienceMetrics[0].preFulfillmentCancellation.count
        }
        preFulfillmentCancellationCount=preFulfillmentCancellationCount_data

        const refundsCount_data={
            startDate:sortedcustomerExperienceMetrics[0].timeFrame.start,
            endDate:sortedcustomerExperienceMetrics[0].timeFrame.end,
            count:sortedcustomerExperienceMetrics[0].refunds.count
        }
        refundsCount=refundsCount_data

        let responseUnder24HoursCount=jsonData.sellerPerformanceReports.sellerPerformanceReport.buyerSellerContactResponseTimeMetrics.responseTimeMetrics.responseUnder24Hours;

        const User=userId

        logger.info("💾 [V1_Seller_Performance_Report] Saving data to database...");
        const createReportData=await GET_V1_SELLER_PERFORMANCE_REPORT.create({
            User,
            region,
            country,
            negativeFeedbacks,
            lateShipmentCount,
            preFulfillmentCancellationCount,
            refundsCount,
            a_z_claims,
            responseUnder24HoursCount
        })

        if(!createReportData){
            logger.error("❌ [V1_Seller_Performance_Report] Failed to store report data");
            logger.error(new ApiError(500, "Internal server error in generating the report"));
            return false;
        }

        logger.info(`✅ [V1_Seller_Performance_Report] Report data saved successfully for user: ${userId}`);

        return createReportData;

    } catch (error) {
        logger.error(`❌ [V1_Seller_Performance_Report] Error: ${error.message}`);
        logger.error(`❌ [V1_Seller_Performance_Report] Stack: ${error.stack}`);
        console.error("❌ Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

async function convertXMLToJson(xmlData) {
    try {
        const parser = new xml2js.Parser({ explicitArray: false });
        const jsonResult = await parser.parseStringPromise(xmlData);
        return jsonResult;
    } catch (error) {
        console.error("❌ Error converting XML to JSON:", error.message);
        throw new Error("Failed to parse XML data");
    }
}

module.exports = getReport;

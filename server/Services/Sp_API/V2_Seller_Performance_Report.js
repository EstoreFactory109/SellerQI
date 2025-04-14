const axios = require("axios");
const logger = require("../../utils/Logger");
const {ApiError}=require('../../utils/ApiError');
const GET_V2_SELLER_PERFORMANCE_REPORT=require('../../models/V2_Seller_Performance_ReportModel.js');
const zlib = require('zlib');


const generateReport=async(accessToken, marketplaceIds,baseuri)=> {
   
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 7 days before end
        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            {
                reportType: "GET_V2_SELLER_PERFORMANCE_REPORT",
                marketplaceIds: marketplaceIds, 
                dataStartTime: StartTime.toISOString(),
                dataEndTime: EndTime.toISOString()
            },
            {
                headers: {
                    "x-amz-access-token": `${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        logger.info(`✅ Report Requested! Report ID: ${response.data.reportId}`);
        return response.data.reportId;
    } catch (error) {
        console.error("❌ Error generating report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to generate report");
    }
}

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

        logger.info(`🔄 Report Status: ${status}`);

        // Handle different statuses
        switch (status) {
            case "DONE":
                logger.info(`✅ Report Ready! Document ID: ${reportDocumentId}`);
                return reportDocumentId;

            case "FATAL":
                console.error("❌ Report failed with a fatal error.");
                if (reportDocumentId) {
                    logger.warn(`📄 A failure report is available: ${reportDocumentId}`);
                    return false;
                }

            case "CANCELLED":
                logger.warn("🚫 Report was cancelled by Amazon.");
                return false;

            case "IN_PROGRESS":
                logger.info("⏳ Report is still processing...");
                return null;

            case "DONE_NO_DATA":
                console.warn("⚠️ Report completed but contains no data.");
                return false;

            case "FAILED":
                logger.error("❌ Report failed for an unknown reason.");
                return false;

            default:
                console.warn(`⚠️ Unknown report status: ${status}`);
        }
    } catch (error) {
        console.error("❌ Error checking report status:", error.response ? error.response.data : error.message);
        throw new Error("Failed to check report status");
    }
};


const getReportLink=async(accessToken, reportDocumentId,baseuri)=> {
    try {
     
        const response = await axios.get(
            `https://${baseuri}/reports/2021-06-30/documents/${reportDocumentId}`,
            { headers: { "x-amz-access-token": accessToken } }
        );

        const documentUrl = response.data.url;
        const reportResponse = await axios.get(documentUrl, { responseType: "arraybuffer" });
        //console.log(reportResponse)

        return reportResponse.config.url;
    } catch (error) {
        console.error("❌ Error downloading report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to download report");
    }
}

const getReport = async (accessToken, marketplaceIds,userId,baseuri,country,region ) => {

    if (!accessToken || !marketplaceIds) {
        logger.error(new ApiError(400, "Credentials are missing"));
    }

    try {
        // 📝 Step 1: Generate the Report
        logger.info("📄 Generating Report...");
        const reportId = await generateReport(accessToken, marketplaceIds,baseuri);
        if(!reportId){
            logger.error(new ApiError(408,"Report did not complete within 5 minutes"));
            return false;
        }

        // ⏳ Step 2: Check Report Status with Retry Logic
        let reportDocumentId = null;
        let retries = 30; // 30 retries (total 5 minutes)

        while (!reportDocumentId && retries > 0) {
            logger.info(`⏳ Checking report status... (Retries left: ${retries})`);
            await new Promise((resolve) => setTimeout(resolve, 20000)); // Wait 20 sec before retrying
            reportDocumentId = await checkReportStatus(accessToken, reportId,baseuri);
            if(reportDocumentId===false){
                return {
                    success:false,
                    message:"Error in generating the report"
                }; 
            }
            retries--;
        }

        if (!reportDocumentId) {
            logger.error (ApiError(408, "Report did not complete within 5 minutes"));
            return {
                success:false,
                message:"Report did not complete within 5 minutes"
            }
        }

        logger.info(`✅ Report Ready! Document ID: ${reportDocumentId}`);

        // 📥 Step 3: get the link of Report
        logger.info("📥 Downloading Report...");
        const reportPath = await getReportLink(accessToken, reportDocumentId,baseuri);

        const fullReport=await axios(
            {
                method: "GET",
                url: reportPath,
                responseType: "arraybuffer",
            }
        );

        if (!fullReport || !fullReport.data) {
            logger.error(new ApiError(500, "Internal server error in generating the report"));
        }
       // const ReportData= convertTSVToJson(fullReport.data);

       const ReportData=zlib.gunzipSync(fullReport.data).toString("utf8");
       const refinedData=JSON.parse(ReportData);


       const User=userId;
       const ahrScore=refinedData.performanceMetrics[0].accountHealthRating.ahrScore;
       const accountStatuses=refinedData.accountStatuses[0].status;
       const listingPolicyViolations=refinedData.performanceMetrics[0].listingPolicyViolations.status;
       const validTrackingRateStatus=refinedData.performanceMetrics[0].validTrackingRate.status;
       const orderWithDefectsStatus=refinedData.performanceMetrics[0].orderDefectRate.afn.orderWithDefects.status;
       const lateShipmentRateStatus=refinedData.performanceMetrics[0].lateShipmentRate.status;
       const CancellationRate=refinedData.performanceMetrics[0].preFulfillmentCancellationRate.status;

       const storeData=await GET_V2_SELLER_PERFORMANCE_REPORT.create({User,region,country,ahrScore,accountStatuses,listingPolicyViolations,validTrackingRateStatus,orderWithDefectsStatus,lateShipmentRateStatus,CancellationRate});

       if(!storeData){
        logger.error(new ApiError(500,"Internal seerror in storing the report"));
        return false;
       }

       return storeData;

    } catch (error) {
        logger.error(new ApiError(500,"Internal server error in generating the report"));
        return false
    }
}



module.exports = getReport;

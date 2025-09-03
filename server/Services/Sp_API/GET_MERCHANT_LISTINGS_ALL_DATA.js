const axios = require("axios");
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const SellerModel = require('../../models/sellerCentralModel.js');
const zlib = require('zlib');

const generateReport = async (accessToken, marketplaceIds, baseURI) => {

    console.log("accessToken: ",accessToken);
    console.log("marketplaceIds: ",marketplaceIds);
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 7 days before end
        const response = await axios.post(
            `https://${baseURI}/reports/2021-06-30/reports`,
            {
                reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
                marketplaceIds: marketplaceIds,
                dataStartTime: StartTime.toISOString(),
                dataEndTime:EndTime.toISOString(),
            },
            {
                headers: {
                    "x-amz-access-token": accessToken,
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

const getReport = async (accessToken, marketplaceIds, userId, country, region, baseURI) => {
 
    console.log("🔍 Debug - getReport function called with:", { accessToken, marketplaceIds, userId, country, region, baseURI });
  
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
            await new Promise((resolve) => setTimeout(resolve, 20000));
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
        console.log("🔍 Debug - refinedData:", refinedData);

        if (refinedData.length === 0) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        const ProductData = [];
        
        refinedData.forEach((data) => {

            ProductData.push({
                asin: data.asin1,
                sku: data["seller-sku"],
                itemName:data["item-name"]|| "Unknown Product",
                price:data.price||0,
                status: data.status,
            });
        });

       
        const getSellerDetails = await SellerModel.findOne({ User: userId });
        if (!getSellerDetails) {
            logger.error(new ApiError(404, "Seller not found"));
            return false;
        }
        
        console.log("🔍 Debug - getSellerDetails:", getSellerDetails);
        

        for (let i = 0; i < getSellerDetails.sellerAccount.length; i++) {
            if (getSellerDetails.sellerAccount[i].country === country && getSellerDetails.sellerAccount[i].region === region) {
                getSellerDetails.sellerAccount[i].products=ProductData;
                getSellerDetails.sellerAccount[i].TotatProducts.push({
                    NumberOfProducts:ProductData.length
                })
                break;
            }
        }


        await getSellerDetails.save();
        return getSellerDetails;
    } catch (error) {
        logger.error("❌ Error in getReport:", error.message);
        return false;
    }
};

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
        const rows = tsv.split("\n").filter(row => row.trim() !== "");
        
        if (rows.length === 0) {
            logger.warn("No data rows found in TSV");
            return [];
        }
        
        const headers = rows[0].split("\t");
        return rows.slice(1).map(row => {
            const values = row.split("\t");
            return headers.reduce((obj, header, index) => {
                obj[header] = values[index] || "";
                return obj;
            }, {});
        });
    } catch (error) {
        logger.error("Error converting TSV to JSON:", error);
        return [];
    }
}

module.exports = getReport;

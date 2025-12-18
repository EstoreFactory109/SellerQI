const axios = require("axios");
const { parse } = require('csv-parse/sync');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const RestockInventoryRecommendations = require('../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js'); 
const UserModel = require('../../models/user-auth/userModel.js');

const generateReport = async (accessToken, marketplaceIds,baseuri) => {
    // console.log(marketplaceIds);
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 7 days before end
        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            {
                reportType: "GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT",
                marketplaceIds: marketplaceIds, 
                dataStartTime: StartTime.toISOString(),
                dataEndTime: EndTime.toISOString() ,
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
        logger.error("Error downloading report:", error.response ? error.response.data : error.message);
        throw new Error("Failed to download report");
    }
};

const getReport = async (accessToken, marketplaceIds, userId,baseuri,country,region) => {
    logger.info("GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT starting");
    
    if (!accessToken || !marketplaceIds) {
        throw new ApiError(400, "Credentials are missing");
    }

    try {
        const reportId = await generateReport(accessToken, marketplaceIds,baseuri);
        if (!reportId) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return false;
        }

        let reportDocumentId = null;
        let retries = 30; 

        while (!reportDocumentId && retries > 0) {
            logger.info(`Checking report status... (Retries left: ${retries})`);
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
        
        if (refinedData.length === 0) {
            logger.error(new ApiError(408, "Report did not complete within 5 minutes"));
            return {
                success: false,
                message: "Report did not complete within 5 minutes",
            };
        }



        let products = [];

        refinedData.forEach((data) => {
            products.push({
                // Core identifiers
                asin: data["ASIN"] || data["asin"] || "",
                fnsku: data["FNSKU"] || data["fnsku"] || "",
                merchantSku: data["Merchant SKU"] || data["merchant-sku"] || "",
                
                // Product info
                productName: data["Product Name"] || data["product-name"] || "",
                condition: data["Condition"] || data["condition"] || "",
                
                // Supplier info
                supplier: data["Supplier"] || data["supplier"] || "",
                supplierPartNo: data["Supplier part no."] || data["supplier-part-no"] || "",
                
                // Pricing
                currencyCode: data["Currency code"] || data["currency-code"] || "",
                price: data["Price"] || data["price"] || "0",
                
                // Sales metrics
                salesLast30Days: data["Sales last 30 days"] || data["sales-last-30-days"] || "0",
                unitsSoldLast30Days: data["Units Sold Last 30 Days"] || data["units-sold-last-30-days"] || "0",
                
                // Inventory quantities
                totalUnits: data["Total Units"] || data["total-units"] || "0",
                inbound: data["Inbound"] || data["inbound"] || "0",
                available: data["Available"] || data["available"] || "0",
                fcTransfer: data["FC transfer"] || data["fc-transfer"] || "0",
                fcProcessing: data["FC Processing"] || data["fc-processing"] || "0",
                customerOrder: data["Customer Order"] || data["customer-order"] || "0",
                unfulfillable: data["Unfulfillable"] || data["unfulfillable"] || "0",
                working: data["Working"] || data["working"] || "0",
                shipped: data["Shipped"] || data["shipped"] || "0",
                receiving: data["Receiving"] || data["receiving"] || "0",
                
                // Fulfillment
                fulfilledBy: data["Fulfilled by"] || data["fulfilled-by"] || "",
                
                // Days of supply
                totalDaysOfSupply: data["Total Days of Supply (including units from open shipments)"] || data["total-days-of-supply"] || "",
                daysOfSupplyAtAmazon: data["Days of Supply at Amazon Fulfillment Network"] || data["days-of-supply-at-amazon"] || "",
                
                // Alerts and recommendations
                alert: data["Alert"] || data["alert"] || "",
                recommendedReplenishmentQty: data["Recommended replenishment qty"] || data["recommended-replenishment-qty"] || "0",
                recommendedShipDate: data["Recommended ship date"] || data["recommended-ship-date"] || "",
                
                // Storage
                unitStorageSize: data["Unit storage size"] || data["unit-storage-size"] || ""
            });
        })

        const createReport= await RestockInventoryRecommendations.create({
            User:userId,
            region:region,
            country:country,
            Products:products
        })

        const getUser=await UserModel.findById(userId);
        if(!getUser){
            logger.error(new ApiError(404,"User not found"));
            return false;
        }
        getUser.restockInventoryRecommendations=createReport._id;
        await getUser.save();

        logger.info("Data saved successfully");
        logger.info("GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT ended");
        return createReport;

    } catch (error) {
        logger.error("Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

/**
 * Convert TSV buffer to JSON using csv-parse library
 * More robust handling of malformed data, encoding issues, and edge cases
 */
function convertTSVToJson(tsvBuffer) {
    try {
        const tsv = tsvBuffer.toString("utf-8");
        
        if (!tsv || tsv.trim().length === 0) {
            logger.warn('[GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT] TSV buffer is empty');
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

        logger.info('[GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT] TSV parsed successfully', { 
            totalRecords: records.length 
        });

        return records;

    } catch (error) {
        logger.error('[GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT] TSV parsing failed', { 
            error: error.message 
        });

        // Fallback to legacy parsing
        try {
            return convertTSVToJsonLegacy(tsvBuffer);
        } catch (fallbackError) {
            logger.error('[GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT] Fallback parsing also failed', { 
                error: fallbackError.message 
            });
            return [];
        }
    }
}

function convertTSVToJsonLegacy(tsvBuffer) {
    const tsv = tsvBuffer.toString("utf-8");
    const rows = tsv.split("\n").filter(row => row.trim() !== "");
    if (rows.length === 0) return [];
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

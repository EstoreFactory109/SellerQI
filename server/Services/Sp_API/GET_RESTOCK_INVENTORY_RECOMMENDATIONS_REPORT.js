const axios = require("axios");
const { parseAsync, yieldToEventLoop } = require('../../utils/asyncCsvParser');
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const RestockInventoryRecommendations = require('../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js'); 
const UserModel = require('../../models/user-auth/userModel.js');
const { getReportOptions, normalizeHeaders } = require('../../utils/ReportHeaderMapping');

const generateReport = async (accessToken, marketplaceIds,baseuri) => {
    // console.log(marketplaceIds);
    try {
        const now = new Date();
        const EndTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        const StartTime = new Date(EndTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 7 days before end
        const reportType = "GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT";
        const requestBody = {
            reportType: reportType,
            marketplaceIds: marketplaceIds, 
            dataStartTime: StartTime.toISOString(),
            dataEndTime: EndTime.toISOString(),
        };
        
        // Add reportOptions to request English headers (for non-English marketplaces)
        const reportOptions = getReportOptions(reportType);
        if (reportOptions) {
            requestBody.reportOptions = reportOptions;
        }
        
        const response = await axios.post(
            `https://${baseuri}/reports/2021-06-30/reports`,
            requestBody,
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

// Returned by checkReportStatus for DONE_NO_DATA. Distinct from false (failed)
// and null (still processing) so the poll loop can save an empty snapshot.
const NO_DATA = 'DONE_NO_DATA';

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

            // Was missing, so a queued report fell to `default` and the inline
            // run gave up as failed on its first poll.
            case "IN_QUEUE":
                return null;

            case "DONE_NO_DATA":
                // Amazon's answer when it has nothing to recommend: a result to
                // save as an empty snapshot, not a failure.
                logger.info("Report completed with no data (no restock recommendations).");
                return NO_DATA;

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
            if (reportDocumentId === NO_DATA) {
                return await _saveRestockProducts([], userId, country, region);
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

        return await _processRestockDocument(accessToken, reportDocumentId, baseuri, userId, country, region);

    } catch (error) {
        logger.error("Error in getReport:", error.message);
        throw new ApiError(500, error.message);
    }
};

// Extracted post-poll step (download → parse TSV → save). Shared by the inline path
// (above) and the P8 async adapter (below) — one source, identical data.
async function _processRestockDocument(accessToken, reportDocumentId, baseuri, userId, country, region) {
        const reportUrl = await getReportLink(accessToken, reportDocumentId,baseuri);

        const fullReport = await axios({
            method: "GET",
            url: reportUrl,
            responseType: "arraybuffer",
        });

        if (!fullReport || !fullReport.data) {
            throw new ApiError(500, "Internal server error in generating the report");
        }

        const refinedData = await convertTSVToJson(fullReport.data);

        // A downloaded report with no rows is Amazon saying "nothing to
        // restock". It used to be logged as a 5-minute timeout and not saved,
        // which left the previous recommendations standing as current.
        if (refinedData.length === 0) {
            logger.info("GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT returned no rows; saving an empty snapshot");
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

        return await _saveRestockProducts(products, userId, country, region);
}

// Save step shared by a downloaded report and DONE_NO_DATA. An empty products
// array is saved too, so the newest document reflects Amazon's latest answer.
async function _saveRestockProducts(products, userId, country, region) {
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
}

/**
 * Convert TSV buffer to JSON using async streaming parser.
 * Uses async parsing to prevent blocking the event loop during large file processing.
 */
async function convertTSVToJson(tsvBuffer) {
    try {
        const records = await parseAsync(tsvBuffer, {
            delimiter: '\t',
            columns: true,
            reportType: 'GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT'
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
            // Thrown, not `return []`: an empty result is now saved as "no
            // problems", so an unreadable report must not be mistaken for one.
            throw new Error(`[GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT] report could not be parsed: ${fallbackError.message}`);
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

// P8: Non-blocking async adapter — reuses _processRestockDocument (same code as inline).
const { checkSpApiStatusOnce } = require('./spApiReportAdapter.js');
getReport.spApiAsync = {
    serviceName: 'RestockinventoryData',
    buildSpecs: ({ userId, country, region, accessToken, baseuri, marketplaceIds }) => ([{
        service: 'RestockinventoryData',
        paramsKey: 'default',
        params: {},
        marketplaceId: '',
        submit: async () => await generateReport(accessToken, marketplaceIds, baseuri),
        checkStatusOnce: (reportId) => checkSpApiStatusOnce(accessToken, reportId, baseuri),
        finalize: async (handle) => {
            // DONE_NO_DATA arrives here with no document to download. Passing it
            // to the download threw, so the run was recorded FAILED and the old
            // recommendations stayed the newest.
            if (!handle?.reportDocumentId) {
                await _saveRestockProducts([], userId, country, region);
                return { empty: true };
            }
            const r = await _processRestockDocument(accessToken, handle.reportDocumentId, baseuri, userId, country, region);
            return { empty: !!r && Array.isArray(r.Products) && r.Products.length === 0 };
        },
    }]),
    saveFromRows: async () => ({ documentsSaved: 0 }),
};

module.exports = getReport;

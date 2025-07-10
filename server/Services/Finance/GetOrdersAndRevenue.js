const axios = require("axios");
const logger = require("../../utils/Logger");
const { ApiError } = require('../../utils/ApiError');
const OrderAndRevenue=require('../../models/OrderAndRevenueModel.js');

const generateReport = async (accessToken, marketplaceIds, baseURI, startTime, endTime) => {
    try {
        const response = await axios.post(
            `https://${baseURI}/reports/2021-06-30/reports`,
            {
                reportType: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
                marketplaceIds: marketplaceIds,
                dataStartTime: startTime.toISOString(),
                dataEndTime: endTime.toISOString(),
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

const convertTSVToJson = (tsvBuffer) => {
    const decoder = new TextDecoder('utf-8');
    const tsv = decoder.decode(tsvBuffer);
    const rows = tsv.split("\n").filter(row => row.trim() !== ""); // Filter empty lines
    const headers = rows[0].split("\t");

    const result = [];
    // Process rows one by one
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i].split("\t");
        const rowData = headers.reduce((obj, header, index) => {
            obj[header] = row[index] || "";
            return obj;
        }, {});
        result.push(rowData);
    }

    return result;
};

const transformOrderDataForDB = (rawOrderData) => {
    try {
        const revenueData = rawOrderData.map(order => {
            // Helper function to safely parse numbers
            const parseNumber = (value) => {
                if (!value || value === "" || value === "-") return 0;
                const parsed = parseFloat(value);
                return isNaN(parsed) ? 0 : parsed;
            };

            // Helper function to safely parse integer
            const parseInteger = (value) => {
                if (!value || value === "" || value === "-") return 0;
                const parsed = parseInt(value);
                return isNaN(parsed) ? 0 : parsed;
            };

            return {
                amazonOrderId: order["amazon-order-id"] || "",
                orderDate: order["purchase-date"] ? new Date(order["purchase-date"]) : new Date(),
                orderStatus: order["order-status"] || "",
                productName: order["product-name"] || "",
                asin: order["asin"] || "",
                sku: order["sku"] || "",
                itemPrice: parseNumber(order["item-price"]),
                quantity: parseInteger(order["quantity"]),
                itemTax: parseNumber(order["item-tax"]),
                shippingPrice: parseNumber(order["shipping-price"]),
                shippingTax: parseNumber(order["shipping-tax"]),
                giftWrapPrice: parseNumber(order["gift-wrap-price"]),
                giftWrapTax: parseNumber(order["gift-wrap-tax"]),
                itemPromotionDiscount: parseNumber(order["item-promotion-discount"]),
                shippingPromotionDiscount: parseNumber(order["ship-promotion-discount"])
            };
        });

        return revenueData;
    } catch (error) {
        logger.error("❌ Error transforming order data:", error.message);
        return [];
    }
};

const saveOrderDataToDB = async (userId, region, country, revenueData) => {
    try {
        // Check if document already exists for this user, region, and country
        let existingDocument = await OrderAndRevenue.findOne({
            User: userId,
            region: region,
            country: country
        });

        if (existingDocument) {
            // Filter out orders that already exist (by amazonOrderId)
            const existingOrderIds = new Set(
                existingDocument.RevenueData.map(order => order.amazonOrderId)
            );
            
            const newOrders = revenueData.filter(order => 
                !existingOrderIds.has(order.amazonOrderId)
            );

            if (newOrders.length > 0) {
                // Add new orders to existing document
                existingDocument.RevenueData.push(...newOrders);
                await existingDocument.save();
                logger.info(`✅ Added ${newOrders.length} new orders to existing document`);
            } else {
                logger.info("ℹ️ No new orders to add - all orders already exist");
            }
            
            return existingDocument;
        } else {
            // Create new document
            const newOrderAndRevenue = new OrderAndRevenue({
                User: userId,
                region: region,
                country: country,
                RevenueData: revenueData
            });

            const savedDocument = await newOrderAndRevenue.save();
            logger.info(`✅ Created new document with ${revenueData.length} orders`);
            return savedDocument;
        }
    } catch (error) {
        logger.error("❌ Error saving order data to database:", error.message);
        throw error;
    }
};

const getReportForPeriod = async (accessToken, marketplaceIds, baseURI, startTime, endTime, periodLabel) => {
    try {
        logger.info(`📄 Generating Report for ${periodLabel}...`);
        const reportId = await generateReport(accessToken, marketplaceIds, baseURI, startTime, endTime);
        
        if (!reportId) {
            logger.error(`❌ Failed to generate report for ${periodLabel}`);
            return [];
        }

        let reportDocumentId = null;
        let retries = 30;

        while (!reportDocumentId && retries > 0) {
            logger.info(`⏳ Checking report status for ${periodLabel}... (Retries left: ${retries})`);
            await new Promise((resolve) => setTimeout(resolve, 20000));
            reportDocumentId = await checkReportStatus(accessToken, reportId, baseURI);
            if (reportDocumentId === false) {
                logger.error(`❌ Report failed for ${periodLabel}`);
                return [];
            }
            retries--;
        }

        if (!reportDocumentId) {
            logger.error(`❌ Report did not complete within timeout for ${periodLabel}`);
            return [];
        }

        logger.info(`✅ Report Ready for ${periodLabel}! Document ID: ${reportDocumentId}`);

        logger.info(`📥 Downloading Report for ${periodLabel}...`);
        const reportUrl = await getReportLink(accessToken, reportDocumentId, baseURI);

        const fullReport = await axios({
            method: "GET",
            url: reportUrl,
            responseType: "arraybuffer",
        });

        if (!fullReport || !fullReport.data) {
            logger.error(`❌ Failed to download report for ${periodLabel}`);
            return [];
        }

        const refinedData = convertTSVToJson(fullReport.data);
        logger.info(`✅ Successfully processed ${refinedData.length} records for ${periodLabel}`);

        return refinedData;

    } catch (error) {
        logger.error(`❌ Error in getReportForPeriod for ${periodLabel}:`, error.message);
        return [];
    }
};



const getReport = async (accessToken, marketplaceIds, userId, country, region, baseURI) => {
    if (!accessToken || !marketplaceIds) {
        logger.error(new ApiError(400, "Credentials are missing"));
        return false;
    }

    try {
        const now = new Date();
        const endTime = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes before now
        
        // Define time periods
        const periods = [
            {
                label: "Period 1 (7 days)",
                days: 7,
                startOffset: 30, // 30 days ago
                endOffset: 23    // 23 days ago
            },
            {
                label: "Period 2 (7 days)", 
                days: 7,
                startOffset: 23, // 23 days ago
                endOffset: 16    // 16 days ago
            },
            {
                label: "Period 3 (7 days)",
                days: 7, 
                startOffset: 16, // 16 days ago
                endOffset: 9     // 9 days ago
            },
            {
                label: "Period 4 (9 days)",
                days: 9,
                startOffset: 9,  // 9 days ago
                endOffset: 0     // to endTime (2 minutes ago)
            }
        ];

        const allResults = [];

        // Process each period
        for (const period of periods) {
            logger.info(`🚀 Starting ${period.label}...`);
            
            const periodStartTime = new Date(endTime.getTime() - period.startOffset * 24 * 60 * 60 * 1000);
            const periodEndTime = period.endOffset === 0 ? endTime : new Date(endTime.getTime() - period.endOffset * 24 * 60 * 60 * 1000);
            
            logger.info(`📅 ${period.label}: ${periodStartTime.toISOString()} to ${periodEndTime.toISOString()}`);
            
            const periodData = await getReportForPeriod(
                accessToken, 
                marketplaceIds, 
                baseURI, 
                periodStartTime, 
                periodEndTime, 
                period.label
            );
            
            if (periodData.length > 0) {
                allResults.push(...periodData);
                logger.info(`✅ Added ${periodData.length} records from ${period.label}`);
            } else {
                logger.warn(`⚠️ No data found for ${period.label}`);
            }
            
            // Add a small delay between requests to avoid rate limiting
            if (period !== periods[periods.length - 1]) {
                logger.info("⏳ Waiting 30 seconds before next period...");
                await new Promise((resolve) => setTimeout(resolve, 30000));
            }
        }

        logger.info(`🎉 All periods completed! Total records: ${allResults.length}`);
        
        if (allResults.length === 0) {
            logger.warn("⚠️ No data found across all periods");
            return [];
        }

        // Transform data for database storage
        logger.info("🔄 Transforming data for database storage...");
        const transformedData = transformOrderDataForDB(allResults);
        
        if (transformedData.length === 0) {
            logger.warn("⚠️ No valid data after transformation");
            return allResults;
        }

        // Calculate total sales and discounts (only for shipped, Unshipped, or PartiallyShipped orders)
        const validStatuses = ['Shipped', 'Unshipped', 'PartiallyShipped'];
        const validOrders = transformedData.filter(order => 
            validStatuses.includes(order.orderStatus)
        );
        
        const totalSales = validOrders.reduce((total, order) => {
            return total + (order.itemPrice * order.quantity);
        }, 0);
        
        const totalItemPromotionDiscount = validOrders.reduce((total, order) => {
            return total + order.itemPromotionDiscount;
        }, 0);
        
        const totalShippingPromotionDiscount = validOrders.reduce((total, order) => {
            return total + order.shippingPromotionDiscount;
        }, 0);
        
        const totalAfterDiscounts = totalSales - totalItemPromotionDiscount - totalShippingPromotionDiscount;

        // console.log("totalAfterDiscounts: ", totalAfterDiscounts);

        const productWiseSales= transformedData.map(order=>{
            if(order.orderStatus === 'Shipped' || order.orderStatus === 'Unshipped' || order.orderStatus === 'PartiallyShipped'){
                return {
                    asin: order.asin,
                    quantity: order.quantity,
                    amount: order.itemPrice 
                }
            }
        })
        


        // Save to database
        logger.info("💾 Saving order data to database...");
        await saveOrderDataToDB(userId, region, country, transformedData);
        
        logger.info(`✅ Successfully processed and saved ${transformedData.length} orders to database`);
        
        return {totalAfterDiscounts,productWiseSales,transformedData};

    } catch (error) {
        logger.error("❌ Error in getReport:", error.message);
        return false;
    }
};

module.exports = getReport;

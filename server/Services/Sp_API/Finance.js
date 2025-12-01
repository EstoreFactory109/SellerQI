// ===== FINANCE FUNCTION WITH RETRY LOGIC DISABLED =====
// The following sections have been commented out:
// - Retry logic in API requests (makeAPIRequestWithRetry)
// - Rate limiting delays and request counting
// - Exponential backoff retry mechanisms

const axios = require('axios');
const aws4 = require('aws4');
const listFinancialEvents = require('../../models/finance/listFinancialEventsModel.js');
const ProductWiseSales = require('../../models/products/ProductWiseSalesModel.js');
const UserModel = require('../../models/user-auth/userModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError');
const getReport = require('../Finance/GetOrdersAndRevenue.js');
const {processWeeklyFinanceData} = require('../Finance/WeeklyFinaceData.js');

// Rate limiting constants
const RATE_LIMIT = {
    BURST_LIMIT: 10,
    REQUESTS_PER_SECOND: 1,
    MIN_REQUEST_INTERVAL: 60000, // 2 seconds (1/0.5)
    MAX_RETRY_ATTEMPTS: 10,
    MAX_BACKOFF_DELAY: 300000 // 5 minutes
};

// Helper function for delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to make API request without retry logic
async function makeAPIRequest(url, headers) {
    try {
        const response = await axios.get(url, { headers });
        return response;
    } catch (error) {
        // Log error and throw immediately without retries
        logger.error(`API request failed: ${error.message}`);
        throw error;
    }
}

const listFinancialEventsMethod = async (dataToReceive, userId, baseuri, country, region) => {
    logger.info("Finance starting");
    
    const host = baseuri;

    if (!dataToReceive || !userId || !baseuri || !country || !region) {
        logger.error("Missing required parameters for listFinancialEventsMethod");
        return [];
    }

    const reportResult = await getReport(dataToReceive.AccessToken, [dataToReceive.marketplaceId], userId, country, region, baseuri);
    const weeklyFinanceData = await processWeeklyFinanceData(dataToReceive, userId, baseuri, country, region);

    let allTransactions = [];
    let nextToken = null;
    let totalPages = 0;

    try {
        do {
            totalPages++;
            
            const queryParams = new URLSearchParams({
                postedAfter: dataToReceive.after,
                postedBefore: dataToReceive.before,
                marketplaceId: dataToReceive.marketplaceId,
                ...(nextToken && { nextToken: nextToken })
            }).toString();

            const path = `/finances/2024-06-19/transactions?${queryParams}`;

            let request = {
                host: host,
                path: path,
                method: "GET",
                headers: {
                    "host": host,
                    "user-agent": "MyApp/1.0",
                    "content-type": "application/json",
                    "x-amz-access-token": dataToReceive.AccessToken
                }
            };

            aws4.sign(request, {
                accessKeyId: dataToReceive.AccessKey,
                secretAccessKey: dataToReceive.SecretKey,
                sessionToken: dataToReceive.SessionToken,
                service: 'execute-api',
                region: 'us-east-1'
            });

            const response = await makeAPIRequest(
                `https://${request.host}${request.path}`,
                request.headers
            );

            const responseData = response.data?.payload;

            if (!responseData) {
                logger.error("No payload in API response");
                break;
            }

            if (responseData.transactions && Array.isArray(responseData.transactions)) {
                allTransactions.push(...responseData.transactions);
            }
            
            nextToken = responseData.nextToken;
            
        } while (nextToken);

        if (allTransactions.length === 0) {
            
            const emptyFinanceData = await listFinancialEvents.create({
                User: userId,
                region: region,
                country: country,
                Total_Sales: "0.00",
                Gross_Profit: "0.00",
                ProductAdsPayment: "0.00",
                FBA_Fees: "0.00",
                Amazon_Charges: "0.00",
                Refunds: "0.00",
                Storage: "0.00",
            });

            await ProductWiseSales.create({
                User: userId,
                region: region,
                country: country,
                productWiseSales: []
            });

            // Update user record with empty finance data
            try {
                const getUser = await UserModel.findById(userId);
                if (getUser) {
                    getUser.listFinancialEvents = emptyFinanceData._id;
                    await getUser.save();
                }
            } catch (userUpdateError) {
                logger.error(`Failed to update user with empty financial events ID: ${userUpdateError.message}`);
                // Continue - non-critical error
            }

            return emptyFinanceData;
        }
        
        const dataObj = calculateAmazonFees(allTransactions, reportResult?.grossRevenue, reportResult?.productWiseSales);

        let addToDb, addToSalesDb;
        
        try {
            addToDb = await listFinancialEvents.create({
                User: userId,
                region: region,
                country: country,
                Total_Sales: dataObj.Total_Sales,
                Gross_Profit: dataObj.Gross_Profit,
                ProductAdsPayment: dataObj.ProductAdsPayment,
                FBA_Fees: dataObj.FBA_Fees,
                Amazon_Charges: dataObj.Amazon_Charges,
                Refunds: dataObj.Refunds,
                Storage: dataObj.Storage,
            });

            addToSalesDb = await ProductWiseSales.create({
                User: userId,
                region: region,
                country: country,
                productWiseSales: dataObj.ProductWiseSales
            });
        } catch (dbError) {
            logger.error(`Database operation failed: ${dbError.message}`);
            throw new ApiError(500, "Failed to save financial data to database");
        }

        try {
            const getUser = await UserModel.findById(userId);
            if (getUser) {
                getUser.listFinancialEvents = addToDb._id;
                await getUser.save();
            }
        } catch (userUpdateError) {
            logger.error(`Failed to update user with financial events ID: ${userUpdateError.message}`);
        }

        logger.info("Data saved successfully");
        logger.info("Finance ended");
        return addToDb;

    } catch (error) {
        logger.error("Error in Finance:", error.message);
        throw new ApiError(500, `Failed to fetch financial events: ${error.message}`);
    }
};

const calculateAmazonFees = (dataArray,Sales,ProductWiseSales) => {
    // Initialize all fee categories
    let totalSales = Sales;
    let totalFBAFees = 0;
    let totalRefunds = 0;
    let productAdsPayment = 0;
    let amazonCharges = 0;
    let storageCharges = 0;
    let debtRecovery = 0;
    let adjustment = 0;
    let otherServiceFees = 0;
    let productWiseSales = [];
    
    //const asinSalesMap = new Map();

    // Validate input
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
        logger.warn("No transactions to process");
        return {
            Total_Sales: "0.00",
            Gross_Profit: "0.00",
            ProductAdsPayment: "0.00",
            FBA_Fees: "0.00",
            Amazon_Charges: "0.00",
            Refunds: "0.00",
            Storage: "0.00",
            ProductWiseSales: []
        };
    }

    // Process each transaction
    dataArray.forEach((transaction, index) => {
        try {
            if (!transaction || typeof transaction !== 'object') {
                logger.warn(`Skipping invalid transaction at index ${index}`);
                return;
            }
            
            const amount = transaction.totalAmount?.currencyAmount || 0;
            const transactionType = transaction.transactionType;
            const description = transaction.description || '';

            switch (transactionType) {
                case "Refund":
                    totalRefunds += amount;
                    break;

                case "ProductAdsPayment":
                    productAdsPayment += amount;
                    break;

                case "DebtRecovery":
                    debtRecovery += amount;
                    break;

                case "Adjustment":
                    adjustment += amount;
                    break;

                case "ServiceFee":
                    if (description.toLowerCase().includes("subscription")) {
                        amazonCharges += amount;
                    } else if (description.toLowerCase().includes("storage") || 
                              description === "FBAStorageBilling") {
                        storageCharges += amount;
                    } else if (description.toLowerCase().includes("fba")) {
                        totalFBAFees += amount;
                    } else {
                        otherServiceFees += amount;
                    }
                    break;

                

                default:
                   // logger.debug(`Unhandled transaction type: ${transactionType}, amount: ${amount}`);
                    break;
            }
        } catch (error) {
            logger.error(`Error processing transaction at index ${index}:`, error);
        }
    });

    // Convert Map to array
    productWiseSales = Array.from(ProductWiseSales);

    // Subtract refunds from total sales (refunds reduce total sales)
    totalSales = totalSales - Math.abs(totalRefunds);
            // console.log("totalSales after refunds:", totalSales);
        // console.log("totalRefunds:", totalRefunds);

    // Calculate gross profit
    const totalGrossProfit = totalSales + productAdsPayment + 
                           totalFBAFees + amazonCharges + storageCharges + 
                           debtRecovery + adjustment + otherServiceFees;

    return {
        Total_Sales: totalSales.toFixed(2),
        Gross_Profit: totalGrossProfit.toFixed(2),
        ProductAdsPayment: Math.abs(productAdsPayment).toFixed(2),
        FBA_Fees: Math.abs(totalFBAFees + otherServiceFees).toFixed(2),
        Amazon_Charges: Math.abs(amazonCharges).toFixed(2),
        Refunds: Math.abs(totalRefunds).toFixed(2),
        Storage: Math.abs(storageCharges).toFixed(2),
        ProductWiseSales: productWiseSales
    };
};

module.exports = { listFinancialEventsMethod, calculateAmazonFees };
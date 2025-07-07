const axios = require('axios');
const aws4 = require('aws4');
const listFinancialEvents = require('../../models/listFinancialEventsModel.js');
const ProductWiseSales = require('../../models/ProductWiseSalesModel.js');
const UserModel = require('../../models/userModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError');
const getReport = require('../Finance/GetOrdersAndRevenue.js');

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

// Helper function to make API request with retry logic
async function makeAPIRequestWithRetry(url, headers, retryAttempt = 0) {
    try {
        const response = await axios.get(url, { headers });
        return response;
    } catch (error) {
        // Handle rate limit error (429)
        if (error.response?.status === 429 && retryAttempt < RATE_LIMIT.MAX_RETRY_ATTEMPTS) {
            const retryAfter = error.response.headers['retry-after'];
            const baseDelay = retryAfter ? parseInt(retryAfter) * 1000 : RATE_LIMIT.MIN_REQUEST_INTERVAL;
            
            // Exponential backoff with jitter
            const backoffDelay = Math.min(
                baseDelay * Math.pow(2, retryAttempt) + Math.random() * 1000,
                RATE_LIMIT.MAX_BACKOFF_DELAY
            );
            
            logger.warn(`Rate limit hit. Retry attempt ${retryAttempt + 1}/${RATE_LIMIT.MAX_RETRY_ATTEMPTS}. Waiting ${backoffDelay/1000}s...`);
            await delay(backoffDelay);
            
            return makeAPIRequestWithRetry(url, headers, retryAttempt + 1);
        }
        
        // For other errors or max retries reached
        throw error;
    }
}

const listFinancialEventsMethod = async (dataToReceive, userId, baseuri, country, region) => {
    const host = baseuri;
    console.log("dataToReceive", dataToReceive);
    logger.info("Starting listFinancialEventsMethod", {
        userId,
        country,
        region,
        dateRange: {
            after: dataToReceive?.after,
            before: dataToReceive?.before
        }
    });

    // Validate required parameters
    if (!dataToReceive || !userId || !baseuri || !country || !region) {
        logger.error("Missing required parameters for listFinancialEventsMethod");
        return [];
    }

    const reportResult = await getReport(dataToReceive.AccessToken, [dataToReceive.marketplaceId], userId, country, region, baseuri);

    
    console.log("reportResult", reportResult.totalAfterDiscounts);
    

  

    
   
    // Rate limiting state
    let requestCount = 0;
    let lastRequestTime = 0;
    
    // Collect all transactions
    let allTransactions = [];
    let nextToken = null;
    let totalPages = 0;

    try {
        do {
            requestCount++;
            totalPages++;
            
            // Rate limiting logic
            if (requestCount > RATE_LIMIT.BURST_LIMIT) {
                const timeSinceLastRequest = Date.now() - lastRequestTime;
                const requiredDelay = RATE_LIMIT.MIN_REQUEST_INTERVAL - timeSinceLastRequest;
                
                if (requiredDelay > 0) {
                    logger.info(`Rate limiting: Waiting ${requiredDelay}ms before request #${requestCount}`);
                    await delay(requiredDelay);
                }
            }
            
            // Build query parameters
            const queryParams = new URLSearchParams({
                postedAfter: dataToReceive.after,
                postedBefore: dataToReceive.before,
                marketplaceId: dataToReceive.marketplaceId,
                ...(nextToken && { nextToken: nextToken })
            }).toString();

            const path = `/finances/2024-06-19/transactions?${queryParams}`;

            // Prepare request
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

            // Sign request
            aws4.sign(request, {
                accessKeyId: process.env.AWS_ACCESS_KEY,
                secretAccessKey: process.env.AWS_SECRET_KEY,
                sessionToken: dataToReceive.SessionToken
            });

            // Record request time
            lastRequestTime = Date.now();
            
            // Make API request with retry logic
            logger.info(`Making API request #${requestCount} (Page ${totalPages})`);
            const response = await makeAPIRequestWithRetry(
                `https://${request.host}${request.path}`,
                request.headers
            );

            const responseData = response.data?.payload;

            if (!responseData) {
                logger.error("No payload in API response");
                break;
            }

            // Log response info
            logger.info(`Page ${totalPages} received:`, {
                transactionCount: responseData.transactions?.length || 0,
                hasNextToken: !!responseData.nextToken
            });
            
            // Collect transactions
            if (responseData.transactions && Array.isArray(responseData.transactions)) {
                allTransactions.push(...responseData.transactions);
            }
            
            nextToken = responseData.nextToken;
            
        } while (nextToken);

        logger.info(`Financial events fetch completed:`, {
            totalRequests: requestCount,
            totalPages: totalPages,
            totalTransactions: allTransactions.length
        });
        
        // Handle empty results
        if (allTransactions.length === 0) {
            logger.warn("No financial transactions found for the specified date range");
            
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

            return emptyFinanceData;
        }

        // Calculate fees
        const dataObj = calculateAmazonFees(allTransactions,reportResult.totalAfterDiscounts,reportResult.productWiseSales);

        
      
        // Log summary
        logger.info("Amazon Fees Calculated:", {
            transactionCount: allTransactions.length,
            totalSales: dataObj.Total_Sales,
            grossProfit: dataObj.Gross_Profit,
            productCount: dataObj.ProductWiseSales.length
        });

        // Save to database
        let addToDb
        
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
            
            logger.info("Data saved to database successfully");
        } catch (dbError) {
            logger.error(`Database operation failed: ${dbError.message}`);
            throw new ApiError(500, "Failed to save financial data to database");
        }

        // Update user record
        try {
            const getUser = await UserModel.findById(userId);
            if (getUser) {
                getUser.listFinancialEvents = addToDb._id;
                await getUser.save();
                logger.info("User record updated with financial events ID");
            }
        } catch (userUpdateError) {
            logger.error(`Failed to update user with financial events ID: ${userUpdateError.message}`);
            // Continue - non-critical error
        }

        return addToDb;

    } catch (error) {
        // Log detailed error information
        if (error.response) {
            logger.error("API Error Response:", {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: error.response.headers
            });
            
            // Handle specific error codes
            if (error.response.status === 403) {
                throw new ApiError(403, "Access denied. Please check your credentials and permissions.");
            } else if (error.response.status === 400) {
                throw new ApiError(400, "Invalid request parameters. Please check your date range and marketplace ID.");
            }
        } else {
            logger.error("Request Error:", error.message);
        }
        
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
    console.log("totalSales after refunds:", totalSales);
    console.log("totalRefunds:", totalRefunds);

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
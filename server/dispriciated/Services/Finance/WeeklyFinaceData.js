const axios = require('axios');
const aws4 = require('aws4');
// Deprecated: listFinancialEventsModel removed - use EconomicsMetrics instead
// const listFinancialEvents = require('../../models/finance/listFinancialEventsModel.js');
const ProductWiseSales = require('../../models/products/ProductWiseSalesModel.js');
const WeekLyFinanceModel = require('../../models/finance/WeekLyFinanceModel.js');
const UserModel = require('../../models/user-auth/userModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError');
//const getReport = require('../Finance/GetOrdersAndRevenue.js');

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

// Helper function to divide date range into 4 weekly periods
const divideDateRangeIntoWeeks = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Calculate periods
    const periods = [];
    
    // First 7 days
    const firstWeekEnd = new Date(start);
    firstWeekEnd.setDate(start.getDate() + 6);
    periods.push({
        start: start.toISOString(),
        end: firstWeekEnd.toISOString(),
        name: 'FirstSevenDays'
    });
    
    // Second 7 days
    const secondWeekStart = new Date(firstWeekEnd);
    secondWeekStart.setDate(firstWeekEnd.getDate() + 1);
    const secondWeekEnd = new Date(secondWeekStart);
    secondWeekEnd.setDate(secondWeekStart.getDate() + 6);
    periods.push({
        start: secondWeekStart.toISOString(),
        end: secondWeekEnd.toISOString(),
        name: 'SecondSevenDays'
    });
    
    // Third 7 days
    const thirdWeekStart = new Date(secondWeekEnd);
    thirdWeekStart.setDate(secondWeekEnd.getDate() + 1);
    const thirdWeekEnd = new Date(thirdWeekStart);
    thirdWeekEnd.setDate(thirdWeekStart.getDate() + 6);
    periods.push({
        start: thirdWeekStart.toISOString(),
        end: thirdWeekEnd.toISOString(),
        name: 'ThirdSevenDays'
    });
    
    // Fourth period (remaining days, typically 9 days)
    const fourthWeekStart = new Date(thirdWeekEnd);
    fourthWeekStart.setDate(thirdWeekEnd.getDate() + 1);
    periods.push({
        start: fourthWeekStart.toISOString(),
        end: end.toISOString(),
        name: 'FourthNineDays'
    });
    
    return periods;
};

// New main function for weekly finance data processing
const processWeeklyFinanceData = async (dataToReceive, userId, baseuri, country, region) => {
    logger.info("Starting processWeeklyFinanceData", {
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
        logger.error("Missing required parameters for processWeeklyFinanceData");
        throw new ApiError(400, "Missing required parameters");
    }

    try {
        // Divide the date range into 4 weekly periods
        const periods = divideDateRangeIntoWeeks(dataToReceive.after, dataToReceive.before);
        
        logger.info("Date range divided into periods:", {
            originalRange: {
                start: dataToReceive.after,
                end: dataToReceive.before
            },
            periods: periods.map(p => ({
                name: p.name,
                start: p.start,
                end: p.end
            }))
        });
        
        const weeklyFinanceData = {};
        
        // Process each period
        for (const period of periods) {
            logger.info(`Processing period: ${period.name}`, {
                start: period.start,
                end: period.end
            });
            
            try {
                // Create modified dataToReceive for this period
                const periodDataToReceive = {
                    ...dataToReceive,
                    after: period.start,
                    before: period.end
                };
                
                // Process financial events for this period
                const periodData = await listWeeklyFinancialEventsForPeriod(
                    periodDataToReceive, 
                    userId, 
                    baseuri, 
                    country, 
                    region
                );
                
                logger.info(`Period ${period.name} data received:`, {
                    ProductAdsPayment: periodData.ProductAdsPayment,
                    FBA_Fees: periodData.FBA_Fees,
                    Amazon_Charges: periodData.Amazon_Charges,
                    Refunds: periodData.Refunds,
                    Storage: periodData.Storage
                });
                
                // Structure the data for the model
                weeklyFinanceData[period.name] = {
                    ProductAdsPayment: periodData.ProductAdsPayment,
                    FBA_Fees: periodData.FBA_Fees,
                    Amazon_Charges: periodData.Amazon_Charges,
                    Refunds: periodData.Refunds,
                    Storage: periodData.Storage,
                    startDate: period.start,
                    endDate: period.end
                };
                
                logger.info(`Period ${period.name} structured successfully`);
                
            } catch (periodError) {
                logger.error(`Error processing period ${period.name}:`, {
                    error: periodError.message,
                    stack: periodError.stack,
                    period: period
                });
                
                // Set default values for failed period
                weeklyFinanceData[period.name] = {
                    ProductAdsPayment: "0.00",
                    FBA_Fees: "0.00",
                    Amazon_Charges: "0.00",
                    Refunds: "0.00",
                    Storage: "0.00",
                    startDate: period.start,
                    endDate: period.end
                };
                
                logger.warn(`Period ${period.name} set to default values due to error`);
            }
            
            // Add delay between periods to respect rate limits
            if (periods.indexOf(period) < periods.length - 1) {
                await delay(2000); // 2 second delay between periods
            }
        }
        
        // Validate that all 4 periods are populated
        const requiredPeriods = ['FirstSevenDays', 'SecondSevenDays', 'ThirdSevenDays', 'FourthNineDays'];
        const missingPeriods = requiredPeriods.filter(period => !weeklyFinanceData[period]);
        
        if (missingPeriods.length > 0) {
            logger.error("Missing required periods:", {
                missingPeriods,
                availablePeriods: Object.keys(weeklyFinanceData)
            });
            throw new ApiError(500, `Missing required periods: ${missingPeriods.join(', ')}`);
        }

        // Validate that each period has all required fields
        for (const period of requiredPeriods) {
            const periodData = weeklyFinanceData[period];
            const requiredFields = ['ProductAdsPayment', 'FBA_Fees', 'Amazon_Charges', 'Refunds', 'Storage', 'startDate', 'endDate'];
            const missingFields = requiredFields.filter(field => !periodData[field] && periodData[field] !== '0.00');
            
            if (missingFields.length > 0) {
                logger.error(`Missing required fields in ${period}:`, {
                    missingFields,
                    periodData
                });
                throw new ApiError(500, `Missing required fields in ${period}: ${missingFields.join(', ')}`);
            }
        }

        // Log the data structure before saving
        logger.info("Weekly finance data structure to save:", {
            userId,
            region,
            country,
            weeklyFinanceData: JSON.stringify(weeklyFinanceData, null, 2)
        });

        // Save to WeekLyFinanceModel
        let weeklyFinanceRecord;
        try {
            weeklyFinanceRecord = await WeekLyFinanceModel.create({
                User: userId,
                region: region,
                country: country,
                weeklyFinanceData: weeklyFinanceData
            });
            
            logger.info("Weekly finance data saved successfully", {
                recordId: weeklyFinanceRecord._id
            });
        } catch (dbError) {
            logger.error("Database save error:", {
                error: dbError.message,
                stack: dbError.stack,
                data: {
                    userId,
                    region,
                    country,
                    weeklyFinanceData
                }
            });
            throw new ApiError(500, `Failed to save weekly finance data: ${dbError.message}`);
        }
        
        return weeklyFinanceRecord;
        
    } catch (error) {
        logger.error("Error in processWeeklyFinanceData:", error);
        throw new ApiError(500, `Failed to process weekly finance data: ${error.message}`);
    }
};

const listWeeklyFinancialEventsMethod = async (dataToReceive, userId, baseuri, country, region) => {
    const host = baseuri;
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

   // const reportResult = await getReport(dataToReceive.AccessToken, [dataToReceive.marketplaceId], userId, country, region, baseuri);
    
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
        const dataObj = calculateAmazonFees(allTransactions);
        
        // Log summary
        logger.info("Amazon Fees Calculated:", {
            transactionCount: allTransactions.length,
            totalSales: dataObj.Total_Sales,
            grossProfit: dataObj.Gross_Profit,
            productCount: dataObj.ProductWiseSales.length
        });

        // Save to database
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

// Modified version of the original function for processing a single period
const listWeeklyFinancialEventsForPeriod = async (dataToReceive, userId, baseuri, country, region) => {
    const host = baseuri;
    
    logger.info("Starting listWeeklyFinancialEventsForPeriod", {
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
        logger.error("Missing required parameters for listWeeklyFinancialEventsForPeriod");
        return {
            ProductAdsPayment: "0.00",
            FBA_Fees: "0.00",
            Amazon_Charges: "0.00",
            Refunds: "0.00",
            Storage: "0.00"
        };
    }

    try {
      //  const reportResult = await getReport(dataToReceive.AccessToken, [dataToReceive.marketplaceId], userId, country, region, baseuri);
        
        // Rate limiting state
        let requestCount = 0;
        let lastRequestTime = 0;
        
        // Collect all transactions
        let allTransactions = [];
        let nextToken = null;
        let totalPages = 0;

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
            logger.info(`Making API request #${requestCount} (Page ${totalPages}) for period`);
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
            logger.info(`Page ${totalPages} received for period:`, {
                transactionCount: responseData.transactions?.length || 0,
                hasNextToken: !!responseData.nextToken
            });
            
            // Collect transactions
            if (responseData.transactions && Array.isArray(responseData.transactions)) {
                allTransactions.push(...responseData.transactions);
            }
            
            nextToken = responseData.nextToken;
            
        } while (nextToken);

        logger.info(`Financial events fetch completed for period:`, {
            totalRequests: requestCount,
            totalPages: totalPages,
            totalTransactions: allTransactions.length
        });
        
        // Handle empty results
        if (allTransactions.length === 0) {
            logger.warn("No financial transactions found for the specified period");
            return {
                ProductAdsPayment: "0.00",
                FBA_Fees: "0.00",
                Amazon_Charges: "0.00",
                Refunds: "0.00",
                Storage: "0.00"
            };
        }

        // Calculate fees for this period
        const dataObj = calculateAmazonFees(allTransactions);

        logger.info("Amazon Fees Calculated for period:", {
            transactionCount: allTransactions.length,
            totalSales: dataObj.Total_Sales,
            grossProfit: dataObj.Gross_Profit,
            productCount: dataObj.ProductWiseSales.length
        });

        // Ensure all fee values are strings
        const feeData = {
            ProductAdsPayment: dataObj.ProductAdsPayment || "0.00",
            FBA_Fees: dataObj.FBA_Fees || "0.00",
            Amazon_Charges: dataObj.Amazon_Charges || "0.00",
            Refunds: dataObj.Refunds || "0.00",
            Storage: dataObj.Storage || "0.00"
        };

        // Validate that all values are strings
        for (const [key, value] of Object.entries(feeData)) {
            if (typeof value !== 'string') {
                logger.warn(`Fee value ${key} is not a string:`, { key, value, type: typeof value });
                feeData[key] = "0.00";
            }
        }

        logger.info("Period fee data validated:", feeData);

        // Return only the fee data (don't save to database here)
        return feeData;

    } catch (error) {
        // Log detailed error information
        if (error.response) {
            logger.error("API Error Response for period:", {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: error.response.headers
            });
        } else {
            logger.error("Request Error for period:", error.message);
        }
        
        // Return zero values for this period on error
        return {
            ProductAdsPayment: "0.00",
            FBA_Fees: "0.00",
            Amazon_Charges: "0.00",
            Refunds: "0.00",
            Storage: "0.00"
        };
    }
};

const calculateAmazonFees = (dataArray) => {
    // Initialize all fee categories
    
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
   

    return {
        ProductAdsPayment: Math.abs(productAdsPayment).toFixed(2),
        FBA_Fees: Math.abs(totalFBAFees + otherServiceFees).toFixed(2),
        Amazon_Charges: Math.abs(amazonCharges).toFixed(2),
        Refunds: Math.abs(totalRefunds).toFixed(2),
        Storage: Math.abs(storageCharges).toFixed(2),
        ProductWiseSales: productWiseSales
    };
};

module.exports = { processWeeklyFinanceData };
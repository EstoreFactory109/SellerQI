const axios = require('axios');
const aws4 = require('aws4');
const listFinancialEvents = require('../../models/listFinancialEventsModel.js');
const ProductWiseSales = require('../../models/ProductWiseSalesModel.js');
const UserModel = require('../../models/userModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError');


const listFinancialEventsMethod = async (dataToReceive, userId, baseuri, country, region) => {
    const host = baseuri;

    console.log("📥 Incoming data:", dataToReceive);

    // Validate required parameters
    if (!dataToReceive || !userId || !baseuri || !country || !region) {
        logger.error("Missing required parameters for listFinancialEventsMethod");
        return [];
    }

    // Collect all transactions
    let allTransactions = [];
    let nextToken = null;

    try {
        do {
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
                accessKeyId: process.env.AWS_ACCESS_KEY,
                secretAccessKey: process.env.AWS_SECRET_KEY,
                sessionToken: dataToReceive.SessionToken // Only needed if temporary creds
            });

            const response = await axios.get(`https://${request.host}${request.path}`, {
                headers: request.headers
            });

            const responseData = response.data?.payload;

            if (!responseData) {
                logger.error("No payload in API response");
                break;
            }

            console.log("responseData: ",responseData)
            
            if (responseData.transactions && Array.isArray(responseData.transactions)) {
                allTransactions.push(...responseData.transactions);
            }
            
            nextToken = responseData.nextToken;
            
                } while (nextToken);

        console.log(`📊 Total transactions fetched: ${allTransactions.length}`);
        
        if (allTransactions.length === 0) {
            logger.warn("No financial transactions found for the specified date range");
            // Return default financial data structure instead of empty array
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

            const emptySalesData = await ProductWiseSales.create({
                User: userId,
                region: region,
                country: country,
                productWiseSales: []
            });

            return emptyFinanceData;
        }

        const dataObj = calculateAmazonFees(allTransactions);

        // Log the calculated data for debugging
        console.log("📊 Calculated Amazon Fees Summary:");
        console.log("Total Transactions:", allTransactions.length);
        console.log("Total Sales:", dataObj.Total_Sales);
        console.log("Gross Profit:", dataObj.Gross_Profit);
        console.log("Product Ads Payment:", dataObj.ProductAdsPayment);
        console.log("FBA Fees:", dataObj.FBA_Fees);
        console.log("Amazon Charges:", dataObj.Amazon_Charges);
        console.log("Refunds:", dataObj.Refunds);
        console.log("Storage:", dataObj.Storage);
        console.log("Product-wise Sales Count:", dataObj.ProductWiseSales.length);
        
        if (dataObj._debug) {
            console.log("📋 Debug Information:");
            console.log("Debt Recovery:", dataObj._debug.debtRecovery);
            console.log("Adjustments:", dataObj._debug.adjustment);
            console.log("Other Service Fees:", dataObj._debug.otherServiceFees);
        }

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
            return [];
        }

        if (!addToDb || !addToSalesDb ) {
            logger.error(new ApiError(500, "Error in adding to DB"));
            return [];
        }

        try {
            const getUser = await UserModel.findById(userId);
            if (getUser) {
                getUser.listFinancialEvents = addToDb._id;
                await getUser.save();
            }
        } catch (userUpdateError) {
            logger.error(`Failed to update user with financial events ID: ${userUpdateError.message}`);
            // Continue processing even if user update fails
        }

        return addToDb;

    } catch (error) {
        console.error("❌ Error Fetching Financial Events:", error.response?.data || error.message);
        logger.error(`Finance API Error: ${error.message}`);
        return [];
    }
};

const calculateAmazonFees = (dataArray) => {
    // Initialize all fee categories
    let totalSales = 0;  // Shipment transactions (positive)
    let totalFBAFees = 0;  // FBA service fees (negative)
    let totalRefunds = 0;  // Refund transactions (negative)
    let productAdsPayment = 0;  // Product ads payments (negative)
    let amazonCharges = 0;  // Amazon subscription fees (negative)
    let storageCharges = 0;  // Storage fees (negative)
    let debtRecovery = 0;  // Debt recovery (negative)
    let adjustment = 0;  // Adjustments (can be positive or negative)
    let otherServiceFees = 0;  // Other service fees not categorized
    let productWiseSales = [];
    
    // Track unique ASINs to aggregate sales
    const asinSalesMap = new Map();

    // Validate input array
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
        console.log("No transactions to process or invalid data array");
        return {
            Total_Sales: "0.00",
            Gross_Profit: "0.00",
            ProductAdsPayment: "0.00",
            FBA_Fees: "0.00",
            Amazon_Charges: "0.00",
            Refunds: "0.00",
            Storage: "0.00",
            ProductWiseSales: [],
            _debug: {
                debtRecovery: "0.00",
                adjustment: "0.00",
                otherServiceFees: "0.00",
                transactionCount: 0
            }
        };
    }

    dataArray.forEach(transaction => {
        // Skip invalid transactions
        if (!transaction || typeof transaction !== 'object') {
            console.log("Skipping invalid transaction:", transaction);
            return;
        }
        
        const amount = transaction.totalAmount?.currencyAmount || 0;
        const transactionType = transaction.transactionType;
        const description = transaction.description || '';

        switch (transactionType) {
            case "Shipment":
                // Sales are positive amounts
                totalSales += amount;
                
                // Extract product details for product-wise sales
                if (transaction.items && transaction.items.length > 0) {
                    transaction.items.forEach(item => {
                        if (item.contexts && item.contexts.length > 0) {
                            const context = item.contexts[0];
                            const asin = context.asin;
                            const quantity = context.quantityShipped || 0;
                            const itemAmount = item.totalAmount?.currencyAmount || amount;
                            
                            if (asin) {
                                if (asinSalesMap.has(asin)) {
                                    const existing = asinSalesMap.get(asin);
                                    existing.quantity += quantity;
                                    existing.amount += itemAmount;
                                } else {
                                    asinSalesMap.set(asin, {
                                        asin: asin,
                                        quantity: quantity,
                                        amount: itemAmount
                                    });
                                }
                            }
                        }
                    });
                }
                break;

            case "Refund":
                // Refunds are negative amounts
                totalRefunds += amount;
                break;

            case "ProductAdsPayment":
                // Product ads are negative amounts
                productAdsPayment += amount;
                break;

            case "DebtRecovery":
                // Debt recovery is typically negative
                debtRecovery += amount;
                break;

            case "Adjustment":
                // Adjustments can be positive or negative
                adjustment += amount;
                break;

            case "ServiceFee":
                // Categorize service fees based on description
                if (description.toLowerCase().includes("subscription")) {
                    amazonCharges += amount;
                } else if (description.toLowerCase().includes("storage") || 
                          description === "FBAStorageBilling") {
                    storageCharges += amount;
                } else if (description.toLowerCase().includes("fba")) {
                    totalFBAFees += amount;
                } else {
                    // Other service fees
                    otherServiceFees += amount;
                }
                break;

            case "Tax":
                // Tax transactions - add to appropriate category based on description
                if (description.toLowerCase().includes("sales tax") || 
                    description.toLowerCase().includes("marketplace tax")) {
                    // Sales tax collected (positive) - part of sales
                    if (amount > 0) {
                        totalSales += amount;
                    }
                }
                break;

            default:
                // Log unhandled transaction types for debugging
                console.log(`Unhandled transaction type: ${transactionType}, amount: ${amount}`);
                break;
        }
    });

    // Convert Map to array for product-wise sales
    productWiseSales = Array.from(asinSalesMap.values()).map(item => ({
        asin: item.asin,
        quantity: item.quantity,
        amount: parseFloat(item.amount.toFixed(2))
    }));

    // Calculate gross profit
    // Gross Profit = Total Sales - All Fees and Charges
    const totalGrossProfit = totalSales + totalRefunds + productAdsPayment + 
                           totalFBAFees + amazonCharges + storageCharges + 
                           debtRecovery + adjustment + otherServiceFees;

    // Prepare return object with proper formatting
    return {
        Total_Sales: totalSales.toFixed(2),
        Gross_Profit: totalGrossProfit.toFixed(2),
        ProductAdsPayment: Math.abs(productAdsPayment).toFixed(2),
        FBA_Fees: Math.abs(totalFBAFees + otherServiceFees).toFixed(2),  // Include other service fees
        Amazon_Charges: Math.abs(amazonCharges).toFixed(2),
        Refunds: Math.abs(totalRefunds).toFixed(2),
        Storage: Math.abs(storageCharges).toFixed(2),
        ProductWiseSales: productWiseSales,
        // Additional data for debugging/reporting (not stored in DB)
        _debug: {
            debtRecovery: debtRecovery.toFixed(2),
            adjustment: adjustment.toFixed(2),
            otherServiceFees: otherServiceFees.toFixed(2),
            transactionCount: dataArray.length
        }
    };
};

module.exports = { listFinancialEventsMethod, calculateAmazonFees };
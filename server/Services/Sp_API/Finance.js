// ===== CALCULATE AMAZON FEES FUNCTION =====
// This file contains the calculateAmazonFees utility function
// Note: listFinancialEventsMethod has been removed - use EconomicsMetrics instead

const logger = require('../../utils/Logger.js');

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

module.exports = { calculateAmazonFees };

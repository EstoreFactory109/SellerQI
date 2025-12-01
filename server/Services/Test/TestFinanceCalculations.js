// Test file for Amazon Fees Calculations
const { calculateAmazonFees } = require('../Sp_API/Finance.js');

// Sample transaction data based on Amazon's financial events structure
const sampleTransactions = [
    // Sales transactions
    {
        transactionType: "Shipment",
        description: "Order Payment",
        totalAmount: {
            currencyAmount: 150.00,
            currencyCode: "USD"
        },
        items: [{
            contexts: [{
                asin: "B08N5WRWNW",
                quantityShipped: 2
            }],
            totalAmount: {
                currencyAmount: 150.00,
                currencyCode: "USD"
            }
        }]
    },
    {
        transactionType: "Shipment",
        description: "Order Payment",
        totalAmount: {
            currencyAmount: 75.50,
            currencyCode: "USD"
        },
        items: [{
            contexts: [{
                asin: "B08N5WRWNW",
                quantityShipped: 1
            }],
            totalAmount: {
                currencyAmount: 75.50,
                currencyCode: "USD"
            }
        }]
    },
    // Refund transaction
    {
        transactionType: "Refund",
        description: "Customer Return",
        totalAmount: {
            currencyAmount: -50.00,
            currencyCode: "USD"
        }
    },
    // Product Ads Payment
    {
        transactionType: "ProductAdsPayment",
        description: "Sponsored Products",
        totalAmount: {
            currencyAmount: -25.00,
            currencyCode: "USD"
        }
    },
    // FBA Fees
    {
        transactionType: "ServiceFee",
        description: "FBA Fulfillment Fee",
        totalAmount: {
            currencyAmount: -15.00,
            currencyCode: "USD"
        }
    },
    // Storage Fee
    {
        transactionType: "ServiceFee",
        description: "FBAStorageBilling",
        totalAmount: {
            currencyAmount: -10.00,
            currencyCode: "USD"
        }
    },
    // Amazon Subscription
    {
        transactionType: "ServiceFee",
        description: "Subscription Fee",
        totalAmount: {
            currencyAmount: -39.99,
            currencyCode: "USD"
        }
    },
    // Tax collected
    {
        transactionType: "Tax",
        description: "Sales Tax Collected",
        totalAmount: {
            currencyAmount: 12.50,
            currencyCode: "USD"
        }
    },
    // Debt Recovery
    {
        transactionType: "DebtRecovery",
        description: "Account Balance Recovery",
        totalAmount: {
            currencyAmount: -5.00,
            currencyCode: "USD"
        }
    }
];

// Function to test calculations
function testCalculations() {
    console.log("🧪 Testing Amazon Fees Calculations\n");
    console.log("Sample Transactions Count:", sampleTransactions.length);
    console.log("=====================================\n");

    const result = calculateAmazonFees(sampleTransactions);

    console.log("📊 Calculation Results:");
    console.log("-------------------------------------");
    console.log("Total Sales:", result.Total_Sales);
    console.log("Gross Profit:", result.Gross_Profit);
    console.log("Product Ads Payment:", result.ProductAdsPayment);
    console.log("FBA Fees:", result.FBA_Fees);
    console.log("Amazon Charges:", result.Amazon_Charges);
    console.log("Refunds:", result.Refunds);
    console.log("Storage:", result.Storage);
    console.log("\n📦 Product-wise Sales:");
    result.ProductWiseSales.forEach(product => {
        console.log(`  ASIN: ${product.asin}, Quantity: ${product.quantity}, Amount: $${product.amount}`);
    });

    if (result._debug) {
        console.log("\n🔍 Debug Information:");
        console.log("Debt Recovery:", result._debug.debtRecovery);
        console.log("Adjustments:", result._debug.adjustment);
        console.log("Other Service Fees:", result._debug.otherServiceFees);
    }

    // Verify calculations
    console.log("\n✅ Verification:");
    console.log("-------------------------------------");
    
    // Expected values based on sample data
    const expectedTotalSales = 150.00 + 75.50 + 12.50; // Including tax
    const expectedGrossProfit = expectedTotalSales - 50.00 - 25.00 - 15.00 - 10.00 - 39.99 - 5.00;
    
    console.log(`Expected Total Sales: $${expectedTotalSales.toFixed(2)}`);
    console.log(`Calculated Total Sales: $${result.Total_Sales}`);
    console.log(`Match: ${expectedTotalSales.toFixed(2) === result.Total_Sales ? '✅' : '❌'}`);
    
    console.log(`\nExpected Gross Profit: $${expectedGrossProfit.toFixed(2)}`);
    console.log(`Calculated Gross Profit: $${result.Gross_Profit}`);
    console.log(`Match: ${expectedGrossProfit.toFixed(2) === result.Gross_Profit ? '✅' : '❌'}`);

    return result;
}

// Export the function to make it importable
module.exports = { testCalculations };

// Run the test if this file is executed directly
if (require.main === module) {
    testCalculations();
} 
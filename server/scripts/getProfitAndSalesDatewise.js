require('dotenv').config();
const mongoose = require('mongoose');
const dbConsts = require('../config/config.js');
const { AnalyseService } = require('../Services/main/Analyse.js');
const logger = require('../utils/Logger.js');

// Connect to database
const connectDB = async () => {
    try {
        await mongoose.connect(`${dbConsts.dbUri}/${dbConsts.dbName}`, {
            connectTimeoutMS: 60000,
            socketTimeoutMS: 120000,
        });
        logger.info('Connected to DB');
    } catch (error) {
        logger.error(`Error connecting to DB: ${error}`);
        process.exit(1);
    }
};

// Main function to get profit and sales data
const getProfitAndSalesDatewise = async (userId, country, region, startDate, endDate) => {
    try {
        console.log('\n📊 Fetching Profit and Sales Data Datewise...\n');
        console.log(`User ID: ${userId}`);
        console.log(`Country: ${country}`);
        console.log(`Region: ${region}`);
        console.log(`Start Date: ${startDate}`);
        console.log(`End Date: ${endDate}\n`);

        // Call the service method
        const result = await AnalyseService.getDataFromDateRange(
            userId,
            country,
            region,
            startDate,
            endDate,
            'custom'
        );

        if (result.status !== 200) {
            console.error('❌ Error:', result.message);
            return;
        }

        const data = result.message;
        const dateWiseSales = data.TotalSales?.dateWiseSales || [];
        const financeData = data.FinanceData || {};

        // Display summary
        console.log('='.repeat(80));
        console.log('📈 SUMMARY');
        console.log('='.repeat(80));
        console.log(`Total Sales: $${(data.TotalSales?.totalSales || 0).toFixed(2)}`);
        console.log(`Total Fees: $${(
            (financeData.ProductAdsPayment || 0) +
            (financeData.FBA_Fees || 0) +
            (financeData.Amazon_Charges || 0) +
            (financeData.Storage || 0) +
            (financeData.Refunds || 0)
        ).toFixed(2)}`);
        console.log(`Gross Profit: $${(financeData.Gross_Profit || 0).toFixed(2)}`);
        console.log('\nFee Breakdown:');
        console.log(`  - Product Ads Payment: $${(financeData.ProductAdsPayment || 0).toFixed(2)}`);
        console.log(`  - FBA Fees: $${(financeData.FBA_Fees || 0).toFixed(2)}`);
        console.log(`  - Amazon Charges: $${(financeData.Amazon_Charges || 0).toFixed(2)}`);
        console.log(`  - Storage: $${(financeData.Storage || 0).toFixed(2)}`);
        console.log(`  - Refunds: $${(financeData.Refunds || 0).toFixed(2)}`);

        // Display datewise data
        console.log('\n' + '='.repeat(80));
        console.log('📅 DATEWISE PROFIT AND SALES');
        console.log('='.repeat(80));
        console.log(
            'Date'.padEnd(15) +
            'Sales'.padEnd(15) +
            'Fees'.padEnd(15) +
            'Profit'.padEnd(15) +
            'Profit %'
        );
        console.log('-'.repeat(80));

        let totalSales = 0;
        let totalFees = 0;
        let totalProfit = 0;

        dateWiseSales.forEach((day) => {
            const sales = parseFloat(day.TotalAmount || 0);
            const fees = parseFloat(day.Fees || 0);
            const profit = parseFloat(day.Profit || 0);
            const profitPercent = sales > 0 ? ((profit / sales) * 100).toFixed(2) : '0.00';

            // Format date for display
            const dateStr = day.date || day.interval || 'N/A';
            let displayDate = dateStr;
            try {
                if (day.date) {
                    const date = new Date(day.date);
                    displayDate = date.toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        year: 'numeric'
                    });
                } else if (day.interval) {
                    displayDate = day.interval;
                }
            } catch (e) {
                displayDate = dateStr;
            }

            console.log(
                displayDate.padEnd(15) +
                `$${sales.toFixed(2)}`.padEnd(15) +
                `$${fees.toFixed(2)}`.padEnd(15) +
                `$${profit.toFixed(2)}`.padEnd(15) +
                `${profitPercent}%`
            );

            totalSales += sales;
            totalFees += fees;
            totalProfit += profit;
        });

        console.log('-'.repeat(80));
        const avgProfitPercent = totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(2) : '0.00';
        console.log(
            'TOTAL'.padEnd(15) +
            `$${totalSales.toFixed(2)}`.padEnd(15) +
            `$${totalFees.toFixed(2)}`.padEnd(15) +
            `$${totalProfit.toFixed(2)}`.padEnd(15) +
            `${avgProfitPercent}%`
        );
        console.log('='.repeat(80));

        // Export as JSON
        console.log('\n📄 JSON Export:');
        console.log(JSON.stringify({
            summary: {
                totalSales: parseFloat(totalSales.toFixed(2)),
                totalFees: parseFloat(totalFees.toFixed(2)),
                totalProfit: parseFloat(totalProfit.toFixed(2)),
                profitMargin: parseFloat(avgProfitPercent)
            },
            datewise: dateWiseSales.map(day => ({
                date: day.date || day.interval,
                sales: parseFloat(day.TotalAmount || 0),
                fees: parseFloat(day.Fees || 0),
                profit: parseFloat(day.Profit || 0),
                profitMargin: day.TotalAmount > 0 
                    ? parseFloat(((day.Profit / day.TotalAmount) * 100).toFixed(2))
                    : 0
            }))
        }, null, 2));

    } catch (error) {
        console.error('❌ Error fetching data:', error);
        logger.error('Error in getProfitAndSalesDatewise:', error);
    }
};

// Main execution
const main = async () => {
    // Get command line arguments
    const args = process.argv.slice(2);
    
    if (args.length < 5) {
        console.log('Usage: node getProfitAndSalesDatewise.js <userId> <country> <region> <startDate> <endDate>');
        console.log('Example: node getProfitAndSalesDatewise.js 507f1f77bcf86cd799439011 US na 2025-10-26 2025-11-25');
        console.log('\nOr set environment variables:');
        console.log('  USER_ID, COUNTRY, REGION, START_DATE, END_DATE');
        process.exit(1);
    }

    const userId = args[0] || process.env.USER_ID;
    const country = args[1] || process.env.COUNTRY;
    const region = args[2] || process.env.REGION;
    const startDate = args[3] || process.env.START_DATE;
    const endDate = args[4] || process.env.END_DATE;

    if (!userId || !country || !region || !startDate || !endDate) {
        console.error('❌ Missing required parameters');
        process.exit(1);
    }

    await connectDB();
    await getProfitAndSalesDatewise(userId, country, region, startDate, endDate);
    
    // Close database connection
    await mongoose.connection.close();
    console.log('\n✅ Done!');
    process.exit(0);
};

// Run the script
main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});


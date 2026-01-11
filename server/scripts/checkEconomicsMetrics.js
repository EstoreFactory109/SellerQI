/**
 * Debug script to check EconomicsMetrics for a user
 * Usage: node scripts/checkEconomicsMetrics.js <userId> <region> <country>
 * Example: node scripts/checkEconomicsMetrics.js 65a1234567890abc FE IN
 */

require('../config/dbConn.js');
const EconomicsMetrics = require('../models/MCP/EconomicsMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../models/MCP/AsinWiseSalesForBigAccountsModel.js');

const [,, userId, region = 'FE', country = 'IN'] = process.argv;

if (!userId) {
    console.error('Usage: node scripts/checkEconomicsMetrics.js <userId> <region> <country>');
    console.error('Example: node scripts/checkEconomicsMetrics.js 65a1234567890abc FE IN');
    process.exit(1);
}

async function checkMetrics() {
    try {
        console.log(`\n=== Checking EconomicsMetrics for User: ${userId}, Region: ${region}, Country: ${country} ===\n`);

        // Find all metrics for this user
        const allMetrics = await EconomicsMetrics.find({
            User: userId,
            region: region,
            country: country
        }).sort({ createdAt: -1 }).lean();

        console.log(`Found ${allMetrics.length} EconomicsMetrics documents\n`);

        if (allMetrics.length === 0) {
            console.log('No metrics found for this user/region/country combination');
            process.exit(0);
        }

        // Show the latest one (what findLatest returns)
        const latest = allMetrics[0];
        console.log('=== LATEST DOCUMENT ===');
        console.log('_id:', latest._id);
        console.log('createdAt:', latest.createdAt);
        console.log('isBig:', latest.isBig, '(type:', typeof latest.isBig, ')');
        console.log('totalSales:', latest.totalSales?.amount);
        console.log('asinWiseSales length:', latest.asinWiseSales?.length || 0);
        console.log('datewiseSales length:', latest.datewiseSales?.length || 0);
        console.log('datewiseGrossProfit length:', latest.datewiseGrossProfit?.length || 0);
        console.log('dateRange:', latest.dateRange);
        
        // Check if asinWiseSales has date field
        if (latest.asinWiseSales && latest.asinWiseSales.length > 0) {
            console.log('\n=== SAMPLE asinWiseSales[0] ===');
            console.log(JSON.stringify(latest.asinWiseSales[0], null, 2));
            const hasDateField = latest.asinWiseSales.some(item => item.date);
            console.log('Has date field in asinWiseSales:', hasDateField);
        }
        
        // Check datewiseSales structure
        if (latest.datewiseSales && latest.datewiseSales.length > 0) {
            console.log('\n=== SAMPLE datewiseSales[0] ===');
            console.log(JSON.stringify(latest.datewiseSales[0], null, 2));
        }

        // Check for data in separate collection
        if (latest.isBig || (latest.totalSales?.amount > 10000 && (!latest.asinWiseSales || latest.asinWiseSales.length === 0))) {
            console.log('\n=== Checking AsinWiseSalesForBigAccounts ===');
            const bigAccountDocs = await AsinWiseSalesForBigAccounts.findByMetricsId(latest._id);
            console.log('Found', bigAccountDocs.length, 'date documents in separate collection');
            
            if (bigAccountDocs.length > 0) {
                let totalRecords = 0;
                bigAccountDocs.forEach(doc => {
                    totalRecords += doc.asinSales?.length || 0;
                });
                console.log('Total ASIN records:', totalRecords);
            }
        }

        // Show all documents summary
        if (allMetrics.length > 1) {
            console.log('\n=== ALL DOCUMENTS (summary) ===');
            allMetrics.forEach((m, i) => {
                console.log(`${i + 1}. _id: ${m._id}, createdAt: ${m.createdAt}, isBig: ${m.isBig}, totalSales: ${m.totalSales?.amount}, asinWiseSales: ${m.asinWiseSales?.length || 0}`);
            });
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

// Wait for DB connection
setTimeout(checkMetrics, 2000);

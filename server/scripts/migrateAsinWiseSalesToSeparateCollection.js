/**
 * Migration Script: Migrate asinWiseSales from EconomicsMetrics to AsinWiseSalesForBigAccounts
 * 
 * This script migrates legacy EconomicsMetrics documents (isBig=false with embedded asinWiseSales)
 * to the new model where asinWiseSales is always stored in a separate collection.
 * 
 * What it does:
 * 1. Finds all EconomicsMetrics documents where isBig=false AND asinWiseSales has data
 * 2. For each document:
 *    - Groups asinWiseSales by date
 *    - Creates documents in AsinWiseSalesForBigAccounts (one per date)
 *    - Updates the EconomicsMetrics document: sets isBig=true and clears asinWiseSales
 * 
 * Usage:
 *   node server/scripts/migrateAsinWiseSalesToSeparateCollection.js [--dry-run] [--batch-size=100]
 * 
 * Options:
 *   --dry-run      Preview what would be migrated without making changes
 *   --batch-size   Number of documents to process per batch (default: 100)
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 100;

// MongoDB connection - use project config (DB_URI, DB_NAME)
const dbConsts = require('../config/config.js');
const MONGODB_URI = dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : (process.env.MONGODB_URI || process.env.MONGO_URI);

if (!MONGODB_URI) {
    console.error('ERROR: DB_URI and DB_NAME (or MONGODB_URI / MONGO_URI) environment variables are required');
    process.exit(1);
}

// Import models after setting up mongoose
let EconomicsMetrics;
let AsinWiseSalesForBigAccounts;

async function connectToDatabase() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        // Import models after connection
        EconomicsMetrics = require('../models/MCP/EconomicsMetricsModel');
        AsinWiseSalesForBigAccounts = require('../models/MCP/AsinWiseSalesForBigAccountsModel');
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error.message);
        process.exit(1);
    }
}

/**
 * Group ASIN sales by date
 */
function groupAsinSalesByDate(asinWiseSales) {
    const salesByDate = {};
    
    asinWiseSales.forEach(asinSale => {
        const date = asinSale.date || 'no_date';
        
        if (!salesByDate[date]) {
            salesByDate[date] = [];
        }
        
        // Create ASIN sales item without the date field (it's stored at document level)
        salesByDate[date].push({
            asin: asinSale.asin,
            parentAsin: asinSale.parentAsin || null,
            sales: asinSale.sales,
            grossProfit: asinSale.grossProfit,
            unitsSold: asinSale.unitsSold,
            refunds: asinSale.refunds,
            ppcSpent: asinSale.ppcSpent,
            fbaFees: asinSale.fbaFees,
            storageFees: asinSale.storageFees,
            totalFees: asinSale.totalFees,
            amazonFees: asinSale.amazonFees,
            feeBreakdown: asinSale.feeBreakdown || []
        });
    });
    
    return salesByDate;
}

/**
 * Migrate a single EconomicsMetrics document
 */
async function migrateDocument(doc, stats) {
    const metricsId = doc._id;
    const userId = doc.User;
    const asinWiseSales = doc.asinWiseSales || [];
    
    if (asinWiseSales.length === 0) {
        stats.skippedEmpty++;
        return { success: true, skipped: true, reason: 'empty asinWiseSales' };
    }
    
    try {
        // Group ASIN sales by date
        const salesByDate = groupAsinSalesByDate(asinWiseSales);
        const dateCount = Object.keys(salesByDate).length;
        
        // Create documents for the separate collection
        const dateDocuments = Object.entries(salesByDate).map(([date, asinSales]) => ({
            metricsId: metricsId,
            User: userId,
            region: doc.region,
            country: doc.country,
            date: date,
            asinSales: asinSales
        }));
        
        if (isDryRun) {
            console.log(`  [DRY RUN] Would migrate metricsId=${metricsId}: ${asinWiseSales.length} ASIN records → ${dateCount} date documents`);
            stats.wouldMigrate++;
            stats.wouldMigrateAsinRecords += asinWiseSales.length;
            stats.wouldMigrateDateDocs += dateCount;
            return { success: true, dryRun: true };
        }
        
        // Insert ASIN data into separate collection
        await AsinWiseSalesForBigAccounts.insertMany(dateDocuments);
        
        // Update the main document: set isBig=true, clear asinWiseSales
        await EconomicsMetrics.updateOne(
            { _id: metricsId },
            { 
                $set: { isBig: true, asinWiseSales: [] }
            }
        );
        
        stats.migrated++;
        stats.migratedAsinRecords += asinWiseSales.length;
        stats.migratedDateDocs += dateCount;
        
        console.log(`  ✅ Migrated metricsId=${metricsId}: ${asinWiseSales.length} ASIN records → ${dateCount} date documents`);
        return { success: true };
        
    } catch (error) {
        stats.failed++;
        console.error(`  ❌ Failed to migrate metricsId=${metricsId}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Main migration function
 */
async function runMigration() {
    console.log('='.repeat(70));
    console.log('Migration: asinWiseSales → AsinWiseSalesForBigAccounts');
    console.log('='.repeat(70));
    console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no changes will be made)' : '🚀 LIVE MIGRATION'}`);
    console.log(`Batch size: ${BATCH_SIZE}`);
    console.log('');
    
    await connectToDatabase();
    
    // Find documents that need migration: isBig=false AND asinWiseSales has data
    // Also include documents where isBig is not set (null/undefined) for safety
    const query = {
        $and: [
            { $or: [{ isBig: false }, { isBig: { $exists: false } }, { isBig: null }] },
            { asinWiseSales: { $exists: true } },
            { 'asinWiseSales.0': { $exists: true } } // Has at least one element
        ]
    };
    
    const totalCount = await EconomicsMetrics.countDocuments(query);
    
    console.log(`Found ${totalCount} documents to migrate`);
    console.log('');
    
    if (totalCount === 0) {
        console.log('✅ No documents need migration. All data is already in the new format.');
        await mongoose.disconnect();
        return;
    }
    
    const stats = {
        processed: 0,
        migrated: 0,
        migratedAsinRecords: 0,
        migratedDateDocs: 0,
        wouldMigrate: 0,
        wouldMigrateAsinRecords: 0,
        wouldMigrateDateDocs: 0,
        skippedEmpty: 0,
        failed: 0
    };
    
    let skip = 0;
    let batchNum = 1;
    
    while (skip < totalCount) {
        console.log(`\n--- Batch ${batchNum} (${skip + 1} to ${Math.min(skip + BATCH_SIZE, totalCount)} of ${totalCount}) ---`);
        
        const documents = await EconomicsMetrics.find(query)
            .skip(skip)
            .limit(BATCH_SIZE)
            .lean();
        
        for (const doc of documents) {
            stats.processed++;
            await migrateDocument(doc, stats);
        }
        
        skip += BATCH_SIZE;
        batchNum++;
    }
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('Migration Summary');
    console.log('='.repeat(70));
    console.log(`Total documents processed: ${stats.processed}`);
    
    if (isDryRun) {
        console.log(`Documents that would be migrated: ${stats.wouldMigrate}`);
        console.log(`ASIN records that would be moved: ${stats.wouldMigrateAsinRecords}`);
        console.log(`Date documents that would be created: ${stats.wouldMigrateDateDocs}`);
        console.log('');
        console.log('👉 Run without --dry-run to perform the actual migration');
    } else {
        console.log(`Documents migrated: ${stats.migrated}`);
        console.log(`ASIN records moved: ${stats.migratedAsinRecords}`);
        console.log(`Date documents created: ${stats.migratedDateDocs}`);
        console.log(`Skipped (empty asinWiseSales): ${stats.skippedEmpty}`);
        console.log(`Failed: ${stats.failed}`);
    }
    
    console.log('='.repeat(70));
    
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
}

// Run the migration
runMigration()
    .then(() => {
        console.log('\n✅ Migration script completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Migration script failed:', error);
        process.exit(1);
    });

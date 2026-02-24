/**
 * Migration Script: IssuesData -> IssuesDataChunks (Unified Model)
 * 
 * This script migrates all data from the IssuesData model to the unified IssuesDataChunks model.
 * 
 * After this migration:
 * - All issues data is stored in IssuesDataChunks only
 * - The _metadata chunk type stores counts and metadata
 * - Array chunks store chunked array data
 * - IssuesData model is no longer used (can be deprecated)
 * 
 * Run with: node server/scripts/migrateIssuesDataToChunks.js
 * 
 * Options:
 *   --dry-run    : Only count records, don't migrate
 *   --batch-size : Number of records per batch (default: 50)
 *   --verbose    : Print detailed progress
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// MongoDB connection - use project config (DB_URI, DB_NAME)
const dbConsts = require('../config/config.js');

const IssuesData = require('../models/system/IssuesDataModel');
const IssuesDataChunks = require('../models/system/IssuesDataChunksModel');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const batchSizeArgIndex = args.indexOf('--batch-size');
const BATCH_SIZE = batchSizeArgIndex !== -1 && args[batchSizeArgIndex + 1] 
    ? parseInt(args[batchSizeArgIndex + 1], 10) 
    : 50;

// Statistics
const stats = {
    totalRecords: 0,
    migratedRecords: 0,
    skippedRecords: 0,
    errorRecords: 0,
    totalChunksCreated: 0,
    errors: []
};

function log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    if (level === 'verbose' && !VERBOSE) return;
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

async function connectToDatabase() {
    // Use project config first, fallback to env vars
    const mongoUri = (dbConsts.dbUri && dbConsts.dbName)
        ? `${dbConsts.dbUri}/${dbConsts.dbName}`
        : (process.env.MONGODB_URI || process.env.MONGO_URI);
    
    if (!mongoUri) {
        throw new Error('MongoDB URI not found. Set DB_URI and DB_NAME (or MONGODB_URI) in environment variables.');
    }
    
    log(`Connecting to MongoDB...`);
    await mongoose.connect(mongoUri);
    log('Connected to MongoDB successfully');
}

async function migrateRecord(issuesDataDoc) {
    const { userId, country, region } = issuesDataDoc;
    
    try {
        // Check if already migrated (metadata chunk exists)
        const existingMetadata = await IssuesDataChunks.findOne({
            userId,
            country,
            region,
            fieldName: '_metadata'
        });
        
        if (existingMetadata) {
            log(`Skipping userId=${userId}, country=${country}, region=${region} - already migrated`, 'verbose');
            stats.skippedRecords++;
            return { skipped: true };
        }
        
        if (DRY_RUN) {
            log(`[DRY RUN] Would migrate userId=${userId}, country=${country}, region=${region}`, 'verbose');
            return { dryRun: true };
        }
        
        // Use the unified upsertIssuesData method
        const result = await IssuesDataChunks.upsertIssuesData(
            userId,
            country,
            region,
            {
                // Counts (mapped from old field names)
                TotalRankingerrors: issuesDataDoc.totalRankingErrors,
                totalErrorInConversion: issuesDataDoc.totalConversionErrors,
                totalInventoryErrors: issuesDataDoc.totalInventoryErrors,
                totalErrorInAccount: issuesDataDoc.totalAccountErrors,
                totalProfitabilityErrors: issuesDataDoc.totalProfitabilityErrors,
                totalSponsoredAdsErrors: issuesDataDoc.totalSponsoredAdsErrors,
                
                // Array data
                productWiseError: issuesDataDoc.productWiseError || [],
                rankingProductWiseErrors: issuesDataDoc.rankingProductWiseErrors || [],
                conversionProductWiseErrors: issuesDataDoc.conversionProductWiseErrors || [],
                inventoryProductWiseErrors: issuesDataDoc.inventoryProductWiseErrors || [],
                profitabilityErrorDetails: issuesDataDoc.profitabilityErrorDetails || [],
                sponsoredAdsErrorDetails: issuesDataDoc.sponsoredAdsErrorDetails || [],
                TotalProduct: issuesDataDoc.TotalProduct || [],
                ActiveProducts: issuesDataDoc.ActiveProducts || [],
                
                // Account/other data
                AccountErrors: issuesDataDoc.AccountErrors || {},
                accountHealthPercentage: issuesDataDoc.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
                buyBoxData: issuesDataDoc.buyBoxData || { asinBuyBoxData: [] },
                
                // Top error products - handle both old and new structure
                first: issuesDataDoc.topErrorProducts?.first || issuesDataDoc.first,
                second: issuesDataDoc.topErrorProducts?.second || issuesDataDoc.second,
                third: issuesDataDoc.topErrorProducts?.third || issuesDataDoc.third,
                fourth: issuesDataDoc.topErrorProducts?.fourth || issuesDataDoc.fourth,
                
                // Metadata
                numberOfProductsWithIssues: issuesDataDoc.numberOfProductsWithIssues || 0,
                totalIssues: issuesDataDoc.totalIssues || 0
            },
            issuesDataDoc.calculationSource || 'migration'
        );
        
        // Count total chunks created
        const chunkCount = Object.values(result.chunkCounts).reduce((sum, count) => sum + count, 0);
        stats.totalChunksCreated += chunkCount + 1; // +1 for metadata
        
        log(`Migrated userId=${userId}, country=${country}, region=${region} - ${chunkCount} array chunks created`, 'verbose');
        stats.migratedRecords++;
        
        return { success: true, chunkCount };
        
    } catch (error) {
        log(`Error migrating userId=${userId}, country=${country}, region=${region}: ${error.message}`, 'error');
        stats.errorRecords++;
        stats.errors.push({
            userId: userId.toString(),
            country,
            region,
            error: error.message
        });
        return { error: true };
    }
}

async function runMigration() {
    log('='.repeat(60));
    log('IssuesData to IssuesDataChunks Migration');
    log('='.repeat(60));
    log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE MIGRATION'}`);
    log(`Batch Size: ${BATCH_SIZE}`);
    log(`Verbose: ${VERBOSE}`);
    log('='.repeat(60));
    
    await connectToDatabase();
    
    // Count total records
    stats.totalRecords = await IssuesData.countDocuments({});
    log(`Total IssuesData records to process: ${stats.totalRecords}`);
    
    if (stats.totalRecords === 0) {
        log('No records to migrate. Exiting.');
        return;
    }
    
    // Process in batches using cursor
    let processed = 0;
    const cursor = IssuesData.find({}).lean().cursor();
    let batch = [];
    
    for await (const doc of cursor) {
        batch.push(doc);
        
        if (batch.length >= BATCH_SIZE) {
            // Process batch
            await Promise.all(batch.map(d => migrateRecord(d)));
            processed += batch.length;
            log(`Progress: ${processed}/${stats.totalRecords} (${Math.round(processed/stats.totalRecords*100)}%)`);
            batch = [];
        }
    }
    
    // Process remaining
    if (batch.length > 0) {
        await Promise.all(batch.map(d => migrateRecord(d)));
        processed += batch.length;
        log(`Progress: ${processed}/${stats.totalRecords} (100%)`);
    }
    
    // Print summary
    log('='.repeat(60));
    log('MIGRATION COMPLETE');
    log('='.repeat(60));
    log(`Total records processed: ${stats.totalRecords}`);
    log(`Successfully migrated: ${stats.migratedRecords}`);
    log(`Already migrated (skipped): ${stats.skippedRecords}`);
    log(`Errors: ${stats.errorRecords}`);
    log(`Total chunks created: ${stats.totalChunksCreated}`);
    
    if (stats.errors.length > 0) {
        log('');
        log('ERRORS:');
        stats.errors.forEach((err, i) => {
            log(`  ${i + 1}. userId=${err.userId}, country=${err.country}, region=${err.region}`);
            log(`     Error: ${err.error}`);
        });
    }
    
    if (DRY_RUN) {
        log('');
        log('[DRY RUN] No changes were made to the database.');
        log('Remove --dry-run flag to perform actual migration.');
    } else {
        log('');
        log('NEXT STEPS:');
        log('1. Verify data integrity by spot-checking a few records');
        log('2. Update all services to use IssuesDataChunks.getIssuesData() instead of IssuesData.getIssuesData()');
        log('3. Once verified, IssuesData model can be deprecated');
    }
    
    log('='.repeat(60));
}

// Run the migration
runMigration()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        log(`Migration failed: ${error.message}`, 'error');
        console.error(error);
        process.exit(1);
    });

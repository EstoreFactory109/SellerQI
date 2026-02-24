/**
 * Migration Script: Migrate ProductWiseSponsoredAdsData (old format) to ProductWiseSponsoredAdsItem (new format)
 * 
 * This script migrates legacy embedded sponsoredAds arrays to the new separate collection format.
 * The new format prevents the 16MB MongoDB document size limit and enables MongoDB aggregation.
 * 
 * What it does:
 * 1. Finds all ProductWiseSponsoredAdsData documents (old format with embedded sponsoredAds array)
 * 2. For each document:
 *    - Streams the sponsoredAds array in chunks (to avoid loading huge arrays into memory)
 *    - Creates documents in ProductWiseSponsoredAdsItem (one per ad entry, grouped by batchId)
 * 3. Optionally deletes the old document after successful migration (use --delete-old flag)
 * 
 * MEMORY-SAFE: Uses MongoDB cursor to stream documents and processes sponsoredAds in batches.
 * 
 * Usage:
 *   node server/scripts/migrateSponsoredAdsToNewFormat.js [options]
 * 
 * Options:
 *   --dry-run        Preview what would be migrated without making changes
 *   --delete-old     Delete old-format documents after successful migration
 *   --batch-size=N   Number of ad items to insert per batch (default: 1000)
 *   --limit=N        Limit number of documents to process (for testing)
 * 
 * Examples:
 *   node server/scripts/migrateSponsoredAdsToNewFormat.js --dry-run
 *   node server/scripts/migrateSponsoredAdsToNewFormat.js --limit=5
 *   node server/scripts/migrateSponsoredAdsToNewFormat.js --delete-old
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const deleteOld = args.includes('--delete-old');
const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
const limitArg = args.find(arg => arg.startsWith('--limit='));
const INSERT_BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 1000;
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : null;

// MongoDB connection - use project config (DB_URI, DB_NAME)
const dbConsts = require('../config/config.js');
const MONGODB_URI = dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : (process.env.MONGODB_URI || process.env.MONGO_URI);

if (!MONGODB_URI) {
    console.error('ERROR: DB_URI and DB_NAME (or MONGODB_URI / MONGO_URI) environment variables are required');
    process.exit(1);
}

// Models (imported after connection)
let ProductWiseSponsoredAdsData;
let ProductWiseSponsoredAdsItem;

async function connectToDatabase() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        // Import models after connection
        ProductWiseSponsoredAdsData = require('../models/amazon-ads/ProductWiseSponseredAdsModel');
        ProductWiseSponsoredAdsItem = require('../models/amazon-ads/ProductWiseSponsoredAdsItemModel');
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error.message);
        process.exit(1);
    }
}

/**
 * Check if user/country/region already has data in the new format
 */
async function hasNewFormatData(userId, country, region) {
    const existing = await ProductWiseSponsoredAdsItem.findOne({ userId, country, region })
        .select('_id')
        .lean();
    return !!existing;
}

/**
 * Migrate a single old-format document to the new format
 * Uses batched inserts to avoid memory issues with large sponsoredAds arrays
 */
async function migrateDocument(doc, stats) {
    const { userId, country, region, sponsoredAds, createdAt, _id: oldDocId } = doc;
    
    if (!sponsoredAds || sponsoredAds.length === 0) {
        stats.skippedEmpty++;
        return { success: true, skipped: true, reason: 'empty sponsoredAds' };
    }
    
    const itemCount = sponsoredAds.length;
    
    // Check if already migrated (has data in new format)
    const alreadyMigrated = await hasNewFormatData(userId, country, region);
    if (alreadyMigrated) {
        stats.skippedAlreadyMigrated++;
        console.log(`  ⏭️  Skipped userId=${userId}, country=${country}, region=${region}: already has new-format data`);
        return { success: true, skipped: true, reason: 'already migrated' };
    }
    
    if (isDryRun) {
        console.log(`  [DRY RUN] Would migrate userId=${userId}, country=${country}, region=${region}: ${itemCount} ad items`);
        stats.wouldMigrate++;
        stats.wouldMigrateItems += itemCount;
        return { success: true, dryRun: true };
    }
    
    try {
        // Create a new batchId for this migration
        const batchId = new mongoose.Types.ObjectId();
        
        // Process sponsoredAds in batches to avoid memory issues
        let insertedCount = 0;
        
        for (let i = 0; i < itemCount; i += INSERT_BATCH_SIZE) {
            const chunk = sponsoredAds.slice(i, i + INSERT_BATCH_SIZE);
            
            // Transform items to new format
            const itemsToInsert = chunk.map(item => ({
                userId: userId,
                country: country,
                region: region,
                batchId: batchId,
                date: item.date || '',
                asin: item.asin || '',
                spend: item.spend || 0,
                salesIn7Days: item.salesIn7Days || 0,
                salesIn14Days: item.salesIn14Days || 0,
                salesIn30Days: item.salesIn30Days || 0,
                campaignId: item.campaignId || '',
                campaignName: item.campaignName || '',
                impressions: item.impressions || 0,
                adGroupId: item.adGroupId || '',
                clicks: item.clicks || 0,
                purchasedIn7Days: item.purchasedIn7Days || 0,
                purchasedIn14Days: item.purchasedIn14Days || 0,
                purchasedIn30Days: item.purchasedIn30Days || 0
            }));
            
            // Insert batch
            await ProductWiseSponsoredAdsItem.insertMany(itemsToInsert, { ordered: false });
            insertedCount += itemsToInsert.length;
            
            // Yield to event loop periodically
            if (i % (INSERT_BATCH_SIZE * 5) === 0 && i > 0) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        
        // Optionally delete the old document
        if (deleteOld) {
            await ProductWiseSponsoredAdsData.deleteOne({ _id: oldDocId });
            console.log(`  ✅ Migrated & deleted old doc: userId=${userId}, country=${country}, region=${region}: ${insertedCount} items`);
        } else {
            console.log(`  ✅ Migrated userId=${userId}, country=${country}, region=${region}: ${insertedCount} items (old doc kept)`);
        }
        
        stats.migrated++;
        stats.migratedItems += insertedCount;
        
        return { success: true };
        
    } catch (error) {
        stats.failed++;
        console.error(`  ❌ Failed to migrate userId=${userId}, country=${country}, region=${region}: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Main migration function
 */
async function runMigration() {
    console.log('='.repeat(70));
    console.log('Migration: ProductWiseSponsoredAdsData → ProductWiseSponsoredAdsItem');
    console.log('='.repeat(70));
    console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no changes will be made)' : '🚀 LIVE MIGRATION'}`);
    console.log(`Insert batch size: ${INSERT_BATCH_SIZE}`);
    console.log(`Delete old documents: ${deleteOld ? 'YES' : 'NO'}`);
    if (LIMIT) console.log(`Document limit: ${LIMIT}`);
    console.log('');
    
    await connectToDatabase();
    
    // Find all old-format documents
    // We stream using cursor to avoid loading all docs into memory
    const query = {
        sponsoredAds: { $exists: true },
        'sponsoredAds.0': { $exists: true } // Has at least one element
    };
    
    const totalCount = await ProductWiseSponsoredAdsData.countDocuments(query);
    const processCount = LIMIT ? Math.min(LIMIT, totalCount) : totalCount;
    
    console.log(`Found ${totalCount} old-format documents with sponsoredAds data`);
    if (LIMIT) console.log(`Will process up to ${LIMIT} documents`);
    console.log('');
    
    if (totalCount === 0) {
        console.log('✅ No old-format documents found. All data may already be in the new format.');
        await mongoose.disconnect();
        return;
    }
    
    const stats = {
        processed: 0,
        migrated: 0,
        migratedItems: 0,
        wouldMigrate: 0,
        wouldMigrateItems: 0,
        skippedEmpty: 0,
        skippedAlreadyMigrated: 0,
        failed: 0
    };
    
    // Use cursor to stream documents one at a time (memory-safe)
    const cursor = ProductWiseSponsoredAdsData.find(query)
        .sort({ createdAt: -1 }) // Latest first
        .lean()
        .cursor();
    
    let docNum = 0;
    
    for await (const doc of cursor) {
        docNum++;
        
        if (LIMIT && docNum > LIMIT) {
            break;
        }
        
        console.log(`\n[${docNum}/${processCount}] Processing userId=${doc.userId}, country=${doc.country}, region=${doc.region}`);
        
        stats.processed++;
        await migrateDocument(doc, stats);
    }
    
    await cursor.close();
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('Migration Summary');
    console.log('='.repeat(70));
    console.log(`Total documents processed: ${stats.processed}`);
    
    if (isDryRun) {
        console.log(`Documents that would be migrated: ${stats.wouldMigrate}`);
        console.log(`Ad items that would be moved: ${stats.wouldMigrateItems}`);
        console.log(`Skipped (empty sponsoredAds): ${stats.skippedEmpty}`);
        console.log(`Skipped (already migrated): ${stats.skippedAlreadyMigrated}`);
        console.log('');
        console.log('👉 Run without --dry-run to perform the actual migration');
    } else {
        console.log(`Documents migrated: ${stats.migrated}`);
        console.log(`Ad items moved: ${stats.migratedItems}`);
        console.log(`Skipped (empty sponsoredAds): ${stats.skippedEmpty}`);
        console.log(`Skipped (already migrated): ${stats.skippedAlreadyMigrated}`);
        console.log(`Failed: ${stats.failed}`);
        if (deleteOld) {
            console.log(`Old documents deleted: ${stats.migrated}`);
        } else {
            console.log(`Old documents kept (use --delete-old to remove them)`);
        }
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

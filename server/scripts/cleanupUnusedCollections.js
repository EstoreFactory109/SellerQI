/**
 * Database Collection Cleanup Script
 * 
 * This script identifies and removes MongoDB collections that are not being used by any
 * model in the codebase. It performs a careful analysis and provides options for:
 * 
 * 1. DRY RUN (default) - Shows what collections would be deleted without actually deleting
 * 2. BACKUP - Creates a backup before deletion
 * 3. DELETE - Actually deletes the unused collections
 * 
 * USAGE:
 *   node server/scripts/cleanupUnusedCollections.js                    # Dry run only
 *   node server/scripts/cleanupUnusedCollections.js --dry-run          # Dry run only (explicit)
 *   node server/scripts/cleanupUnusedCollections.js --backup           # Backup unused collections
 *   node server/scripts/cleanupUnusedCollections.js --delete           # Delete unused collections (DANGEROUS!)
 *   node server/scripts/cleanupUnusedCollections.js --delete --force   # Delete without confirmation
 * 
 * SAFETY FEATURES:
 *   - Default mode is dry run (no changes made)
 *   - Protected collections that are never deleted (system collections, critical data)
 *   - Shows document counts before any deletion
 *   - Requires manual confirmation for deletion
 *   - Can backup collections before deletion
 * 
 * WARNING: This script can cause irreversible data loss. Always:
 *   1. Run in dry-run mode first
 *   2. Create a full database backup before running with --delete
 *   3. Test in a staging environment first
 */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * All collections that are used by models in the codebase.
 * This list is derived from mongoose.model() calls in server/models/
 * 
 * Mongoose naming convention:
 * - Model name is lowercased
 * - Model name is pluralized (with some exceptions)
 * 
 * IMPORTANT: If you add a new model, add its collection name here!
 */
const USED_COLLECTIONS = [
    // User & Auth
    'users',
    'sellers',
    'subscriptions',
    'agencysellers',
    'userupdateschedules',
    'accounthistories',
    
    // System & Logging
    'paymentlogs',
    'emaillogs',
    'userAccountLogs',  // From ErrorLogs.js model - explicit collection name (camelCase)
    'jobstatuses',
    'dataFetchTracking',  // From DataFetchTrackingModel.js - explicit collection name (camelCase)
    'iptrackings',
    'supports',
    
    // AI
    'qmatechats',
    
    // Alerts (single collection with discriminators)
    'alerts',
    
    // Products
    'orderandrevenues',
    'productwisesales',
    'listingitemskeywords',
    'listingitems',
    
    // Inventory
    'get_fba_fulfillment_inbound_noncomplaiance_datas',
    'strandedinventoryuidatas',
    'get_fba_inventory_planning_datas',
    'shipments',
    'restockinventoryrecommendations',
    'productwisefbadataitems',
    'productwisefbadatas',
    'strandedinventoryuidataitems',
    
    // Seller Performance
    'apluscontents',
    'numberofproductreviews',
    'get_v1_seller_performance_reports',
    'get_v2_seller_performance_reports',
    
    // Amazon Ads
    'productwisesponsoredadsitems',
    'adsgroups',
    'getdatewisespendskeywords',
    'adskeywordsperformances',
    'campaigns',
    'searchterms',
    'keywords',
    'negativekeywords',
    'productwisesponsoredadsdatas',
    'ppcmetrics',
    'ppcunitssolds',
    'asinkeywordrecommendations',
    'keywordrecommendations',
    'keywordtrackingmodels',
    
    // Finance
    'ledgersummaryviewitems',
    'fbareimbursements',
    'ledgerdetailviews',
    'weeklyfinancemodels',
    'cogs',
    'ledgersummaryviews',
    'long_term_storage_fee_charges_datas',
    'productwisestoragefees',
    'productwisefinancials',
    
    // MCP
    'asinwisesalesforbigaccounts',
    'economicsmetrics',
    'buyboxdatas',
    'tasks',
];

/**
 * System collections that should NEVER be deleted
 * These are MongoDB internal collections
 */
const PROTECTED_COLLECTIONS = [
    'system.buckets',
    'system.profile',
    'system.js',
    'system.views',
    'system.users',
    'system.roles',
    'system.version',
    'startup_log',
    // Add any other collections you want to protect
];

/**
 * Parse command line arguments
 */
function parseArgs() {
    const args = process.argv.slice(2);
    return {
        dryRun: args.includes('--dry-run') || (!args.includes('--delete') && !args.includes('--backup')),
        delete: args.includes('--delete'),
        backup: args.includes('--backup'),
        force: args.includes('--force'),
        help: args.includes('--help') || args.includes('-h'),
    };
}

/**
 * Show help message
 */
function showHelp() {
    console.log(`
Database Collection Cleanup Script
===================================

This script identifies and optionally removes MongoDB collections not used by the codebase.

USAGE:
  node server/scripts/cleanupUnusedCollections.js [options]

OPTIONS:
  --dry-run     Show what would be deleted without making changes (default)
  --backup      Export unused collections to JSON files before deletion
  --delete      Actually delete unused collections (DANGEROUS!)
  --force       Skip confirmation prompt when deleting
  --help, -h    Show this help message

EXAMPLES:
  # See what collections would be deleted
  node server/scripts/cleanupUnusedCollections.js

  # Delete unused collections (will ask for confirmation)
  node server/scripts/cleanupUnusedCollections.js --delete

  # Delete without confirmation (for scripts)
  node server/scripts/cleanupUnusedCollections.js --delete --force

  # Backup unused collections to JSON
  node server/scripts/cleanupUnusedCollections.js --backup

WARNING: Always run in dry-run mode first and create a database backup before deleting!
    `);
}

/**
 * Connect to the database
 */
async function connectDB() {
    const dbUri = process.env.DB_URI;
    const dbName = process.env.DB_NAME;
    
    if (!dbUri || !dbName) {
        console.error('Error: DB_URI and DB_NAME environment variables are required');
        console.error('Make sure your .env file is properly configured');
        process.exit(1);
    }
    
    console.log(`Connecting to database: ${dbName}`);
    
    try {
        await mongoose.connect(`${dbUri}/${dbName}`, {
            connectTimeoutMS: 60000,
            socketTimeoutMS: 120000,
        });
        console.log('Connected to database successfully\n');
    } catch (error) {
        console.error('Failed to connect to database:', error.message);
        process.exit(1);
    }
}

/**
 * Get all collections in the database
 */
async function getAllCollections() {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    return collections.map(col => col.name);
}

/**
 * Get document count for a collection
 */
async function getDocumentCount(collectionName) {
    const db = mongoose.connection.db;
    try {
        const count = await db.collection(collectionName).countDocuments();
        return count;
    } catch (error) {
        return 'Error';
    }
}

/**
 * Get collection stats (size, storage)
 */
async function getCollectionStats(collectionName) {
    const db = mongoose.connection.db;
    try {
        const stats = await db.collection(collectionName).stats();
        return {
            size: formatBytes(stats.size || 0),
            storageSize: formatBytes(stats.storageSize || 0),
            avgObjSize: formatBytes(stats.avgObjSize || 0),
        };
    } catch (error) {
        return { size: 'N/A', storageSize: 'N/A', avgObjSize: 'N/A' };
    }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Identify unused collections
 */
async function identifyUnusedCollections(allCollections) {
    const usedSet = new Set(USED_COLLECTIONS.map(c => c.toLowerCase()));
    const protectedSet = new Set(PROTECTED_COLLECTIONS.map(c => c.toLowerCase()));
    
    const unused = [];
    const used = [];
    const protected = [];
    
    for (const collection of allCollections) {
        const lowerName = collection.toLowerCase();
        
        if (protectedSet.has(lowerName) || collection.startsWith('system.')) {
            protected.push(collection);
        } else if (usedSet.has(lowerName)) {
            used.push(collection);
        } else {
            unused.push(collection);
        }
    }
    
    return { unused, used, protected };
}

/**
 * Backup a collection to JSON
 */
async function backupCollection(collectionName, backupDir) {
    const db = mongoose.connection.db;
    const fs = require('fs');
    const path = require('path');
    
    // Create backup directory if it doesn't exist
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    try {
        const documents = await db.collection(collectionName).find({}).toArray();
        const filename = path.join(backupDir, `${collectionName}_${Date.now()}.json`);
        fs.writeFileSync(filename, JSON.stringify(documents, null, 2));
        return { success: true, filename, count: documents.length };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Delete a collection
 */
async function deleteCollection(collectionName) {
    const db = mongoose.connection.db;
    try {
        await db.collection(collectionName).drop();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Ask for user confirmation
 */
async function askConfirmation(message) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    
    return new Promise((resolve) => {
        rl.question(message, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
        });
    });
}

/**
 * Main execution
 */
async function main() {
    const args = parseArgs();
    
    if (args.help) {
        showHelp();
        process.exit(0);
    }
    
    console.log('='.repeat(80));
    console.log('DATABASE COLLECTION CLEANUP SCRIPT');
    console.log('='.repeat(80));
    console.log();
    
    // Show mode
    if (args.dryRun) {
        console.log('MODE: DRY RUN (no changes will be made)');
    } else if (args.backup) {
        console.log('MODE: BACKUP (will export unused collections to JSON)');
    } else if (args.delete) {
        console.log('MODE: DELETE (will remove unused collections!)');
        console.log('\n⚠️  WARNING: This operation is IRREVERSIBLE!\n');
    }
    console.log();
    
    // Connect to database
    await connectDB();
    
    // Get all collections
    console.log('Fetching all collections...');
    const allCollections = await getAllCollections();
    console.log(`Found ${allCollections.length} collections in database\n`);
    
    // Identify unused collections
    const { unused, used, protected } = await identifyUnusedCollections(allCollections);
    
    // Report: Used collections
    console.log('=' .repeat(80));
    console.log(`USED COLLECTIONS (${used.length}):`);
    console.log('=' .repeat(80));
    for (const collection of used.sort()) {
        const count = await getDocumentCount(collection);
        console.log(`  ✓ ${collection.padEnd(50)} ${String(count).padStart(10)} docs`);
    }
    console.log();
    
    // Report: Protected collections
    if (protected.length > 0) {
        console.log('=' .repeat(80));
        console.log(`PROTECTED COLLECTIONS (${protected.length}):`);
        console.log('=' .repeat(80));
        for (const collection of protected.sort()) {
            console.log(`  🔒 ${collection}`);
        }
        console.log();
    }
    
    // Report: Unused collections
    console.log('=' .repeat(80));
    console.log(`UNUSED COLLECTIONS (${unused.length}):`);
    console.log('=' .repeat(80));
    
    if (unused.length === 0) {
        console.log('  No unused collections found! 🎉');
        console.log();
        await mongoose.disconnect();
        return;
    }
    
    let totalDocs = 0;
    const unusedDetails = [];
    
    for (const collection of unused.sort()) {
        const count = await getDocumentCount(collection);
        const stats = await getCollectionStats(collection);
        totalDocs += typeof count === 'number' ? count : 0;
        unusedDetails.push({ name: collection, count, stats });
        console.log(`  ✗ ${collection.padEnd(50)} ${String(count).padStart(10)} docs  (${stats.size})`);
    }
    console.log();
    console.log(`Total documents in unused collections: ${totalDocs}`);
    console.log();
    
    // Actions based on mode
    if (args.dryRun) {
        console.log('=' .repeat(80));
        console.log('DRY RUN COMPLETE');
        console.log('=' .repeat(80));
        console.log(`\nTo delete these ${unused.length} collections, run:`);
        console.log('  node server/scripts/cleanupUnusedCollections.js --delete\n');
        console.log('To backup before deletion, run:');
        console.log('  node server/scripts/cleanupUnusedCollections.js --backup\n');
    }
    
    if (args.backup) {
        console.log('=' .repeat(80));
        console.log('BACKING UP UNUSED COLLECTIONS');
        console.log('=' .repeat(80));
        
        const backupDir = `./backups/db_cleanup_${Date.now()}`;
        console.log(`Backup directory: ${backupDir}\n`);
        
        for (const { name, count } of unusedDetails) {
            process.stdout.write(`  Backing up ${name}... `);
            const result = await backupCollection(name, backupDir);
            if (result.success) {
                console.log(`✓ ${result.count} documents saved`);
            } else {
                console.log(`✗ Error: ${result.error}`);
            }
        }
        
        console.log(`\nBackup complete! Files saved to: ${backupDir}`);
    }
    
    if (args.delete) {
        // Confirmation
        if (!args.force) {
            console.log('=' .repeat(80));
            console.log('CONFIRMATION REQUIRED');
            console.log('=' .repeat(80));
            console.log(`\nYou are about to DELETE ${unused.length} collections containing ${totalDocs} documents.`);
            console.log('This action is IRREVERSIBLE.\n');
            
            const confirmed = await askConfirmation('Type "yes" to confirm deletion: ');
            
            if (!confirmed) {
                console.log('\nDeletion cancelled.');
                await mongoose.disconnect();
                return;
            }
        }
        
        console.log('\n' + '=' .repeat(80));
        console.log('DELETING UNUSED COLLECTIONS');
        console.log('=' .repeat(80) + '\n');
        
        let deleted = 0;
        let failed = 0;
        
        for (const { name } of unusedDetails) {
            process.stdout.write(`  Deleting ${name}... `);
            const result = await deleteCollection(name);
            if (result.success) {
                console.log('✓ Deleted');
                deleted++;
            } else {
                console.log(`✗ Error: ${result.error}`);
                failed++;
            }
        }
        
        console.log('\n' + '=' .repeat(80));
        console.log('DELETION COMPLETE');
        console.log('=' .repeat(80));
        console.log(`  Deleted: ${deleted}`);
        console.log(`  Failed: ${failed}`);
    }
    
    // Disconnect
    await mongoose.disconnect();
    console.log('\nDatabase connection closed.');
}

// Run the script
main().catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
});

/**
 * Migration Script: Migrate Tasks and IssuesData to Chunked Storage
 * 
 * This script migrates existing data to avoid the 16MB MongoDB document limit:
 * 
 * 1. TASKS MIGRATION:
 *    - Reads tasks from the embedded `tasks` array in Task documents
 *    - Inserts each task as a separate document in TaskItem collection
 *    - Clears the embedded tasks array after migration
 * 
 * 2. ISSUES DATA MIGRATION:
 *    - Reads large arrays from IssuesData documents
 *    - Stores them as chunks in IssuesDataChunks collection
 *    - Updates IssuesData to dataVersion 2 and clears embedded arrays
 * 
 * Usage:
 *   node server/migrations/migrate-tasks-issues-to-chunks.js
 * 
 * Options:
 *   --dry-run    Preview changes without modifying database
 *   --tasks-only Migrate only tasks
 *   --issues-only Migrate only issues data
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Import models
const Task = require('../models/MCP/TaskModel.js');
const TaskItem = require('../models/MCP/TaskItemModel.js');
const IssuesData = require('../models/system/IssuesDataModel.js');
const IssuesDataChunks = require('../models/system/IssuesDataChunksModel.js');

// Parse CLI arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TASKS_ONLY = args.includes('--tasks-only');
const ISSUES_ONLY = args.includes('--issues-only');

// Chunk sizes
const TASK_CHUNK_SIZE = 500;
const ISSUES_CHUNK_SIZE = 200;

// Fields to chunk in IssuesData
const CHUNKED_FIELDS = [
    'productWiseError',
    'rankingProductWiseErrors',
    'conversionProductWiseErrors',
    'inventoryProductWiseErrors',
    'profitabilityErrorDetails',
    'sponsoredAdsErrorDetails',
    'TotalProduct',
    'ActiveProducts'
];

// Statistics
const stats = {
    tasks: {
        documentsProcessed: 0,
        tasksMigrated: 0,
        duplicatesSkipped: 0,
        errors: 0
    },
    issues: {
        documentsProcessed: 0,
        chunksCreated: 0,
        errors: 0
    }
};

/**
 * Connect to MongoDB
 * Uses same env vars as app: DB_URI + DB_NAME, or full URI (MONGODB_URI / MONGO_URI / DB_URL)
 */
async function connectDB() {
    const fullUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
    const dbUri = process.env.DB_URI;
    const dbName = process.env.DB_NAME;
    
    const mongoUri = fullUri || (dbUri && dbName ? `${dbUri}/${dbName}` : null);
    
    if (!mongoUri) {
        throw new Error(
            'MongoDB URI not found. In .env set either: MONGODB_URI (or MONGO_URI or DB_URL), or DB_URI + DB_NAME'
        );
    }
    
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
}

/**
 * Migrate tasks from embedded array to TaskItem collection
 */
async function migrateTasks() {
    console.log('\n========================================');
    console.log('MIGRATING TASKS');
    console.log('========================================\n');
    
    // Find all Task documents with embedded tasks
    const taskDocs = await Task.find({ 'tasks.0': { $exists: true } }).lean();
    
    console.log(`Found ${taskDocs.length} Task documents with embedded tasks`);
    
    if (taskDocs.length === 0) {
        console.log('No tasks to migrate.');
        return;
    }
    
    for (const taskDoc of taskDocs) {
        const userId = taskDoc.userId;
        const embeddedTasks = taskDoc.tasks || [];
        
        console.log(`\nProcessing user ${userId}: ${embeddedTasks.length} embedded tasks`);
        stats.tasks.documentsProcessed++;
        
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would migrate ${embeddedTasks.length} tasks`);
            stats.tasks.tasksMigrated += embeddedTasks.length;
            continue;
        }
        
        try {
            // Prepare tasks for bulk insert
            const tasksToInsert = embeddedTasks.map(task => ({
                userId: userId,
                taskId: task.taskId,
                productName: task.productName,
                asin: task.asin,
                errorCategory: task.errorCategory,
                errorType: task.errorType,
                error: task.error,
                solution: task.solution,
                status: task.status || 'pending'
            }));
            
            // Insert in chunks
            let insertedCount = 0;
            for (let i = 0; i < tasksToInsert.length; i += TASK_CHUNK_SIZE) {
                const chunk = tasksToInsert.slice(i, i + TASK_CHUNK_SIZE);
                
                try {
                    const result = await TaskItem.insertMany(chunk, { ordered: false });
                    insertedCount += result.length;
                } catch (error) {
                    if (error.code === 11000 || error.writeErrors) {
                        // Duplicate key errors - some were inserted
                        const inserted = error.insertedDocs?.length || 0;
                        insertedCount += inserted;
                        stats.tasks.duplicatesSkipped += chunk.length - inserted;
                    } else {
                        throw error;
                    }
                }
            }
            
            stats.tasks.tasksMigrated += insertedCount;
            console.log(`  Migrated ${insertedCount} tasks (${embeddedTasks.length - insertedCount} duplicates skipped)`);
            
            // Clear embedded tasks array
            await Task.updateOne(
                { _id: taskDoc._id },
                { $set: { tasks: [] } }
            );
            console.log(`  Cleared embedded tasks array`);
            
        } catch (error) {
            console.error(`  ERROR: ${error.message}`);
            stats.tasks.errors++;
        }
    }
}

/**
 * Migrate IssuesData to chunked storage
 */
async function migrateIssuesData() {
    console.log('\n========================================');
    console.log('MIGRATING ISSUES DATA');
    console.log('========================================\n');
    
    // Find all IssuesData documents that haven't been migrated (dataVersion < 2 or undefined)
    const issuesDocs = await IssuesData.find({
        $or: [
            { dataVersion: { $lt: 2 } },
            { dataVersion: { $exists: false } }
        ]
    }).lean();
    
    console.log(`Found ${issuesDocs.length} IssuesData documents to migrate`);
    
    if (issuesDocs.length === 0) {
        console.log('No issues data to migrate.');
        return;
    }
    
    for (const issuesDoc of issuesDocs) {
        const { userId, country, region, _id: issuesDataId } = issuesDoc;
        
        console.log(`\nProcessing user ${userId}, ${country}/${region}`);
        stats.issues.documentsProcessed++;
        
        // Count items to migrate
        let totalItems = 0;
        for (const field of CHUNKED_FIELDS) {
            const arr = issuesDoc[field];
            if (arr && Array.isArray(arr)) {
                totalItems += arr.length;
            }
        }
        
        console.log(`  Total items across chunked fields: ${totalItems}`);
        
        if (DRY_RUN) {
            const estimatedChunks = Math.ceil(totalItems / ISSUES_CHUNK_SIZE);
            console.log(`  [DRY RUN] Would create ~${estimatedChunks} chunks`);
            stats.issues.chunksCreated += estimatedChunks;
            continue;
        }
        
        try {
            let chunksCreated = 0;
            
            // Delete existing chunks for this user/country/region
            await IssuesDataChunks.deleteMany({ userId, country, region });
            
            // Create chunks for each field
            for (const fieldName of CHUNKED_FIELDS) {
                const data = issuesDoc[fieldName];
                
                if (!data || !Array.isArray(data) || data.length === 0) {
                    // Create empty chunk to indicate no data
                    await IssuesDataChunks.create({
                        issuesDataId,
                        userId,
                        country,
                        region,
                        fieldName,
                        chunkIndex: 0,
                        totalChunks: 1,
                        data: [],
                        itemCount: 0
                    });
                    chunksCreated++;
                    continue;
                }
                
                const totalChunks = Math.ceil(data.length / ISSUES_CHUNK_SIZE);
                
                for (let i = 0; i < totalChunks; i++) {
                    const start = i * ISSUES_CHUNK_SIZE;
                    const end = Math.min(start + ISSUES_CHUNK_SIZE, data.length);
                    const chunkData = data.slice(start, end);
                    
                    await IssuesDataChunks.create({
                        issuesDataId,
                        userId,
                        country,
                        region,
                        fieldName,
                        chunkIndex: i,
                        totalChunks,
                        data: chunkData,
                        itemCount: chunkData.length
                    });
                    chunksCreated++;
                }
            }
            
            stats.issues.chunksCreated += chunksCreated;
            console.log(`  Created ${chunksCreated} chunks`);
            
            // Update IssuesData to dataVersion 2 and clear embedded arrays
            const clearFields = {};
            for (const field of CHUNKED_FIELDS) {
                clearFields[field] = [];
            }
            clearFields.dataVersion = 2;
            
            await IssuesData.updateOne(
                { _id: issuesDataId },
                { $set: clearFields }
            );
            console.log(`  Updated to dataVersion 2 and cleared embedded arrays`);
            
        } catch (error) {
            console.error(`  ERROR: ${error.message}`);
            stats.issues.errors++;
        }
    }
}

/**
 * Print migration summary
 */
function printSummary() {
    console.log('\n========================================');
    console.log('MIGRATION SUMMARY');
    console.log('========================================');
    
    if (DRY_RUN) {
        console.log('\n*** DRY RUN - No changes were made ***\n');
    }
    
    if (!ISSUES_ONLY) {
        console.log('\nTasks Migration:');
        console.log(`  Documents processed: ${stats.tasks.documentsProcessed}`);
        console.log(`  Tasks migrated: ${stats.tasks.tasksMigrated}`);
        console.log(`  Duplicates skipped: ${stats.tasks.duplicatesSkipped}`);
        console.log(`  Errors: ${stats.tasks.errors}`);
    }
    
    if (!TASKS_ONLY) {
        console.log('\nIssues Data Migration:');
        console.log(`  Documents processed: ${stats.issues.documentsProcessed}`);
        console.log(`  Chunks created: ${stats.issues.chunksCreated}`);
        console.log(`  Errors: ${stats.issues.errors}`);
    }
    
    console.log('\n========================================\n');
}

/**
 * Main migration function
 */
async function runMigration() {
    console.log('\n========================================');
    console.log('TASK & ISSUES DATA MIGRATION');
    console.log('========================================');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'LIVE'}`);
    console.log(`Scope: ${TASKS_ONLY ? 'Tasks only' : ISSUES_ONLY ? 'Issues only' : 'Tasks and Issues'}`);
    console.log('========================================\n');
    
    try {
        await connectDB();
        
        if (!ISSUES_ONLY) {
            await migrateTasks();
        }
        
        if (!TASKS_ONLY) {
            await migrateIssuesData();
        }
        
        printSummary();
        
        console.log('Migration completed successfully!');
        
    } catch (error) {
        console.error('\nMIGRATION FAILED:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

// Run migration
runMigration();

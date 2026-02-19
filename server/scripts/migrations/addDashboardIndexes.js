/**
 * Migration: Add compound indexes for dashboard performance
 * 
 * This script adds indexes for fast "latest doc per user/country/region" queries.
 * Run this once to ensure all dashboard-related collections have proper indexes.
 * 
 * Usage: node server/scripts/migrations/addDashboardIndexes.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Import models to ensure indexes are registered
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const V2_Model = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1_Model = require('../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const GetOrderDataModel = require('../../models/products/OrderAndRevenueModel.js');
const adsKeywordsPerformanceModel = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');

// Collections and their required indexes for dashboard queries
const indexDefinitions = [
    {
        model: EconomicsMetrics,
        name: 'EconomicsMetrics',
        indexes: [
            { fields: { User: 1, country: 1, region: 1, createdAt: -1 }, options: { name: 'user_country_region_created_desc' } }
        ]
    },
    {
        model: BuyBoxData,
        name: 'BuyBoxData',
        indexes: [
            { fields: { User: 1, country: 1, region: 1, createdAt: -1 }, options: { name: 'user_country_region_created_desc' } }
        ]
    },
    {
        model: PPCMetrics,
        name: 'PPCMetrics',
        indexes: [
            { fields: { userId: 1, country: 1, region: 1, createdAt: -1 }, options: { name: 'userid_country_region_created_desc' } }
        ]
    },
    {
        model: adsKeywordsPerformanceModel,
        name: 'adsKeywordsPerformance',
        indexes: [
            { fields: { userId: 1, country: 1, region: 1, createdAt: -1 }, options: { name: 'userid_country_region_created_desc' } }
        ]
    },
    {
        model: GetOrderDataModel,
        name: 'OrderAndRevenue',
        indexes: [
            { fields: { User: 1, country: 1, region: 1, createdAt: -1 }, options: { name: 'user_country_region_created_desc' } }
        ]
    },
    {
        model: DataFetchTracking,
        name: 'DataFetchTracking',
        indexes: [
            { fields: { User: 1, country: 1, region: 1, status: 1, fetchedAt: -1 }, options: { name: 'user_country_region_status_fetched_desc' } }
        ]
    },
    {
        model: Seller,
        name: 'Seller',
        indexes: [
            { fields: { User: 1 }, options: { name: 'user_idx' } }
        ]
    }
];

async function ensureIndexes() {
    console.log('Starting index migration for dashboard performance...\n');
    
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MongoDB URI not found in environment variables');
        }
        
        await mongoose.connect(mongoUri);
        console.log('Connected to MongoDB\n');
        
        let indexesCreated = 0;
        let indexesExisted = 0;
        
        for (const def of indexDefinitions) {
            console.log(`Checking indexes for ${def.name}...`);
            
            try {
                // Get existing indexes
                const existingIndexes = await def.model.collection.indexes();
                const existingIndexNames = existingIndexes.map(idx => idx.name);
                
                for (const indexDef of def.indexes) {
                    const indexName = indexDef.options.name;
                    
                    if (existingIndexNames.includes(indexName)) {
                        console.log(`  ✓ Index '${indexName}' already exists`);
                        indexesExisted++;
                    } else {
                        // Check if a similar index exists (same fields, different name)
                        const fieldKeys = Object.keys(indexDef.fields).sort().join('_');
                        const similarExists = existingIndexes.some(idx => {
                            const idxFieldKeys = Object.keys(idx.key).sort().join('_');
                            return idxFieldKeys === fieldKeys;
                        });
                        
                        if (similarExists) {
                            console.log(`  ✓ Similar index for fields already exists`);
                            indexesExisted++;
                        } else {
                            // Create the index
                            await def.model.collection.createIndex(indexDef.fields, indexDef.options);
                            console.log(`  ✓ Created index '${indexName}'`);
                            indexesCreated++;
                        }
                    }
                }
            } catch (error) {
                console.error(`  ✗ Error with ${def.name}: ${error.message}`);
            }
            
            console.log('');
        }
        
        console.log('=== Summary ===');
        console.log(`Indexes created: ${indexesCreated}`);
        console.log(`Indexes already existed: ${indexesExisted}`);
        console.log('\nIndex migration completed successfully!');
        
    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    ensureIndexes().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { ensureIndexes };

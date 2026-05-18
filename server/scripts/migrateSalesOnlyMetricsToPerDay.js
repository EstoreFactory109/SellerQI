#!/usr/bin/env node
/**
 * Migration Script: SalesOnlyMetrics to Per-Day Documents
 *
 * Migrates existing SalesOnlyMetrics documents (with embedded datewiseSales arrays)
 * to the new per-day document structure.
 *
 * Usage:
 *   node server/scripts/migrateSalesOnlyMetricsToPerDay.js --userId=<userId>
 *
 * Logic:
 * 1. Find all existing SalesOnlyMetrics docs for the userId (sorted by createdAt DESC)
 * 2. Build a Map of `date -> dayData` from all datewiseSales arrays (newer doc wins for duplicate dates)
 * 3. Bulk insert per-day documents
 * 4. Delete old embedded-array documents
 * 5. Log summary: dates migrated, old docs deleted
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const DB_URI = process.env.DB_URI;
const DB_NAME = process.env.DB_NAME;
const MONGODB_URI = DB_URI && DB_NAME 
  ? `${DB_URI}/${DB_NAME}` 
  : process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/sellerqi';

const oldSchema = new mongoose.Schema(
  {
    User: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    region: { type: String, required: true },
    country: { type: String, required: true },
    dateRange: {
      startDate: { type: String },
      endDate: { type: String },
    },
    totalSales: {
      amount: { type: Number },
      currencyCode: { type: String },
    },
    datewiseSales: [
      {
        date: { type: String },
        sales: { amount: { type: Number }, currencyCode: { type: String } },
        grossProfit: { amount: { type: Number }, currencyCode: { type: String } },
        unitsSold: { type: Number },
      },
    ],
    last7Days: { type: mongoose.Schema.Types.Mixed },
    last14Days: { type: mongoose.Schema.Types.Mixed },
    queryId: { type: String },
    documentId: { type: String },
    processedAt: { type: Date },
    dataSource: { type: String },
  },
  { timestamps: true, strict: false }
);

const OldSalesOnlyMetrics = mongoose.model('OldSalesOnlyMetrics', oldSchema, 'salesonlymetrics');

const newSchema = new mongoose.Schema(
  {
    User: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    region: { type: String, required: true },
    country: { type: String, required: true },
    date: { type: String, required: true },
    sales: {
      amount: { type: Number, required: true, default: 0 },
      currencyCode: { type: String, required: true, default: 'USD' },
    },
    grossProfit: {
      amount: { type: Number, required: true, default: 0 },
      currencyCode: { type: String, required: true, default: 'USD' },
    },
    unitsSold: { type: Number, default: 0 },
    dataSource: { type: String, default: 'DataKiosk' },
  },
  { timestamps: true }
);
newSchema.index({ User: 1, country: 1, region: 1, date: 1 }, { unique: true });

const NewSalesOnlyMetrics = mongoose.model('NewSalesOnlyMetrics', newSchema, 'salesonlymetrics');

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value;
    }
  });
  return args;
}

async function migrate(userId) {
  console.log(`\n[Migration] Starting migration for userId: ${userId}`);

  const userObjectId = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  const oldDocs = await OldSalesOnlyMetrics.find({
    User: userObjectId,
    datewiseSales: { $exists: true, $ne: [] },
  }).sort({ createdAt: -1 }).lean();

  if (!oldDocs || oldDocs.length === 0) {
    console.log('[Migration] No old documents found with datewiseSales array. Nothing to migrate.');
    return { migrated: 0, deleted: 0, skipped: true };
  }

  console.log(`[Migration] Found ${oldDocs.length} old document(s) with embedded datewiseSales.`);

  const dateMap = new Map();
  const oldDocIds = [];

  for (const doc of oldDocs) {
    oldDocIds.push(doc._id);

    const datewiseSales = doc.datewiseSales || [];
    for (const day of datewiseSales) {
      if (!day.date) continue;

      const dateKey = `${doc.country}:${doc.region}:${day.date}`;
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          User: doc.User,
          region: doc.region,
          country: doc.country,
          date: day.date,
          sales: day.sales || { amount: 0, currencyCode: 'USD' },
          grossProfit: day.grossProfit || { amount: 0, currencyCode: 'USD' },
          unitsSold: day.unitsSold || 0,
          dataSource: doc.dataSource || 'DataKiosk',
        });
      }
    }
  }

  console.log(`[Migration] Extracted ${dateMap.size} unique date entries across all countries/regions.`);

  if (dateMap.size === 0) {
    console.log('[Migration] No date entries to migrate. Skipping bulk insert.');
    return { migrated: 0, deleted: 0, skipped: true };
  }

  const operations = Array.from(dateMap.values()).map((dayData) => ({
    updateOne: {
      filter: {
        User: dayData.User,
        region: dayData.region,
        country: dayData.country,
        date: dayData.date,
      },
      update: { $set: dayData },
      upsert: true,
    },
  }));

  console.log(`[Migration] Performing bulk write of ${operations.length} per-day documents...`);
  const bulkResult = await NewSalesOnlyMetrics.bulkWrite(operations, { ordered: false });
  console.log(
    `[Migration] Bulk write completed: upserted=${bulkResult.upsertedCount}, modified=${bulkResult.modifiedCount}`
  );

  console.log(`[Migration] Deleting ${oldDocIds.length} old document(s)...`);
  const deleteResult = await OldSalesOnlyMetrics.deleteMany({ _id: { $in: oldDocIds } });
  console.log(`[Migration] Deleted ${deleteResult.deletedCount} old document(s).`);

  return {
    migrated: bulkResult.upsertedCount + bulkResult.modifiedCount,
    deleted: deleteResult.deletedCount,
    skipped: false,
  };
}

async function main() {
  const args = parseArgs();
  const userId = args.userId;

  if (!userId) {
    console.error('Usage: node migrateSalesOnlyMetricsToPerDay.js --userId=<userId>');
    process.exit(1);
  }

  try {
    console.log('[Migration] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[Migration] Connected.');

    const result = await migrate(userId);

    console.log('\n[Migration] Summary:');
    console.log(`  - User ID: ${userId}`);
    console.log(`  - Per-day documents created/updated: ${result.migrated}`);
    console.log(`  - Old documents deleted: ${result.deleted}`);
    console.log(`  - Skipped: ${result.skipped}`);

    console.log('\n[Migration] Done.');
    process.exit(0);
  } catch (error) {
    console.error('[Migration] Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

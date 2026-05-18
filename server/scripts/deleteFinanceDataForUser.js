#!/usr/bin/env node
/**
 * Delete new finance-flow data for a specific user + country + region.
 *
 * Usage:
 *   Dry run (recommended first):
 *   node server/scripts/deleteFinanceDataForUser.js \
 *     --userId=<userId> --country=<code> --region=<NA|EU|FE> --dryRun
 *
 *   Actual delete:
 *   node server/scripts/deleteFinanceDataForUser.js \
 *     --userId=<userId> --country=<code> --region=<NA|EU|FE> --confirm
 */

require('dotenv').config();
const mongoose = require('mongoose');

const DailySkuFinance = require('../models/finance/DailySkuFinanceModel.js');
const DailyOverheadFinance = require('../models/finance/DailyOverheadFinanceModel.js');
const AsinRelationship = require('../models/finance/AsinRelationshipModel.js');
const FinanceSyncLog = require('../models/finance/FinanceSyncLogModel.js');
const PendingExpenseOrder = require('../models/finance/PendingExpenseOrderModel.js');

const DB_URI = process.env.DB_URI;
const DB_NAME = process.env.DB_NAME;
const MONGODB_URI =
  DB_URI && DB_NAME
    ? `${DB_URI}/${DB_NAME}`
    : process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/sellerqi';

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (!arg.startsWith('--')) return;
    const eq = arg.indexOf('=');
    if (eq > -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      args[arg.slice(2)] = true;
    }
  });
  return args;
}

function normalizeCountry(country) {
  return String(country || '').trim().toUpperCase();
}

function normalizeRegion(region) {
  return String(region || '').trim().toUpperCase();
}

function getUserObjectId(userId) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error(`Invalid userId: "${userId}"`);
  }
  return new mongoose.Types.ObjectId(userId);
}

function buildFilter({ userId, country, region }) {
  return {
    User: getUserObjectId(userId),
    country: normalizeCountry(country),
    region: normalizeRegion(region),
  };
}

async function getCounts(filter) {
  const [
    dailySkuFinance,
    dailyOverheadFinance,
    asinRelationship,
    financeSyncLog,
    pendingExpenseOrder,
  ] = await Promise.all([
    DailySkuFinance.countDocuments(filter),
    DailyOverheadFinance.countDocuments(filter),
    AsinRelationship.countDocuments(filter),
    FinanceSyncLog.countDocuments(filter),
    PendingExpenseOrder.countDocuments(filter),
  ]);

  return {
    dailySkuFinance,
    dailyOverheadFinance,
    asinRelationship,
    financeSyncLog,
    pendingExpenseOrder,
    total:
      dailySkuFinance +
      dailyOverheadFinance +
      asinRelationship +
      financeSyncLog +
      pendingExpenseOrder,
  };
}

async function deleteData(filter) {
  const [
    dailySkuFinance,
    dailyOverheadFinance,
    asinRelationship,
    financeSyncLog,
    pendingExpenseOrder,
  ] = await Promise.all([
    DailySkuFinance.deleteMany(filter),
    DailyOverheadFinance.deleteMany(filter),
    AsinRelationship.deleteMany(filter),
    FinanceSyncLog.deleteMany(filter),
    PendingExpenseOrder.deleteMany(filter),
  ]);

  return {
    dailySkuFinance: dailySkuFinance.deletedCount || 0,
    dailyOverheadFinance: dailyOverheadFinance.deletedCount || 0,
    asinRelationship: asinRelationship.deletedCount || 0,
    financeSyncLog: financeSyncLog.deletedCount || 0,
    pendingExpenseOrder: pendingExpenseOrder.deletedCount || 0,
  };
}

async function main() {
  const args = parseArgs();
  const { userId, country, region, dryRun, confirm } = args;

  if (!userId || !country || !region) {
    console.error(
      'Usage: node deleteFinanceDataForUser.js --userId=<id> --country=<code> --region=<NA|EU|FE> [--dryRun|--confirm]'
    );
    process.exit(1);
  }

  const normalizedRegion = normalizeRegion(region);
  if (!['NA', 'EU', 'FE'].includes(normalizedRegion)) {
    console.error('Error: region must be one of: NA, EU, FE');
    process.exit(1);
  }

  if (!dryRun && !confirm) {
    console.error('Safety check failed: pass --dryRun to preview or --confirm to delete.');
    process.exit(1);
  }

  try {
    console.log('[Delete Finance Data] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[Delete Finance Data] Connected.');

    const filter = buildFilter({ userId, country, region: normalizedRegion });
    const targetCountry = normalizeCountry(country);

    console.log(
      `[Delete Finance Data] Target => userId=${userId}, country=${targetCountry}, region=${normalizedRegion}`
    );

    const beforeCounts = await getCounts(filter);
    console.log('\n[Delete Finance Data] Matching documents:');
    console.log(`  DailySkuFinance:      ${beforeCounts.dailySkuFinance}`);
    console.log(`  DailyOverheadFinance: ${beforeCounts.dailyOverheadFinance}`);
    console.log(`  AsinRelationship:     ${beforeCounts.asinRelationship}`);
    console.log(`  FinanceSyncLog:       ${beforeCounts.financeSyncLog}`);
    console.log(`  PendingExpenseOrder:  ${beforeCounts.pendingExpenseOrder}`);
    console.log(`  Total:                ${beforeCounts.total}`);

    if (dryRun) {
      console.log('\n[Delete Finance Data] DRY RUN complete. No data deleted.');
      process.exit(0);
    }

    const deleted = await deleteData(filter);
    const deletedTotal =
      deleted.dailySkuFinance +
      deleted.dailyOverheadFinance +
      deleted.asinRelationship +
      deleted.financeSyncLog +
      deleted.pendingExpenseOrder;

    console.log('\n[Delete Finance Data] Deleted documents:');
    console.log(`  DailySkuFinance:      ${deleted.dailySkuFinance}`);
    console.log(`  DailyOverheadFinance: ${deleted.dailyOverheadFinance}`);
    console.log(`  AsinRelationship:     ${deleted.asinRelationship}`);
    console.log(`  FinanceSyncLog:       ${deleted.financeSyncLog}`);
    console.log(`  PendingExpenseOrder:  ${deleted.pendingExpenseOrder}`);
    console.log(`  Total Deleted:        ${deletedTotal}`);

    const afterCounts = await getCounts(filter);
    console.log('\n[Delete Finance Data] Remaining documents after delete:');
    console.log(`  DailySkuFinance:      ${afterCounts.dailySkuFinance}`);
    console.log(`  DailyOverheadFinance: ${afterCounts.dailyOverheadFinance}`);
    console.log(`  AsinRelationship:     ${afterCounts.asinRelationship}`);
    console.log(`  FinanceSyncLog:       ${afterCounts.financeSyncLog}`);
    console.log(`  PendingExpenseOrder:  ${afterCounts.pendingExpenseOrder}`);
    console.log(`  Total:                ${afterCounts.total}`);

    console.log('\n[Delete Finance Data] Done.');
    process.exit(0);
  } catch (error) {
    console.error('[Delete Finance Data] Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

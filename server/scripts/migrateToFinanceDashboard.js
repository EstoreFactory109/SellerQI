#!/usr/bin/env node
/**
 * Migration Script: Old Expense/Sales Models -> New Finance Dashboard Models
 *
 * Migrates data from ExpenseRawRow and AsinWiseSalesDateItem into
 * DailySkuFinance and DailyOverheadFinance for a specific user+country+region.
 *
 * Usage:
 *   node server/scripts/migrateToFinanceDashboard.js \
 *     --userId=<userId> --country=<code> --region=<NA|EU|FE> [--dryRun]
 *
 * Steps:
 *   A) ExpenseRawRow (sku rows)       -> DailySkuFinance   (expense fields)
 *   B) ExpenseRawRow (non-sku rows)   -> DailyOverheadFinance
 *   C) AsinWiseSalesDateItem          -> DailySkuFinance   (revenue fields)
 */

require('dotenv').config();
const mongoose = require('mongoose');

const DB_URI = process.env.DB_URI;
const DB_NAME = process.env.DB_NAME;
const MONGODB_URI =
  DB_URI && DB_NAME
    ? `${DB_URI}/${DB_NAME}`
    : process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/sellerqi';

const ExpenseRawRow = require('../models/finance/ExpenseRawRowModel.js');
const AsinWiseSalesDateItem = require('../models/finance/AsinWiseSalesDateItemModel.js');
const AsinWiseSalesRun = require('../models/finance/AsinWiseSalesRunModel.js');
const DailySkuFinance = require('../models/finance/DailySkuFinanceModel.js');
const DailyOverheadFinance = require('../models/finance/DailyOverheadFinanceModel.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');

const { marketplaceConfig } = require('../controllers/config/config.js');

// ── Category -> DailySkuFinance field mapping ──
const CATEGORY_TO_FIELD = {
  'FBA Fulfillment Fee': 'fbaFulfillmentFee',
  'Referral Commission': 'referralCommission',
  'Closing Fee': 'closingFee',
  'Technology Fee': 'technologyFee',
  'Shipping Chargeback': 'shippingChargeback',
  'Gift Wrap Chargeback': 'giftWrapChargeback',
  'Refund Commission': 'refundCommission',
  'Promotions / Discounts': 'promotionsDiscount',
  'Shipping Discount': 'shippingDiscount',
  'Tax Discount': 'taxDiscount',
  'Shipping Tax Discount': 'shippingTaxDiscount',
  'Sales Tax Collected': 'salesTaxCollected',
  'Shipping Tax Collected': 'shippingTaxCollected',
  'Gift Wrap Tax Collected': 'giftWrapTaxCollected',
  'TDS (Tax Deducted at Source)': 'tdsDeducted',
  'TCS (Tax Collected at Source)': 'tcsCollected',
  'FBA Reversed Reimbursement': 'fbaReversedReimbursement',
};

// Categories that belong to overhead (not per-SKU)
const OVERHEAD_CATEGORIES = new Set([
  'FBA Storage Fee',
  'FBA Inbound Transportation Fee',
  'FBA Removal Fee',
  'TaxWithholding',
  'Advertising / PPC',
  'Subscription Fee',
  'FBA Capacity Reservation Fee',
]);

// Overhead categories that represent revenue (not expense)
const REVENUE_CATEGORIES = new Set([
  'Disbursement',
  'Seller Reward',
  'SAFE-T Reimbursement',
  'Reimbursement',
  'Fulfillment Fee Refund',
  'SERRAC Reimbursement',
]);

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > -1) {
        args[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        args[arg.slice(2)] = true;
      }
    }
  });
  return args;
}

function resolveMarketplaceId(country) {
  const upper = (country || '').toUpperCase();
  return marketplaceConfig[upper] || '';
}

// ── Step A: ExpenseRawRow (with SKU) -> DailySkuFinance ──
async function migrateExpenseRowsToSkuFinance(userId, country, region, dryRun) {
  const uid =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const marketplaceId = resolveMarketplaceId(country);

  console.log('\n[Step A] Migrating ExpenseRawRow (SKU rows) -> DailySkuFinance...');

  const pipeline = [
    {
      $match: {
        User: uid,
        country,
        region,
        sku: { $ne: 'N/A', $exists: true, $nin: ['', null] },
        postedDateStr: { $ne: '', $exists: true },
      },
    },
    {
      $group: {
        _id: { sku: '$sku', date: '$postedDateStr' },
        asin: { $first: '$asin' },
        categories: {
          $push: { category: '$category', amount: '$amount' },
        },
      },
    },
  ];

  const groups = await ExpenseRawRow.aggregate(pipeline);
  console.log(`  Found ${groups.length} (sku, date) groups.`);

  if (!groups.length) return { written: 0 };

  const operations = [];

  for (const g of groups) {
    const sku = g._id.sku;
    const date = g._id.date;
    const asin = (g.asin || '').trim();

    const fields = {};
    const otherBreakdown = [];
    let otherTotal = 0;

    for (const { category, amount } of g.categories) {
      const field = CATEGORY_TO_FIELD[category];
      if (field) {
        fields[field] = round2((fields[field] || 0) + (amount || 0));
      } else if (category && !OVERHEAD_CATEGORIES.has(category) && !REVENUE_CATEGORIES.has(category)) {
        otherTotal += amount || 0;
        otherBreakdown.push({ category, amount: round2(amount || 0) });
      }
    }

    if (otherTotal !== 0) {
      fields.otherExpenses = round2(otherTotal);
    }

    // Compute totalExpenses from all expense fields
    const expenseFields = [
      'fbaFulfillmentFee', 'referralCommission', 'closingFee', 'technologyFee',
      'shippingChargeback', 'giftWrapChargeback', 'refundCommission',
      'promotionsDiscount', 'shippingDiscount', 'taxDiscount', 'shippingTaxDiscount',
      'fbaReversedReimbursement', 'otherExpenses',
    ];
    let totalExpenses = 0;
    for (const ef of expenseFields) {
      totalExpenses += fields[ef] || 0;
    }
    fields.totalExpenses = round2(totalExpenses);
    fields.netAmount = round2((fields.totalRevenue || 0) + totalExpenses);

    const setOnInsert = {
      User: uid,
      country,
      region,
      marketplaceId,
      sku,
      date,
    };
    if (asin) setOnInsert.asin = asin;

    const update = { $set: fields, $setOnInsert: setOnInsert };
    if (otherBreakdown.length) {
      update.$set.otherExpensesBreakdown = otherBreakdown;
    }

    operations.push({
      updateOne: {
        filter: { User: uid, country, region, sku, date },
        update,
        upsert: true,
      },
    });
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would write ${operations.length} DailySkuFinance documents.`);
    return { written: 0, wouldWrite: operations.length };
  }

  const result = await DailySkuFinance.bulkWrite(operations, { ordered: false });
  const written = (result.upsertedCount || 0) + (result.modifiedCount || 0);
  console.log(`  Written: upserted=${result.upsertedCount}, modified=${result.modifiedCount}`);
  return { written };
}

// ── Step B: ExpenseRawRow (no SKU / overhead) -> DailyOverheadFinance ──
async function migrateExpenseRowsToOverhead(userId, country, region, dryRun) {
  const uid =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const marketplaceId = resolveMarketplaceId(country);

  console.log('\n[Step B] Migrating ExpenseRawRow (overhead rows) -> DailyOverheadFinance...');

  const pipeline = [
    {
      $match: {
        User: uid,
        country,
        region,
        postedDateStr: { $ne: '', $exists: true },
        $or: [
          { sku: 'N/A' },
          { sku: { $exists: false } },
          { sku: '' },
          { category: { $in: [...OVERHEAD_CATEGORIES, ...REVENUE_CATEGORIES] } },
        ],
      },
    },
    {
      $group: {
        _id: { category: '$category', date: '$postedDateStr' },
        amount: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ];

  const groups = await ExpenseRawRow.aggregate(pipeline);
  console.log(`  Found ${groups.length} (category, date) groups.`);

  if (!groups.length) return { written: 0 };

  const operations = groups.map((g) => {
    const category = g._id.category;
    const date = g._id.date;
    const isRevenue = REVENUE_CATEGORIES.has(category);

    return {
      updateOne: {
        filter: { User: uid, country, region, category, date },
        update: {
          $set: {
            amount: round2(g.amount),
            count: g.count,
            isRevenue,
          },
          $setOnInsert: {
            User: uid,
            country,
            region,
            marketplaceId,
            category,
            date,
          },
        },
        upsert: true,
      },
    };
  });

  if (dryRun) {
    console.log(`  [DRY RUN] Would write ${operations.length} DailyOverheadFinance documents.`);
    return { written: 0, wouldWrite: operations.length };
  }

  const result = await DailyOverheadFinance.bulkWrite(operations, { ordered: false });
  const written = (result.upsertedCount || 0) + (result.modifiedCount || 0);
  console.log(`  Written: upserted=${result.upsertedCount}, modified=${result.modifiedCount}`);
  return { written };
}

// ── Step C: AsinWiseSalesDateItem -> DailySkuFinance (revenue fields) ──
async function migrateSalesToSkuFinance(userId, country, region, dryRun) {
  const uid =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const marketplaceId = resolveMarketplaceId(country);

  console.log('\n[Step C] Migrating AsinWiseSalesDateItem -> DailySkuFinance (revenue)...');

  // Build asin -> sku map from seller catalog
  const asinToSku = new Map();
  const seller = await Seller.findOne({ User: uid }).sort({ createdAt: -1 }).lean();
  if (seller) {
    const account = (seller.sellerAccount || []).find(
      (a) => a.country === country && a.region === region
    );
    if (account && account.products) {
      for (const p of account.products) {
        if (p.asin && p.sku) {
          asinToSku.set(p.asin, p.sku);
        }
      }
    }
  }
  console.log(`  Built ASIN->SKU map with ${asinToSku.size} entries from seller catalog.`);

  // If seller catalog is empty, try building from ExpenseRawRow
  if (asinToSku.size === 0) {
    console.log('  Seller catalog empty, building map from ExpenseRawRow...');
    const rawMappings = await ExpenseRawRow.aggregate([
      {
        $match: {
          User: uid,
          country,
          region,
          asin: { $ne: '', $exists: true },
          sku: { $ne: 'N/A', $nin: ['', null] },
        },
      },
      { $group: { _id: '$asin', sku: { $first: '$sku' } } },
    ]);
    for (const m of rawMappings) {
      asinToSku.set(m._id, m.sku);
    }
    console.log(`  Built ASIN->SKU map with ${asinToSku.size} entries from ExpenseRawRow.`);
  }

  // Get all sales run IDs for this user/country/region
  const runs = await AsinWiseSalesRun.find({ User: uid, country, region })
    .sort({ generatedAt: -1 })
    .limit(10)
    .select('_id')
    .lean();
  const runIds = runs.map((r) => r._id);

  if (!runIds.length) {
    console.log('  No AsinWiseSalesRun found. Skipping revenue migration.');
    return { written: 0 };
  }

  // Deduplicate by (asin, date) — newest run wins
  const salesDocs = await AsinWiseSalesDateItem.aggregate([
    { $match: { runId: { $in: runIds } } },
    { $addFields: { _runIdx: { $indexOfArray: [runIds, '$runId'] } } },
    { $sort: { _runIdx: 1 } },
    {
      $group: {
        _id: { asin: '$asin', date: '$date' },
        units: { $first: '$units' },
        revenue: { $first: '$revenue' },
      },
    },
  ]);

  console.log(`  Found ${salesDocs.length} deduplicated (asin, date) sales entries.`);

  if (!salesDocs.length) return { written: 0 };

  const operations = [];
  let skippedNoSku = 0;

  for (const doc of salesDocs) {
    const asin = doc._id.asin;
    const date = doc._id.date;
    const sku = asinToSku.get(asin);

    if (!sku) {
      skippedNoSku++;
      continue;
    }

    const productSales = round2(doc.revenue || 0);
    const units = doc.units || 0;
    const totalRevenue = productSales;

    operations.push({
      updateOne: {
        filter: { User: uid, country, region, sku, date },
        update: {
          $set: {
            productSales,
            units,
            totalRevenue,
            asin,
          },
          $setOnInsert: {
            User: uid,
            country,
            region,
            marketplaceId,
            sku,
            date,
          },
        },
        upsert: true,
      },
    });
  }

  if (skippedNoSku > 0) {
    console.log(`  Skipped ${skippedNoSku} entries (no SKU mapping found for ASIN).`);
  }

  if (!operations.length) {
    console.log('  No operations to execute.');
    return { written: 0 };
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would write ${operations.length} DailySkuFinance documents (revenue).`);
    return { written: 0, wouldWrite: operations.length };
  }

  const result = await DailySkuFinance.bulkWrite(operations, { ordered: false });
  const written = (result.upsertedCount || 0) + (result.modifiedCount || 0);
  console.log(`  Written: upserted=${result.upsertedCount}, modified=${result.modifiedCount}`);
  return { written };
}

// ── Main ──
async function main() {
  const args = parseArgs();
  const { userId, country, region, dryRun } = args;

  if (!userId || !country || !region) {
    console.error(
      'Usage: node migrateToFinanceDashboard.js --userId=<id> --country=<code> --region=<NA|EU|FE> [--dryRun]'
    );
    process.exit(1);
  }

  if (!['NA', 'EU', 'FE'].includes(region)) {
    console.error('Error: region must be one of: NA, EU, FE');
    process.exit(1);
  }

  const mpId = resolveMarketplaceId(country);
  if (!mpId) {
    console.error(`Error: No marketplace ID found for country "${country}".`);
    process.exit(1);
  }

  try {
    console.log('[Migration] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[Migration] Connected.');
    console.log(`[Migration] User: ${userId} | Country: ${country} | Region: ${region} | Marketplace: ${mpId}`);
    if (dryRun) console.log('[Migration] *** DRY RUN MODE — no writes ***');

    const stepA = await migrateExpenseRowsToSkuFinance(userId, country, region, dryRun);
    const stepB = await migrateExpenseRowsToOverhead(userId, country, region, dryRun);
    const stepC = await migrateSalesToSkuFinance(userId, country, region, dryRun);

    console.log('\n[Migration] ══════════════════════════════════════');
    console.log('[Migration] Summary:');
    console.log(`  User: ${userId}`);
    console.log(`  Country: ${country} | Region: ${region}`);
    console.log(`  Step A (Expense -> DailySkuFinance):     ${dryRun ? `would write ${stepA.wouldWrite || 0}` : `wrote ${stepA.written}`}`);
    console.log(`  Step B (Expense -> DailyOverheadFinance): ${dryRun ? `would write ${stepB.wouldWrite || 0}` : `wrote ${stepB.written}`}`);
    console.log(`  Step C (Sales   -> DailySkuFinance):     ${dryRun ? `would write ${stepC.wouldWrite || 0}` : `wrote ${stepC.written}`}`);
    console.log('[Migration] Done.');

    process.exit(0);
  } catch (error) {
    console.error('[Migration] Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

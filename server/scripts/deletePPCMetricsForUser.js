#!/usr/bin/env node
/**
 * Delete all PPC metrics documents written by GetPPCMetrics (PPCMetrics collection)
 * for a specific userId + country + region.
 *
 * Usage (from repo root; loads .env):
 *   Dry run (recommended first):
 *   node server/scripts/deletePPCMetricsForUser.js \
 *     --userId=<userId> --country=<code> --region=<NA|EU|FE> --dryRun
 *
 *   Actual delete:
 *   node server/scripts/deletePPCMetricsForUser.js \
 *     --userId=<userId> --country=<code> --region=<NA|EU|FE> --confirm
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PPCMetrics = require('../models/amazon-ads/PPCMetricsModel.js');

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

/**
 * GetPPCMetrics stores userId as a string (typically ObjectId.toString()).
 * Pass the same string your app uses for that user (24-char hex is common).
 */
function normalizeUserId(userId) {
  const raw = String(userId || '').trim();
  if (!raw) {
    throw new Error('userId is required');
  }
  return raw;
}

function buildFilter({ userId, country, region }) {
  return {
    userId: normalizeUserId(userId),
    country: normalizeCountry(country),
    region: normalizeRegion(region),
  };
}

async function main() {
  const args = parseArgs();
  const { userId, country, region, dryRun, confirm } = args;

  if (!userId || !country || !region) {
    console.error(
      'Usage: node server/scripts/deletePPCMetricsForUser.js --userId=<id> --country=<code> --region=<NA|EU|FE> [--dryRun|--confirm]'
    );
    process.exit(1);
  }

  const normalizedRegion = normalizeRegion(region);
  if (!['NA', 'EU', 'FE'].includes(normalizedRegion)) {
    console.error('Error: region must be one of: NA, EU, FE');
    process.exit(1);
  }

  if (!dryRun && !confirm) {
    console.error('Safety check: pass --dryRun to preview counts or --confirm to delete.');
    process.exit(1);
  }

  let filter;
  try {
    filter = buildFilter({ userId, country, region: normalizedRegion });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const userIdStr = filter.userId;
  const targetCountry = normalizeCountry(country);

  try {
    console.log('[Delete PPC Metrics] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[Delete PPC Metrics] Connected.');

    console.log(
      `[Delete PPC Metrics] Target => userId=${filter.userId}, country=${filter.country}, region=${filter.region}`
    );

    const count = await PPCMetrics.countDocuments(filter);
    console.log(`\n[Delete PPC Metrics] PPCMetrics documents matching filter: ${count}`);

    if (dryRun) {
      console.log('\n[Delete PPC Metrics] DRY RUN complete. No data deleted.');
      await mongoose.connection.close();
      process.exit(0);
    }

    const result = await PPCMetrics.deleteMany(filter);
    const deleted = result.deletedCount ?? 0;
    console.log(`\n[Delete PPC Metrics] Deleted PPCMetrics documents: ${deleted}`);

    const remaining = await PPCMetrics.countDocuments(filter);
    console.log(`[Delete PPC Metrics] Remaining matching documents: ${remaining}`);

    console.log('\n[Delete PPC Metrics] Done.');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('[Delete PPC Metrics] Error:', error.message);
    console.error(error.stack);
    try {
      await mongoose.connection.close();
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  }
}

main();

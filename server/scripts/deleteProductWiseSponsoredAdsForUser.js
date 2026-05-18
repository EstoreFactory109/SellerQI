#!/usr/bin/env node
/**
 * Delete ProductWiseSponsoredAdsItem documents for a specific
 * userId + country + region (ASIN-level PPC data from GetPPCProductWise).
 *
 * Usage (from repo root; loads .env):
 *   Dry run (recommended first):
 *     node server/scripts/deleteProductWiseSponsoredAdsForUser.js \
 *       --userId=<userId> --country=<code> --region=<NA|EU|FE> --dryRun
 *
 *   Actual delete:
 *     node server/scripts/deleteProductWiseSponsoredAdsForUser.js \
 *       --userId=<userId> --country=<code> --region=<NA|EU|FE> --confirm
 */

require('dotenv').config();
const mongoose = require('mongoose');

const ProductWiseSponsoredAdsItem = require('../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');

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
    if (eq > -1) args[arg.slice(2, eq)] = arg.slice(eq + 1);
    else args[arg.slice(2)] = true;
  });
  return args;
}

const normalizeCountry = (c) => String(c || '').trim().toUpperCase();
const normalizeRegion = (r) => String(r || '').trim().toUpperCase();

function normalizeUserId(userId) {
  const raw = String(userId || '').trim();
  if (!raw) throw new Error('userId is required');
  return raw;
}

/** Match userId stored as ObjectId or string. */
function buildUserIdFilter(userIdStr) {
  const filter = { $or: [{ userId: userIdStr }] };
  if (mongoose.Types.ObjectId.isValid(userIdStr)) {
    filter.$or.push({ userId: new mongoose.Types.ObjectId(userIdStr) });
  }
  return filter;
}

function buildFilter({ userIdStr, country, region }) {
  return {
    ...buildUserIdFilter(userIdStr),
    country,
    region,
  };
}

async function main() {
  const args = parseArgs();
  const { userId, country, region, dryRun, confirm } = args;

  if (!userId || !country || !region) {
    console.error(
      'Usage: node server/scripts/deleteProductWiseSponsoredAdsForUser.js --userId=<id> --country=<code> --region=<NA|EU|FE> [--dryRun|--confirm]'
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

  let userIdStr;
  try {
    userIdStr = normalizeUserId(userId);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const filter = buildFilter({
    userIdStr,
    country: normalizeCountry(country),
    region: normalizedRegion,
  });

  try {
    console.log('[Delete ProductWiseSponsoredAdsItem] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[Delete ProductWiseSponsoredAdsItem] Connected.');
    console.log(
      `[Delete ProductWiseSponsoredAdsItem] Target => userId=${userIdStr}, country=${normalizeCountry(country)}, region=${normalizedRegion}`
    );
    console.log(`[Delete ProductWiseSponsoredAdsItem] Mode: ${dryRun ? 'DRY RUN' : 'DELETE'}\n`);

    const before = await ProductWiseSponsoredAdsItem.countDocuments(filter);

    if (dryRun) {
      console.log(`  • ProductWiseSponsoredAdsItem: ${before} document(s) would be deleted`);
      console.log('\n[Delete ProductWiseSponsoredAdsItem] DRY RUN complete. No data was deleted.');
    } else {
      const res = await ProductWiseSponsoredAdsItem.deleteMany(filter);
      const deleted = res.deletedCount ?? 0;
      const after = await ProductWiseSponsoredAdsItem.countDocuments(filter);
      console.log(`  • matched=${before}, deleted=${deleted}, remaining=${after}`);
      console.log('\n[Delete ProductWiseSponsoredAdsItem] Done.');
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('[Delete ProductWiseSponsoredAdsItem] Error:', error.message);
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

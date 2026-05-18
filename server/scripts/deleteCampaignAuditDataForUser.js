#!/usr/bin/env node
/**
 * Delete the data behind the six Campaign Audit tabs for a specific
 * userId + country + region.
 *
 * Collections cleared:
 *   1. ProductWiseSponsoredAdsItem  (High ACOS rows)
 *   2. ProductWiseSponsoredAdsData  (legacy embedded format)
 *   3. adsKeywordsPerformance       (Wasted spend / Top performing keywords)
 *   4. SearchTerms                  (Zero-sales / Auto insights search terms)
 *   5. Campaign                     (Campaigns without negatives / Auto insights)
 *   6. NegativeKeywords             (Campaigns without negatives)
 *   7. AdsGroup                     (Campaigns without negatives)
 *   8. Keyword                      (Auto insights manual keyword set)
 *
 * Usage (from repo root; loads .env):
 *   Dry run (recommended first):
 *     node server/scripts/deleteCampaignAuditDataForUser.js \
 *       --userId=<userId> --country=<code> --region=<NA|EU|FE> --dryRun
 *
 *   Actual delete:
 *     node server/scripts/deleteCampaignAuditDataForUser.js \
 *       --userId=<userId> --country=<code> --region=<NA|EU|FE> --confirm
 */

require('dotenv').config();
const mongoose = require('mongoose');

const ProductWiseSponsoredAdsItem = require('../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const ProductWiseSponsoredAdsData = require('../models/amazon-ads/ProductWiseSponseredAdsModel.js');
const adsKeywordsPerformanceModel = require('../models/amazon-ads/adsKeywordsPerformanceModel.js');
const SearchTerms = require('../models/amazon-ads/SearchTermsModel.js');
const Campaign = require('../models/amazon-ads/CampaignModel.js');
const NegativeKeywords = require('../models/amazon-ads/NegetiveKeywords.js');
const AdsGroup = require('../models/amazon-ads/adsgroupModel.js');
const Keyword = require('../models/amazon-ads/keywordModel.js');

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

/**
 * Some collections store userId as ObjectId, others as String.
 * Build a filter that matches BOTH so we don't miss legacy rows.
 */
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

const TARGETS = [
  { label: 'ProductWiseSponsoredAdsItem (High ACOS rows)', model: ProductWiseSponsoredAdsItem },
  { label: 'ProductWiseSponsoredAdsData (legacy)', model: ProductWiseSponsoredAdsData },
  { label: 'adsKeywordsPerformance (Wasted/Top keywords)', model: adsKeywordsPerformanceModel },
  { label: 'SearchTerms (Zero-sales / Auto insights)', model: SearchTerms },
  { label: 'Campaign (No-negatives / Auto insights)', model: Campaign },
  { label: 'NegativeKeywords (No-negatives)', model: NegativeKeywords },
  { label: 'AdsGroup (No-negatives)', model: AdsGroup },
  { label: 'Keyword (Auto insights manual set)', model: Keyword },
];

async function main() {
  const args = parseArgs();
  const { userId, country, region, dryRun, confirm } = args;

  if (!userId || !country || !region) {
    console.error(
      'Usage: node server/scripts/deleteCampaignAuditDataForUser.js --userId=<id> --country=<code> --region=<NA|EU|FE> [--dryRun|--confirm]'
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
    console.log('[Delete Campaign Audit] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[Delete Campaign Audit] Connected.');

    console.log(
      `[Delete Campaign Audit] Target => userId=${userIdStr}, country=${normalizeCountry(country)}, region=${normalizedRegion}`
    );
    console.log(`[Delete Campaign Audit] Mode: ${dryRun ? 'DRY RUN' : 'DELETE'}\n`);

    const summary = [];

    for (const t of TARGETS) {
      const before = await t.model.countDocuments(filter);
      if (dryRun) {
        console.log(`  • ${t.label}: ${before} document(s) match`);
        summary.push({ collection: t.label, matched: before, deleted: 0 });
        continue;
      }

      const res = await t.model.deleteMany(filter);
      const deleted = res.deletedCount ?? 0;
      const after = await t.model.countDocuments(filter);
      console.log(`  • ${t.label}: matched=${before}, deleted=${deleted}, remaining=${after}`);
      summary.push({ collection: t.label, matched: before, deleted, remaining: after });
    }

    console.log('\n[Delete Campaign Audit] Summary:');
    console.table(summary);

    if (dryRun) {
      console.log('\n[Delete Campaign Audit] DRY RUN complete. No data was deleted.');
    } else {
      console.log('\n[Delete Campaign Audit] Done.');
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('[Delete Campaign Audit] Error:', error.message);
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

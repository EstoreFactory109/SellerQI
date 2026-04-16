/**
 * Get "Money Wasted in Ads" from the latest ads keywords fetch.
 *
 * Definition used:
 *   wasted keyword => cost > 0 && attributedSales30d < 0.01
 *   total wasted   => sum(cost) across wasted keywords
 *
 * Usage:
 *   node server/scripts/getMoneyWastedInAds.js --user-id=<id> --country=IN --region=EU
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const adsKeywordsPerformanceModel = require('../models/amazon-ads/adsKeywordsPerformanceModel.js');

const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const idx = raw.indexOf('=');
    if (idx === -1) {
      out[raw.slice(2)] = true;
      continue;
    }
    out[raw.slice(2, idx)] = raw.slice(idx + 1);
  }
  return out;
}

function requireArg(args, key) {
  const value = args[key];
  if (!value) throw new Error(`Missing required arg: --${key}=...`);
  return value;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const userId = requireArg(args, 'user-id');
  const country = String(requireArg(args, 'country')).trim().toUpperCase();
  const region = String(requireArg(args, 'region')).trim().toUpperCase();

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error(`Invalid --user-id (expected Mongo ObjectId): ${userId}`);
  }
  if (!MONGODB_URI) {
    throw new Error('Mongo URI not found. Set config or env (MONGODB_URI / MONGO_URI).');
  }

  await mongoose.connect(MONGODB_URI);
  try {
    const latest = await adsKeywordsPerformanceModel
      .findOne({
        userId: new mongoose.Types.ObjectId(userId),
        country,
        region,
      })
      .sort({ createdAt: -1 })
      .lean();

    if (!latest) {
      console.log(
        JSON.stringify(
          {
            success: false,
            message: 'No ads keyword fetch found for this user/country/region',
            input: { userId, country, region },
          },
          null,
          2
        )
      );
      return;
    }

    const rows = Array.isArray(latest.keywordsData) ? latest.keywordsData : [];
    const wastedRows = rows.filter((kw) => {
      const cost = Number(kw?.cost) || 0;
      const sales = Number(kw?.attributedSales30d) || 0;
      return cost > 0 && sales < 0.01;
    });
    const totalWastedSpend = round2(
      wastedRows.reduce((sum, kw) => sum + (Number(kw?.cost) || 0), 0)
    );

    console.log(
      JSON.stringify(
        {
          success: true,
          input: { userId, country, region },
          fetchedAt: latest.createdAt,
          totalKeywords: rows.length,
          wastedKeywordsCount: wastedRows.length,
          totalWastedSpend,
          formula: 'sum(cost) where cost > 0 and attributedSales30d < 0.01',
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error(`[getMoneyWastedInAds] ${err.message}`);
  process.exit(1);
});


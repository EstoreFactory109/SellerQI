#!/usr/bin/env node
/**
 * Resync FBA Inventory API data for one user + marketplace.
 *
 * Fetches GET /fba/inventory/v1/summaries (ItemStock.js) and persists:
 *   - FbaInventoryApiDetail (per sellerSku)
 *   - Seller.sellerAccount[].products[].quantity (fulfillableQuantity)
 *
 * Usage:
 *   node server/scripts/resyncFbaInventoryForUser.js \
 *     --user-id=<mongoId> --country=US --region=NA
 *
 * Options:
 *   --dry-run   Log only; no SP-API call or DB writes
 *
 * Env: DB_URI, DB_NAME (or MONGODB_URI), SPAPI credentials (config.js or SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET)
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

const Seller = require('../models/user-auth/sellerCentralModel.js');
const User = require('../models/user-auth/userModel.js');
const { getAccessToken } = require('../Services/Sp_API/SpApiMarketplace.js');
const spCredentials = require('../Services/Sp_API/config.js');
const { fetchInventoryStock } = require('../Services/Sp_API/ItemStock.js');
const { persistFbaInventoryFromFetch } = require('../Services/Sp_API/FbaInventoryStorageService.js');

function getArg(name) {
  const match = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return match ? match.split('=').slice(1).join('=').trim() : null;
}

const isDryRun = process.argv.slice(2).includes('--dry-run');
const USER_ID = getArg('user-id');
const COUNTRY = (getArg('country') || '').toUpperCase();
const REGION = (getArg('region') || '').toUpperCase();

function sellerRegionToSpApiInternal(regionUpper) {
  const r = String(regionUpper).toUpperCase();
  if (r === 'NA') return 'na';
  if (r === 'EU') return 'eu';
  if (r === 'FE') return 'apac';
  return null;
}

async function main() {
  if (!USER_ID || !COUNTRY || !REGION) {
    console.error('Missing required args. Usage:');
    console.error('  node server/scripts/resyncFbaInventoryForUser.js \\');
    console.error('       --user-id=<mongoId> --country=US --region=NA [--dry-run]');
    process.exit(1);
  }

  if (!['NA', 'EU', 'FE'].includes(REGION)) {
    console.error(`Invalid region "${REGION}". Expected NA | EU | FE.`);
    process.exit(1);
  }

  if (!MONGODB_URI) {
    console.error('ERROR: Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
    process.exit(1);
  }

  const internalRegion = sellerRegionToSpApiInternal(REGION);
  if (!internalRegion) {
    console.error(`Cannot map region ${REGION} to SP-API internal region`);
    process.exit(1);
  }

  console.log('FBA inventory resync');
  console.log('  Mode:', isDryRun ? 'DRY-RUN' : 'LIVE');
  console.log('  User:', USER_ID);
  console.log('  Marketplace:', `${COUNTRY} / ${REGION}`);
  console.log('---');

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const userObjectId = mongoose.Types.ObjectId.isValid(USER_ID)
    ? new mongoose.Types.ObjectId(USER_ID)
    : USER_ID;

  const user = await User.findById(userObjectId).select('_id email').lean();
  if (!user) {
    throw new Error(`User not found: ${USER_ID}`);
  }

  const seller = await Seller.findOne({ User: userObjectId }).sort({ createdAt: -1 }).lean();
  if (!seller) {
    throw new Error(`No Seller document for User=${USER_ID}`);
  }

  const account = (seller.sellerAccount || []).find(
    (a) =>
      String(a?.country || '').toUpperCase() === COUNTRY &&
      String(a?.region || '').toUpperCase() === REGION
  );

  if (!account) {
    throw new Error(`No sellerAccount for ${COUNTRY}/${REGION}`);
  }

  const refreshToken = account.spiRefreshToken;
  if (!refreshToken) {
    throw new Error('spiRefreshToken missing for this marketplace');
  }

  const label = `${user.email || 'user'} (${USER_ID}) ${REGION}/${COUNTRY}`;

  if (isDryRun) {
    console.log(`[dry-run] Would fetch + persist FBA inventory for ${label}`);
    await mongoose.disconnect();
    return;
  }

  const clientId = spCredentials.clientId || process.env.SPAPI_CLIENT_ID;
  const clientSecret = spCredentials.clientSecret || process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SPAPI_CLIENT_ID / SPAPI_CLIENT_SECRET not configured');
  }

  console.log(`Fetching SP-API access token for ${label}...`);
  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

  console.log('Calling fetchInventoryStock (full catalog, paginated)...');
  const result = await fetchInventoryStock({
    userId: String(USER_ID),
    country: COUNTRY,
    region: internalRegion,
    accessToken,
    sellerSkus: [],
  });

  if (!result?.hasData || !Array.isArray(result.stockRows) || result.stockRows.length === 0) {
    console.log('\nResult: no inventory rows returned from SP-API');
    console.log(JSON.stringify({ marketplaceId: result?.marketplaceId || null, hasData: false }, null, 2));
    await mongoose.disconnect();
    return;
  }

  console.log(`Persisting ${result.stockRows.length} SKU row(s)...`);
  const persistSummary = await persistFbaInventoryFromFetch({
    userId: USER_ID,
    country: COUNTRY,
    region: REGION,
    marketplaceId: result.marketplaceId,
    stockRows: result.stockRows,
  });

  const sampleSku = result.stockRows.find((r) => String(r.sellerSku) === '1000') || result.stockRows[0];

  console.log('\n--- Success ---');
  console.log(
    JSON.stringify(
      {
        userId: USER_ID,
        country: COUNTRY,
        region: REGION,
        marketplaceId: result.marketplaceId,
        skuRowsFetched: result.stockRows.length,
        sellerProductsQuantityUpdated: persistSummary.sellerProductsUpdated,
        fbaInventoryDetailDocsWritten: persistSummary.inventorySkuRowsWritten,
        sampleRow: sampleSku
          ? {
              sellerSku: sampleSku.sellerSku,
              asin: sampleSku.asin,
              fulfillableQuantity: sampleSku.fulfillableQuantity,
              totalQuantity: sampleSku.totalQuantity,
            }
          : null,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  if (err.stack) console.error(err.stack);
  mongoose.connection.close().finally(() => process.exit(1));
});

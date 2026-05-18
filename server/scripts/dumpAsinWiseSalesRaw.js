/**
 * Fetch ASIN-wise sales sources from Amazon SP-API and write exactly two kinds of raw JSON
 * (no normalization, merge, or calculateSales).
 *
 * 1) Reports API — flat file rows (TSV parsed to row objects; same as fetchOrdersReport returns).
 * 2) Orders API — getOrders pages + getOrderItems per order (raw payloads only).
 *
 * Date window is STRICT: you must pass --from and --to (YYYY-MM-DD, UTC day bounds).
 * Reports request uses dataStartTime/dataEndTime; Orders list uses CreatedAfter/CreatedBefore.
 *
 * Usage:
 *   node server/scripts/dumpAsinWiseSalesRaw.js \
 *     --user-id=<ObjectId> \
 *     --country=US \
 *     --region=NA \
 *     --from=2026-03-20 \
 *     --to=2026-04-19 \
 *     --out-dir=exports/asin-wise-sales \
 *     --data-source=both
 *
 * --data-source: report | api | both (default: both)
 *
 * Output files only (no manifest, no normalized, no calculated):
 *   <prefix>.reports-api.raw.json
 *   <prefix>.orders-api.raw.json
 *
 * Default prefix: asin-wise-sales-<COUNTRY>-<REGION>-<from>_to_<to>
 */
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const https = require('https');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const { URIs, marketplaceConfig: sharedMarketplaceConfig } = require('../controllers/config/config.js');
const {
  fetchOrdersReport,
  fetchOrders,
  fetchOrderItemsBatch,
} = require('../Services/Sp_API/asinwiseSales.js');

const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

const COUNTRY_TO_INTERNAL_REGION = {
  US: 'na', CA: 'na', MX: 'na', BR: 'na',
  UK: 'eu', DE: 'eu', FR: 'eu', IT: 'eu', ES: 'eu', NL: 'eu',
  SE: 'eu', PL: 'eu', BE: 'eu', IN: 'eu', TR: 'eu', AE: 'eu',
  SA: 'eu', EG: 'eu',
  AU: 'apac', JP: 'apac', SG: 'apac',
};

const REGION_BASE_URLS = {
  na: 'sellingpartnerapi-na.amazon.com',
  eu: 'sellingpartnerapi-eu.amazon.com',
  apac: 'sellingpartnerapi-fe.amazon.com',
};

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      out[raw.slice(2)] = true;
      continue;
    }
    out[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return out;
}

function requireParam(args, key) {
  const v = args[key];
  if (!v) throw new Error(`Missing required arg: --${key}=...`);
  return v;
}

function mapInternalRegionToSharedRegionKey(internalRegion) {
  if (internalRegion === 'na') return 'NA';
  if (internalRegion === 'eu') return 'EU';
  if (internalRegion === 'apac') return 'FE';
  return null;
}

function resolveMarketplaceAndRegion(countryUpper, regionOverride) {
  const internalRegionFromCountry = COUNTRY_TO_INTERNAL_REGION[countryUpper];
  if (!internalRegionFromCountry) {
    throw new Error(`Unsupported country: "${countryUpper}"`);
  }
  const internalRegion = regionOverride || internalRegionFromCountry;
  const sharedRegionKey = mapInternalRegionToSharedRegionKey(internalRegion);
  const marketplaceId = sharedMarketplaceConfig?.[countryUpper];
  if (!marketplaceId) {
    throw new Error(`marketplaceId not configured for country: "${countryUpper}"`);
  }
  const baseUrlFromShared = sharedRegionKey ? URIs?.[sharedRegionKey] : null;
  const baseUrl = baseUrlFromShared || REGION_BASE_URLS[internalRegion];
  if (!baseUrl) throw new Error(`Unsupported region: "${internalRegion}"`);
  return { marketplaceId, baseUrl, region: internalRegion };
}

function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getAccessToken(clientId, clientSecret, refreshToken) {
  const postData = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const res = await httpsRequest(
    {
      hostname: 'api.amazon.com',
      path: '/auth/o2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    },
    postData
  );

  if (!res.body.access_token) {
    throw new Error(`Auth failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

function strictUtcRange(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid --from/--to. Use YYYY-MM-DD.');
  }
  if (start > end) {
    throw new Error('--from must be <= --to');
  }
  return {
    from,
    to,
    startDateISO: start.toISOString(),
    endDateISO: end.toISOString(),
  };
}

async function getUserSpApiRefreshToken({ userId, country, region }) {
  const sellerCentral = await Seller.findOne({ User: userId }).sort({ createdAt: -1 }).lean();
  if (!sellerCentral) throw new Error(`SellerCentral not found for userId=${userId}`);
  const acc = (sellerCentral.sellerAccount || []).find((a) => a?.country === country && a?.region === region);
  if (!acc) throw new Error(`Seller account not found for ${region}/${country} (userId=${userId})`);
  if (!acc.spiRefreshToken) throw new Error(`spiRefreshToken missing for ${region}/${country} (userId=${userId})`);
  return acc.spiRefreshToken;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!MONGODB_URI) {
    throw new Error('DB connection is not configured. Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
  }

  const userIdRaw = requireParam(args, 'user-id');
  const country = requireParam(args, 'country').trim().toUpperCase();
  const regionModel = requireParam(args, 'region').trim().toUpperCase();
  const from = requireParam(args, 'from').trim();
  const to = requireParam(args, 'to').trim();
  const outDirArg = requireParam(args, 'out-dir').trim();

  const dataSource = String(args['data-source'] || 'both').toLowerCase();
  if (!['report', 'api', 'both'].includes(dataSource)) {
    throw new Error('Invalid --data-source. Use report|api|both');
  }
  if (!['NA', 'EU', 'FE'].includes(regionModel)) {
    throw new Error('Invalid --region. Use NA|EU|FE');
  }

  const range = strictUtcRange(from, to);
  const defaultPrefix = `asin-wise-sales-${country}-${regionModel}-${range.from}_to_${range.to}`;
  const prefix = String(args.prefix || defaultPrefix).trim();

  const internalRegion = regionModel === 'NA' ? 'na' : regionModel === 'EU' ? 'eu' : 'apac';
  const { marketplaceId, baseUrl, region } = resolveMarketplaceAndRegion(country, internalRegion);

  const userId =
    typeof userIdRaw === 'string' && mongoose.Types.ObjectId.isValid(userIdRaw)
      ? new mongoose.Types.ObjectId(userIdRaw)
      : userIdRaw;

  const clientId = process.env.SPAPI_CLIENT_ID;
  const clientSecret = process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing SPAPI_CLIENT_ID or SPAPI_CLIENT_SECRET in .env');
  }

  await mongoose.connect(MONGODB_URI);
  let refreshToken;
  try {
    refreshToken = await getUserSpApiRefreshToken({ userId, country, region: regionModel });
  } finally {
    await mongoose.connection.close();
  }

  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(process.cwd(), outDirArg);
  fs.mkdirSync(outDir, { recursive: true });

  const metaBase = {
    userId: String(userIdRaw),
    country,
    regionModel,
    regionInternal: region,
    marketplaceId,
    baseUrl,
    from: range.from,
    to: range.to,
    startDateISO: range.startDateISO,
    endDateISO: range.endDateISO,
    exportedAt: new Date().toISOString(),
  };

  if (dataSource === 'report' || dataSource === 'both') {
    const reportRows = await fetchOrdersReport(
      accessToken,
      baseUrl,
      marketplaceId,
      range.startDateISO,
      range.endDateISO
    );
    const reportsPayload = {
      _meta: {
        ...metaBase,
        source: 'reports-api',
        reportType: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
        note:
          'data is the flat-file row array after TSV download+parse (same structure fetchOrdersReport returns).',
      },
      data: reportRows,
    };
    const p = path.join(outDir, `${prefix}.reports-api.raw.json`);
    fs.writeFileSync(p, JSON.stringify(reportsPayload, null, 2), 'utf8');
    console.log(`Wrote: ${p}`);
  }

  if (dataSource === 'api' || dataSource === 'both') {
    const orders = await fetchOrders(
      accessToken,
      baseUrl,
      marketplaceId,
      range.startDateISO,
      range.endDateISO
    );
    const orderIds = orders.map((o) => o.AmazonOrderId).filter(Boolean);
    const orderItemsMap = await fetchOrderItemsBatch(accessToken, baseUrl, orderIds);
    const orderItemsByOrderId = Object.fromEntries(orderItemsMap.entries());

    const ordersPayload = {
      _meta: {
        ...metaBase,
        source: 'orders-api',
        note: 'data.orders = getOrders payload list; data.orderItemsByOrderId = orderId -> getOrderItems arrays.',
      },
      data: {
        orders,
        orderItemsByOrderId,
      },
    };
    const p = path.join(outDir, `${prefix}.orders-api.raw.json`);
    fs.writeFileSync(p, JSON.stringify(ordersPayload, null, 2), 'utf8');
    console.log(`Wrote: ${p}`);
  }
}

main().catch((err) => {
  console.error('Failed:', err?.message || err);
  process.exit(1);
});

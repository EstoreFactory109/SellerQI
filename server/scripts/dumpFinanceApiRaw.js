/**
 * Call Amazon SP-API Finances v0 `financialEvents` (all pages), merge into one object,
 * and write JSON to a file you choose (for studying / improving Expences.js parsers).
 *
 * The saved `financialEvents` object matches the merged shape of
 * `payload.FinancialEvents` (lists keyed by event type). It is NOT the literal HTTP
 * envelope per page; pagination is already consumed inside fetchFinancialEvents.
 *
 * Usage (from repo root):
 *   node server/scripts/dumpFinanceApiRaw.js \
 *     --user-id=<ObjectId> \
 *     --country=IN \
 *     --region=EU \
 *     --from=2026-03-15 \
 *     --to=2026-04-14
 *
 *   Optional:
 *     --out=exports/finance/my-raw-study.json
 *     (default: exports/finance/financialEvents-raw-<region>-<country>-<userId>-<timestamp>.json)
 *
 * Env: DB_URI + DB_NAME (or MONGODB_URI), SPAPI_CLIENT_ID, SPAPI_CLIENT_SECRET, .env with tokens path as usual.
 */
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const {
  getAccessToken: getSpApiAccessToken,
  fetchFinancialEvents,
  resolveMarketplaceAndRegion,
} = require('../Services/Sp_API/Expences.js');

const MONGODB_URI =
  dbConsts.dbUri && dbConsts.dbName
    ? `${dbConsts.dbUri}/${dbConsts.dbName}`
    : process.env.MONGODB_URI || process.env.MONGO_URI;

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

function regionModelToInternal(regionModel) {
  const r = String(regionModel || '').trim().toUpperCase();
  if (r === 'NA') return 'na';
  if (r === 'EU') return 'eu';
  if (r === 'FE') return 'apac';
  return null;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function resolveOutPath(outArg, meta) {
  if (outArg) {
    return path.isAbsolute(outArg) ? outArg : path.resolve(process.cwd(), outArg);
  }

  const baseDir = path.resolve(process.cwd(), 'exports/finance');
  fs.mkdirSync(baseDir, { recursive: true });
  const safeCountry = String(meta.country || 'XX').replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeRegion = String(meta.region || 'NA').replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `financialEvents-raw-${safeRegion}-${safeCountry}-${meta.userId}-${nowStamp()}.json`;
  return path.join(baseDir, filename);
}

async function getUserSpApiRefreshToken({ userId, country, region }) {
  const sellerCentral = await Seller.findOne({ User: userId }).sort({ createdAt: -1 }).lean();
  if (!sellerCentral) throw new Error(`SellerCentral not found for userId=${userId}`);
  const acc = (sellerCentral.sellerAccount || []).find((a) => a?.country === country && a?.region === region);
  if (!acc) throw new Error(`Seller account not found for ${region}/${country} (userId=${userId})`);
  const refreshToken = acc.spiRefreshToken;
  if (!refreshToken) throw new Error(`spiRefreshToken missing for ${region}/${country} (userId=${userId})`);
  return refreshToken;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!MONGODB_URI) {
    throw new Error('DB connection is not configured. Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
  }

  const userIdRaw = requireParam(args, 'user-id');
  const country = requireParam(args, 'country').trim().toUpperCase();
  const region = requireParam(args, 'region').trim().toUpperCase();
  const from = requireParam(args, 'from').trim();
  const to = requireParam(args, 'to').trim();
  const out = args.out ? String(args.out).trim() : null;

  if (!['NA', 'EU', 'FE'].includes(region)) {
    throw new Error(`Invalid --region=${region}. Expected NA, EU, or FE.`);
  }

  let userId = userIdRaw;
  if (typeof userIdRaw === 'string' && mongoose.Types.ObjectId.isValid(userIdRaw)) {
    userId = new mongoose.Types.ObjectId(userIdRaw);
  }

  const fromIso = new Date(`${from}T00:00:00.000Z`).toISOString();
  const toIso = new Date(`${to}T23:59:59.999Z`).toISOString();
  if (Number.isNaN(new Date(fromIso).getTime()) || Number.isNaN(new Date(toIso).getTime())) {
    throw new Error('Invalid --from or --to. Use YYYY-MM-DD.');
  }
  if (new Date(fromIso) > new Date(toIso)) {
    throw new Error('--from must be <= --to');
  }

  const clientId = process.env.SPAPI_CLIENT_ID;
  const clientSecret = process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Set SPAPI_CLIENT_ID and SPAPI_CLIENT_SECRET in .env');
  }

  const internalRegion = regionModelToInternal(region);
  if (!internalRegion) throw new Error(`Invalid region: ${region}`);

  await mongoose.connect(MONGODB_URI);
  let refreshToken;
  try {
    refreshToken = await getUserSpApiRefreshToken({ userId, country, region });
  } finally {
    await mongoose.connection.close();
  }

  const { baseUrl } = resolveMarketplaceAndRegion(country, internalRegion);
  const accessToken = await getSpApiAccessToken(clientId, clientSecret, refreshToken);

  console.log(`Fetching Finances financialEvents: ${fromIso} → ${toIso} (${baseUrl})`);
  const financialEvents = await fetchFinancialEvents(accessToken, baseUrl, fromIso, toIso);

  const payload = {
    meta: {
      exportedAt: new Date().toISOString(),
      userId: String(userId),
      country,
      region,
      from,
      to,
      postedAfter: fromIso,
      postedBefore: toIso,
      baseUrl,
      note:
        'financialEvents is the merged object across all Finances pages (same lists as payload.FinancialEvents).',
    },
    financialEvents,
  };

  const outPath = resolveOutPath(out, { userId, country, region });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Wrote: ${outPath}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

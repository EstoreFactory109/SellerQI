/**
 * Fetch refunded SKUs for a user/country/region from ExpenseRawRow.
 *
 * Usage:
 *   node server/scripts/getRefundedSkus.js --user-id=<id> --country=US --region=NA
 *   node server/scripts/getRefundedSkus.js --user-id=<id> --country=US --region=NA --from=2026-01-01 --to=2026-01-31
 *   node server/scripts/getRefundedSkus.js --user-id=<id> --country=US --region=NA --out=exports/refunds.json
 */
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const ExpenseRawRow = require('../models/finance/ExpenseRawRowModel.js');

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
    const k = raw.slice(2, eq);
    const v = raw.slice(eq + 1);
    out[k] = v;
  }
  return out;
}

function requireParam(args, key) {
  const v = args[key];
  if (!v) {
    throw new Error(`Missing required arg: --${key}=...`);
  }
  return v;
}

function toDateRange(from, to) {
  if (!from && !to) return null;
  if (!from || !to) throw new Error('Provide both --from=YYYY-MM-DD and --to=YYYY-MM-DD together.');

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new Error('Invalid date format. Use YYYY-MM-DD for --from and --to.');
  }
  if (fromDate > toDate) throw new Error('--from must be <= --to');
  return { fromDate, toDate };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveOutPath(outArg) {
  if (!outArg) return null;
  const abs = path.isAbsolute(outArg) ? outArg : path.resolve(process.cwd(), outArg);
  ensureDir(path.dirname(abs));
  return abs;
}

async function fetchRefundedSkus({ userId, country, region, dateRange }) {
  const match = {
    User: new mongoose.Types.ObjectId(userId),
    country,
    region,
    transactionType: 'Refund',
    sku: { $nin: [null, '', 'N/A'] },
  };

  if (dateRange) {
    match.postedDate = { $gte: dateRange.fromDate, $lte: dateRange.toDate };
  }

  const rows = await ExpenseRawRow.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$sku',
        refundRows: { $sum: 1 },
        totalRefundAmount: { $sum: '$amount' },
        firstRefundAt: { $min: '$postedDate' },
        lastRefundAt: { $max: '$postedDate' },
        orderIds: { $addToSet: '$orderId' },
      },
    },
    {
      $project: {
        _id: 0,
        sku: '$_id',
        refundRows: 1,
        totalRefundAmount: { $round: ['$totalRefundAmount', 2] },
        firstRefundAt: 1,
        lastRefundAt: 1,
        orderIds: {
          $filter: {
            input: '$orderIds',
            as: 'orderId',
            cond: { $and: [{ $ne: ['$$orderId', null] }, { $ne: ['$$orderId', ''] }] },
          },
        },
      },
    },
    { $sort: { totalRefundAmount: 1 } },
  ]);

  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!MONGODB_URI) {
    throw new Error('DB connection is not configured. Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
  }

  const userId = requireParam(args, 'user-id');
  const country = requireParam(args, 'country').trim().toUpperCase();
  const region = requireParam(args, 'region').trim().toUpperCase();
  const dateRange = toDateRange(args.from, args.to);
  const outPath = resolveOutPath(args.out);

  await mongoose.connect(MONGODB_URI);

  let refundedSkus;
  try {
    refundedSkus = await fetchRefundedSkus({ userId, country, region, dateRange });
  } finally {
    await mongoose.connection.close();
  }

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      params: {
        userId,
        country,
        region,
        from: args.from || null,
        to: args.to || null,
      },
      totalRefundedSkus: refundedSkus.length,
    },
    refundedSkus,
  };

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`Wrote: ${outPath}`);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to fetch refunded SKUs:', err?.message || err);
  process.exit(1);
});

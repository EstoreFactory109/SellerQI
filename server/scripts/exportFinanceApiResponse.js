/**
 * Export Finance API (service) response to JSON file.
 *
 * This script runs the same underlying read-services used by finance endpoints
 * (profitability / expenses) and stores the final JSON response in a .json file.
 *
 * Usage examples:
 *   node server/scripts/exportFinanceApiResponse.js --user-id=<id> --country=US --region=NA --api=profitability:summary --period=30
 *   node server/scripts/exportFinanceApiResponse.js --user-id=<id> --country=US --region=NA --api=profitability:table --period=30 --page=1 --limit=25
 *   node server/scripts/exportFinanceApiResponse.js --user-id=<id> --country=US --region=NA --api=expenses:snapshot
 *   node server/scripts/exportFinanceApiResponse.js --user-id=<id> --country=US --region=NA --api=expenses:total --from=2026-01-01 --to=2026-01-31
 *
 * Output:
 *   Writes JSON to: ./exports/finance/<auto-name>.json (or --out=<path>)
 */
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

// Load env from repo root .env (same convention used by other scripts)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const dbConsts = require('../config/config.js');
const ProfitabilityReadService = require('../Services/Finance/ProfitabilityReadService.js');
const ExpenseReadService = require('../Services/Finance/ExpenseReadService.js');
const { buildExpenseReportResponseFromDB } = require('../Services/Sp_API/ExpenseReportService.js');
const Seller = require('../models/user-auth/sellerCentralModel.js');
const {
  getAccessToken: getSpApiAccessToken,
  fetchFinancialEvents,
  parseFinancialEvents,
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

function parseIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
}

function regionModelToInternal(regionModel) {
  const r = String(regionModel || '').trim().toUpperCase();
  if (r === 'NA') return 'na';
  if (r === 'EU') return 'eu';
  if (r === 'FE') return 'apac';
  return null;
}

function isoRange(from, to) {
  if (!from || !to) throw new Error('Both --from=YYYY-MM-DD and --to=YYYY-MM-DD are required for date-range calls.');
  const fromIso = new Date(`${from}T00:00:00.000Z`);
  const toIso = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(fromIso.getTime()) || Number.isNaN(toIso.getTime())) {
    throw new Error('Invalid date format. Use YYYY-MM-DD for --from and --to.');
  }
  if (fromIso > toIso) throw new Error('--from must be <= --to');
  return { postedAfter: fromIso.toISOString(), postedBefore: toIso.toISOString() };
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveOutPath(outArg, meta) {
  if (outArg) {
    const abs = path.isAbsolute(outArg) ? outArg : path.resolve(process.cwd(), outArg);
    ensureDir(path.dirname(abs));
    return abs;
  }

  const baseDir = path.resolve(process.cwd(), 'exports/finance');
  ensureDir(baseDir);
  const safeApi = String(meta.api || 'finance').replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeCountry = String(meta.country || 'XX').replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeRegion = String(meta.region || 'NA').replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `${safeApi}-${safeRegion}-${safeCountry}-${meta.userId}-${nowStamp()}.json`;
  return path.join(baseDir, filename);
}

function deriveRawOutPath(summaryOutPath, rawOutArg) {
  if (rawOutArg) {
    const abs = path.isAbsolute(rawOutArg) ? rawOutArg : path.resolve(process.cwd(), rawOutArg);
    ensureDir(path.dirname(abs));
    return abs;
  }

  const ext = path.extname(summaryOutPath) || '.json';
  const base = summaryOutPath.slice(0, summaryOutPath.length - ext.length);
  const rawPath = `${base}-raw-financialEvents${ext}`;
  ensureDir(path.dirname(rawPath));
  return rawPath;
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

function summarizeExpensesFromFinanceRows(expenseRows) {
  // Match ProfitabilityReadService behavior: exclude PPC from expenses.
  const rows = Array.isArray(expenseRows) ? expenseRows : [];
  const filtered = rows.filter((r) => r && r.category !== 'Advertising / PPC');

  let totalExpenses = 0;
  let amazonFees = 0;
  let refunds = 0;

  const FBA_FEE_CATEGORIES = new Set(['FBA Fulfillment Fee', 'FBA Storage Fee', 'FBA Disposal Fee']);
  let fbaFees = 0;

  for (const r of filtered) {
    const amt = Number(r.amount) || 0;
    totalExpenses += amt;
    if (r.isAmazonFee) {
      amazonFees += amt;
      if (FBA_FEE_CATEGORIES.has(r.category)) fbaFees += amt;
    }
    if (r.transactionType === 'Refund') refunds += amt;
  }

  // Match API output shape (positive numbers for deductions)
  return {
    totalExpenses: Math.abs(Math.round(totalExpenses * 100) / 100),
    amazonFees: Math.abs(Math.round(amazonFees * 100) / 100),
    fbaFees: Math.abs(Math.round(fbaFees * 100) / 100),
    refunds: Math.abs(Math.round(refunds * 100) / 100),
  };
}

async function runProfitabilitySummaryLiveFinance(ctx, args) {
  const { from, to } = args;
  const { postedAfter, postedBefore } = isoRange(from, to);

  const internalRegion = regionModelToInternal(ctx.region);
  if (!internalRegion) throw new Error(`Invalid --region=${ctx.region}. Expected NA, EU, or FE.`);

  const refreshToken = await getUserSpApiRefreshToken(ctx);

  const clientId = process.env.SPAPI_CLIENT_ID;
  const clientSecret = process.env.SPAPI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing SP-API app creds. Set SPAPI_CLIENT_ID and SPAPI_CLIENT_SECRET in .env');
  }

  const { baseUrl } = resolveMarketplaceAndRegion(ctx.country, internalRegion);
  const accessToken = await getSpApiAccessToken(clientId, clientSecret, refreshToken);

  // 1) Fetch expenses from SP-API Finances for the requested window
  const financialEvents = await fetchFinancialEvents(accessToken, baseUrl, postedAfter, postedBefore);
  const expenseRows = parseFinancialEvents(financialEvents);
  const expenseSummary = summarizeExpensesFromFinanceRows(expenseRows);

  // 2) Fetch sales/units from DB (same as profitability API) for the same range
  const salesSide = await ProfitabilityReadService.getSummaryByDateRange({
    userId: ctx.userId,
    country: ctx.country,
    region: ctx.region,
    from,
    to,
  });

  const totalSales = Number(salesSide?.totalSales) || 0;
  const totalUnits = Number(salesSide?.totalUnits) || 0;

  return {
    totalSales,
    totalUnits,
    totalExpenses: expenseSummary.totalExpenses,
    amazonFees: expenseSummary.amazonFees,
    fbaFees: expenseSummary.fbaFees,
    refunds: expenseSummary.refunds,
    grossProfit: Math.round((totalSales - expenseSummary.totalExpenses) * 100) / 100,
    _source: {
      sales: 'db',
      expenses: 'spapi-finances',
      postedAfter,
      postedBefore,
      baseUrl,
    },
    _rawFinancialEvents: financialEvents,
  };
}

async function runFinance(api, ctx, args) {
  // Profitability
  if (api === 'profitability:summary') {
    const liveFinance = parseBool(args['live-finance']);
    if (liveFinance) {
      if (!args.from || !args.to) {
        throw new Error('--live-finance=1 requires --from=YYYY-MM-DD and --to=YYYY-MM-DD');
      }
      return runProfitabilitySummaryLiveFinance(ctx, args);
    }
    const periodDays = parseIntOrNull(args.period);
    if (periodDays) return ProfitabilityReadService.getSummaryByPeriod({ ...ctx, periodDays });
    if (args.from && args.to) return ProfitabilityReadService.getSummaryByDateRange({ ...ctx, from: args.from, to: args.to });
    return ProfitabilityReadService.getSummaryByPeriod({ ...ctx, periodDays: 30 });
  }

  if (api === 'profitability:chart') {
    const periodDays = parseIntOrNull(args.period);
    if (periodDays) return ProfitabilityReadService.getChartByPeriod({ ...ctx, periodDays });
    if (args.from && args.to) return ProfitabilityReadService.getChartByDateRange({ ...ctx, from: args.from, to: args.to });
    return ProfitabilityReadService.getChartByPeriod({ ...ctx, periodDays: 30 });
  }

  if (api === 'profitability:table') {
    const page = Math.max(1, parseIntOrNull(args.page) || 1);
    const limit = Math.min(100, Math.max(1, parseIntOrNull(args.limit) || 10));
    const periodDays = parseIntOrNull(args.period);
    if (periodDays) return ProfitabilityReadService.getTableByPeriod({ ...ctx, periodDays, page, limit });
    if (args.from && args.to) return ProfitabilityReadService.getTableByDateRange({ ...ctx, from: args.from, to: args.to, page, limit });
    return ProfitabilityReadService.getTableByPeriod({ ...ctx, periodDays: 30, page, limit });
  }

  // Expenses (raw-row aggregates)
  if (api === 'expenses:total') {
    const periodDays = parseIntOrNull(args.period);
    if (periodDays) return ExpenseReadService.getTotalExpensesByPeriod({ ...ctx, periodDays });
    if (args.from && args.to) {
      const err = ExpenseReadService.validateDateRange(args.from, args.to);
      if (err) throw new Error(err);
      return ExpenseReadService.getTotalExpensesByDateRange({ ...ctx, from: args.from, to: args.to });
    }
    return ExpenseReadService.getTotalExpensesByPeriod({ ...ctx, periodDays: 30 });
  }

  if (api === 'expenses:amazon-fees') {
    const periodDays = parseIntOrNull(args.period);
    if (periodDays) return ExpenseReadService.getTotalAmazonFeesByPeriod({ ...ctx, periodDays });
    if (args.from && args.to) {
      const err = ExpenseReadService.validateDateRange(args.from, args.to);
      if (err) throw new Error(err);
      return ExpenseReadService.getTotalAmazonFeesByDateRange({ ...ctx, from: args.from, to: args.to });
    }
    return ExpenseReadService.getTotalAmazonFeesByPeriod({ ...ctx, periodDays: 30 });
  }

  if (api === 'expenses:asin-wise') {
    const periodDays = parseIntOrNull(args.period);
    if (periodDays) return ExpenseReadService.getAsinWiseExpensesByPeriod({ ...ctx, periodDays });
    if (args.from && args.to) {
      const err = ExpenseReadService.validateDateRange(args.from, args.to);
      if (err) throw new Error(err);
      return ExpenseReadService.getAsinWiseExpensesByDateRange({ ...ctx, from: args.from, to: args.to });
    }
    return ExpenseReadService.getAsinWiseExpensesByPeriod({ ...ctx, periodDays: 30 });
  }

  if (api === 'expenses:refunds') {
    const periodDays = parseIntOrNull(args.period);
    if (periodDays) return ExpenseReadService.getRefundsByPeriod({ ...ctx, periodDays });
    if (args.from && args.to) {
      const err = ExpenseReadService.validateDateRange(args.from, args.to);
      if (err) throw new Error(err);
      return ExpenseReadService.getRefundsByDateRange({ ...ctx, from: args.from, to: args.to });
    }
    return ExpenseReadService.getRefundsByPeriod({ ...ctx, periodDays: 30 });
  }

  // Expenses (latest persisted snapshot from ExpenseReportRun + aggregates)
  if (api === 'expenses:snapshot') {
    return buildExpenseReportResponseFromDB({
      userId: ctx.userId,
      country: ctx.country,
      regionModel: ctx.region,
    });
  }

  throw new Error(
    `Unknown --api=${api}. Supported: ` +
      [
        'profitability:summary',
        'profitability:chart',
        'profitability:table',
        'expenses:total',
        'expenses:amazon-fees',
        'expenses:asin-wise',
        'expenses:refunds',
        'expenses:snapshot',
      ].join(', ')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!MONGODB_URI) {
    throw new Error('DB connection is not configured. Set DB_URI and DB_NAME (or MONGODB_URI) in .env');
  }

  const userId = requireParam(args, 'user-id');
  const country = requireParam(args, 'country').trim().toUpperCase();
  const region = requireParam(args, 'region').trim().toUpperCase(); // NA | EU | FE
  const api = String(args.api || 'profitability:summary').trim();

  const ctx = { userId, country, region };
  const startedAt = new Date().toISOString();

  await mongoose.connect(MONGODB_URI);

  let response;
  try {
    response = await runFinance(api, ctx, args);
  } finally {
    await mongoose.connection.close();
  }

  // If live-finance returned raw payload, write it separately and keep the summary file small.
  const rawFinancialEvents = response && response._rawFinancialEvents ? response._rawFinancialEvents : null;
  if (rawFinancialEvents) {
    delete response._rawFinancialEvents;
  }

  const payload = {
    meta: {
      startedAt,
      finishedAt: new Date().toISOString(),
      api,
      params: {
        userId,
        country,
        region,
        period: args.period || null,
        from: args.from || null,
        to: args.to || null,
        page: args.page || null,
        limit: args.limit || null,
      },
    },
    data: response,
  };

  const outPath = resolveOutPath(args.out, { api, userId, country, region });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote: ${outPath}`);

  if (rawFinancialEvents) {
    const rawOutPath = deriveRawOutPath(outPath, args['raw-out']);
    fs.writeFileSync(rawOutPath, JSON.stringify(rawFinancialEvents, null, 2), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`Wrote raw: ${rawOutPath}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Export failed:', err?.message || err);
  process.exit(1);
});


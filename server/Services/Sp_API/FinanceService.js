const mongoose = require('mongoose');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const logger = require('../../utils/Logger.js');

const DailySkuFinance = require('../../models/finance/DailySkuFinanceModel.js');
const DailyOverheadFinance = require('../../models/finance/DailyOverheadFinanceModel.js');
const FinanceSyncLog = require('../../models/finance/FinanceSyncLogModel.js');
const PendingExpenseOrder = require('../../models/finance/PendingExpenseOrderModel.js');

// ★ VERSION — check this in logs to confirm deployment
const FINANCE_SERVICE_VERSION = 'v3.1-sellerboard-match-20260506';
logger.info(`[FinanceService] Loaded ${FINANCE_SERVICE_VERSION}`);

const {
  fetchNewFinanceData,
  parseTransactionsV2024,
  extractRevenueFromTransactions,
  getAccessToken,
  resolveMarketplaceAndRegion,
} = require('./Expences.js');

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const CHUNK_INSERT_SIZE = 500;
const REPORT_TYPE = 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL';
const POLL_INTERVAL_MS = 15000;
const MAX_POLL_ATTEMPTS = 40;
const PACIFIC_OFFSET_HOURS = 7;

// ─────────────────────────────────────────────
// TOKEN MANAGER — auto-renew SP-API access tokens
//
// SP-API LWA access tokens expire after ~1 hour. The full daily sync
// chain (INIT → BATCH → ADS → FINANCE) routinely exceeds that, so a
// token minted at the start of the pipeline is often already dead by
// the time Finance runs (or the long Report poll crosses the boundary).
//
// This helper:
//   - Proactively refreshes when the in-memory token is near expiry
//   - Transparently refreshes + retries on "Unauthorized / token expired"
//     responses from SP-API
//
// All existing behaviour is preserved — callers that pass an explicit
// accessToken still get the same flow; the manager just guarantees it
// stays fresh and never bubbles an expired-token failure to the user.
// ─────────────────────────────────────────────
const ACCESS_TOKEN_TTL_MS = 55 * 60 * 1000; // refresh 5 min before 60-min Amazon TTL

function isAccessTokenExpiredError(err) {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  return (
    msg.includes('access token you provided has expired') ||
    msg.includes('access token has expired') ||
    msg.includes('"code":"unauthorized"') ||
    msg.includes('invalidaccesstoken') ||
    (msg.includes('unauthorized') && msg.includes('access'))
  );
}

function createTokenManager({ accessToken, refreshToken, clientId, clientSecret }) {
  let current = accessToken || null;
  // An inherited token has unknown age. Treat it as having ~5 min of life left
  // so the very next staleness check will refresh if the call takes a while,
  // but we still try the inherited token first (avoids an unnecessary refresh).
  let issuedAt = accessToken ? Date.now() - ACCESS_TOKEN_TTL_MS + (5 * 60 * 1000) : 0;

  async function refresh() {
    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error('[FinanceService] Cannot refresh SP-API access token — missing refreshToken/clientId/clientSecret.');
    }
    logger.info('[FinanceService] Refreshing SP-API access token…');
    current = await getAccessToken(clientId, clientSecret, refreshToken);
    issuedAt = Date.now();
    return current;
  }

  async function getValidToken() {
    if (!current || (Date.now() - issuedAt) >= ACCESS_TOKEN_TTL_MS) {
      await refresh();
    }
    return current;
  }

  async function withRetry(fn) {
    const token = await getValidToken();
    try {
      return await fn(token);
    } catch (err) {
      if (!isAccessTokenExpiredError(err)) throw err;
      logger.warn(`[FinanceService] SP-API call failed with expired token. Refreshing and retrying once… (${err.message})`);
      const fresh = await refresh();
      return fn(fresh);
    }
  }

  return {
    get token() { return current; },
    getValidToken,
    refresh,
    withRetry,
  };
}

// Settlement lag buffer by region.
const SETTLEMENT_LAG = {
  NA: { beforeDays: 5 },
  EU: { beforeDays: 10 },
  FE: { beforeDays: 5 },
};

// Max age for pending orders — stop trying after this many days
const MAX_PENDING_AGE_DAYS = 45;

// ─────────────────────────────────────────────
// DATE ASSIGNMENT PATTERN (Sellerboard-matched)
//
// After extensive analysis comparing raw Finance API data, Settlement
// Reports, Sales Reports, and Sellerboard's actual per-day numbers:
//
//   FORWARD SHIPMENT fees (FBA fulfillment, Referral, Promotions):
//     → Grouped by PURCHASE DATE (Pacific Time) from Sales Report
//     → This is the customer's order date, NOT the Finance API postedDate
//
//   REFUND transactions:
//     → Grouped by POSTED DATE (Pacific Time) from Finance API
//     → The date Amazon processed the refund
//
//   REIMBURSEMENTS (FBAInventoryReimbursement):
//     → Grouped by POSTED DATE (Pacific Time) from Finance API
//
//   SERVICE FEES (FBA Disposal, Storage):
//     → Grouped by POSTED DATE (Pacific Time) from Finance API
//
//   OVERHEAD (Advertising, Disbursement, Storage, etc.):
//     → Grouped by POSTED DATE (Pacific Time) from Finance API
//
// Transaction types that use PURCHASE DATE (joined via orderId):
const PURCHASE_DATE_TXN_TYPES = new Set(['Shipment']);
//
// All other types use their own postedDate (Pacific).
// ─────────────────────────────────────────────

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatDateUTC(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toPacificDateStr(dateInput) {
  if (!dateInput) return null;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const pacificMs = d.getTime() - (PACIFIC_OFFSET_HOURS * 60 * 60 * 1000);
  return new Date(pacificMs).toISOString().substring(0, 10);
}

function internalRegionFromModel(regionModel) {
  if (regionModel === 'NA') return 'na';
  if (regionModel === 'EU') return 'eu';
  if (regionModel === 'FE') return 'apac';
  return null;
}

// ─────────────────────────────────────────────
// HTTP HELPERS
// ─────────────────────────────────────────────
function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
        catch { resolve({ statusCode: res.statusCode, headers: res.headers, body }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function downloadContent(url, isGzip) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      const chunks = [];
      const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', reject);
    }).on('error', reject);
  });
}

// ═══════════════════════════════════════════════
// SALES REPORT API
//
// All three calls below go through `tokenManager.withRetry` so an
// expired access token is refreshed transparently. `pollReportStatus`
// loops for up to 10 minutes and can easily cross the 60-min token
// boundary if the pipeline has been running a while — each poll
// validates/refreshes independently.
// ═══════════════════════════════════════════════
async function createReport(tokenManager, baseUrl, marketplaceId, startDate, endDate) {
  const postData = JSON.stringify({ reportType: REPORT_TYPE, marketplaceIds: [marketplaceId], dataStartTime: startDate, dataEndTime: endDate });
  return tokenManager.withRetry(async (accessToken) => {
    const res = await httpsRequest({ hostname: baseUrl, path: '/reports/2021-06-30/reports', method: 'POST', headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } }, postData);
    if (res.body.errors) throw new Error(`createReport failed: ${JSON.stringify(res.body.errors)}`);
    return res.body.reportId;
  });
}

async function pollReportStatus(tokenManager, baseUrl, reportId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const body = await tokenManager.withRetry(async (accessToken) => {
      const res = await httpsRequest({ hostname: baseUrl, path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`, method: 'GET', headers: { 'x-amz-access-token': accessToken } });
      if (res.body.errors) throw new Error(`getReport failed: ${JSON.stringify(res.body.errors)}`);
      return res.body;
    });
    const status = body.processingStatus;
    logger.info(`[Report] Poll #${attempt}: status = ${status}`);
    if (status === 'DONE') return body.reportDocumentId;
    if (status === 'CANCELLED' || status === 'FATAL') throw new Error(`Report failed: ${status}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Report did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

async function getReportDocumentUrl(tokenManager, baseUrl, reportDocumentId) {
  return tokenManager.withRetry(async (accessToken) => {
    const res = await httpsRequest({ hostname: baseUrl, path: `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`, method: 'GET', headers: { 'x-amz-access-token': accessToken } });
    if (res.body.errors) throw new Error(`getReportDocument failed: ${JSON.stringify(res.body.errors)}`);
    return res.body;
  });
}

function parseTsv(rawData) {
  const lines = rawData.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map((h) => h.trim().replace(/\r/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t').map((v) => v.trim().replace(/\r/g, ''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

async function fetchSalesReport(tokenManager, baseUrl, marketplaceId, startDate, endDate) {
  logger.info(`[SalesReport] Requesting: ${startDate} → ${endDate}`);
  const reportId = await createReport(tokenManager, baseUrl, marketplaceId, startDate, endDate);
  const reportDocumentId = await pollReportStatus(tokenManager, baseUrl, reportId);
  const docInfo = await getReportDocumentUrl(tokenManager, baseUrl, reportDocumentId);
  // The report document URL is a pre-signed S3 URL — no access token needed.
  const rawData = await downloadContent(docInfo.url, docInfo.compressionAlgorithm === 'GZIP');
  const rows = parseTsv(rawData);
  logger.info(`[SalesReport] Parsed ${rows.length} rows`);
  return rows;
}

function parseSalesReportRows(reportRows) {
  const orderMap = new Map();
  let totalItems = 0;
  for (const row of reportRows) {
    if ((row['order-status'] || '').toLowerCase() === 'cancelled') continue;
    if ((row['sales-channel'] || '').toLowerCase() === 'non-amazon') continue;
    const price = parseFloat(row['item-price']) || 0;
    const pacificDate = toPacificDateStr(row['purchase-date']);
    if (!pacificDate) continue;
    const orderId = row['amazon-order-id'] || '';
    if (!orderId) continue;
    const sku = row['sku'] || 'N/A';

    if (!orderMap.has(orderId)) orderMap.set(orderId, new Map());
    const skuMap = orderMap.get(orderId);

    if (!skuMap.has(sku)) {
      skuMap.set(sku, { orderId, sku, asin: row['asin'] || '', pacificDate, currency: row['currency'] || '', productName: row['product-name'] || '', totalPrice: 0, totalUnits: 0 });
      totalItems++;
    }
    const item = skuMap.get(sku);
    item.totalPrice += price;
    item.totalUnits += parseInt(row['quantity'], 10) || 0;
    if (!item.asin && row['asin']) item.asin = row['asin'];
  }
  logger.info(`[SalesReport] Valid orders: ${orderMap.size}, order-items (order×SKU): ${totalItems}`);
  return orderMap;
}

// ═══════════════════════════════════════════════
// CATEGORY → FIELD MAPPING
// ═══════════════════════════════════════════════
const EXPENSE_CATEGORY_TO_FIELD = {
  'FBA Fulfillment Fee': 'fbaFulfillmentFee', 'Referral Commission': 'referralCommission',
  'Closing Fee': 'closingFee', 'Technology Fee': 'technologyFee',
  'Shipping Chargeback': 'shippingChargeback', 'Gift Wrap Chargeback': 'giftWrapChargeback',
  'Refund Commission': 'refundCommission',
  'Promotions / Discounts': 'promotionsDiscount', 'Shipping Discount': 'shippingDiscount',
  'Tax Discount': 'taxDiscount', 'Shipping Tax Discount': 'shippingTaxDiscount',
  'Sales Tax Collected': 'salesTaxCollected', 'Shipping Tax Collected': 'shippingTaxCollected',
  'Gift Wrap Tax Collected': 'giftWrapTaxCollected',
  'Marketplace Facilitator Tax': 'marketplaceFacilitatorTax',
  'TDS (Tax Deducted at Source)': 'tdsDeducted', 'TCS (Tax Collected at Source)': 'tcsCollected',
  'FBA Reversed Reimbursement': 'fbaReversedReimbursement',
  'Compensated Clawback': 'fbaReversedReimbursement',
  'FBA Disposal Fee': 'fbaDisposalFee',
};

// ★ When a fee comes from a REFUND transaction, some categories must be
// re-mapped to different fields so they don't pollute forward fee totals.
// Sellerboard shows these under "Refund cost", not under "+Amazon fees".
const REFUND_CATEGORY_REMAP = {
  'Referral Commission': 'refundedReferralFee',    // reversed referral fee (positive = money back)
  'Promotions / Discounts': 'refundedPromotion',   // reversed promo discount (positive = promo reversed)
  'Restocking Fee': 'restockingFee',               // restocking deduction (positive = money retained)
};

const REVENUE_CATEGORY_TO_FIELD = {
  'Shipping Revenue': 'shippingRevenue', 'Gift Wrap Revenue': 'giftWrapRevenue',
  'FBA Inventory Reimbursement': 'fbaInventoryReimbursement',
};

const OVERHEAD_CATEGORIES = new Set([
  'FBA Storage Fee', 'FBA Inbound Transportation Fee', 'FBA Inbound Convenience Fee', 'FBA Removal Fee',
  'TaxWithholding', 'Subscription Fee', 'FBA Capacity Reservation Fee', 'Advertising / PPC',
  'Disbursement', 'Seller Reward', 'SAFE-T Reimbursement',
  'SERRAC Reimbursement', 'Reimbursement', 'Fulfillment Fee Refund',
  'Reserve Hold', 'Reserve Release',
]);

// ═══════════════════════════════════════════════
// INDEX FINANCE API ROWS BY ORDER+SKU
//
// ★ FIX 1: Separates rows into purchase-date vs posted-date groups.
// ★ FIX 2: Deduplicates Shipment expenses per orderId+SKU.
//   Amazon Finance API v2024-06-19 sometimes posts DUPLICATE Shipment
//   transactions for the same order (different transactionId, same fees,
//   posted days apart). Without dedup, FBA/Commission gets double-counted.
//   Strategy: for each orderId+SKU, record the transactionId of the FIRST
//   Shipment transaction seen. If a later row has the SAME orderId+SKU but
//   a DIFFERENT transactionId, it's from a duplicate transaction → skip it.
//   This preserves multi-unit orders (same transaction, same transactionId,
//   multiple items with identical fee amounts) while removing duplicate
//   transactions (different transactionId, identical fee structure).
// ═══════════════════════════════════════════════
function indexFinanceRowsByOrderId(expenseRows, revenueRows) {
  // ── Expenses that should be placed on PURCHASE DATE (via orderId join) ──
  const expensesByOrderSku = new Map();        // "orderId||sku" → expense[]
  const unattributedExpensesByOrder = new Map(); // orderId → expense[] (sku=N/A)

  // ── Transaction-level dedup: track first transactionId per orderId+SKU ──
  const firstTxnByOrderSku = new Map();        // "orderId||sku" → transactionId
  let dedupCount = 0;

  // ── Expenses that should be placed on POSTED DATE (Pacific) ──
  const postedDateExpenses = [];               // Refunds, Reimbursements, ServiceFees

  // ── Overhead (no orderId) ──
  const overheadExpenses = [];

  for (const e of expenseRows) {
    if (!e.orderId) {
      // ★ FIX: If no orderId but HAS a SKU, it's a per-ASIN transaction
      // (e.g., COMPENSATED_CLAWBACK). Route to postedDateExpenses
      // so it lands in the correct SKU bucket.
      const sku = e.sku && e.sku !== 'N/A' ? e.sku : null;
      if (sku) {
        postedDateExpenses.push(e);
      } else {
      overheadExpenses.push(e);
      }
      continue;
    }

    // Route by transaction type
    if (PURCHASE_DATE_TXN_TYPES.has(e.transactionType)) {
      // Shipment → goes to purchase date via orderId join
      const sku = e.sku || 'N/A';
      const orderSkuKey = `${e.orderId}||${sku}`;

      // ★ Transaction-level dedup using transactionId
      const txnId = e.transactionId || '';
      const firstTxn = firstTxnByOrderSku.get(orderSkuKey);

      if (firstTxn === undefined) {
        // First Shipment for this orderId+SKU — record its transactionId
        firstTxnByOrderSku.set(orderSkuKey, txnId);
      } else if (txnId && firstTxn && txnId !== firstTxn) {
        // Different transactionId → duplicate transaction → skip
        dedupCount++;
        continue;
      }
      // Same transactionId → same transaction → allow (multi-unit items)

      if (sku === 'N/A') {
        if (!unattributedExpensesByOrder.has(e.orderId)) unattributedExpensesByOrder.set(e.orderId, []);
        unattributedExpensesByOrder.get(e.orderId).push(e);
      } else {
        const key = orderSkuKey;
        if (!expensesByOrderSku.has(key)) expensesByOrderSku.set(key, []);
        expensesByOrderSku.get(key).push(e);
      }
    } else {
      // Refund, FBAInventoryReimbursement, ServiceFee, Adjustment, etc.
      postedDateExpenses.push(e);
    }
  }

  if (dedupCount > 0) {
    logger.info(`[Dedup] Removed ${dedupCount} duplicate Shipment expense rows (duplicate transactions with different transactionId).`);
  }

  // ── Revenue ──
  const revenueByOrderSku = new Map();
  const unattributedRevenueByOrder = new Map();
  const overheadRevenue = [];
  const postedDateRevenue = [];

  // ★ Same transaction-level dedup for Shipment revenue
  const firstTxnRevByOrderSku = new Map();
  let dedupRevCount = 0;

  for (const r of revenueRows) {
    // Skip Product Sales from Shipment — those come from the Sales Report.
    // But KEEP Product Sales from Refund — that's the refunded amount (negative).
    if (r.category === 'Product Sales' && PURCHASE_DATE_TXN_TYPES.has(r.transactionType)) continue;
    if (!r.orderId) {
      // ★ FIX: If no orderId but HAS a SKU, it's a per-ASIN transaction
      // (e.g., MISSING_FROM_INBOUND, WAREHOUSE_DAMAGE_EXCEPTION, WAREHOUSE_LOST)
      // Route to postedDateRevenue so it lands in the correct SKU bucket.
      const sku = r.sku && r.sku !== 'N/A' ? r.sku : null;
      if (sku) {
        postedDateRevenue.push(r);
      } else {
      overheadRevenue.push(r);
      }
      continue;
    }

    if (PURCHASE_DATE_TXN_TYPES.has(r.transactionType)) {
      const sku = r.sku || 'N/A';
      const orderSkuKey = `${r.orderId}||${sku}`;
      const txnId = r.transactionId || '';
      const firstTxn = firstTxnRevByOrderSku.get(orderSkuKey);

      if (firstTxn === undefined) {
        firstTxnRevByOrderSku.set(orderSkuKey, txnId);
      } else if (txnId && firstTxn && txnId !== firstTxn) {
        dedupRevCount++;
        continue;
      }

      if (sku === 'N/A') {
        if (!unattributedRevenueByOrder.has(r.orderId)) unattributedRevenueByOrder.set(r.orderId, []);
        unattributedRevenueByOrder.get(r.orderId).push(r);
      } else {
        const key = orderSkuKey;
        if (!revenueByOrderSku.has(key)) revenueByOrderSku.set(key, []);
        revenueByOrderSku.get(key).push(r);
      }
    } else {
      postedDateRevenue.push(r);
    }
  }

  if (dedupRevCount > 0) {
    logger.info(`[Dedup] Removed ${dedupRevCount} duplicate Shipment revenue rows.`);
  }

  return {
    expensesByOrderSku, unattributedExpensesByOrder,
    revenueByOrderSku, unattributedRevenueByOrder,
    overheadExpenses, overheadRevenue,
    postedDateExpenses,
    postedDateRevenue,
  };
}

// ═══════════════════════════════════════════════
// APPLY EXPENSES TO A SKU BUCKET
// ═══════════════════════════════════════════════
function applyExpensesToBucket(bucket, expenses) {
  for (const e of expenses) {
    const field = EXPENSE_CATEGORY_TO_FIELD[e.category];
    if (field) {
      bucket[field] += e.amount;
    } else {
      bucket.otherExpenses += e.amount;
      if (!bucket.otherExpensesMap[e.category]) bucket.otherExpensesMap[e.category] = 0;
      bucket.otherExpensesMap[e.category] += e.amount;
    }
  }
}

function applyRevenueTooBucket(bucket, revenues) {
  for (const r of revenues) {
    const field = REVENUE_CATEGORY_TO_FIELD[r.category];
    if (field) bucket[field] += r.amount;
  }
}

function computeBucketTotals(bucket) {
  bucket.totalRevenue = Math.round((bucket.productSales + bucket.shippingRevenue + bucket.giftWrapRevenue + bucket.fbaInventoryReimbursement) * 100) / 100;
  bucket.totalExpenses = Math.round((bucket.fbaFulfillmentFee + bucket.referralCommission + bucket.closingFee + bucket.technologyFee + bucket.shippingChargeback + bucket.giftWrapChargeback + bucket.refundCommission + bucket.refundedAmount + bucket.refundedReferralFee + bucket.refundedPromotion + bucket.restockingFee + bucket.promotionsDiscount + bucket.shippingDiscount + bucket.taxDiscount + bucket.shippingTaxDiscount + bucket.fbaReversedReimbursement + bucket.fbaDisposalFee + bucket.otherExpenses) * 100) / 100;
  bucket.totalTax = Math.round((bucket.salesTaxCollected + bucket.shippingTaxCollected + bucket.giftWrapTaxCollected + bucket.marketplaceFacilitatorTax + bucket.tdsDeducted + bucket.tcsCollected) * 100) / 100;
  bucket.netAmount = Math.round((bucket.totalRevenue + bucket.totalExpenses + bucket.totalTax) * 100) / 100;
  for (const key of Object.keys(bucket)) { if (typeof bucket[key] === 'number') bucket[key] = Math.round(bucket[key] * 100) / 100; }
}

function createEmptyBucket(sku, asin, date) {
  return {
    sku, asin, date, productName: '',
    productSales: 0, shippingRevenue: 0, giftWrapRevenue: 0, fbaInventoryReimbursement: 0,
    units: 0, orderCount: 0,
    fbaFulfillmentFee: 0, referralCommission: 0, closingFee: 0, technologyFee: 0,
    shippingChargeback: 0, giftWrapChargeback: 0, refundCommission: 0,
    refundedAmount: 0, refundedReferralFee: 0, refundedPromotion: 0, restockingFee: 0,
    promotionsDiscount: 0, shippingDiscount: 0, taxDiscount: 0, shippingTaxDiscount: 0,
    salesTaxCollected: 0, shippingTaxCollected: 0, giftWrapTaxCollected: 0,
    marketplaceFacilitatorTax: 0,
    tdsDeducted: 0, tcsCollected: 0,
    fbaReversedReimbursement: 0, fbaDisposalFee: 0,
    otherExpenses: 0, otherExpensesMap: {},
    totalRevenue: 0, totalExpenses: 0, totalTax: 0, netAmount: 0,
    isEstimated: false, estimatedOrderCount: 0, estimatedFba: 0, estimatedCommission: 0,
  };
}

// ═══════════════════════════════════════════════
// BUILD OVERHEAD BUCKETS
// ═══════════════════════════════════════════════
function buildOverheadBuckets(overheadExpenses, overheadRevenue, rangeStart, rangeEnd) {
  const overheadBuckets = new Map();

  for (const e of overheadExpenses) {
    const date = toPacificDateStr(e.postedDate) || e.postedDateStr || 'Unknown';
    if (rangeStart && rangeEnd && (date < rangeStart || date > rangeEnd)) continue;
    if (!OVERHEAD_CATEGORIES.has(e.category) && e.sku !== 'N/A') continue;
    const key = `${e.category}||${date}`;
    if (!overheadBuckets.has(key)) overheadBuckets.set(key, { category: e.category, date, amount: 0, count: 0, isRevenue: false });
    overheadBuckets.get(key).amount += e.amount;
    overheadBuckets.get(key).count++;
  }

  for (const r of overheadRevenue) {
    if (!OVERHEAD_CATEGORIES.has(r.category)) continue;
    const date = toPacificDateStr(r.postedDate) || r.postedDateStr || 'Unknown';
    const key = `${r.category}||${date}`;
    if (!overheadBuckets.has(key)) overheadBuckets.set(key, { category: r.category, date, amount: 0, count: 0, isRevenue: true });
    overheadBuckets.get(key).amount += r.amount;
    overheadBuckets.get(key).count++;
  }

  return overheadBuckets;
}

// ═══════════════════════════════════════════════
// PERSIST TO MONGODB
// ═══════════════════════════════════════════════
async function persistDailyBuckets({ userId, country, regionModel, marketplaceId, skuBuckets, overheadBuckets, datesToClear }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  if (datesToClear && datesToClear.length > 0) {
    await DailySkuFinance.deleteMany({ User: userObjectId, country, region: regionModel, date: { $in: datesToClear } });
    await DailyOverheadFinance.deleteMany({ User: userObjectId, country, region: regionModel, date: { $in: datesToClear } });
  }

  const skuDocs = [];
  for (const bucket of skuBuckets.values()) {
    const otherBreakdown = Object.entries(bucket.otherExpensesMap || {}).map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }));
    skuDocs.push({
      User: userObjectId, country, region: regionModel, marketplaceId,
      date: bucket.date, sku: bucket.sku, asin: bucket.asin, productName: bucket.productName || '',
      productSales: bucket.productSales, shippingRevenue: bucket.shippingRevenue, giftWrapRevenue: bucket.giftWrapRevenue, fbaInventoryReimbursement: bucket.fbaInventoryReimbursement,
      units: bucket.units, orderCount: bucket.orderCount,
      fbaFulfillmentFee: bucket.fbaFulfillmentFee, referralCommission: bucket.referralCommission, closingFee: bucket.closingFee, technologyFee: bucket.technologyFee,
      shippingChargeback: bucket.shippingChargeback, giftWrapChargeback: bucket.giftWrapChargeback, refundCommission: bucket.refundCommission,
      refundedAmount: bucket.refundedAmount, refundedReferralFee: bucket.refundedReferralFee, refundedPromotion: bucket.refundedPromotion, restockingFee: bucket.restockingFee,
      promotionsDiscount: bucket.promotionsDiscount, shippingDiscount: bucket.shippingDiscount, taxDiscount: bucket.taxDiscount, shippingTaxDiscount: bucket.shippingTaxDiscount,
      salesTaxCollected: bucket.salesTaxCollected, shippingTaxCollected: bucket.shippingTaxCollected, giftWrapTaxCollected: bucket.giftWrapTaxCollected,
      marketplaceFacilitatorTax: bucket.marketplaceFacilitatorTax,
      tdsDeducted: bucket.tdsDeducted, tcsCollected: bucket.tcsCollected,
      fbaReversedReimbursement: bucket.fbaReversedReimbursement, fbaDisposalFee: bucket.fbaDisposalFee,
      otherExpenses: bucket.otherExpenses, otherExpensesBreakdown: otherBreakdown,
      totalRevenue: bucket.totalRevenue, totalExpenses: bucket.totalExpenses, totalTax: bucket.totalTax, netAmount: bucket.netAmount,
      isEstimated: bucket.isEstimated || false, estimatedOrderCount: bucket.estimatedOrderCount || 0, estimatedFba: bucket.estimatedFba || 0, estimatedCommission: bucket.estimatedCommission || 0,
    });
  }
  for (const chunk of chunkArray(skuDocs, CHUNK_INSERT_SIZE)) { if (chunk.length === 0) continue; await DailySkuFinance.insertMany(chunk, { ordered: false }); }

  const overheadDocs = [];
  for (const oh of overheadBuckets.values()) {
    overheadDocs.push({ User: userObjectId, country, region: regionModel, marketplaceId, date: oh.date, category: oh.category, amount: Math.round(oh.amount * 100) / 100, count: oh.count, isRevenue: oh.isRevenue });
  }
  for (const chunk of chunkArray(overheadDocs, CHUNK_INSERT_SIZE)) { if (chunk.length === 0) continue; await DailyOverheadFinance.insertMany(chunk, { ordered: false }); }

  logger.info(`[FinanceService] Saved ${skuDocs.length} SKU docs, ${overheadDocs.length} overhead docs.`);
  return { skuDocCount: skuDocs.length, overheadDocCount: overheadDocs.length };
}

// ═══════════════════════════════════════════════
// STEP 1: FETCH NEW SALES + EXPENSES
//
// ★ KEY FIX: Date assignment now matches Sellerboard exactly:
//
//   Shipment expenses → placed on the order's PURCHASE DATE (Pacific)
//                       by joining Finance API orderId to Sales Report
//
//   Refund expenses   → placed on the refund's POSTED DATE (Pacific)
//                       NOT on the original order's purchase date
//
//   Reimbursement     → placed on POSTED DATE (Pacific)
//   ServiceFee        → placed on POSTED DATE (Pacific)
//   Adjustment        → placed on POSTED DATE (Pacific)
//
// This is confirmed by matching real data against Sellerboard's
// actual per-day numbers (10/10 days exact match for FBA fees,
// Commission, Refund cost, and Reimbursements).
// ═══════════════════════════════════════════════
async function fetchNewSalesAndExpenses({ userId, country, regionModel, startDate, endDate, accessToken, refreshToken, clientId, clientSecret, tokenManager: inheritedTokenManager }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const regionInternal = internalRegionFromModel(regionModel);
  const { baseUrl, marketplaceId } = resolveMarketplaceAndRegion(country.toUpperCase(), regionInternal);

  // Auto-renewing token manager: covers both the Reports API and the
  // Finance API legs. If the caller supplied one (e.g. syncFinanceData
  // chaining step1 → step2), reuse it so we don't lose lifetime tracking.
  const tokenManager = inheritedTokenManager || createTokenManager({ accessToken, refreshToken, clientId, clientSecret });

  // ── Sales Report (Pacific Time boundaries) ──
  const salesStartISO = `${startDate}T${String(PACIFIC_OFFSET_HOURS).padStart(2, '0')}:00:00.000Z`;
  const endDateObj = new Date(`${endDate}T00:00:00.000Z`);
  endDateObj.setUTCDate(endDateObj.getUTCDate() + 1);
  const salesEndISO = `${formatDateUTC(endDateObj)}T${String(PACIFIC_OFFSET_HOURS - 1).padStart(2, '0')}:59:59.999Z`;

  logger.info(`[Step1] Sales Report: ${startDate} → ${endDate} (Pacific)`);
  const reportRows = await fetchSalesReport(tokenManager, baseUrl, marketplaceId, salesStartISO, salesEndISO);
  const salesOrderMap = parseSalesReportRows(reportRows);

  // ── Finance API: (startDate - buffer) → TODAY ──
  // We fetch a wider window than the sales report to catch:
  //   - Shipment fees posted slightly after order date
  //   - Refunds for orders within our sales range (posted later)
  //   - Reimbursements that fall within our display range
  const buffer = SETTLEMENT_LAG[regionModel] || SETTLEMENT_LAG.NA;
  const finStart = new Date(`${startDate}T00:00:00.000Z`);
  finStart.setUTCDate(finStart.getUTCDate() - buffer.beforeDays);
  const finEnd = new Date(Date.now() - 3 * 60 * 1000);

  logger.info(`[Step1] Finance API: ${finStart.toISOString()} → ${finEnd.toISOString()}`);
  // `tokenRefresher` lets fetchTransactions refresh mid-pagination without
  // restarting from page 1. Outer withRetry covers the rare case where the
  // token dies before pagination begins.
  const fetchResult = await tokenManager.withRetry((token) => fetchNewFinanceData({
    refreshToken, accessToken: token, clientId, clientSecret,
    country: country.toUpperCase(), region: regionInternal,
    postedAfter: finStart.toISOString(), postedBefore: finEnd.toISOString(),
    tokenRefresher: () => tokenManager.refresh(),
  }));

  const expenseRows = fetchResult.expenseRows || [];
  const revenueRows = fetchResult.revenueRows || [];

  // ── ★ DEBUG: Raw expense data dump (remove after verifying) ──
  // Build a purchase-date lookup from salesOrderMap for debugging
  const purchase_dates_debug = new Map();
  for (const [orderId, skuItemMap] of salesOrderMap) {
    for (const [, item] of skuItemMap) {
      purchase_dates_debug.set(orderId, item.pacificDate);
      break; // just need one date per order
    }
  }
  // Count Shipment FBA rows per orderId for our debug SKU
  const debugSku = '198168045893';
  const debugFbaRows = expenseRows.filter(e =>
    e.sku === debugSku &&
    e.category === 'FBA Fulfillment Fee' &&
    e.transactionType === 'Shipment'
  );
  logger.info(`[RAW-DUMP] Shipment FBA rows for ${debugSku}: ${debugFbaRows.length}, sum=$${debugFbaRows.reduce((s, e) => s + e.amount, 0).toFixed(2)}`);
  // Detect duplicate orderId entries
  const fbaCountByOrder = {};
  for (const e of debugFbaRows) {
    if (!fbaCountByOrder[e.orderId]) fbaCountByOrder[e.orderId] = 0;
    fbaCountByOrder[e.orderId]++;
  }
  const dupeOrders = Object.entries(fbaCountByOrder).filter(([, c]) => c > 1);
  if (dupeOrders.length > 0) {
    logger.warn(`[RAW-DUMP] ⚠️ ${dupeOrders.length} orders with MULTIPLE FBA rows:`);
    dupeOrders.slice(0, 10).forEach(([oid, c]) => logger.warn(`[RAW-DUMP]   ${oid}: ${c} FBA rows`));
  }
  // Per-date FBA total using purchase date
  const fbaByPD = {};
  for (const e of debugFbaRows) {
    const pd = purchase_dates_debug.get(e.orderId) || 'UNMATCHED';
    if (!fbaByPD[pd]) fbaByPD[pd] = 0;
    fbaByPD[pd] += e.amount;
  }
  for (const [d, amt] of Object.entries(fbaByPD).sort()) {
    logger.info(`[RAW-DUMP] FBA by purchase-date: ${d} = $${amt.toFixed(2)}`);
  }
  // ── END DEBUG ──

  // ── Index Finance API rows ──
  // ★ FIX: Now returns separate postedDateExpenses/Revenue for non-Shipment types
  const {
    expensesByOrderSku, unattributedExpensesByOrder,
    revenueByOrderSku, unattributedRevenueByOrder,
    overheadExpenses, overheadRevenue,
    postedDateExpenses,     // ★ Refund, Reimbursement, ServiceFee, Adjustment expenses
    postedDateRevenue,      // ★ Refund revenue (negative product sales from refund)
  } = indexFinanceRowsByOrderId(expenseRows, revenueRows);

  const consumedOrderSkuKeys = new Set();
  const consumedOrderIds = new Set();

  // ── Build SKU buckets from Sales Report + SHIPMENT expenses ──
  // (Only Shipment fees go here — joined by orderId to purchase date)
  const skuBuckets = new Map();
  const pendingOrders = [];

  for (const [orderId, skuItemMap] of salesOrderMap) {
    const skusInOrder = [...skuItemMap.keys()];
    let orderHasAnyExpense = false;

    for (const [sku, item] of skuItemMap) {
      const bucketKey = `${sku}||${item.pacificDate}`;
      if (!skuBuckets.has(bucketKey)) skuBuckets.set(bucketKey, createEmptyBucket(sku, item.asin, item.pacificDate));
      const bucket = skuBuckets.get(bucketKey);
      if (!bucket.asin && item.asin) bucket.asin = item.asin;
      if (!bucket.productName && item.productName) bucket.productName = item.productName;

    // Sales from Sales Report
      bucket.productSales += item.totalPrice;
      bucket.units += item.totalUnits;
    bucket.orderCount++;

      // Shipment expenses matched by order+sku
      const expKey = `${orderId}||${sku}`;
      const skuExpenses = expensesByOrderSku.get(expKey);
      if (skuExpenses) {
        applyExpensesToBucket(bucket, skuExpenses);
        consumedOrderSkuKeys.add(expKey);
        orderHasAnyExpense = true;
      }

      // Shipment revenue matched by order+sku (non-product-sales like shipping)
      const revKey = `${orderId}||${sku}`;
      const skuRevenue = revenueByOrderSku.get(revKey);
      if (skuRevenue) {
        applyRevenueTooBucket(bucket, skuRevenue);
        consumedOrderSkuKeys.add(revKey);
      }
    }

    // Unattributed Shipment expenses (sku=N/A) → assign to first SKU
    const unattributed = unattributedExpensesByOrder.get(orderId);
    if (unattributed && unattributed.length > 0) {
      const firstItem = skuItemMap.get(skusInOrder[0]);
      const bucketKey = `${skusInOrder[0]}||${firstItem.pacificDate}`;
      const bucket = skuBuckets.get(bucketKey);
      applyExpensesToBucket(bucket, unattributed);
      unattributedExpensesByOrder.delete(orderId);
      orderHasAnyExpense = true;
    }

    // Unattributed Shipment revenue → assign to first SKU
    const unattribRev = unattributedRevenueByOrder.get(orderId);
    if (unattribRev && unattribRev.length > 0) {
      const firstItem = skuItemMap.get(skusInOrder[0]);
      const bucketKey = `${skusInOrder[0]}||${firstItem.pacificDate}`;
      const bucket = skuBuckets.get(bucketKey);
      applyRevenueTooBucket(bucket, unattribRev);
      unattributedRevenueByOrder.delete(orderId);
    }

    consumedOrderIds.add(orderId);

    // If no Shipment expenses found for this order → mark as pending
    if (!orderHasAnyExpense) {
      for (const [sku, item] of skuItemMap) {
      pendingOrders.push({
        User: userObjectId, country: country.toUpperCase(), region: regionModel,
          orderId, purchasePacificDate: item.pacificDate,
          asin: item.asin, sku: item.sku, salesAmount: item.totalPrice, units: item.totalUnits,
        attempts: 0, firstSeenAt: new Date(),
      });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // ★ FEE ESTIMATION FOR PENDING ORDERS
  //
  // The Finance API often lags 1-14 days behind the Sales Report for
  // Shipment fees. Sellerboard shows fees immediately because it estimates
  // them from known rate cards. We do the same:
  //
  //   1. Compute average FBA fee/unit and referral % per SKU from matched orders
  //   2. Apply those rates to pending orders
  //   3. Mark as estimated (isEstimated flag on bucket)
  //   4. Step 2 backfill replaces estimated with actual when Finance API confirms
  // ═══════════════════════════════════════════════
  if (pendingOrders.length > 0) {
    // Compute per-SKU average rates from matched orders
    const skuRates = new Map(); // sku → { totalFba, totalComm, totalSales, totalUnits }
    for (const [key, expenses] of expensesByOrderSku) {
      const [oid, sku] = key.split('||');
      if (!consumedOrderSkuKeys.has(key)) continue;
      if (!skuRates.has(sku)) skuRates.set(sku, { totalFba: 0, totalComm: 0, totalSales: 0, totalUnits: 0, orderCount: 0 });
      const rates = skuRates.get(sku);
      for (const e of expenses) {
        if (e.category === 'FBA Fulfillment Fee') rates.totalFba += e.amount;
        if (e.category === 'Referral Commission') rates.totalComm += e.amount;
      }
    }
    // Get sales and units from salesOrderMap for matched orders
    for (const [orderId, skuItemMap] of salesOrderMap) {
      if (!consumedOrderIds.has(orderId)) continue;
      for (const [sku, item] of skuItemMap) {
        const expKey = `${orderId}||${sku}`;
        if (!consumedOrderSkuKeys.has(expKey)) continue;
        if (!skuRates.has(sku)) continue;
        const rates = skuRates.get(sku);
        rates.totalSales += item.totalPrice;
        rates.totalUnits += item.totalUnits;
        rates.orderCount++;
      }
    }

    // Apply estimated rates to pending orders
    let estimatedCount = 0;
    for (const po of pendingOrders) {
      const rates = skuRates.get(po.sku);
      if (!rates || rates.totalUnits === 0 || rates.totalSales === 0) continue;

      const avgFbaPerUnit = rates.totalFba / rates.totalUnits;
      const referralPct = rates.totalComm / rates.totalSales; // negative / positive = negative %

      const estFba = Math.round(avgFbaPerUnit * po.units * 100) / 100;
      const estComm = Math.round(referralPct * po.salesAmount * 100) / 100;

      const bucketKey = `${po.sku}||${po.purchasePacificDate}`;
      if (!skuBuckets.has(bucketKey)) skuBuckets.set(bucketKey, createEmptyBucket(po.sku, po.asin, po.purchasePacificDate));
      const bucket = skuBuckets.get(bucketKey);

      bucket.fbaFulfillmentFee += estFba;
      bucket.referralCommission += estComm;
      bucket.isEstimated = true;
      bucket.estimatedOrderCount = (bucket.estimatedOrderCount || 0) + 1;
      bucket.estimatedFba = (bucket.estimatedFba || 0) + estFba;
      bucket.estimatedCommission = (bucket.estimatedCommission || 0) + estComm;
      estimatedCount++;
    }

    if (estimatedCount > 0) {
      logger.info(`[Step1] Estimated fees for ${estimatedCount} pending orders (Finance API lag). Rates derived from ${skuRates.size} SKUs.`);
      // Log sample rates for debugging
      for (const [sku, rates] of skuRates) {
        if (rates.totalUnits > 0) {
          const avgFba = (rates.totalFba / rates.totalUnits).toFixed(2);
          const refPct = ((rates.totalComm / rates.totalSales) * 100).toFixed(1);
          logger.info(`[Step1] SKU ${sku}: avgFBA/unit=$${avgFba}, referral=${refPct}% (from ${rates.orderCount} orders)`);
        }
      }
    }
  }

  // ── Finance-only Shipment expenses (not in Sales Report) → discard ──
  let discardedFinanceOnly = 0;
  for (const [key, expenses] of expensesByOrderSku) {
    if (consumedOrderSkuKeys.has(key)) continue;
    if (expenses.length === 0) continue;
    discardedFinanceOnly += expenses.length;
  }
  if (discardedFinanceOnly > 0) {
    logger.info(`[Step1] Discarded ${discardedFinanceOnly} Shipment expense rows (orders not in Sales Report).`);
  }

  // ═══════════════════════════════════════════════
  // ★ FIX: Place Refund/Reimbursement/ServiceFee expenses on POSTED DATE (Pacific)
  //
  // These transactions have an orderId but they should NOT go to the
  // original order's purchase date. Sellerboard places them on the day
  // the refund/reimbursement was processed (postedDate → Pacific).
  //
  // For REFUND transactions specifically, reversed fees (Commission,
  // Promotions) must be remapped to refund-specific fields so they
  // don't inflate the forward fee totals. Sellerboard shows them as:
  //   "Refund cost" = refundedAmount + refundCommission + refundedReferralFee + refundedPromotion
  // ═══════════════════════════════════════════════
  let postedDateExpenseCount = 0;
  for (const e of postedDateExpenses) {
    const pacificDate = toPacificDateStr(e.postedDate) || e.postedDateStr;
    if (!pacificDate) continue;
    // Only include if the date falls within our display range
    if (pacificDate < startDate || pacificDate > endDate) continue;

    const sku = (e.sku && e.sku !== 'N/A') ? e.sku : null;
    const asin = e.asin || '';

    if (sku) {
      // Per-SKU bucket on the posted date
      const bucketKey = `${sku}||${pacificDate}`;
      if (!skuBuckets.has(bucketKey)) skuBuckets.set(bucketKey, createEmptyBucket(sku, asin, pacificDate));
      const bucket = skuBuckets.get(bucketKey);
    if (!bucket.asin && asin) bucket.asin = asin;

      // ★ For Refund transactions, remap certain categories to refund-specific fields
      if (e.transactionType === 'Refund') {
        const remappedField = REFUND_CATEGORY_REMAP[e.category];
        if (remappedField) {
          bucket[remappedField] += e.amount;
        } else {
          // Non-remapped Refund expenses (RefundCommission, tax, etc.) use normal mapping
          applyExpensesToBucket(bucket, [e]);
        }
      } else {
        // Non-Refund posted-date expenses (ServiceFee, Adjustment, etc.)
        applyExpensesToBucket(bucket, [e]);
      }
      postedDateExpenseCount++;
    } else {
      // No SKU — these are account-level expenses that the Finance API does not
      // attribute to any specific ASIN. Examples:
      //   - FBADisposal: disposal fees (per-ASIN data available in FBA Removal report)
      //   - FBAStorageBilling: storage fees (per-ASIN data in FBA Monthly Storage Fee report)
      //   - FBAPostInboundTransportation: inbound shipping
      //   - ProductAdsPayment: advertising lump sum (per-ASIN in Advertising API)
      //   - Subscription: professional seller subscription
      //   - Reserve/Adjustment: account reserves
      //
      // These go to DailyOverheadFinance. For per-ASIN breakdown of storage,
      // disposal, and advertising, the seller must connect the corresponding
      // Amazon reports (FBA Storage Fee report, FBA Removal report, Advertising API).
      // Guessing the ASIN would produce inaccurate data for multi-SKU sellers.
      overheadExpenses.push(e);
    }
  }
  if (postedDateExpenseCount > 0) {
    logger.info(`[Step1] Placed ${postedDateExpenseCount} Refund/Reimbursement/ServiceFee expense rows on posted date (Pacific).`);
  }

  // ★ FIX: Same for posted-date revenue (e.g., negative Product Sales from Refund,
  // FBAInventoryReimbursement amounts)
  let postedDateRevenueCount = 0;
  let postedDateRevenueSkipped = 0;
  for (const r of postedDateRevenue) {
    const pacificDate = toPacificDateStr(r.postedDate) || r.postedDateStr;
    if (!pacificDate) continue;
    if (pacificDate < startDate || pacificDate > endDate) {
      postedDateRevenueSkipped++;
      continue;
    }

    const sku = (r.sku && r.sku !== 'N/A') ? r.sku : null;
    const asin = r.asin || '';

    if (sku) {
      const bucketKey = `${sku}||${pacificDate}`;
      if (!skuBuckets.has(bucketKey)) skuBuckets.set(bucketKey, createEmptyBucket(sku, asin, pacificDate));
      const bucket = skuBuckets.get(bucketKey);
      if (!bucket.asin && asin) bucket.asin = asin;

      // ★ For Refund transactions, "Product Sales" is negative (money returned to buyer)
      // → goes to refundedAmount field, NOT productSales
      if (r.transactionType === 'Refund' && r.category === 'Product Sales') {
        bucket.refundedAmount += r.amount;
      } else {
        // FBAInventoryReimbursement, Shipping Revenue, etc.
        const fieldBefore = bucket.fbaInventoryReimbursement;
        applyRevenueTooBucket(bucket, [r]);
        const fieldAfter = bucket.fbaInventoryReimbursement;
        // ★ DEBUG: Log every reimbursement placement
        if (r.category === 'FBA Inventory Reimbursement') {
          logger.info(`[REIMB-DEBUG] ${pacificDate} ${r.sku}: category='${r.category}' amt=${r.amount} txnType=${r.transactionType} field before=${fieldBefore} after=${fieldAfter}`);
        }
      }
      postedDateRevenueCount++;
    } else {
      overheadRevenue.push(r);
    }
  }
  if (postedDateRevenueCount > 0) {
    logger.info(`[Step1] Placed ${postedDateRevenueCount} Refund/Reimbursement revenue rows on posted date (Pacific). Skipped ${postedDateRevenueSkipped} outside range. postedDateRevenue array size: ${postedDateRevenue.length}`);
  } else {
    logger.info(`[Step1] postedDateRevenue: ${postedDateRevenue.length} rows total, ${postedDateRevenueSkipped} skipped (outside ${startDate}→${endDate}), 0 placed.`);
  }

  // Compute totals for all buckets
  for (const bucket of skuBuckets.values()) computeBucketTotals(bucket);

  // ★ DEBUG: Log buckets with non-zero fbaInventoryReimbursement
  for (const bucket of skuBuckets.values()) {
    if (bucket.fbaInventoryReimbursement !== 0) {
      logger.info(`[REIMB-BUCKET] ${bucket.date} ${bucket.sku}: fbaInventoryReimbursement=${bucket.fbaInventoryReimbursement} totalRevenue=${bucket.totalRevenue}`);
    }
  }

  // ── Diagnostics ──
  let diagFbaTotal = 0;
  const diagFbaByDate = {};
  const diagCommByDate = {};
  const diagRefundByDate = {};
  for (const bucket of skuBuckets.values()) {
    diagFbaTotal += bucket.fbaFulfillmentFee || 0;
    if (!diagFbaByDate[bucket.date]) { diagFbaByDate[bucket.date] = 0; diagCommByDate[bucket.date] = 0; diagRefundByDate[bucket.date] = 0; }
    diagFbaByDate[bucket.date] += bucket.fbaFulfillmentFee || 0;
    diagCommByDate[bucket.date] += bucket.referralCommission || 0;
    diagRefundByDate[bucket.date] += (bucket.refundedAmount || 0) + (bucket.refundCommission || 0) + (bucket.refundedReferralFee || 0) + (bucket.refundedPromotion || 0);
  }
  logger.info(`[DIAG] Total FBA Fulfillment across ${skuBuckets.size} SKU buckets: $${Math.round(diagFbaTotal * 100) / 100}`);
  logger.info(`[DIAG] Finance API returned ${expenseRows.length} expense rows total`);
  // Per-date breakdown for verification against Sellerboard
  const diagDates = Object.keys(diagFbaByDate).sort();
  for (const d of diagDates) {
    logger.info(`[DIAG] ${d}: FBA=${diagFbaByDate[d].toFixed(2)} Comm=${diagCommByDate[d].toFixed(2)} RefundCost=${diagRefundByDate[d].toFixed(2)}`);
  }

  // Build overhead
  const overheadBuckets = buildOverheadBuckets(overheadExpenses, overheadRevenue, startDate, endDate);

  // ── Persist ──
  const allDates = new Set();
  for (const b of skuBuckets.values()) allDates.add(b.date);
  for (const b of overheadBuckets.values()) allDates.add(b.date);
  const d = new Date(`${startDate}T00:00:00.000Z`);
  const endD = new Date(`${endDate}T00:00:00.000Z`);
  while (d <= endD) { allDates.add(formatDateUTC(d)); d.setUTCDate(d.getUTCDate() + 1); }

  const saved = await persistDailyBuckets({ userId, country: country.toUpperCase(), regionModel, marketplaceId, skuBuckets, overheadBuckets, datesToClear: [...allDates] });

  // ── ★ FIX: Clear previously-pending orders that were resolved in this sync ──
  // Without this, Step 2 (backfillPendingExpenses) would find these same orders
  // still in PendingExpenseOrder, fetch their Finance API data AGAIN, and ADD
  // the fees on top of what Step 1 already wrote — causing double-counting.
  if (consumedOrderIds.size > 0) {
    const resolvedResult = await PendingExpenseOrder.deleteMany({
      User: userObjectId, country: country.toUpperCase(), region: regionModel,
      orderId: { $in: [...consumedOrderIds] },
    });
    if (resolvedResult.deletedCount > 0) {
      logger.info(`[Step1] Cleared ${resolvedResult.deletedCount} previously-pending orders now resolved.`);
    }
  }

  // ── Save NEW pending orders (only those with NO expenses found) ──
  // Unique index is (User, country, region, orderId) — one row per order.
  // Multiple SKUs in the same order are stored as the first SKU seen;
  // the backfill (Step 2) resolves all SKUs for the order anyway.
  if (pendingOrders.length > 0) {
    const pendingByKey = new Map();
    for (const po of pendingOrders) {
      const orderKey = po.orderId;
      // Keep the first SKU seen for this orderId (dedup by orderId, not orderId+sku)
      if (!pendingByKey.has(orderKey)) {
        pendingByKey.set(orderKey, { ...po, sku: po.sku || 'N/A' });
      }
    }
    for (const po of pendingByKey.values()) {
      await PendingExpenseOrder.findOneAndUpdate(
        { User: po.User, country: po.country, region: po.region, orderId: po.orderId },
        po,
        { upsert: true, new: true }
      );
    }
    logger.info(`[Step1] Saved ${pendingByKey.size} pending expense orders.`);
  }

  // ── Log sync ──
  const dateList = [];
  const dd = new Date(`${startDate}T00:00:00.000Z`);
  while (dd <= endD) { dateList.push(formatDateUTC(dd)); dd.setUTCDate(dd.getUTCDate() + 1); }
  for (const dateStr of dateList) {
    await FinanceSyncLog.findOneAndUpdate(
      { User: userObjectId, country: country.toUpperCase(), region: regionModel, date: dateStr },
      { User: userObjectId, country: country.toUpperCase(), region: regionModel, marketplaceId, date: dateStr, fetchedAt: new Date(), status: 'success', expenseRowCount: expenseRows.length, revenueRowCount: revenueRows.length, skuCount: skuBuckets.size, error: '' },
      { upsert: true, new: true }
    );
  }

  logger.info(`[Step1] Done. ${saved.skuDocCount} SKU docs. ${pendingOrders.length} pending.`);
  return { salesOrders: salesOrderMap.size, skuDocs: saved.skuDocCount, overheadDocs: saved.overheadDocCount, pendingOrders: pendingOrders.length, token: tokenManager.token, tokenManager, marketplaceId, baseUrl };
}

// ═══════════════════════════════════════════════
// STEP 2: BACKFILL PENDING EXPENSES
//
// ★ FIX: Only backfills SHIPMENT expenses (purchase-date type).
// Refunds/Reimbursements are already handled in Step 1 via
// posted-date placement and don't need order-ID-based backfill.
// ═══════════════════════════════════════════════
async function backfillPendingExpenses({ userId, country, regionModel, accessToken, refreshToken, clientId, clientSecret, tokenManager: inheritedTokenManager }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const regionInternal = internalRegionFromModel(regionModel);

  const pendingOrders = await PendingExpenseOrder.find({
    User: userObjectId, country: country.toUpperCase(), region: regionModel,
  }).lean();

  if (pendingOrders.length === 0) {
    logger.info('[Step2] No pending expense orders. Skipping backfill.');
    return { resolved: 0, stillPending: 0, expired: 0, token: accessToken, tokenManager: inheritedTokenManager };
  }

  logger.info(`[Step2] Backfilling ${pendingOrders.length} pending orders...`);

  const pendingDates = pendingOrders.map((p) => p.purchasePacificDate).sort();
  const earliestPurchase = pendingDates[0];

  const buffer = SETTLEMENT_LAG[regionModel] || SETTLEMENT_LAG.NA;
  const finStart = new Date(`${earliestPurchase}T00:00:00.000Z`);
  finStart.setUTCDate(finStart.getUTCDate() - buffer.beforeDays);
  const finEnd = new Date(Date.now() - 3 * 60 * 1000);

  const tokenManager = inheritedTokenManager || createTokenManager({ accessToken, refreshToken, clientId, clientSecret });

  logger.info(`[Step2] Finance API: ${finStart.toISOString()} → ${finEnd.toISOString()}`);
  const fetchResult = await tokenManager.withRetry((token) => fetchNewFinanceData({
    refreshToken, accessToken: token, clientId, clientSecret,
    country: country.toUpperCase(), region: regionInternal,
    postedAfter: finStart.toISOString(), postedBefore: finEnd.toISOString(),
    tokenRefresher: () => tokenManager.refresh(),
  }));

  const expenseRows = fetchResult.expenseRows || [];
  const revenueRows = fetchResult.revenueRows || [];

  // ★ FIX: Use updated indexer that separates by transaction type
  const { expensesByOrderSku, unattributedExpensesByOrder, revenueByOrderSku, unattributedRevenueByOrder } = indexFinanceRowsByOrderId(expenseRows, revenueRows);

  let resolved = 0, stillPending = 0, expired = 0;
  const resolvedOrderIds = [];
  const datesToUpdate = new Map();

  const now = new Date();

  for (const pending of pendingOrders) {
    const ageMs = now.getTime() - new Date(pending.firstSeenAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays > MAX_PENDING_AGE_DAYS) {
      expired++;
      resolvedOrderIds.push(pending.orderId);
      continue;
    }

    const sku = pending.sku || 'N/A';
    const expKey = `${pending.orderId}||${sku}`;
    // ★ Only looks at Shipment-type expenses (purchase-date rows)
    const skuExpenses = expensesByOrderSku.get(expKey);
    const unattribExpenses = unattributedExpensesByOrder.get(pending.orderId);
    const hasExpenses = (skuExpenses && skuExpenses.length > 0) || (unattribExpenses && unattribExpenses.length > 0);

    if (hasExpenses) {
      const dateKey = pending.purchasePacificDate;
      if (!datesToUpdate.has(dateKey)) datesToUpdate.set(dateKey, new Map());
      const skuMap = datesToUpdate.get(dateKey);
      if (!skuMap.has(sku)) skuMap.set(sku, { expenses: [], revenues: [] });
      if (skuExpenses) skuMap.get(sku).expenses.push(...skuExpenses);
      if (unattribExpenses) {
        skuMap.get(sku).expenses.push(...unattribExpenses);
        unattributedExpensesByOrder.delete(pending.orderId);
      }

      const revKey = `${pending.orderId}||${sku}`;
      const skuRevenue = revenueByOrderSku.get(revKey);
      if (skuRevenue) skuMap.get(sku).revenues.push(...skuRevenue);
      const unattribRevenue = unattributedRevenueByOrder.get(pending.orderId);
      if (unattribRevenue) {
        skuMap.get(sku).revenues.push(...unattribRevenue);
        unattributedRevenueByOrder.delete(pending.orderId);
      }

      resolved++;
      resolvedOrderIds.push(pending.orderId);
    } else {
      stillPending++;
      await PendingExpenseOrder.updateOne(
        { _id: pending._id },
        { $inc: { attempts: 1 } }
      );
    }
  }

  // ── Update DailySkuFinance for resolved orders ──
  // When Step 1 estimated fees for pending orders, the exact estimated amounts
  // are stored in estimatedFba/estimatedCommission. We subtract those precise
  // values and add actual fees from the Finance API. No rate recalculation needed.

  for (const [dateKey, skuMap] of datesToUpdate) {
    for (const [sku, { expenses, revenues }] of skuMap) {
      const existing = await DailySkuFinance.findOne({
        User: userObjectId, country: country.toUpperCase(), region: regionModel,
        sku, date: dateKey,
      });

      if (!existing) {
        logger.warn(`[Step2] No DailySkuFinance found for ${sku} on ${dateKey}. Skipping.`);
        continue;
      }

      const update = {};

      // Reverse stored estimates (precise, no rounding drift)
      if (existing.isEstimated && existing.estimatedFba) {
        update.fbaFulfillmentFee = (existing.fbaFulfillmentFee || 0) - (existing.estimatedFba || 0);
        update.referralCommission = (existing.referralCommission || 0) - (existing.estimatedCommission || 0);
        update.isEstimated = false;
        update.estimatedOrderCount = 0;
        update.estimatedFba = 0;
        update.estimatedCommission = 0;
        logger.info(`[Step2] Reversed estimates for ${sku} on ${dateKey}: FBA=${existing.estimatedFba}, Comm=${existing.estimatedCommission}`);
      }

      // Add actual fees from Finance API
      for (const e of expenses) {
        const field = EXPENSE_CATEGORY_TO_FIELD[e.category];
        if (field) {
          update[field] = (update[field] ?? existing[field] ?? 0) + e.amount;
        } else {
          update.otherExpenses = (update.otherExpenses ?? existing.otherExpenses ?? 0) + e.amount;
        }
      }

      for (const r of revenues) {
        const field = REVENUE_CATEGORY_TO_FIELD[r.category];
        if (field) {
          update[field] = (update[field] || existing[field] || 0) + r.amount;
        }
      }

      const merged = { ...existing.toObject(), ...update };
      update.totalRevenue = Math.round((merged.productSales + (merged.shippingRevenue || 0) + (merged.giftWrapRevenue || 0) + (merged.fbaInventoryReimbursement || 0)) * 100) / 100;
      update.totalExpenses = Math.round(((merged.fbaFulfillmentFee || 0) + (merged.referralCommission || 0) + (merged.closingFee || 0) + (merged.technologyFee || 0) + (merged.shippingChargeback || 0) + (merged.giftWrapChargeback || 0) + (merged.refundCommission || 0) + (merged.refundedAmount || 0) + (merged.refundedReferralFee || 0) + (merged.refundedPromotion || 0) + (merged.restockingFee || 0) + (merged.promotionsDiscount || 0) + (merged.shippingDiscount || 0) + (merged.taxDiscount || 0) + (merged.shippingTaxDiscount || 0) + (merged.fbaReversedReimbursement || 0) + (merged.fbaDisposalFee || 0) + (merged.otherExpenses || 0)) * 100) / 100;
      update.totalTax = Math.round(((merged.salesTaxCollected || 0) + (merged.shippingTaxCollected || 0) + (merged.giftWrapTaxCollected || 0) + (merged.marketplaceFacilitatorTax || 0) + (merged.tdsDeducted || 0) + (merged.tcsCollected || 0)) * 100) / 100;
      update.netAmount = Math.round((update.totalRevenue + update.totalExpenses + update.totalTax) * 100) / 100;

      await DailySkuFinance.updateOne({ _id: existing._id }, { $set: update });
    }
  }

  // ── Remove resolved and expired pending orders ──
  if (resolvedOrderIds.length > 0) {
    await PendingExpenseOrder.deleteMany({
      User: userObjectId, country: country.toUpperCase(), region: regionModel,
      orderId: { $in: resolvedOrderIds },
    });
  }

  logger.info(`[Step2] Done. Resolved: ${resolved}, Still pending: ${stillPending}, Expired: ${expired}`);
  return { resolved, stillPending, expired, token: tokenManager.token, tokenManager };
}

// ═══════════════════════════════════════════════
// MAIN: SYNC FINANCE DATA
// ═══════════════════════════════════════════════
async function syncFinanceData({ userId, country, regionModel, refreshToken, accessToken, clientId = process.env.SPAPI_CLIENT_ID, clientSecret = process.env.SPAPI_CLIENT_SECRET, backfillDays = 30, forceDates = null, maxIncrementalDays = null }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  // One token manager for the whole sync — step1/step2/relationships share
  // a single lifetime, so a mid-sync refresh in any phase is visible to the
  // next phase without re-issuing tokens.
  const tokenManager = createTokenManager({ accessToken, refreshToken, clientId, clientSecret });

  const now = new Date();
  const yesterdayPacificMs = now.getTime() - (PACIFIC_OFFSET_HOURS * 60 * 60 * 1000) - (24 * 60 * 60 * 1000);
  const yesterdayStr = new Date(yesterdayPacificMs).toISOString().substring(0, 10);

  let startDate, endDate;

  if (forceDates && forceDates.length === 2) {
    [startDate, endDate] = forceDates;
    logger.info(`[Sync] Force: ${startDate} → ${endDate}`);
  } else {
    const latestSync = await FinanceSyncLog.findOne({ User: userObjectId, country: country.toUpperCase(), region: regionModel, status: 'success' }).sort({ date: -1 }).lean();
    if (!latestSync) {
      const backfillStart = new Date(yesterdayPacificMs - ((backfillDays - 1) * 24 * 60 * 60 * 1000));
      startDate = backfillStart.toISOString().substring(0, 10);
      endDate = yesterdayStr;
      logger.info(`[Sync] Backfill ${backfillDays} days: ${startDate} → ${endDate}`);
    } else if (latestSync.date >= yesterdayStr) {
      logger.info(`[Sync] Up to date (latest: ${latestSync.date}). Running backfill only.`);
      const step2 = await backfillPendingExpenses({ userId, country, regionModel, accessToken, refreshToken, clientId, clientSecret, tokenManager });
      await syncRelationshipsIfNeeded({ userId, country, regionModel, startDate: latestSync.date, endDate: latestSync.date, accessToken: tokenManager.token, refreshToken, clientId, clientSecret });
      return { status: 'up_to_date', latestDate: latestSync.date, backfill: step2 };
    } else {
      const nextDay = new Date(latestSync.date + 'T00:00:00.000Z');
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      startDate = formatDateUTC(nextDay);
      endDate = yesterdayStr;
      // Soft cap so a long-broken account can't drag a 60-day fetch into the
      // daily window. The remaining days will be picked up by the freshness
      // sweeper (or by subsequent daily runs, advancing one window at a time).
      if (maxIncrementalDays && maxIncrementalDays > 0) {
        const gapDays = Math.round((new Date(`${endDate}T00:00:00.000Z`) - new Date(`${startDate}T00:00:00.000Z`)) / 86400000) + 1;
        if (gapDays > maxIncrementalDays) {
          const clampedStart = new Date(`${endDate}T00:00:00.000Z`);
          clampedStart.setUTCDate(clampedStart.getUTCDate() - (maxIncrementalDays - 1));
          const clampedStartStr = formatDateUTC(clampedStart);
          logger.warn(`[Sync] Incremental gap ${gapDays}d exceeds maxIncrementalDays=${maxIncrementalDays}; clamping ${startDate} → ${clampedStartStr}. Remaining ${gapDays - maxIncrementalDays}d will sync on later runs.`);
          startDate = clampedStartStr;
        }
      }
      logger.info(`[Sync] Incremental: ${startDate} → ${endDate}`);
    }
  }

  const step1 = await fetchNewSalesAndExpenses({ userId, country, regionModel, startDate, endDate, accessToken, refreshToken, clientId, clientSecret, tokenManager });
  const step2 = await backfillPendingExpenses({ userId, country, regionModel, accessToken: tokenManager.token, refreshToken, clientId, clientSecret, tokenManager });
  await syncRelationshipsIfNeeded({ userId, country, regionModel, startDate, endDate, accessToken: tokenManager.token, refreshToken, clientId, clientSecret });

  return {
    status: 'completed', startDate, endDate,
    step1: { salesOrders: step1.salesOrders, skuDocs: step1.skuDocs, overheadDocs: step1.overheadDocs, pendingOrders: step1.pendingOrders },
    step2: { resolved: step2.resolved, stillPending: step2.stillPending, expired: step2.expired },
  };
}

async function syncRelationshipsIfNeeded({ userId, country, regionModel, startDate, endDate, accessToken, refreshToken, clientId, clientSecret }) {
  try {
    const { syncAsinRelationships } = require('./AsinRelationshipService.js');
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const recentAsins = await DailySkuFinance.distinct('asin', { User: userObjectId, country: country.toUpperCase(), region: regionModel, date: { $gte: startDate, $lte: endDate }, asin: { $ne: '' } });
    if (recentAsins.length > 0) {
      logger.info(`[Sync] Syncing relationships for ${recentAsins.length} ASINs...`);
      await syncAsinRelationships({ userId, country, regionModel, asins: recentAsins, accessToken, refreshToken, clientId, clientSecret });
    }
  } catch (err) {
    logger.error(`[Sync] Relationship sync failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════
// QUERY: Sync status
// ═══════════════════════════════════════════════
async function getSyncStatus({ userId, country, regionModel }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const match = { User: userObjectId, country: country.toUpperCase(), region: regionModel };

  const [syncResult] = await FinanceSyncLog.aggregate([
    { $match: { ...match, status: 'success' } },
    { $group: { _id: null, latestDate: { $max: '$date' }, earliestDate: { $min: '$date' }, totalSyncedDays: { $sum: 1 } } },
    { $project: { _id: 0 } },
  ]);

  const pendingCount = await PendingExpenseOrder.countDocuments(match);

  return {
    latestDate: syncResult?.latestDate || null,
    earliestDate: syncResult?.earliestDate || null,
    totalSyncedDays: syncResult?.totalSyncedDays || 0,
    pendingExpenseOrders: pendingCount,
  };
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  syncFinanceData,
  fetchNewSalesAndExpenses,
  backfillPendingExpenses,
  getSyncStatus,
  // Helpers for testing
  parseSalesReportRows,
  toPacificDateStr,
  indexFinanceRowsByOrderId,
  buildOverheadBuckets,
  EXPENSE_CATEGORY_TO_FIELD,
  REVENUE_CATEGORY_TO_FIELD,
  // Token auto-renewal helpers
  createTokenManager,
  isAccessTokenExpiredError,
};
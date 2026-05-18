const mongoose = require('mongoose');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const logger = require('../../utils/Logger.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const FinanceDashboardReadService = require('../../Services/Finance/FinanceDashboardReadService.js');

const DailySkuFinance = require('../../models/finance/DailySkuFinanceModel.js');
const DailyOverheadFinance = require('../../models/finance/DailyOverheadFinanceModel.js');
const FinanceSyncLog = require('../../models/finance/FinanceSyncLogModel.js');
const PendingExpenseOrder = require('../../models/finance/PendingExpenseOrderModel.js');
const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');

const {
  fetchNewFinanceData,
  parseTransactionsV2024,
  extractRevenueFromTransactions,
  getAccessToken,
  resolveMarketplaceAndRegion,
} = require('../../Services/Sp_API/Expences.js');

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const CHUNK_INSERT_SIZE = 500;
const REPORT_TYPE = 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL';
const POLL_INTERVAL_MS = 15000;
const MAX_POLL_ATTEMPTS = 40;
const PACIFIC_OFFSET_HOURS = 7;

// Settlement lag buffer by region.
// BEFORE: days before sales start to fetch Finance API (catches boundary fees).
// AFTER: not used for "after sales end" anymore — instead we fetch up to TODAY.
const SETTLEMENT_LAG = {
  NA: { beforeDays: 5 },
  EU: { beforeDays: 10 },
  FE: { beforeDays: 5 },
};

// Max age for pending orders — stop trying after this many days
const MAX_PENDING_AGE_DAYS = 45;

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
// ═══════════════════════════════════════════════
async function createReport(accessToken, baseUrl, marketplaceId, startDate, endDate) {
  const postData = JSON.stringify({ reportType: REPORT_TYPE, marketplaceIds: [marketplaceId], dataStartTime: startDate, dataEndTime: endDate });
  const res = await httpsRequest({ hostname: baseUrl, path: '/reports/2021-06-30/reports', method: 'POST', headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } }, postData);
  if (res.body.errors) throw new Error(`createReport failed: ${JSON.stringify(res.body.errors)}`);
  return res.body.reportId;
}

async function pollReportStatus(accessToken, baseUrl, reportId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const res = await httpsRequest({ hostname: baseUrl, path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`, method: 'GET', headers: { 'x-amz-access-token': accessToken } });
    if (res.body.errors) throw new Error(`getReport failed: ${JSON.stringify(res.body.errors)}`);
    const status = res.body.processingStatus;
    logger.info(`[Report] Poll #${attempt}: status = ${status}`);
    if (status === 'DONE') return res.body.reportDocumentId;
    if (status === 'CANCELLED' || status === 'FATAL') throw new Error(`Report failed: ${status}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Report did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

async function getReportDocumentUrl(accessToken, baseUrl, reportDocumentId) {
  const res = await httpsRequest({ hostname: baseUrl, path: `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`, method: 'GET', headers: { 'x-amz-access-token': accessToken } });
  if (res.body.errors) throw new Error(`getReportDocument failed: ${JSON.stringify(res.body.errors)}`);
  return res.body;
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

async function fetchSalesReport(accessToken, baseUrl, marketplaceId, startDate, endDate) {
  logger.info(`[SalesReport] Requesting: ${startDate} → ${endDate}`);
  const reportId = await createReport(accessToken, baseUrl, marketplaceId, startDate, endDate);
  const reportDocumentId = await pollReportStatus(accessToken, baseUrl, reportId);
  const docInfo = await getReportDocumentUrl(accessToken, baseUrl, reportDocumentId);
  const rawData = await downloadContent(docInfo.url, docInfo.compressionAlgorithm === 'GZIP');
  const rows = parseTsv(rawData);
  logger.info(`[SalesReport] Parsed ${rows.length} rows`);
  return rows;
}

function parseSalesReportRows(reportRows) {
  // Returns Map<orderId, Map<sku, orderItem>>
  // Each orderItem: { orderId, sku, asin, pacificDate, totalPrice, totalUnits }
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
      skuMap.set(sku, { orderId, sku, asin: row['asin'] || '', pacificDate, currency: row['currency'] || '', totalPrice: 0, totalUnits: 0 });
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
  'FBA Disposal Fee': 'fbaDisposalFee',
};

const REVENUE_CATEGORY_TO_FIELD = {
  'Shipping Revenue': 'shippingRevenue', 'Gift Wrap Revenue': 'giftWrapRevenue',
  'FBA Inventory Reimbursement': 'fbaInventoryReimbursement',
};

const OVERHEAD_CATEGORIES = new Set([
  'FBA Storage Fee', 'FBA Inbound Transportation Fee', 'FBA Removal Fee',
  'TaxWithholding', 'Subscription Fee', 'FBA Capacity Reservation Fee', 'Advertising / PPC',
  'Disbursement', 'Seller Reward', 'SAFE-T Reimbursement',
  'SERRAC Reimbursement', 'Reimbursement', 'Fulfillment Fee Refund',
]);

// ═══════════════════════════════════════════════
// INDEX FINANCE API ROWS BY ORDER+SKU
// ═══════════════════════════════════════════════
function indexFinanceRowsByOrderId(expenseRows, revenueRows) {
  // expensesByOrderSku: Map<"orderId||sku", expense[]>  — SKU-level match
  // unattributedExpensesByOrder: Map<orderId, expense[]> — order-level expenses with no SKU
  const expensesByOrderSku = new Map();
  const unattributedExpensesByOrder = new Map();
  const overheadExpenses = [];

  for (const e of expenseRows) {
    if (!e.orderId) {
      overheadExpenses.push(e);
      continue;
    }
    const sku = e.sku || 'N/A';
    if (sku === 'N/A') {
      if (!unattributedExpensesByOrder.has(e.orderId)) unattributedExpensesByOrder.set(e.orderId, []);
      unattributedExpensesByOrder.get(e.orderId).push(e);
    } else {
      const key = `${e.orderId}||${sku}`;
      if (!expensesByOrderSku.has(key)) expensesByOrderSku.set(key, []);
      expensesByOrderSku.get(key).push(e);
    }
  }

  const revenueByOrderSku = new Map();
  const unattributedRevenueByOrder = new Map();
  const overheadRevenue = [];

  for (const r of revenueRows) {
    if (r.category === 'Product Sales') continue;
    if (!r.orderId) {
      overheadRevenue.push(r);
      continue;
    }
    const sku = r.sku || 'N/A';
    if (sku === 'N/A') {
      if (!unattributedRevenueByOrder.has(r.orderId)) unattributedRevenueByOrder.set(r.orderId, []);
      unattributedRevenueByOrder.get(r.orderId).push(r);
    } else {
      const key = `${r.orderId}||${sku}`;
      if (!revenueByOrderSku.has(key)) revenueByOrderSku.set(key, []);
      revenueByOrderSku.get(key).push(r);
    }
  }

  return { expensesByOrderSku, unattributedExpensesByOrder, revenueByOrderSku, unattributedRevenueByOrder, overheadExpenses, overheadRevenue };
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
  bucket.totalExpenses = Math.round((bucket.fbaFulfillmentFee + bucket.referralCommission + bucket.closingFee + bucket.technologyFee + bucket.shippingChargeback + bucket.giftWrapChargeback + bucket.refundCommission + bucket.promotionsDiscount + bucket.shippingDiscount + bucket.taxDiscount + bucket.shippingTaxDiscount + bucket.fbaReversedReimbursement + bucket.fbaDisposalFee + bucket.otherExpenses) * 100) / 100;
  // Tax: salesTaxCollected (+) and marketplaceFacilitatorTax (-) cancel out to ~$0
  // Both are pass-through — seller doesn't keep or pay this money
  bucket.totalTax = Math.round((bucket.salesTaxCollected + bucket.shippingTaxCollected + bucket.giftWrapTaxCollected + bucket.marketplaceFacilitatorTax + bucket.tdsDeducted + bucket.tcsCollected) * 100) / 100;
  bucket.netAmount = Math.round((bucket.totalRevenue + bucket.totalExpenses + bucket.totalTax) * 100) / 100;
  for (const key of Object.keys(bucket)) { if (typeof bucket[key] === 'number') bucket[key] = Math.round(bucket[key] * 100) / 100; }
}

function createEmptyBucket(sku, asin, date) {
  return {
    sku, asin, date,
    productSales: 0, shippingRevenue: 0, giftWrapRevenue: 0, fbaInventoryReimbursement: 0,
    units: 0, orderCount: 0,
    fbaFulfillmentFee: 0, referralCommission: 0, closingFee: 0, technologyFee: 0,
    shippingChargeback: 0, giftWrapChargeback: 0, refundCommission: 0,
    promotionsDiscount: 0, shippingDiscount: 0, taxDiscount: 0, shippingTaxDiscount: 0,
    salesTaxCollected: 0, shippingTaxCollected: 0, giftWrapTaxCollected: 0,
    marketplaceFacilitatorTax: 0,
    tdsDeducted: 0, tcsCollected: 0,
    fbaReversedReimbursement: 0, fbaDisposalFee: 0,
    otherExpenses: 0, otherExpensesMap: {},
    totalRevenue: 0, totalExpenses: 0, totalTax: 0, netAmount: 0,
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
    if (rangeStart && rangeEnd && (date < rangeStart || date > rangeEnd)) continue;
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
      date: bucket.date, sku: bucket.sku, asin: bucket.asin,
      productSales: bucket.productSales, shippingRevenue: bucket.shippingRevenue, giftWrapRevenue: bucket.giftWrapRevenue, fbaInventoryReimbursement: bucket.fbaInventoryReimbursement,
      units: bucket.units, orderCount: bucket.orderCount,
      fbaFulfillmentFee: bucket.fbaFulfillmentFee, referralCommission: bucket.referralCommission, closingFee: bucket.closingFee, technologyFee: bucket.technologyFee,
      shippingChargeback: bucket.shippingChargeback, giftWrapChargeback: bucket.giftWrapChargeback, refundCommission: bucket.refundCommission,
      promotionsDiscount: bucket.promotionsDiscount, shippingDiscount: bucket.shippingDiscount, taxDiscount: bucket.taxDiscount, shippingTaxDiscount: bucket.shippingTaxDiscount,
      salesTaxCollected: bucket.salesTaxCollected, shippingTaxCollected: bucket.shippingTaxCollected, giftWrapTaxCollected: bucket.giftWrapTaxCollected,
      marketplaceFacilitatorTax: bucket.marketplaceFacilitatorTax,
      tdsDeducted: bucket.tdsDeducted, tcsCollected: bucket.tcsCollected,
      fbaReversedReimbursement: bucket.fbaReversedReimbursement, fbaDisposalFee: bucket.fbaDisposalFee,
      otherExpenses: bucket.otherExpenses, otherExpensesBreakdown: otherBreakdown,
      totalRevenue: bucket.totalRevenue, totalExpenses: bucket.totalExpenses, totalTax: bucket.totalTax, netAmount: bucket.netAmount,
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
// Fetches Sales Report for the date range.
// Fetches Finance API from (startDate - beforeBuffer) to TODAY.
// Joins by order ID.
// Pending orders saved to PendingExpenseOrder.
// ═══════════════════════════════════════════════
async function fetchNewSalesAndExpenses({ userId, country, regionModel, startDate, endDate, accessToken, refreshToken, clientId, clientSecret }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const regionInternal = internalRegionFromModel(regionModel);
  const { baseUrl, marketplaceId } = resolveMarketplaceAndRegion(country.toUpperCase(), regionInternal);

  let token = accessToken;
  if (!token) token = await getAccessToken(clientId, clientSecret, refreshToken);

  // ── Sales Report (Pacific Time boundaries) ──
  const salesStartISO = `${startDate}T${String(PACIFIC_OFFSET_HOURS).padStart(2, '0')}:00:00.000Z`;
  const endDateObj = new Date(`${endDate}T00:00:00.000Z`);
  endDateObj.setUTCDate(endDateObj.getUTCDate() + 1);
  const salesEndISO = `${formatDateUTC(endDateObj)}T${String(PACIFIC_OFFSET_HOURS - 1).padStart(2, '0')}:59:59.999Z`;

  logger.info(`[Step1] Sales Report: ${startDate} → ${endDate} (Pacific)`);
  const reportRows = await fetchSalesReport(token, baseUrl, marketplaceId, salesStartISO, salesEndISO);
  const salesOrderMap = parseSalesReportRows(reportRows);

  // ── Finance API: (startDate - buffer) → TODAY ──
  const buffer = SETTLEMENT_LAG[regionModel] || SETTLEMENT_LAG.NA;
  const finStart = new Date(`${startDate}T00:00:00.000Z`);
  finStart.setUTCDate(finStart.getUTCDate() - buffer.beforeDays);
  const finEnd = new Date(Date.now() - 3 * 60 * 1000); // 3 min before now (API requires ≥ 2 min buffer)

  logger.info(`[Step1] Finance API: ${finStart.toISOString()} → ${finEnd.toISOString()}`);
  const fetchResult = await fetchNewFinanceData({
    refreshToken, accessToken: token, clientId, clientSecret,
    country: country.toUpperCase(), region: regionInternal,
    postedAfter: finStart.toISOString(), postedBefore: finEnd.toISOString(),
  });

  const expenseRows = fetchResult.expenseRows || [];
  const revenueRows = fetchResult.revenueRows || [];

  // ── Index Finance API rows by order+SKU ──
  const { expensesByOrderSku, unattributedExpensesByOrder, revenueByOrderSku, unattributedRevenueByOrder, overheadExpenses, overheadRevenue } = indexFinanceRowsByOrderId(expenseRows, revenueRows);

  // Track which order+sku keys have been consumed so leftovers can be detected
  const consumedOrderSkuKeys = new Set();
  const consumedOrderIds = new Set();

  // ── Build SKU buckets from Sales Report + Finance API ──
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

      // Sales from Sales Report
      bucket.productSales += item.totalPrice;
      bucket.units += item.totalUnits;
      bucket.orderCount++;

      // Expenses matched by order+sku
      const expKey = `${orderId}||${sku}`;
      const skuExpenses = expensesByOrderSku.get(expKey);
      if (skuExpenses) {
        applyExpensesToBucket(bucket, skuExpenses);
        consumedOrderSkuKeys.add(expKey);
        orderHasAnyExpense = true;
      }

      // Revenue matched by order+sku
      const revKey = `${orderId}||${sku}`;
      const skuRevenue = revenueByOrderSku.get(revKey);
      if (skuRevenue) {
        applyRevenueTooBucket(bucket, skuRevenue);
        consumedOrderSkuKeys.add(revKey);
      }
    }

    // Unattributed expenses (sku=N/A) for this order → assign to first SKU in order
    const unattributed = unattributedExpensesByOrder.get(orderId);
    if (unattributed && unattributed.length > 0) {
      const firstItem = skuItemMap.get(skusInOrder[0]);
      const bucketKey = `${skusInOrder[0]}||${firstItem.pacificDate}`;
      const bucket = skuBuckets.get(bucketKey);
      applyExpensesToBucket(bucket, unattributed);
      unattributedExpensesByOrder.delete(orderId);
      orderHasAnyExpense = true;
    }

    // Unattributed revenue for this order → assign to first SKU
    const unattribRev = unattributedRevenueByOrder.get(orderId);
    if (unattribRev && unattribRev.length > 0) {
      const firstItem = skuItemMap.get(skusInOrder[0]);
      const bucketKey = `${skusInOrder[0]}||${firstItem.pacificDate}`;
      const bucket = skuBuckets.get(bucketKey);
      applyRevenueTooBucket(bucket, unattribRev);
      unattributedRevenueByOrder.delete(orderId);
    }

    consumedOrderIds.add(orderId);

    // If no expenses found for ANY sku in this order → pending per-item
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

  // ── Finance-only expenses (prior period, no matching sales order) ──
  // These are expenses for orders NOT in our Sales Report. They inflate
  // per-SKU totals because they belong to a different period's orders.
  // Discard them — only orders in the Sales Report get SKU buckets.
  // (Sellerboard and other tools follow the same order-date-based approach.)
  let discardedFinanceOnly = 0;
  for (const [key, expenses] of expensesByOrderSku) {
    if (consumedOrderSkuKeys.has(key)) continue;
    if (expenses.length === 0) continue;
    discardedFinanceOnly += expenses.length;
  }
  if (discardedFinanceOnly > 0) {
    logger.info(`[Step1] Discarded ${discardedFinanceOnly} finance-only expense rows (orders not in Sales Report).`);
  }

  // Handle leftover unattributed expenses (orderId has expenses but no sales order match)
  for (const [orderId, expenses] of unattributedExpensesByOrder) {
    if (consumedOrderIds.has(orderId)) continue;
    if (expenses.length === 0) continue;
    // Discard — these belong to orders outside the Sales Report range
  }

  // Compute totals
  for (const bucket of skuBuckets.values()) computeBucketTotals(bucket);

  // ── Diagnostic: trace FBA Fulfillment to detect inflation source ──
  let diagFbaTotal = 0;
  for (const bucket of skuBuckets.values()) {
    diagFbaTotal += bucket.fbaFulfillmentFee || 0;
  }
  logger.info(`[DIAG] Total FBA Fulfillment across ${skuBuckets.size} SKU buckets: $${Math.round(diagFbaTotal * 100) / 100}`);
  logger.info(`[DIAG] Finance API returned ${expenseRows.length} expense rows total`);
  const fbaExpenseRows = expenseRows.filter(e => e.category === 'FBA Fulfillment Fee');
  const fbaInRange = fbaExpenseRows.filter(e => {
    const d = toPacificDateStr(e.postedDate) || e.postedDateStr || '';
    return d >= startDate && d <= endDate;
  });
  logger.info(`[DIAG] FBA Fulfillment rows: ${fbaExpenseRows.length} total, ${fbaInRange.length} in date range`);
  logger.info(`[DIAG] FBA Fulfillment sum ALL: $${Math.round(fbaExpenseRows.reduce((s, e) => s + e.amount, 0) * 100) / 100}`);
  logger.info(`[DIAG] FBA Fulfillment sum IN-RANGE: $${Math.round(fbaInRange.reduce((s, e) => s + e.amount, 0) * 100) / 100}`);

  // Break down FBA fees by transaction type to find unexpected sources
  const fbaByTxnType = {};
  for (const e of fbaExpenseRows) {
    const txnType = e.transactionType || 'Unknown';
    if (!fbaByTxnType[txnType]) fbaByTxnType[txnType] = { count: 0, sum: 0 };
    fbaByTxnType[txnType].count++;
    fbaByTxnType[txnType].sum += e.amount;
  }
  for (const [txnType, data] of Object.entries(fbaByTxnType)) {
    logger.info(`[DIAG] FBA by txnType "${txnType}": ${data.count} rows, $${Math.round(data.sum * 100) / 100}`);
  }

  // Count matched vs unmatched expenses
  let matchedFba = 0, unmatchedFba = 0;
  for (const e of fbaExpenseRows) {
    const key = `${e.orderId}||${e.sku || 'N/A'}`;
    if (consumedOrderSkuKeys.has(key)) matchedFba += e.amount;
    else unmatchedFba += e.amount;
  }
  logger.info(`[DIAG] FBA matched (in merge loop): $${Math.round(matchedFba * 100) / 100}`);
  logger.info(`[DIAG] FBA unmatched (finance-only/overhead): $${Math.round(unmatchedFba * 100) / 100}`);

  // Check for SKU mismatches between sales report and finance API
  const salesSkusByOrder = new Map();
  for (const [orderId, skuMap] of salesOrderMap) {
    salesSkusByOrder.set(orderId, [...skuMap.keys()]);
  }
  let mismatchCount = 0;
  for (const [key] of expensesByOrderSku) {
    if (consumedOrderSkuKeys.has(key)) continue;
    const [orderId, sku] = key.split('||');
    if (salesSkusByOrder.has(orderId)) {
      const salesSkus = salesSkusByOrder.get(orderId);
      if (!salesSkus.includes(sku)) {
        mismatchCount++;
        if (mismatchCount <= 5) {
          logger.warn(`[DIAG] SKU mismatch: Order ${orderId} — Finance SKU "${sku}" not in Sales Report SKUs [${salesSkus.join(', ')}]`);
        }
      }
    }
  }
  if (mismatchCount > 0) logger.warn(`[DIAG] Total SKU mismatches: ${mismatchCount} (finance-side SKU didn't match any sales-report SKU for the same order)`);

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

  // ── Save pending orders (keyed by orderId+sku for multi-item orders) ──
  if (pendingOrders.length > 0) {
    for (const po of pendingOrders) {
      await PendingExpenseOrder.findOneAndUpdate(
        { User: po.User, country: po.country, region: po.region, orderId: po.orderId, sku: po.sku },
        po,
        { upsert: true, new: true }
      );
    }
    logger.info(`[Step1] Saved ${pendingOrders.length} pending expense orders.`);
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
  return { salesOrders: salesOrderMap.size, skuDocs: saved.skuDocCount, overheadDocs: saved.overheadDocCount, pendingOrders: pendingOrders.length, token, marketplaceId, baseUrl };
}

// ═══════════════════════════════════════════════
// STEP 2: BACKFILL PENDING EXPENSES
//
// Fetches Finance API for all pending order IDs.
// Matches expenses by order ID.
// Updates existing DailySkuFinance docs.
// Removes resolved orders from PendingExpenseOrder.
// ═══════════════════════════════════════════════
async function backfillPendingExpenses({ userId, country, regionModel, accessToken, refreshToken, clientId, clientSecret }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const regionInternal = internalRegionFromModel(regionModel);

  // Find all pending orders
  const pendingOrders = await PendingExpenseOrder.find({
    User: userObjectId, country: country.toUpperCase(), region: regionModel,
  }).lean();

  if (pendingOrders.length === 0) {
    logger.info('[Step2] No pending expense orders. Skipping backfill.');
    return { resolved: 0, stillPending: 0, expired: 0 };
  }

  logger.info(`[Step2] Backfilling ${pendingOrders.length} pending orders...`);

  // Find the date range we need to cover
  const pendingDates = pendingOrders.map((p) => p.purchasePacificDate).sort();
  const earliestPurchase = pendingDates[0];

  // Fetch Finance API from earliest pending order date up to today
  const buffer = SETTLEMENT_LAG[regionModel] || SETTLEMENT_LAG.NA;
  const finStart = new Date(`${earliestPurchase}T00:00:00.000Z`);
  finStart.setUTCDate(finStart.getUTCDate() - buffer.beforeDays);
  const finEnd = new Date(Date.now() - 3 * 60 * 1000); // 3 min before now (API requires ≥ 2 min buffer)

  let token = accessToken;
  if (!token) token = await getAccessToken(clientId, clientSecret, refreshToken);

  logger.info(`[Step2] Finance API: ${finStart.toISOString()} → ${finEnd.toISOString()}`);
  const fetchResult = await fetchNewFinanceData({
    refreshToken, accessToken: token, clientId, clientSecret,
    country: country.toUpperCase(), region: regionInternal,
    postedAfter: finStart.toISOString(), postedBefore: finEnd.toISOString(),
  });

  const expenseRows = fetchResult.expenseRows || [];
  const revenueRows = fetchResult.revenueRows || [];

  // Index by order+sku
  const { expensesByOrderSku, unattributedExpensesByOrder, revenueByOrderSku, unattributedRevenueByOrder } = indexFinanceRowsByOrderId(expenseRows, revenueRows);

  // Match against pending orders
  let resolved = 0, stillPending = 0, expired = 0;
  const resolvedOrderIds = [];
  const datesToUpdate = new Map(); // pacificDate → Map<sku, { expenses[], revenues[] }>

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

      // Also get non-product revenue
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
      // Increment attempt counter
      await PendingExpenseOrder.updateOne(
        { _id: pending._id },
        { $inc: { attempts: 1 } }
      );
    }
  }

  // ── Update DailySkuFinance for resolved orders ──
  for (const [dateKey, skuMap] of datesToUpdate) {
    for (const [sku, { expenses, revenues }] of skuMap) {
      // Read existing doc
      const existing = await DailySkuFinance.findOne({
        User: userObjectId, country: country.toUpperCase(), region: regionModel,
        sku, date: dateKey,
      });

      if (!existing) {
        logger.warn(`[Step2] No DailySkuFinance found for ${sku} on ${dateKey}. Skipping.`);
        continue;
      }

      // Apply expenses
      const update = {};
      for (const e of expenses) {
        const field = EXPENSE_CATEGORY_TO_FIELD[e.category];
        if (field) {
          update[field] = (update[field] || existing[field] || 0) + e.amount;
        } else {
          update.otherExpenses = (update.otherExpenses || existing.otherExpenses || 0) + e.amount;
        }
      }

      // Apply non-product revenue
      for (const r of revenues) {
        const field = REVENUE_CATEGORY_TO_FIELD[r.category];
        if (field) {
          update[field] = (update[field] || existing[field] || 0) + r.amount;
        }
      }

      // Recompute totals
      const merged = { ...existing.toObject(), ...update };
      update.totalRevenue = Math.round((merged.productSales + (merged.shippingRevenue || 0) + (merged.giftWrapRevenue || 0) + (merged.fbaInventoryReimbursement || 0)) * 100) / 100;
      update.totalExpenses = Math.round(((merged.fbaFulfillmentFee || 0) + (merged.referralCommission || 0) + (merged.closingFee || 0) + (merged.technologyFee || 0) + (merged.shippingChargeback || 0) + (merged.giftWrapChargeback || 0) + (merged.refundCommission || 0) + (merged.promotionsDiscount || 0) + (merged.shippingDiscount || 0) + (merged.taxDiscount || 0) + (merged.shippingTaxDiscount || 0) + (merged.fbaReversedReimbursement || 0) + (merged.fbaDisposalFee || 0) + (merged.otherExpenses || 0)) * 100) / 100;
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
  return { resolved, stillPending, expired, token };
}

// ═══════════════════════════════════════════════
// MAIN: SYNC FINANCE DATA
//
// Called by background job (weekly or on-demand).
//
// 1. Determines date range (backfill or incremental)
// 2. Step 1: Fetch new sales + expenses
// 3. Step 2: Backfill pending expenses from previous syncs
// 4. Sync ASIN relationships
// ═══════════════════════════════════════════════
async function syncFinanceData({ userId, country, regionModel, refreshToken, accessToken, clientId = process.env.SPAPI_CLIENT_ID, clientSecret = process.env.SPAPI_CLIENT_SECRET, backfillDays = 30, forceDates = null }) {
  const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

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
      // Still run Step 2 to fill pending expenses
      const step2 = await backfillPendingExpenses({ userId, country, regionModel, accessToken, refreshToken, clientId, clientSecret });
      // Sync relationships
      await syncRelationshipsIfNeeded({ userId, country, regionModel, startDate: latestSync.date, endDate: latestSync.date, accessToken: step2.token, refreshToken, clientId, clientSecret });
      return { status: 'up_to_date', latestDate: latestSync.date, backfill: step2 };
    } else {
      const nextDay = new Date(latestSync.date + 'T00:00:00.000Z');
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      startDate = formatDateUTC(nextDay);
      endDate = yesterdayStr;
      logger.info(`[Sync] Incremental: ${startDate} → ${endDate}`);
    }
  }

  // ── Step 1: New sales + expenses ──
  const step1 = await fetchNewSalesAndExpenses({ userId, country, regionModel, startDate, endDate, accessToken, refreshToken, clientId, clientSecret });

  // ── Step 2: Backfill pending expenses from previous syncs ──
  const step2 = await backfillPendingExpenses({ userId, country, regionModel, accessToken: step1.token, refreshToken, clientId, clientSecret });

  // ── Step 3: Sync ASIN relationships ──
  await syncRelationshipsIfNeeded({ userId, country, regionModel, startDate, endDate, accessToken: step2.token || step1.token, refreshToken, clientId, clientSecret });

  return {
    status: 'completed', startDate, endDate,
    step1: { salesOrders: step1.salesOrders, skuDocs: step1.skuDocs, overheadDocs: step1.overheadDocs, pendingOrders: step1.pendingOrders },
    step2: { resolved: step2.resolved, stillPending: step2.stillPending, expired: step2.expired },
  };
}

async function syncRelationshipsIfNeeded({ userId, country, regionModel, startDate, endDate, accessToken, refreshToken, clientId, clientSecret }) {
  try {
    const { syncAsinRelationships } = require('../../Services/Sp_API/AsinRelationshipService.js');
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
// HTTP: Dashboard reads (FinanceDashboardReadService)
// ═══════════════════════════════════════════════

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateFinanceDateRange(startDate, endDate) {
  if (!startDate || !endDate || !DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return 'startDate and endDate are required (YYYY-MM-DD).';
  }
  if (startDate > endDate) return 'startDate must be on or before endDate.';
  return null;
}

/** Default date window from DataFetchTracking (same source as dashboard phase 1). */
const getFinanceDateRange = asyncHandler(async (req, res) => {
  const userObjectId =
    typeof req.userId === 'string' ? new mongoose.Types.ObjectId(req.userId) : req.userId;

  const doc = await DataFetchTracking.findOne({
    User: userObjectId,
    country: req.country,
    region: req.region,
    status: { $in: ['completed', 'partial'] },
  })
    .sort({ fetchedAt: -1 })
    .select('dataRange status')
    .lean();

  const startDate = doc?.dataRange?.startDate || null;
  const endDate = doc?.dataRange?.endDate || null;

  return res.status(200).json(
    new ApiResponse(
      200,
      { startDate, endDate, calendarMode: 'default' },
      'Finance dashboard default date range'
    )
  );
});

const getFinanceDashboard = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const validationError = validateFinanceDateRange(startDate, endDate);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }
  const data = await FinanceDashboardReadService.getDashboard({
    userId: req.userId,
    country: req.country,
    region: req.region,
    startDate,
    endDate,
  });
  return res.status(200).json(new ApiResponse(200, data, 'Finance dashboard data'));
});

const getFinanceAsinDetail = asyncHandler(async (req, res) => {
  const { asin } = req.params;
  const { startDate, endDate } = req.query;
  const validationError = validateFinanceDateRange(startDate, endDate);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }
  if (!asin || String(asin).trim() === '') {
    return res.status(400).json(new ApiError(400, 'asin is required'));
  }
  const rows = await FinanceDashboardReadService.getAsinDetail({
    userId: req.userId,
    country: req.country,
    region: req.region,
    asin: String(asin).trim(),
    startDate,
    endDate,
  });
  return res.status(200).json(new ApiResponse(200, rows, 'ASIN finance detail'));
});

const getFinanceAsinSnapshot = asyncHandler(async (req, res) => {
  const { asin } = req.params;
  const { startDate, endDate } = req.query;
  const validationError = validateFinanceDateRange(startDate, endDate);
  if (validationError) {
    return res.status(400).json(new ApiError(400, validationError));
  }
  const normalized = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) {
    return res.status(400).json(new ApiError(400, 'Invalid ASIN.'));
  }
  const data = await FinanceDashboardReadService.getAsinSnapshot({
    userId: req.userId,
    country: req.country,
    region: req.region,
    startDate,
    endDate,
    asin: normalized,
  });
  return res.status(200).json(
    new ApiResponse(200, data, 'ASIN finance snapshot')
  );
});

/** Wraps internal getSyncStatus (pending orders + FinanceSyncLog range). */
const getFinanceSyncStatus = asyncHandler(async (req, res) => {
  const data = await getSyncStatus({
    userId: req.userId,
    country: req.country,
    regionModel: req.region,
  });
  return res.status(200).json(new ApiResponse(200, data, 'Finance sync status'));
});

// ═══════════════════════════════════════════════
// QUERY: Sync status (internal — used by HTTP + jobs)
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
  getFinanceDateRange,
  getFinanceDashboard,
  getFinanceAsinDetail,
  getFinanceAsinSnapshot,
  getFinanceSyncStatus,
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
};
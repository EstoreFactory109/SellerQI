const logger = require("../../utils/Logger.js");
const { URIs, marketplaceConfig: sharedMarketplaceConfig } = require("../../controllers/config/config.js");

// ─────────────────────────────────────────────
// REUSE FROM EXISTING CODEBASE
// ─────────────────────────────────────────────

const https = require("https");
const http = require("http");
const zlib = require("zlib");

const COUNTRY_TO_INTERNAL_REGION = {
  US: "na", CA: "na", MX: "na", BR: "na",
  UK: "eu", DE: "eu", FR: "eu", IT: "eu", ES: "eu", NL: "eu",
  SE: "eu", PL: "eu", BE: "eu", IN: "eu", TR: "eu", AE: "eu",
  SA: "eu", EG: "eu",
  AU: "apac", JP: "apac", SG: "apac",
};

const REGION_BASE_URLS = {
  na: "sellingpartnerapi-na.amazon.com",
  eu: "sellingpartnerapi-eu.amazon.com",
  apac: "sellingpartnerapi-fe.amazon.com",
};

const LWA_TOKEN_URL = "api.amazon.com";

function mapInternalRegionToSharedRegionKey(internalRegion) {
  switch (internalRegion) {
    case "na": return "NA";
    case "eu": return "EU";
    case "apac": return "FE";
    default: return null;
  }
}

function resolveMarketplaceAndRegion(countryUpper, regionOverride) {
  const internalRegionFromCountry = COUNTRY_TO_INTERNAL_REGION[countryUpper];
  if (!internalRegionFromCountry) {
    throw new Error(
      `Unsupported country: "${countryUpper}". Supported: ${Object.keys(COUNTRY_TO_INTERNAL_REGION).join(", ")}`
    );
  }

  const internalRegion = regionOverride || internalRegionFromCountry;
  const sharedRegionKey = mapInternalRegionToSharedRegionKey(internalRegion);

  const marketplaceId = sharedMarketplaceConfig?.[countryUpper];
  if (!marketplaceId) {
    throw new Error(`marketplaceId not configured for country: "${countryUpper}"`);
  }

  const baseUrlFromShared = sharedRegionKey ? URIs?.[sharedRegionKey] : null;
  const baseUrl = baseUrlFromShared || REGION_BASE_URLS[internalRegion];

  if (!baseUrl) {
    throw new Error(`Unsupported region: "${internalRegion}". Supported: na, eu, apac`);
  }

  return { marketplaceId, baseUrl, region: internalRegion };
}

function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// SP-API retry helper for rate-limited endpoints.
// Handles 429 / 503 with exponential backoff, honors `retry-after` when present,
// and enforces a floor matching /orders/v0/orders' 60s sustained refill rate
// when called in `orders` mode so we do not retry before a token exists.
// ─────────────────────────────────────────────
const SP_API_RETRY_DEFAULTS = {
  orders: {
    maxAttempts: 10,
    baseBackoffMs: 2000,
    maxBackoffMs: 120000,
    min429WaitMs: 60000, // one token-refill period for /orders/v0/orders
  },
  orderItems: {
    // /orders/v0/orders/{id}/orderItems — rate 0.5 req/s, burst 30 — much friendlier.
    maxAttempts: 6,
    baseBackoffMs: 1000,
    maxBackoffMs: 30000,
    min429WaitMs: 2000,
  },
};

function readHeader(headers, name) {
  if (!headers) return undefined;
  // `headers` from node's http/https is a plain object with lowercased keys.
  return headers[name] || headers[name.toLowerCase()];
}

function computeSpApiBackoffMs(statusCode, headers, attempt, cfg) {
  const retryAfterRaw = readHeader(headers, "retry-after");
  const retryAfterMs = retryAfterRaw ? parseInt(retryAfterRaw, 10) * 1000 : NaN;

  let waitMs;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    waitMs = retryAfterMs;
  } else {
    waitMs = cfg.baseBackoffMs * Math.pow(2, attempt) + Math.random() * 1000;
  }
  if (statusCode === 429) {
    waitMs = Math.max(waitMs, cfg.min429WaitMs);
  }
  return Math.min(cfg.maxBackoffMs, waitMs);
}

/**
 * Wrap an SP-API request with throttle-aware retries.
 * `mode` selects the retry profile: 'orders' or 'orderItems'.
 * `requestFn` must return `{ statusCode, headers, body }` (matching httpsRequest).
 */
async function spApiRequestWithRetry(mode, requestFn, label = "SP-API") {
  const cfg = SP_API_RETRY_DEFAULTS[mode] || SP_API_RETRY_DEFAULTS.orders;

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const res = await requestFn();
    const statusCode = res?.statusCode;
    const isRetryable = statusCode === 429 || statusCode === 503;

    if (isRetryable && attempt < cfg.maxAttempts - 1) {
      const waitMs = computeSpApiBackoffMs(statusCode, res.headers, attempt, cfg);
      logger.warn(
        `[${label}] ${statusCode} (rate limit / transient); retry ${attempt + 1}/${cfg.maxAttempts} in ${Math.round(waitMs / 1000)}s`
      );
      await sleep(waitMs);
      continue;
    }

    return res;
  }

  throw new Error(`${label} failed: throttled — exhausted retries`);
}

function deriveNextDelayFromRateLimitHeader(headers) {
  const rateHeader = readHeader(headers, "x-amzn-RateLimit-Limit");
  if (!rateHeader) return 0;
  const rate = parseFloat(rateHeader);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.ceil((1000 / rate) * 1.25);
}

function downloadContent(url, isGzip = false) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === "https:" ? https : http;

    protocol.get(url, (res) => {
      const chunks = [];
      const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      stream.on("error", reject);
    }).on("error", reject);
  });
}

async function getAccessToken(clientId, clientSecret, refreshToken) {
  const postData = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const res = await httpsRequest(
    {
      hostname: LWA_TOKEN_URL,
      path: "/auth/o2/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    },
    postData
  );

  if (!res.body.access_token) {
    throw new Error(`Auth failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

// ─────────────────────────────────────────────
// 1. REPORT SERVICE
//    Fetches GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL
//    Flow: createReport → poll getReport → getReportDocument → download TSV
// ─────────────────────────────────────────────

const REPORT_TYPE = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL";
const POLL_INTERVAL_MS = 15000;
const MAX_POLL_ATTEMPTS = 40;

async function createReport(accessToken, baseUrl, marketplaceId, startDate, endDate) {
  const postData = JSON.stringify({
    reportType: REPORT_TYPE,
    marketplaceIds: [marketplaceId],
    dataStartTime: startDate,
    dataEndTime: endDate,
  });

  const res = await httpsRequest({
    hostname: baseUrl,
    path: "/reports/2021-06-30/reports",
    method: "POST",
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  }, postData);

  if (res.body.errors) {
    throw new Error(`createReport failed: ${JSON.stringify(res.body.errors)}`);
  }

  return res.body.reportId;
}

async function pollReportStatus(accessToken, baseUrl, reportId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const res = await httpsRequest({
      hostname: baseUrl,
      path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`,
      method: "GET",
      headers: { "x-amz-access-token": accessToken },
    });

    if (res.body.errors) {
      throw new Error(`getReport failed: ${JSON.stringify(res.body.errors)}`);
    }

    const status = res.body.processingStatus;
    logger.info(`[Report] Poll #${attempt}: status = ${status}`);

    if (status === "DONE") return res.body.reportDocumentId;
    if (status === "CANCELLED" || status === "FATAL") {
      throw new Error(`Report processing failed with status: ${status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Report did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}

async function getReportDocumentUrl(accessToken, baseUrl, reportDocumentId) {
  const res = await httpsRequest({
    hostname: baseUrl,
    path: `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`,
    method: "GET",
    headers: { "x-amz-access-token": accessToken },
  });

  if (res.body.errors) {
    throw new Error(`getReportDocument failed: ${JSON.stringify(res.body.errors)}`);
  }

  return res.body;
}

function parseTsv(rawData) {
  const lines = rawData.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split("\t").map((h) => h.trim().replace(/\r/g, ""));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split("\t").map((v) => v.trim().replace(/\r/g, ""));
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });
    rows.push(row);
  }

  return rows;
}

async function fetchOrdersReport(accessToken, baseUrl, marketplaceId, startDate, endDate) {
  logger.info(`[Report] Requesting report: ${startDate} → ${endDate}`);

  const reportId = await createReport(accessToken, baseUrl, marketplaceId, startDate, endDate);
  logger.info(`[Report] Created report: ${reportId}`);

  const reportDocumentId = await pollReportStatus(accessToken, baseUrl, reportId);
  logger.info(`[Report] Report ready. Document ID: ${reportDocumentId}`);

  const docInfo = await getReportDocumentUrl(accessToken, baseUrl, reportDocumentId);
  logger.info(`[Report] Downloading report...`);

  const isGzip = docInfo.compressionAlgorithm === "GZIP";
  const rawData = await downloadContent(docInfo.url, isGzip);

  const rows = parseTsv(rawData);
  logger.info(`[Report] Parsed ${rows.length} order rows`);

  return rows;
}

// ─────────────────────────────────────────────
// 2. ORDERS SERVICE
//    Fetches orders via getOrders + line items via getOrderItems
//    Use as supplement to fill missing prices from report
// ─────────────────────────────────────────────

// Static floor for pagination pacing. The adaptive delay derived from Amazon's
// x-amzn-RateLimit-Limit header may raise this further at runtime.
const ORDERS_PAGE_STATIC_DELAY_MS = 3000;
const ORDER_ITEMS_PAGE_STATIC_DELAY_MS = 2000;

async function fetchOrders(accessToken, baseUrl, marketplaceId, createdAfter, createdBefore = null) {
  const allOrders = [];
  let nextToken = null;
  let page = 1;

  do {
    logger.info(`[Orders] Fetching page ${page}...`);

    let path;
    if (nextToken) {
      path = `/orders/v0/orders?NextToken=${encodeURIComponent(nextToken)}`;
    } else {
      const params = new URLSearchParams({
        MarketplaceIds: marketplaceId,
        CreatedAfter: createdAfter,
      });
      if (createdBefore) {
        params.set('CreatedBefore', createdBefore);
      }
      path = `/orders/v0/orders?${params.toString()}`;
    }

    const res = await spApiRequestWithRetry(
      "orders",
      () =>
        httpsRequest({
          hostname: baseUrl,
          path,
          method: "GET",
          headers: { "x-amz-access-token": accessToken },
        }),
      "Orders"
    );

    if (!res || res.statusCode < 200 || res.statusCode >= 300 || res.body?.errors) {
      throw new Error(
        `getOrders failed (status=${res?.statusCode}): ${JSON.stringify(res?.body?.errors || res?.body)}`
      );
    }

    const orders = res.body.payload?.Orders || [];
    allOrders.push(...orders);
    nextToken = res.body.payload?.NextToken || null;
    page++;

    if (nextToken) {
      const adaptive = deriveNextDelayFromRateLimitHeader(res.headers);
      const delay = Math.max(ORDERS_PAGE_STATIC_DELAY_MS, adaptive);
      await sleep(delay);
    }
  } while (nextToken);

  logger.info(`[Orders] Total orders fetched: ${allOrders.length}`);
  return allOrders;
}

async function fetchOrderItems(accessToken, baseUrl, orderId) {
  const allItems = [];
  let nextToken = null;

  do {
    let path = `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`;
    if (nextToken) {
      path += `?NextToken=${encodeURIComponent(nextToken)}`;
    }

    const res = await spApiRequestWithRetry(
      "orderItems",
      () =>
        httpsRequest({
          hostname: baseUrl,
          path,
          method: "GET",
          headers: { "x-amz-access-token": accessToken },
        }),
      `OrderItems(${orderId})`
    );

    if (!res || res.statusCode < 200 || res.statusCode >= 300 || res.body?.errors) {
      throw new Error(
        `getOrderItems failed for ${orderId} (status=${res?.statusCode}): ${JSON.stringify(res?.body?.errors || res?.body)}`
      );
    }

    const items = res.body.payload?.OrderItems || [];
    allItems.push(...items);
    nextToken = res.body.payload?.NextToken || null;

    if (nextToken) {
      const adaptive = deriveNextDelayFromRateLimitHeader(res.headers);
      const delay = Math.max(ORDER_ITEMS_PAGE_STATIC_DELAY_MS, adaptive);
      await sleep(delay);
    }
  } while (nextToken);

  return allItems;
}

async function fetchOrderItemsBatch(accessToken, baseUrl, orderIds) {
  const results = new Map();

  for (let i = 0; i < orderIds.length; i++) {
    const orderId = orderIds[i];
    try {
      const items = await fetchOrderItems(accessToken, baseUrl, orderId);
      results.set(orderId, items);
    } catch (error) {
      logger.error(`[Orders] Failed to fetch items for ${orderId}: ${error.message}`);
      results.set(orderId, []);
    }

    if ((i + 1) % 50 === 0 || i === orderIds.length - 1) {
      logger.info(`[Orders] Order items progress: ${i + 1}/${orderIds.length}`);
    }

    // Rate limit: 0.5 req/s
    if (i < orderIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// 3. SALES CALCULATOR
//    Normalises data from report/API, calculates
//    ASIN-wise date-wise sales for 7/14/30 day windows
// ─────────────────────────────────────────────

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseToDateStr(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return formatDate(d);
  } catch {
    return null;
  }
}

/** YYYY-MM-DD in UTC — matches Expences.js / MCP sales-only default window. */
function formatDateUTC(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * SP-API fetch window aligned with Expences / total sales: UTC (yesterday − days) 00:00 through yesterday 23:59:59.
 */
function getOrdersFetchRangeUtc(days = 30) {
  const now = new Date();
  const yesterdayEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999)
  );
  const startDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1 - days, 0, 0, 0)
  );
  return { startDateISO: startDay.toISOString(), endDateISO: yesterdayEnd.toISOString() };
}

/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  FIX 1 — normaliseReportData                                    │
 * │                                                                  │
 * │  Two new filters added to exclude non-sale rows that were        │
 * │  previously counted as real sales with ₹0 revenue:              │
 * │                                                                  │
 * │  A) Non-Amazon / MCF orders (sales-channel = "Non-Amazon")       │
 * │     These are Multi-Channel Fulfillment orders where the seller  │
 * │     sold on another platform (Flipkart, Shopify, own website)    │
 * │     and Amazon only handled warehousing & shipping.              │
 * │     Revenue is always ₹0 in the report because Amazon did not   │
 * │     process the payment — the other platform did.                │
 * │     Order IDs start with "S02-" prefix.                          │
 * │     Ref: Amazon MCF Seller Central guide —                       │
 * │       https://supplychain.amazon.com/learn/seller-central-guide  │
 * │     Ref: Amazon MCF best practices for developers —              │
 * │       https://developer.amazonservices.com/mcf-best-practices    │
 * │                                                                  │
 * │  B) Zero-price orders (item-price = 0, order-status = Shipped)   │
 * │     These are free replacement shipments. When a customer        │
 * │     receives a damaged/defective item, Amazon ships a new one    │
 * │     at no charge. The original sale was recorded earlier with    │
 * │     full revenue; this replacement has item-price = 0.           │
 * │     Verified against raw report data: 12 such rows found in a   │
 * │     30-day sample, all on Amazon.in with Shipped status.         │
 * └──────────────────────────────────────────────────────────────────┘
 */
function normaliseReportData(reportRows) {
  const items = [];
  let skippedNonAmazon = 0;
  let skippedZeroPrice = 0;

  for (const row of reportRows) {
    // 1. Skip cancelled orders (existing filter — unchanged)
    if ((row["order-status"] || "").toLowerCase() === "cancelled") continue;

    // 2. [FIX 1-A] Skip Non-Amazon / MCF orders
    //    These are sold on other platforms, fulfilled by Amazon FBA.
    //    sales-channel = "Non-Amazon", order IDs start with "S02-".
    //    item-price is always empty/zero because Amazon didn't process payment.
    const salesChannel = (row["sales-channel"] || "").toLowerCase();
    if (salesChannel === "non-amazon") {
      skippedNonAmazon++;
      continue;
    }

    const price = parseFloat(row["item-price"]) || 0;
    const quantity = parseInt(row["quantity"], 10) || 0;

    // 3. [FIX 1-B] Skip zero-price orders (free replacements)
    //    These are shipped orders with item-price = 0.0 on Amazon.in.
    //    The original sale with full revenue was counted in a prior period.
    if (price === 0) {
      skippedZeroPrice++;
      continue;
    }

    // 4. Skip rows where both price and quantity are zero (existing safety net)
    if (price === 0 && quantity === 0) continue;

    const date = parseToDateStr(row["purchase-date"]);
    if (!date) continue;

    items.push({
      orderId: row["amazon-order-id"] || "",
      asin: row["asin"] || "",
      sku: row["sku"] || "",
      productName: row["product-name"] || "",
      date,
      quantity,
      itemPrice: price,
      itemTax: parseFloat(row["item-tax"]) || 0,
      currency: row["currency"] || "",
      orderStatus: row["order-status"] || "",
      fulfillmentChannel: row["fulfillment-channel"] || "",
    });
  }

  if (skippedNonAmazon > 0) {
    logger.info(`[Sales] Skipped ${skippedNonAmazon} Non-Amazon/MCF orders (sold on other platforms)`);
  }
  if (skippedZeroPrice > 0) {
    logger.info(`[Sales] Skipped ${skippedZeroPrice} zero-price orders (free replacements)`);
  }

  return items;
}

/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  FIX 1 — normaliseOrdersApiData                                 │
 * │                                                                  │
 * │  Same two filters applied to Orders API data path:               │
 * │  A) Skip orders where SalesChannel = "Non-Amazon" (MCF)          │
 * │  B) Skip order items where ItemPrice.Amount = 0 (replacements)   │
 * └──────────────────────────────────────────────────────────────────┘
 */
function normaliseOrdersApiData(orders, orderItemsMap) {
  const items = [];

  for (const order of orders) {
    const orderId = order.AmazonOrderId;
    const orderStatus = order.OrderStatus || "";
    if (orderStatus.toLowerCase() === "canceled") continue;

    // [FIX 1-A] Skip Non-Amazon / MCF orders from Orders API as well.
    //           MCF orders have SalesChannel = "Non-Amazon".
    const salesChannel = (order.SalesChannel || "").toLowerCase();
    if (salesChannel === "non-amazon") continue;

    const date = parseToDateStr(order.PurchaseDate);
    if (!date) continue;

    const orderItems = orderItemsMap.get(orderId) || [];
    for (const item of orderItems) {
      const itemPrice = parseFloat(item.ItemPrice?.Amount) || 0;

      // [FIX 1-B] Skip zero-price items (free replacements)
      if (itemPrice === 0) continue;

      items.push({
        orderId,
        asin: item.ASIN || "",
        sku: item.SellerSKU || "",
        productName: item.Title || "",
        date,
        quantity: parseInt(item.QuantityOrdered, 10) || 0,
        itemPrice,
        itemTax: parseFloat(item.ItemTax?.Amount) || 0,
        promotionDiscount: parseFloat(item.PromotionDiscount?.Amount) || 0,
        currency: item.ItemPrice?.CurrencyCode || "",
        orderStatus,
        fulfillmentChannel: order.FulfillmentChannel || "",
      });
    }
  }

  return items;
}

function calculateSales(normalisedItems) {
  const now = new Date();
  const utcTodayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const utcYesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
  const cutoff7 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1 - 6, 0, 0, 0));
  const cutoff14 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1 - 13, 0, 0, 0));
  const cutoff30 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1 - 30, 0, 0, 0));

  // Group items by ASIN
  const asinMap = new Map();

  for (const item of normalisedItems) {
    const itemDate = new Date(`${item.date}T00:00:00.000Z`);
    if (itemDate < cutoff30 || itemDate >= utcTodayStart) continue;

    if (!asinMap.has(item.asin)) {
      asinMap.set(item.asin, {
        sku: item.sku,
        productName: item.productName,
        currency: item.currency,
        dateMap: new Map(),
      });
    }

    const asinData = asinMap.get(item.asin);
    if (!asinData.sku && item.sku) asinData.sku = item.sku;
    if (!asinData.productName && item.productName) asinData.productName = item.productName;
    if (!asinData.currency && item.currency) asinData.currency = item.currency;

    if (!asinData.dateMap.has(item.date)) {
      asinData.dateMap.set(item.date, { units: 0, revenue: 0 });
    }
    const dateEntry = asinData.dateMap.get(item.date);
    dateEntry.units += item.quantity;
    dateEntry.revenue += item.itemPrice;
  }

  // Build per-ASIN result
  const asinSales = [];

  for (const [asin, data] of asinMap) {
    const dateWiseSales = [];
    const periodTotals = {
      last7Days: { totalUnits: 0, totalRevenue: 0 },
      last14Days: { totalUnits: 0, totalRevenue: 0 },
      last30Days: { totalUnits: 0, totalRevenue: 0 },
    };

    const sortedDates = Array.from(data.dateMap.keys()).sort();

    for (const dateStr of sortedDates) {
      const entry = data.dateMap.get(dateStr);
      const entryDate = new Date(`${dateStr}T00:00:00.000Z`);
      const revenue = Math.round(entry.revenue * 100) / 100;

      dateWiseSales.push({ date: dateStr, units: entry.units, revenue });

      if (entryDate >= cutoff30) {
        periodTotals.last30Days.totalUnits += entry.units;
        periodTotals.last30Days.totalRevenue += revenue;
      }
      if (entryDate >= cutoff14) {
        periodTotals.last14Days.totalUnits += entry.units;
        periodTotals.last14Days.totalRevenue += revenue;
      }
      if (entryDate >= cutoff7) {
        periodTotals.last7Days.totalUnits += entry.units;
        periodTotals.last7Days.totalRevenue += revenue;
      }
    }

    periodTotals.last7Days.totalRevenue = Math.round(periodTotals.last7Days.totalRevenue * 100) / 100;
    periodTotals.last14Days.totalRevenue = Math.round(periodTotals.last14Days.totalRevenue * 100) / 100;
    periodTotals.last30Days.totalRevenue = Math.round(periodTotals.last30Days.totalRevenue * 100) / 100;

    asinSales.push({
      asin,
      sku: data.sku,
      productName: data.productName,
      currency: data.currency,
      last7Days: periodTotals.last7Days,
      last14Days: periodTotals.last14Days,
      last30Days: periodTotals.last30Days,
      dateWiseSales,
    });
  }

  asinSales.sort((a, b) => b.last30Days.totalRevenue - a.last30Days.totalRevenue);

  // Overall summary
  const summary = {
    last7Days: { totalUnits: 0, totalRevenue: 0, startDate: formatDateUTC(cutoff7), endDate: formatDateUTC(utcYesterday) },
    last14Days: { totalUnits: 0, totalRevenue: 0, startDate: formatDateUTC(cutoff14), endDate: formatDateUTC(utcYesterday) },
    last30Days: { totalUnits: 0, totalRevenue: 0, startDate: formatDateUTC(cutoff30), endDate: formatDateUTC(utcYesterday) },
  };

  for (const asin of asinSales) {
    summary.last7Days.totalUnits += asin.last7Days.totalUnits;
    summary.last7Days.totalRevenue += asin.last7Days.totalRevenue;
    summary.last14Days.totalUnits += asin.last14Days.totalUnits;
    summary.last14Days.totalRevenue += asin.last14Days.totalRevenue;
    summary.last30Days.totalUnits += asin.last30Days.totalUnits;
    summary.last30Days.totalRevenue += asin.last30Days.totalRevenue;
  }

  summary.last7Days.totalRevenue = Math.round(summary.last7Days.totalRevenue * 100) / 100;
  summary.last14Days.totalRevenue = Math.round(summary.last14Days.totalRevenue * 100) / 100;
  summary.last30Days.totalRevenue = Math.round(summary.last30Days.totalRevenue * 100) / 100;

  return { generatedAt: new Date().toISOString(), totalAsins: asinSales.length, summary, asinSales };
}

function calculateSalesForDateRange(normalisedItems, startDate, endDate) {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T23:59:59");

  const filtered = normalisedItems.filter((item) => {
    const d = new Date(item.date + "T00:00:00");
    return d >= start && d <= end;
  });

  const asinMap = new Map();

  for (const item of filtered) {
    if (!asinMap.has(item.asin)) {
      asinMap.set(item.asin, { sku: item.sku, productName: item.productName, currency: item.currency, dateMap: new Map() });
    }
    const asinData = asinMap.get(item.asin);
    if (!asinData.dateMap.has(item.date)) {
      asinData.dateMap.set(item.date, { units: 0, revenue: 0 });
    }
    const dateEntry = asinData.dateMap.get(item.date);
    dateEntry.units += item.quantity;
    dateEntry.revenue += item.itemPrice;
  }

  const asinSales = [];
  let totalUnits = 0;
  let totalRevenue = 0;

  for (const [asin, data] of asinMap) {
    const dateWiseSales = [];
    let asinUnits = 0;
    let asinRevenue = 0;

    for (const dateStr of Array.from(data.dateMap.keys()).sort()) {
      const entry = data.dateMap.get(dateStr);
      const revenue = Math.round(entry.revenue * 100) / 100;
      dateWiseSales.push({ date: dateStr, units: entry.units, revenue });
      asinUnits += entry.units;
      asinRevenue += revenue;
    }

    asinSales.push({
      asin, sku: data.sku, productName: data.productName, currency: data.currency,
      totalUnits: asinUnits, totalRevenue: Math.round(asinRevenue * 100) / 100, dateWiseSales,
    });
    totalUnits += asinUnits;
    totalRevenue += asinRevenue;
  }

  asinSales.sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    generatedAt: new Date().toISOString(),
    dateRange: { startDate, endDate },
    totalAsins: asinSales.length,
    totalUnits,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    asinSales,
  };
}

function mergeReportAndApiData(reportItems, apiItems) {
  const apiLookup = new Map();
  for (const item of apiItems) {
    apiLookup.set(`${item.orderId}_${item.asin}`, item);
  }

  return reportItems.map((item) => {
    if (item.itemPrice === 0) {
      const apiItem = apiLookup.get(`${item.orderId}_${item.asin}`);
      if (apiItem && apiItem.itemPrice > 0) {
        return { ...item, itemPrice: apiItem.itemPrice, currency: apiItem.currency };
      }
    }
    return item;
  });
}

// ─────────────────────────────────────────────
// 4. MAIN ENTRY POINT
// ─────────────────────────────────────────────

/**
 * Fetch ASIN-wise, date-wise sales data for 7/14/30 day breakdown.
 *
 * @param {Object} config
 * @param {string} config.refreshToken       - LWA refresh token
 * @param {string} config.clientId           - LWA app client ID
 * @param {string} config.clientSecret       - LWA app client secret
 * @param {string} config.country            - Country code: AU, US, IN, UK, DE, etc.
 * @param {string} [config.region]           - Optional override: na, eu, apac
 * @param {string} [config.accessToken]      - Optional pre-generated access token
 * @param {string} [config.dataSource="report"] - "report" | "api" | "both"
 * @param {number} [config.days=30]          - How many days of data to fetch
 *
 * @returns {Object} result
 * @returns {Object} result.data             - Sales analysis with 7/14/30 day breakdown per ASIN
 * @returns {Object} result.metadata
 */
async function getSalesReport(config) {
  const {
    refreshToken,
    clientId,
    clientSecret,
    country,
    days = 30,
    dataSource = "report",
    accessToken: providedAccessToken,
  } = config;

  const countryUpper = country.toUpperCase();
  const { marketplaceId, baseUrl, region } = resolveMarketplaceAndRegion(countryUpper, config.region);

  logger.info(`[Sales] Country: ${countryUpper} | Region: ${region} | Marketplace: ${marketplaceId}`);
  logger.info(`[Sales] Base URL: ${baseUrl} | Data source: ${dataSource}`);

  // Step 1: Get access token
  let accessToken = providedAccessToken;
  if (!accessToken) {
    logger.info("[Sales] Getting access token...");
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
    logger.info("[Sales] Access token obtained.");
  }

  // Step 2: Same UTC window as Expences / MCP sales-only: (UTC yesterday − days) through end of UTC yesterday
  const { startDateISO, endDateISO } = getOrdersFetchRangeUtc(days);

  logger.info(`[Sales] Date range (UTC, aligned with finance/sales-only): ${startDateISO} → ${endDateISO}`);

  // Step 3: Fetch data
  let normalisedItems = [];

  if (dataSource === "report" || dataSource === "both") {
    try {
      logger.info("[Sales] Fetching from Report API...");
      const reportRows = await fetchOrdersReport(accessToken, baseUrl, marketplaceId, startDateISO, endDateISO);
      normalisedItems = normaliseReportData(reportRows);
      logger.info(`[Sales] Normalised ${normalisedItems.length} items from report`);
    } catch (error) {
      logger.error(`[Sales] Report fetch failed: ${error.message}`);
      if (dataSource === "report") throw error;
    }
  }

  if (dataSource === "api" || (dataSource === "both" && normalisedItems.length === 0)) {
    try {
      logger.info("[Sales] Fetching from Orders API...");
      const orders = await fetchOrders(accessToken, baseUrl, marketplaceId, startDateISO, endDateISO);

      const activeOrders = orders.filter(
        (o) => o.OrderStatus !== "Canceled" && o.OrderStatus !== "Cancelled"
      );
      logger.info(`[Sales] Active orders: ${activeOrders.length}/${orders.length}`);

      const orderIds = activeOrders.map((o) => o.AmazonOrderId);
      logger.info(`[Sales] Fetching order items for ${orderIds.length} orders...`);
      const orderItemsMap = await fetchOrderItemsBatch(accessToken, baseUrl, orderIds);

      const apiItems = normaliseOrdersApiData(activeOrders, orderItemsMap);
      logger.info(`[Sales] Normalised ${apiItems.length} items from Orders API`);

      if (dataSource === "both" && normalisedItems.length > 0) {
        normalisedItems = mergeReportAndApiData(normalisedItems, apiItems);
        logger.info(`[Sales] Merged report + API data`);
      } else {
        normalisedItems = apiItems;
      }
    } catch (error) {
      logger.error(`[Sales] Orders API fetch failed: ${error.message}`);
      if (normalisedItems.length === 0) throw error;
    }
  }

  logger.info(`[Sales] Total normalised items: ${normalisedItems.length}`);

  // Step 4: Calculate sales
  const salesData = calculateSales(normalisedItems);

  // Step 5: Extract unique order IDs from normalised items.
  //         These are needed by the expense system (Fix 2) to determine whether
  //         an expense belongs to the current sales period or a prior period.
  //         Order IDs are lost during ASIN/date aggregation in calculateSales(),
  //         so we extract them here before that information is discarded.
  const orderIds = [...new Set(
    normalisedItems
      .map((item) => item.orderId)
      .filter((id) => id && id.length > 0)
  )];

  logger.info(`[Sales] Done. ${salesData.totalAsins} ASINs found. ${orderIds.length} unique order IDs extracted.`);
  logger.info(`[Sales] 7D: ${salesData.summary.last7Days.totalUnits} units / ${salesData.summary.last7Days.totalRevenue}`);
  logger.info(`[Sales] 14D: ${salesData.summary.last14Days.totalUnits} units / ${salesData.summary.last14Days.totalRevenue}`);
  logger.info(`[Sales] 30D: ${salesData.summary.last30Days.totalUnits} units / ${salesData.summary.last30Days.totalRevenue}`);

  return {
    data: salesData,
    orderIds,
    metadata: {
      country: countryUpper,
      region,
      marketplaceId,
      dataSource,
      days,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Fetch ASIN-wise sales for a custom date range.
 *
 * @param {Object} config   - Same as getSalesReport
 * @param {string} startDate - "YYYY-MM-DD"
 * @param {string} endDate   - "YYYY-MM-DD"
 * @returns {Object}
 */
async function getSalesReportForDateRange(config, startDate, endDate) {
  const { refreshToken, clientId, clientSecret, country, accessToken: providedAccessToken } = config;

  const countryUpper = country.toUpperCase();
  const { marketplaceId, baseUrl, region } = resolveMarketplaceAndRegion(countryUpper, config.region);

  let accessToken = providedAccessToken;
  if (!accessToken) {
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
  }

  const startISO = new Date(startDate + "T00:00:00Z").toISOString();
  const endISO = new Date(endDate + "T23:59:59Z").toISOString();

  const reportRows = await fetchOrdersReport(accessToken, baseUrl, marketplaceId, startISO, endISO);
  const normalisedItems = normaliseReportData(reportRows);
  const salesData = calculateSalesForDateRange(normalisedItems, startDate, endDate);

  return {
    data: salesData,
    metadata: { country: countryUpper, region, marketplaceId, generatedAt: new Date().toISOString() },
  };
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  getSalesReport,
  getSalesReportForDateRange,
  // Individual pieces (if needed standalone)
  fetchOrdersReport,
  fetchOrders,
  fetchOrderItems,
  fetchOrderItemsBatch,
  normaliseReportData,
  normaliseOrdersApiData,
  calculateSales,
  calculateSalesForDateRange,
  mergeReportAndApiData,
};
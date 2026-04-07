const logger = require("../../utils/Logger.js");
const { getAccessToken, resolveMarketplaceAndRegion } = require("./SpApiMarketplace.js");

const https = require("https");

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

// ─────────────────────────────────────────────
// 1. FETCH INVENTORY SUMMARIES (WITH PAGINATION)
// ─────────────────────────────────────────────

/**
 * Fetch all FBA inventory summaries from the Inventory API with pagination.
 *
 * @param {string} accessToken
 * @param {string} baseUrl
 * @param {string} marketplaceId
 * @param {string[]} [sellerSkus] - Optional array of SKUs to filter
 * @returns {Object[]} Array of inventory summary objects
 */
async function fetchInventorySummaries(accessToken, baseUrl, marketplaceId, sellerSkus = []) {
  const allSummaries = [];
  let nextToken = null;
  let pageCount = 0;

  do {
    let path;

    if (nextToken) {
      path = `/fba/inventory/v1/summaries?details=true&granularityType=Marketplace&granularityId=${encodeURIComponent(marketplaceId)}&marketplaceIds=${encodeURIComponent(marketplaceId)}&nextToken=${encodeURIComponent(nextToken)}`;
    } else {
      const params = new URLSearchParams({
        details: "true",
        granularityType: "Marketplace",
        granularityId: marketplaceId,
        marketplaceIds: marketplaceId,
      });

      if (sellerSkus.length > 0) {
        params.set("sellerSkus", sellerSkus.join(","));
      }

      path = `/fba/inventory/v1/summaries?${params.toString()}`;
    }

    const MAX_RETRIES = 5;
    let res;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      res = await httpsRequest({
        hostname: baseUrl,
        path,
        method: "GET",
        headers: { "x-amz-access-token": accessToken },
      });

      const isThrottled =
        res.statusCode === 429 ||
        (Array.isArray(res.body.errors) &&
          res.body.errors.some((e) => e.code === "QuotaExceeded"));

      if (isThrottled && attempt < MAX_RETRIES) {
        const delayMs = Math.min(10000 * Math.pow(2, attempt), 60000);
        logger.warn(
          `[Inventory API] Throttled on page ${pageCount + 1}, attempt ${attempt + 1}/${MAX_RETRIES}. ` +
          `Retrying in ${delayMs / 1000}s...`
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      break;
    }

    if (res.statusCode !== 200 || res.body.errors) {
      throw new Error(
        `Inventory API failed (HTTP ${res.statusCode}): ${JSON.stringify(res.body.errors || res.body)}`
      );
    }

    const payload = res.body.payload || {};
    const summaries = payload.inventorySummaries || [];
    allSummaries.push(...summaries);

    nextToken = res.body.pagination?.nextToken || null;
    pageCount++;

    logger.info(
      `[Inventory API] Page ${pageCount}: fetched ${summaries.length} items. NextToken: ${nextToken ? "yes" : "no"}`
    );
  } while (nextToken);

  return allSummaries;
}

// ─────────────────────────────────────────────
// 2. PARSE INVENTORY SUMMARIES → STOCK ROWS
// ─────────────────────────────────────────────

/**
 * Convert raw inventory summaries into normalized stock rows.
 *
 * @param {Object[]} inventorySummaries - Raw summaries from fetchInventorySummaries
 * @returns {Object[]} Array of normalized stock objects
 */
function parseInventorySummaries(inventorySummaries) {
  return inventorySummaries.map((item) => {
    const inventoryDetails = item.inventoryDetails || {};
    const reservedQuantity = inventoryDetails.reservedQuantity || {};
    const unfulfillableQuantity = inventoryDetails.unfulfillableQuantity || {};
    const researchingQuantity = inventoryDetails.researchingQuantity || {};

    return {
      asin: item.asin || "",
      fnSku: item.fnSku || "",
      sellerSku: item.sellerSku || "",
      productName: item.productName || "",
      condition: item.condition || "",
      lastUpdatedTime: item.lastUpdatedTime || "",

      // ── Stock Summary ──
      totalQuantity: item.totalQuantity || 0,
      fulfillableQuantity: inventoryDetails.fulfillableQuantity || 0,

      // ── Inbound ──
      inboundWorkingQuantity: inventoryDetails.inboundWorkingQuantity || 0,
      inboundShippedQuantity: inventoryDetails.inboundShippedQuantity || 0,
      inboundReceivingQuantity: inventoryDetails.inboundReceivingQuantity || 0,

      // ── Reserved Breakdown ──
      totalReservedQuantity: reservedQuantity.totalReservedQuantity || 0,
      pendingCustomerOrderQuantity: reservedQuantity.pendingCustomerOrderQuantity || 0,
      pendingTransshipmentQuantity: reservedQuantity.pendingTransshipmentQuantity || 0,
      fcProcessingQuantity: reservedQuantity.fcProcessingQuantity || 0,

      // ── Unfulfillable Breakdown ──
      totalUnfulfillableQuantity: unfulfillableQuantity.totalUnfulfillableQuantity || 0,
      customerDamagedQuantity: unfulfillableQuantity.customerDamagedQuantity || 0,
      warehouseDamagedQuantity: unfulfillableQuantity.warehouseDamagedQuantity || 0,
      distributorDamagedQuantity: unfulfillableQuantity.distributorDamagedQuantity || 0,
      carrierDamagedQuantity: unfulfillableQuantity.carrierDamagedQuantity || 0,
      defectiveQuantity: unfulfillableQuantity.defectiveQuantity || 0,
      expiredQuantity: unfulfillableQuantity.expiredQuantity || 0,

      // ── Researching Breakdown ──
      totalResearchingQuantity: researchingQuantity.totalResearchingQuantity || 0,
      researchingQuantityInShortTerm: researchingQuantity.researchingQuantityInShortTerm || 0,
      researchingQuantityInMidTerm: researchingQuantity.researchingQuantityInMidTerm || 0,
      researchingQuantityInLongTerm: researchingQuantity.researchingQuantityInLongTerm || 0,
    };
  });
}

// ─────────────────────────────────────────────
// 3. ANALYZE STOCK DATA
// ─────────────────────────────────────────────

/**
 * Analyze parsed stock rows — totals, in-stock vs out-of-stock, etc.
 *
 * @param {Object[]} stockRows - From parseInventorySummaries
 * @returns {Object} Analysis result
 */
function analyzeInventory(stockRows) {
  const now = new Date();

  const totalSkus = stockRows.length;
  const inStockItems = stockRows.filter((r) => r.fulfillableQuantity > 0);
  const outOfStockItems = stockRows.filter((r) => r.fulfillableQuantity === 0);

  const totalFulfillable = stockRows.reduce((sum, r) => sum + r.fulfillableQuantity, 0);
  const totalReserved = stockRows.reduce((sum, r) => sum + r.totalReservedQuantity, 0);
  const totalUnfulfillable = stockRows.reduce((sum, r) => sum + r.totalUnfulfillableQuantity, 0);
  const totalInbound =
    stockRows.reduce((sum, r) => sum + r.inboundWorkingQuantity + r.inboundShippedQuantity + r.inboundReceivingQuantity, 0);
  const totalQuantity = stockRows.reduce((sum, r) => sum + r.totalQuantity, 0);

  return {
    summary: {
      totalSkus,
      inStockCount: inStockItems.length,
      outOfStockCount: outOfStockItems.length,
      totalQuantity,
      totalFulfillable,
      totalReserved,
      totalUnfulfillable,
      totalInbound,
    },

    inStockItems: inStockItems
      .map((r) => ({
        sellerSku: r.sellerSku,
        asin: r.asin,
        productName: r.productName,
        fulfillableQuantity: r.fulfillableQuantity,
        totalQuantity: r.totalQuantity,
        totalReservedQuantity: r.totalReservedQuantity,
        totalUnfulfillableQuantity: r.totalUnfulfillableQuantity,
      }))
      .sort((a, b) => b.fulfillableQuantity - a.fulfillableQuantity),

    outOfStockItems: outOfStockItems
      .map((r) => ({
        sellerSku: r.sellerSku,
        asin: r.asin,
        productName: r.productName,
        lastUpdatedTime: r.lastUpdatedTime,
      }))
      .sort((a, b) => a.sellerSku.localeCompare(b.sellerSku)),

    allItems: stockRows,

    metadata: {
      totalItems: totalSkus,
      generatedAt: now.toISOString(),
    },
  };
}

// ─────────────────────────────────────────────
// 4. MAIN — FETCH INVENTORY STOCK DATA
// ─────────────────────────────────────────────

/**
 * Fetch FBA inventory stock data with full details.
 *
 * @param {Object}   config
 * @param {string}   config.userId       - User ID (for logging / DB association)
 * @param {string}   config.country      - Country code (e.g. "IN", "US", "UK")
 * @param {string}   [config.region]     - Region override (optional)
 * @param {string}   [config.accessToken]  - Pre-fetched access token (optional)
 * @param {string}   [config.refreshToken] - LWA refresh token (required if no accessToken)
 * @param {string}   [config.clientId]     - LWA client ID (required if no accessToken)
 * @param {string}   [config.clientSecret] - LWA client secret (required if no accessToken)
 * @param {string[]} [config.sellerSkus]   - Optional SKU filter
 *
 * @returns {Object} result
 * @returns {boolean}  result.hasData
 * @returns {Object[]} result.stockRows      - Normalized stock objects
 * @returns {Object}   result.analysis       - Analyzed inventory data
 * @returns {string}   result.marketplaceId
 */
async function fetchInventoryStock(config) {
  const {
    userId,
    country,
    sellerSkus = [],
    accessToken: providedAccessToken,
    refreshToken,
    clientId,
    clientSecret,
  } = config;

  const countryUpper = country.toUpperCase();
  const { marketplaceId, baseUrl, region } = resolveMarketplaceAndRegion(countryUpper, config.region);

  logger.info(`[Inventory Fetch] User: ${userId} | Country: ${countryUpper} | Region: ${region}`);
  logger.info(`[Inventory Fetch] Base URL: ${baseUrl} | Marketplace: ${marketplaceId}`);

  // Get access token
  let accessToken = providedAccessToken;
  if (!accessToken) {
    logger.info("[Inventory Fetch] Getting access token...");
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
    logger.info("[Inventory Fetch] Access token obtained.");
  }

  // Fetch all inventory summaries with pagination
  const inventorySummaries = await fetchInventorySummaries(accessToken, baseUrl, marketplaceId, sellerSkus);

  logger.info(`[Inventory Fetch] Fetched ${inventorySummaries.length} inventory items.`);

  if (inventorySummaries.length === 0) {
    return {
      hasData: false,
      stockRows: [],
      analysis: null,
      marketplaceId,
    };
  }

  // Parse into normalized stock rows
  const stockRows = parseInventorySummaries(inventorySummaries);

  // Analyze
  const analysis = analyzeInventory(stockRows);

  logger.info(
    `[Inventory Fetch] Summary — In Stock: ${analysis.summary.inStockCount} | Out of Stock: ${analysis.summary.outOfStockCount} | Total Fulfillable: ${analysis.summary.totalFulfillable}`
  );

  return {
    hasData: true,
    stockRows,
    analysis,
    marketplaceId,
  };
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  // ── Main function ──
  fetchInventoryStock,

  // ── Utilities ──
  fetchInventorySummaries,
  parseInventorySummaries,
  analyzeInventory,
};
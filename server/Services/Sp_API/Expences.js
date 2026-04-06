const https = require("https");
const http = require("http");
const zlib = require("zlib");
const logger = require("../../utils/Logger.js");
const { URIs, marketplaceConfig: sharedMarketplaceConfig } = require("../../controllers/config/config.js");
const { getDefaultExpenseFinanceDaysBack } = require("../../config/expenseFinanceDaysBack.js");

// ─────────────────────────────────────────────
// 1. COUNTRY -> INTERNAL REGION CONFIG
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// 2. DATE HELPERS
// ─────────────────────────────────────────────

function formatDateDDMMYYYY(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "N/A";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Format Date to YYYY-MM-DD string (for postedDateStr)
 */
function formatDateYYYYMMDD(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0];
}

/**
 * Parse any date string into a Date object
 */
function parseDate(dateStr) {
  if (!dateStr || (typeof dateStr === "string" && dateStr.trim() === "")) return null;
  if (dateStr instanceof Date) return dateStr;

  // Handle "DD.MM.YYYY HH:MM:SS UTC" (settlement format)
  const euMatch = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (euMatch) {
    return new Date(`${euMatch[3]}-${euMatch[2]}-${euMatch[1]}T${euMatch[4]}Z`);
  }

  return new Date(dateStr);
}

// ─────────────────────────────────────────────
// 3. HTTP HELPERS
// ─────────────────────────────────────────────

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
// 4. SP-API AUTH
// ─────────────────────────────────────────────

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
// 5. FINANCE API — FETCH FINANCIAL EVENTS
// ─────────────────────────────────────────────

/**
 * Fetch all financial events from Finance API with pagination.
 *
 * @param {string} accessToken
 * @param {string} baseUrl
 * @param {string} postedAfter  - ISO date string
 * @param {string} [postedBefore] - ISO date string (optional)
 * @returns {Object} Combined FinancialEvents object
 */
async function fetchFinancialEvents(accessToken, baseUrl, postedAfter, postedBefore) {
  const allEvents = {};
  let nextToken = null;
  let pageCount = 0;

  do {
    let path;
    if (nextToken) {
      path = `/finances/v0/financialEvents?NextToken=${encodeURIComponent(nextToken)}`;
    } else {
      const params = new URLSearchParams({
        PostedAfter: postedAfter,
        MaxResultsPerPage: "100",
      });
      if (postedBefore) {
        params.set("PostedBefore", postedBefore);
      }
      path = `/finances/v0/financialEvents?${params.toString()}`;
    }

    const res = await httpsRequest({
      hostname: baseUrl,
      path,
      method: "GET",
      headers: { "x-amz-access-token": accessToken },
    });

    if (res.body.errors) {
      throw new Error(`Finance API failed: ${JSON.stringify(res.body.errors)}`);
    }

    const payload = res.body.payload || {};
    const events = payload.FinancialEvents || {};

    // Merge all event lists
    for (const [key, val] of Object.entries(events)) {
      if (Array.isArray(val)) {
        if (!allEvents[key]) allEvents[key] = [];
        allEvents[key].push(...val);
      }
    }

    nextToken = payload.NextToken || null;
    pageCount++;
    logger.info(`[Finance API] Page ${pageCount}: fetched events. NextToken: ${nextToken ? "yes" : "no"}`);
  } while (nextToken);

  return allEvents;
}

// ─────────────────────────────────────────────
// 6. AMAZON FEE CLASSIFICATION
// ─────────────────────────────────────────────

const AMAZON_FEE_CATEGORIES = new Set([
  "Referral Commission",
  "Closing Fee",
  "FBA Fulfillment Fee",
  "Shipping / Easy Ship Fee",
  "Shipping Chargeback",
  "FBA Storage Fee",
  "FBA Disposal Fee",
  "Subscription Fee",
]);

function isAmazonFee(category) {
  return AMAZON_FEE_CATEGORIES.has(category);
}

/**
 * Map Finance API FeeType to our standard category name
 */
function mapFeeTypeToCategory(feeType) {
  switch (feeType) {
    case "Commission":
    case "RefundCommission":
      return "Referral Commission";
    case "FBAPerUnitFulfillmentFee":
      return "FBA Fulfillment Fee";
    case "ShippingChargeback":
    case "ShippingHB":
      return "Shipping Chargeback";
    case "VariableClosingFee":
      return "Closing Fee";
    case "GiftwrapChargeback":
      return "Other Fee";
    default:
      return feeType || "Other Fee";
  }
}

// ─────────────────────────────────────────────
// 7. PARSE FINANCE API EVENTS → EXPENSE ROWS
// ─────────────────────────────────────────────

/**
 * Convert Finance API FinancialEvents into normalized expense rows.
 * Same object shape as before so analyzeExpenses works unchanged.
 *
 * @param {Object} financialEvents - Combined FinancialEvents from fetchFinancialEvents
 * @returns {Object[]} Array of expense objects
 */
function parseFinancialEvents(financialEvents) {
  const expenses = [];

  // ── 1. Order Fees (ShipmentEventList) ──
  for (const shipment of financialEvents.ShipmentEventList || []) {
    const orderId = shipment.AmazonOrderId || "";
    const postedDate = shipment.PostedDate ? new Date(shipment.PostedDate) : null;
    const postedDateStr = postedDate ? formatDateYYYYMMDD(postedDate) : "";

    for (const item of shipment.ShipmentItemList || []) {
      const sku = item.SellerSKU || "N/A";

      // Item Fees (Commission, FBA, ShippingChargeback, etc.)
      for (const fee of item.ItemFeeList || []) {
        const amount = parseFloat(fee.FeeAmount?.CurrencyAmount || 0);
        if (amount === 0) continue;

        const category = mapFeeTypeToCategory(fee.FeeType);

        expenses.push({
          amount,
          absoluteAmount: Math.abs(amount),
          category,
          isAmazonFee: isAmazonFee(category),
          amountType: "ItemFees",
          amountDescription: fee.FeeType || "",
          sku,
          orderId,
          transactionType: "Order",
          postedDate,
          postedDateStr,
        });
      }

      // Promotions
      for (const promo of item.PromotionList || []) {
        const amount = parseFloat(promo.PromotionAmount?.CurrencyAmount || 0);
        if (amount === 0) continue;

        expenses.push({
          amount,
          absoluteAmount: Math.abs(amount),
          category: "Promotions / Discounts",
          isAmazonFee: false,
          amountType: "Promotion",
          amountDescription: promo.PromotionType || "Promotion",
          sku,
          orderId,
          transactionType: "Order",
          postedDate,
          postedDateStr,
        });
      }
    }
  }

  // ── 2. Refund Fees (RefundEventList) ──
  for (const refund of financialEvents.RefundEventList || []) {
    const orderId = refund.AmazonOrderId || "";
    const postedDate = refund.PostedDate ? new Date(refund.PostedDate) : null;
    const postedDateStr = postedDate ? formatDateYYYYMMDD(postedDate) : "";

    const itemList = refund.ShipmentItemAdjustmentList || refund.ShipmentItemList || [];
    for (const item of itemList) {
      const sku = item.SellerSKU || "N/A";

      // Refund fee adjustments
      const feeList = item.ItemFeeAdjustmentList || item.ItemFeeList || [];
      for (const fee of feeList) {
        const amount = parseFloat(fee.FeeAmount?.CurrencyAmount || 0);
        if (amount === 0) continue;

        const category = mapFeeTypeToCategory(fee.FeeType);

        expenses.push({
          amount,
          absoluteAmount: Math.abs(amount),
          category,
          isAmazonFee: isAmazonFee(category),
          amountType: "ItemFees",
          amountDescription: fee.FeeType || "",
          sku,
          orderId,
          transactionType: "Refund",
          postedDate,
          postedDateStr,
        });
      }

      // Refund promotion adjustments
      const promoList = item.PromotionAdjustmentList || item.PromotionList || [];
      for (const promo of promoList) {
        const amount = parseFloat(promo.PromotionAmount?.CurrencyAmount || 0);
        if (amount === 0) continue;

        expenses.push({
          amount,
          absoluteAmount: Math.abs(amount),
          category: "Promotions / Discounts",
          isAmazonFee: false,
          amountType: "Promotion",
          amountDescription: promo.PromotionType || "Promotion",
          sku,
          orderId,
          transactionType: "Refund",
          postedDate,
          postedDateStr,
        });
      }
    }
  }

  // ── 3. Service Fees (Subscription, etc.) ──
  for (const sfe of financialEvents.ServiceFeeEventList || []) {
    for (const fee of sfe.FeeList || []) {
      const amount = parseFloat(fee.FeeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;

      const category = fee.FeeType === "Subscription" ? "Subscription Fee" : (fee.FeeType || "Other Fee");
      const postedDate = new Date(); // ServiceFeeEvents don't have PostedDate
      const postedDateStr = formatDateYYYYMMDD(postedDate);

      expenses.push({
        amount,
        absoluteAmount: Math.abs(amount),
        category,
        isAmazonFee: isAmazonFee(category),
        amountType: "ServiceFee",
        amountDescription: fee.FeeType || "",
        sku: "N/A",
        orderId: "",
        transactionType: "ServiceFee",
        postedDate,
        postedDateStr,
      });
    }
  }

  // ── 4. Advertising / PPC ──
  for (const ad of financialEvents.ProductAdsPaymentEventList || []) {
    const amount = parseFloat(ad.transactionValue?.CurrencyAmount || 0);
    if (amount === 0) continue;

    const postedDate = ad.postedDate ? new Date(ad.postedDate) : null;
    const postedDateStr = postedDate ? formatDateYYYYMMDD(postedDate) : "";

    expenses.push({
      amount,
      absoluteAmount: Math.abs(amount),
      category: "Advertising / PPC",
      isAmazonFee: false,
      amountType: "Cost of Advertising",
      amountDescription: ad.transactionType || "Advertising",
      sku: "N/A",
      orderId: ad.invoiceId || "",
      transactionType: "Advertising",
      postedDate,
      postedDateStr,
    });
  }

  // ── 5. Removal / Disposal Fees ──
  for (const removal of financialEvents.RemovalShipmentEventList || []) {
    const postedDate = removal.PostedDate ? new Date(removal.PostedDate) : null;
    const postedDateStr = postedDate ? formatDateYYYYMMDD(postedDate) : "";

    for (const item of removal.RemovalShipmentItemList || []) {
      const amount = parseFloat(item.FeeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;

      expenses.push({
        amount: -Math.abs(amount), // fees are negative
        absoluteAmount: Math.abs(amount),
        category: "FBA Disposal Fee",
        isAmazonFee: true,
        amountType: "other-transaction",
        amountDescription: "DisposalComplete",
        sku: item.SellerSKU || "N/A",
        orderId: removal.OrderId || "",
        transactionType: "Removal",
        postedDate,
        postedDateStr,
      });
    }
  }

  // ── 6. Adjustment Events (storage fees, reimbursements, etc.) ──
  for (const adj of financialEvents.AdjustmentEventList || []) {
    const postedDate = adj.PostedDate ? new Date(adj.PostedDate) : null;
    const postedDateStr = postedDate ? formatDateYYYYMMDD(postedDate) : "";
    const adjType = adj.AdjustmentType || "";

    for (const item of adj.AdjustmentItemList || []) {
      const amount = parseFloat(item.TotalAmount?.CurrencyAmount || item.PerUnitAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;

      let category = adjType || "Other Fee";
      if (adjType.includes("Storage")) category = "FBA Storage Fee";
      if (adjType.includes("Reimbursement")) continue; // skip reimbursements (not an expense)

      expenses.push({
        amount,
        absoluteAmount: Math.abs(amount),
        category,
        isAmazonFee: isAmazonFee(category),
        amountType: "Adjustment",
        amountDescription: adjType,
        sku: item.SellerSKU || "N/A",
        orderId: "",
        transactionType: "Adjustment",
        postedDate,
        postedDateStr,
      });
    }
  }

  // ── 7. TDS Reimbursement (India) ──
  for (const tds of financialEvents.TDSReimbursementEventList || []) {
    const amount = parseFloat(tds.ReimbursedAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;

    const postedDate = tds.PostedDate ? new Date(tds.PostedDate) : null;
    const postedDateStr = postedDate ? formatDateYYYYMMDD(postedDate) : "";

    expenses.push({
      amount: -Math.abs(amount),
      absoluteAmount: Math.abs(amount),
      category: "TDS (Tax Deducted at Source)",
      isAmazonFee: false,
      amountType: "ItemTDS",
      amountDescription: "TDS",
      sku: "N/A",
      orderId: "",
      transactionType: "TDS",
      postedDate,
      postedDateStr,
    });
  }

  // ── 8. Tax Withholding Events (TCS for India) ──
  for (const tax of financialEvents.TaxWithholdingEventList || []) {
    const postedDate = tax.PostedDate ? new Date(tax.PostedDate) : null;
    const postedDateStr = postedDate ? formatDateYYYYMMDD(postedDate) : "";

    for (const component of tax.TaxWithholdingComponentList || []) {
      const amount = parseFloat(component.TaxAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;

      expenses.push({
        amount: -Math.abs(amount),
        absoluteAmount: Math.abs(amount),
        category: "TCS (Tax Collected at Source)",
        isAmazonFee: false,
        amountType: "ItemTCS",
        amountDescription: component.TaxType || "TCS",
        sku: "N/A",
        orderId: "",
        transactionType: "TaxWithholding",
        postedDate,
        postedDateStr,
      });
    }
  }

  return expenses;
}

// ─────────────────────────────────────────────
// 8. EXPENSE ANALYSIS ENGINE (UNCHANGED)
// ─────────────────────────────────────────────
//
// IMPORTANT: This function receives ALL expense data
// (from your DB), not just new data. This ensures
// 7/14 day calculations are correct.
//

function analyzeExpenses(expenseRows) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const expenses = expenseRows.map((e) => ({
    ...e,
    postedDate: e.postedDate instanceof Date ? e.postedDate : parseDate(e.postedDate || e.postedDateStr),
  }));

  function aggregateByCategory(filtered) {
    const catMap = {};
    let total = 0;
    for (const exp of filtered) {
      total += exp.amount;
      if (!catMap[exp.category]) {
        catMap[exp.category] = { category: exp.category, totalAmount: 0, count: 0 };
      }
      catMap[exp.category].totalAmount += exp.amount;
      catMap[exp.category].count++;
    }
    const categories = Object.values(catMap)
      .map((c) => ({ ...c, totalAmount: Math.round(c.totalAmount * 100) / 100 }))
      .sort((a, b) => a.totalAmount - b.totalAmount);
    return { total: Math.round(total * 100) / 100, categories };
  }

  function aggregateBySku(filtered) {
    const skuMap = {};
    for (const exp of filtered) {
      const sku = exp.sku;
      if (!skuMap[sku]) skuMap[sku] = { sku, totalAmount: 0, count: 0, breakdown: {} };
      skuMap[sku].totalAmount += exp.amount;
      skuMap[sku].count++;
      if (!skuMap[sku].breakdown[exp.category]) skuMap[sku].breakdown[exp.category] = 0;
      skuMap[sku].breakdown[exp.category] += exp.amount;
    }
    return Object.values(skuMap)
      .map((s) => ({
        ...s,
        totalAmount: Math.round(s.totalAmount * 100) / 100,
        breakdown: Object.entries(s.breakdown)
          .map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 }))
          .sort((a, b) => a.amount - b.amount),
      }))
      .sort((a, b) => a.totalAmount - b.totalAmount);
  }

  function aggregateBySkuAndDate(filtered) {
    const map = {};
    for (const exp of filtered) {
      const dateKey = exp.postedDateStr || "Unknown";
      const sku = exp.sku;
      const key = `${sku}||${dateKey}`;
      if (!map[key]) map[key] = { sku, date: dateKey, totalAmount: 0, count: 0, breakdown: {} };
      map[key].totalAmount += exp.amount;
      map[key].count++;
      if (!map[key].breakdown[exp.category]) map[key].breakdown[exp.category] = 0;
      map[key].breakdown[exp.category] += exp.amount;
    }
    return Object.values(map)
      .map((entry) => ({
        ...entry,
        totalAmount: Math.round(entry.totalAmount * 100) / 100,
        breakdown: Object.entries(entry.breakdown)
          .map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 }))
          .sort((a, b) => a.amount - b.amount),
      }))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? -1 : 1;
        return a.sku.localeCompare(b.sku);
      });
  }

  function aggregateByDate(filtered) {
    const dateMap = {};
    for (const exp of filtered) {
      const dateKey = exp.postedDateStr || "Unknown";
      if (!dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, totalAmount: 0, count: 0, breakdown: {} };
      dateMap[dateKey].totalAmount += exp.amount;
      dateMap[dateKey].count++;
      if (!dateMap[dateKey].breakdown[exp.category]) dateMap[dateKey].breakdown[exp.category] = 0;
      dateMap[dateKey].breakdown[exp.category] += exp.amount;
    }
    return Object.values(dateMap)
      .map((entry) => ({
        ...entry,
        totalAmount: Math.round(entry.totalAmount * 100) / 100,
        breakdown: Object.entries(entry.breakdown)
          .map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 }))
          .sort((a, b) => a.amount - b.amount),
      }))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? -1 : 1;
        return 0;
      });
  }

  const last7 = expenses.filter((e) => e.postedDate && e.postedDate >= sevenDaysAgo);
  const last14 = expenses.filter((e) => e.postedDate && e.postedDate >= fourteenDaysAgo);

  const amazonFeesAll = expenses.filter((e) => e.isAmazonFee);
  const amazonFeesLast7 = last7.filter((e) => e.isAmazonFee);
  const amazonFeesLast14 = last14.filter((e) => e.isAmazonFee);

  const expenseEarliest = expenses.reduce(
    (min, e) => (e.postedDate && (!min || e.postedDate < min) ? e.postedDate : min), null
  );
  const expenseLatest = expenses.reduce(
    (max, e) => (e.postedDate && (!max || e.postedDate > max) ? e.postedDate : max), null
  );

  return {
    // ═══ TOTAL EXPENSES (all deductions) ═══
    totalExpenses: aggregateByCategory(expenses),
    totalExpensesLast7Days: aggregateByCategory(last7),
    totalExpensesLast14Days: aggregateByCategory(last14),
    skuWiseExpenses: aggregateBySku(expenses),
    skuWiseExpensesLast7Days: aggregateBySku(last7),
    skuWiseExpensesLast14Days: aggregateBySku(last14),
    skuDateWiseExpenses: aggregateBySkuAndDate(expenses),
    dateWiseExpenses: aggregateByDate(expenses),

    // ═══ AMAZON FEES ONLY ═══
    totalAmazonFees: aggregateByCategory(amazonFeesAll),
    totalAmazonFeesLast7Days: aggregateByCategory(amazonFeesLast7),
    totalAmazonFeesLast14Days: aggregateByCategory(amazonFeesLast14),
    dateWiseAmazonFees: aggregateByDate(amazonFeesAll),

    // Metadata
    metadata: {
      totalExpenseRows: expenses.length,
      totalAmazonFeeRows: amazonFeesAll.length,
      amazonFeeCategories: Array.from(AMAZON_FEE_CATEGORIES),
      nonAmazonFeeCategories: [
        "TCS (Tax Collected at Source)",
        "TDS (Tax Deducted at Source)",
        "Advertising / PPC",
        "Promotions / Discounts",
      ],
      dateRange: {
        from: expenseEarliest,
        to: expenseLatest,
        fromFormatted: formatDateDDMMYYYY(expenseEarliest),
        toFormatted: formatDateDDMMYYYY(expenseLatest),
      },
      generatedAt: now.toISOString(),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 9. STEP 1 — FETCH FINANCE DATA
// ─────────────────────────────────────────────────────────────
//
// Fetches a rolling window: (yesterday - daysBack) → yesterday (UTC).
// Default daysBack: EXPENSE_FINANCE_DAYS_BACK env or 30 (see expenseFinanceDaysBack.js).
//
// Each run replaces overlapping ExpenseRawRow rows for that window so aggregates stay consistent.
//

/**
 * Fetch financial events from Finance API.
 * Always fetches: (yesterday - daysBack) to yesterday.
 *
 * @param {Object} config
 * @param {string} config.country
 * @param {string} [config.region]
 * @param {string} [config.accessToken]
 * @param {string} [config.refreshToken]
 * @param {string} [config.clientId]
 * @param {string} [config.clientSecret]
 * @param {number} [config.daysBack]  - Days before yesterday to fetch (default: env EXPENSE_FINANCE_DAYS_BACK or 30)
 *
 * @returns {Object} result
 * @returns {boolean}  result.hasNewData
 * @returns {Object[]} result.expenseRows   - Expense objects for the fetch window
 * @returns {string}   result.postedAfter   - Start of fetch window (ISO string)
 * @returns {string}   result.postedBefore  - End of fetch window (ISO string)
 */
async function fetchNewFinanceData(config) {
  const {
    country,
    daysBack = getDefaultExpenseFinanceDaysBack(),
    accessToken: providedAccessToken,
    refreshToken,
    clientId,
    clientSecret,
  } = config;

  const countryUpper = country.toUpperCase();
  const { baseUrl, region } = resolveMarketplaceAndRegion(countryUpper, config.region);

  logger.info(`[Finance Fetch] Country: ${countryUpper} | Region: ${region}`);
  logger.info(`[Finance Fetch] Base URL: ${baseUrl}`);

  // Get access token
  let accessToken = providedAccessToken;
  if (!accessToken) {
    logger.info("[Finance Fetch] Getting access token...");
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
    logger.info("[Finance Fetch] Access token obtained.");
  }

  // Calculate date window: (yesterday - daysBack) to yesterday
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59));
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1 - daysBack, 0, 0, 0));

  const postedAfter = startDate.toISOString();
  const postedBefore = yesterday.toISOString();

  logger.info(`[Finance Fetch] Fetching window: ${formatDateDDMMYYYY(startDate)} → ${formatDateDDMMYYYY(yesterday)} (${daysBack} days)`);

  // Fetch all events with pagination
  const financialEvents = await fetchFinancialEvents(accessToken, baseUrl, postedAfter, postedBefore);

  // Parse into expense rows
  const expenseRows = parseFinancialEvents(financialEvents);

  logger.info(`[Finance Fetch] Parsed ${expenseRows.length} expense rows.`);

  if (expenseRows.length > 0) {
    const dates = expenseRows.filter(e => e.postedDateStr).map(e => e.postedDateStr).sort();
    logger.info(`[Finance Fetch] Data date range: ${dates[0]} → ${dates[dates.length - 1]}`);
  }

  return {
    hasNewData: expenseRows.length > 0,
    expenseRows,
    postedAfter,
    postedBefore,
  };
}

// ─────────────────────────────────────────────────────────────
// 10. CONVENIENCE — Combined fetch + analyze
// ─────────────────────────────────────────────────────────────

async function fetchAndAnalyze(config) {
  const result = await fetchNewFinanceData(config);

  if (!result.hasNewData) {
    return { data: null, postedAfter: result.postedAfter, postedBefore: result.postedBefore };
  }

  const analysis = analyzeExpenses(result.expenseRows);

  logger.info(`[Analyze] Total expenses: ${analysis.totalExpenses.total} | Amazon fees: ${analysis.totalAmazonFees.total}`);

  return {
    data: analysis,
    postedAfter: result.postedAfter,
    postedBefore: result.postedBefore,
  };
}

// ─────────────────────────────────────────────
// 11. OFFLINE MODE — Parse local JSON files
// ─────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

/**
 * Parse local Finance API JSON response files
 */
function analyzeLocalFinanceFiles(filePaths) {
  const allEvents = {};

  for (const filePath of filePaths) {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(rawContent);
    const events = data.payload?.FinancialEvents || data.FinancialEvents || {};

    for (const [key, val] of Object.entries(events)) {
      if (Array.isArray(val)) {
        if (!allEvents[key]) allEvents[key] = [];
        allEvents[key].push(...val);
      }
    }

    logger.info(`Parsed ${path.basename(filePath)}`);
  }

  const expenseRows = parseFinancialEvents(allEvents);
  logger.info(`Total expense rows: ${expenseRows.length}`);

  const result = analyzeExpenses(expenseRows);

  logger.info(`[Summary] Expense data range: ${result.metadata.dateRange.fromFormatted} → ${result.metadata.dateRange.toFormatted}`);
  logger.info(`[Summary] Total expenses: ${result.totalExpenses.total} | Amazon fees: ${result.totalAmazonFees.total}`);

  return result;
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  // ── Main functions ──
  fetchNewFinanceData,     // Step 1: Fetch new data → save to DB (deduplicate by dedupKey)
  analyzeExpenses,         // Step 2: Analyze ALL data from DB → 7/14 day totals
  fetchAndAnalyze,         // Convenience: fetch + analyze in one call

  // ── Utilities ──
  parseFinancialEvents,    // Convert Finance API JSON → expense rows
  analyzeLocalFinanceFiles,// Offline testing with JSON files
  isAmazonFee,
  AMAZON_FEE_CATEGORIES,
  formatDateDDMMYYYY,

  // ── Low-level helpers ──
  getAccessToken,
  fetchFinancialEvents,
  resolveMarketplaceAndRegion,
  COUNTRY_TO_INTERNAL_REGION,
  REGION_BASE_URLS,
};
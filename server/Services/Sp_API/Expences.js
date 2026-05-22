const https = require("https");
const http = require("http");
const zlib = require("zlib");
const logger = require("../../utils/Logger.js");
const { URIs, marketplaceConfig: sharedMarketplaceConfig } = require("../../controllers/config/config.js");
const { getDefaultExpenseFinanceDaysBack } = require("../../config/expenseFinanceDaysBack.js");

// ═════════════════════════════════════════════════════════════════════════════
// MIGRATED TO FINANCES API v2024-06-19
//
// Endpoint:  GET /finances/2024-06-19/transactions
// Reference: https://developer-docs.amazon.com/sp-api/docs/finances-api-v2024-06-19-reference
// Model:     https://github.com/amzn/selling-partner-api-models/blob/main/models/finances-api-model/finances_2024-06-19.json
//
// Key changes from v0:
//   1. Endpoint changed from /finances/v0/financialEvents
//   2. Response is a flat transactions[] array (not 34 nested event lists)
//   3. Pagination param: NextToken → nextToken
//   4. Date params: PostedAfter/PostedBefore → postedAfter/postedBefore (camelCase)
//   5. NEW: marketplaceId query param to filter by specific marketplace
//      (solves the multi-marketplace mixing problem in v0)
//   6. SKU/ASIN now in items[].contexts[].ProductContext (not item.SellerSKU)
//   7. Fees categorized by breakdowns[].breakdownType strings
//      (not the v0 FeeType enum)
//   8. Rate limit: 0.5 req/sec, burst 10 (was 0.5/30 in v0)
// ═════════════════════════════════════════════════════════════════════════════

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
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateYYYYMMDD(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0];
}

function parseDate(dateStr) {
  if (!dateStr || (typeof dateStr === "string" && dateStr.trim() === "")) return null;
  if (dateStr instanceof Date) return dateStr;
  const euMatch = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  if (euMatch) return new Date(`${euMatch[3]}-${euMatch[2]}-${euMatch[1]}T${euMatch[4]}Z`);
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
        try { resolve({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
        catch { resolve({ statusCode: res.statusCode, headers: res.headers, body }); }
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
    grant_type: "refresh_token", refresh_token: refreshToken,
    client_id: clientId, client_secret: clientSecret,
  }).toString();
  const res = await httpsRequest({
    hostname: LWA_TOKEN_URL, path: "/auth/o2/token", method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) },
  }, postData);
  if (!res.body.access_token) throw new Error(`Auth failed: ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. FINANCE API v2024-06-19 — FETCH TRANSACTIONS
//
// Endpoint: GET /finances/2024-06-19/transactions
// Rate limit: 0.5 req/sec, burst 10
//
// Query params:
//   postedAfter            — ISO 8601 date-time (required if no relatedIdentifier)
//   postedBefore           — ISO 8601 date-time (default: 2 min before now)
//   marketplaceId          — Filter by specific marketplace ★ NEW
//   transactionStatus      — RELEASED | DEFERRED | DEFERRED_RELEASED
//   relatedIdentifierName  — ORDER_ID | FINANCIAL_EVENT_GROUP_ID
//   relatedIdentifierValue — Corresponding value
//   nextToken              — For pagination
//
// NOTE: postedAfter and postedBefore must be > 2 minutes before request time.
//       If they're more than 180 days apart, response is empty.
// ═════════════════════════════════════════════════════════════════════════════
// `tokenRefresher` (optional) is a `() => Promise<string>` that returns a
// fresh SP-API access token. When supplied, this loop will transparently
// refresh the token if Amazon responds with "Unauthorized / access token
// expired" and continue from the same page — pagination is NOT restarted.
function isExpiredTokenResponse(res) {
  if (!res) return false;
  if (res.statusCode === 401 || res.statusCode === 403) return true;
  if (!Array.isArray(res.body?.errors)) return false;
  return res.body.errors.some((e) => {
    if (!e) return false;
    if (e.code === "Unauthorized" || e.code === "InvalidAccessToken") return true;
    const blob = `${e.message || ""} ${e.details || ""}`.toLowerCase();
    return blob.includes("access token") && (blob.includes("expired") || blob.includes("invalid"));
  });
}

async function fetchTransactions(accessToken, baseUrl, postedAfter, postedBefore, marketplaceId, tokenRefresher = null) {
  const allTransactions = [];
  let nextToken = null;
  let pageCount = 0;
  let currentToken = accessToken;
  const MAX_RETRIES = 5;
  const MAX_AUTH_REFRESHES_PER_PAGE = 2;

  do {
    let path;
    if (nextToken) {
      // For pagination: include same arguments as the call that produced the token
      const params = new URLSearchParams({ nextToken });
      path = `/finances/2024-06-19/transactions?${params.toString()}`;
    } else {
      const params = new URLSearchParams({ postedAfter });
      if (postedBefore) params.set("postedBefore", postedBefore);
      if (marketplaceId) params.set("marketplaceId", marketplaceId);
      path = `/finances/2024-06-19/transactions?${params.toString()}`;
    }

    let res;
    let authRefreshCount = 0;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      res = await httpsRequest({
        hostname: baseUrl,
        path,
        method: "GET",
        headers: { "x-amz-access-token": currentToken },
      });

      // ★ Auto-renew on expired access token. Does not consume a throttle
      //   retry — token errors are independent of rate-limit retries.
      if (isExpiredTokenResponse(res) && tokenRefresher && authRefreshCount < MAX_AUTH_REFRESHES_PER_PAGE) {
        authRefreshCount++;
        logger.warn(
          `[Finance API v2024-06-19] Access token expired on page ${pageCount + 1} (auth retry ${authRefreshCount}/${MAX_AUTH_REFRESHES_PER_PAGE}). Refreshing…`
        );
        currentToken = await tokenRefresher();
        attempt--; // retry the same page with the new token without burning a throttle attempt
        continue;
      }

      const isThrottled =
        res.statusCode === 429 ||
        (Array.isArray(res.body.errors) && res.body.errors.some((e) => e.code === "QuotaExceeded"));

      if (isThrottled && attempt < MAX_RETRIES) {
        const delayMs = Math.min(10000 * Math.pow(2, attempt), 60000);
        logger.warn(
          `[Finance API v2024-06-19] Throttled on page ${pageCount + 1}, attempt ${attempt + 1}/${MAX_RETRIES}. Retrying in ${delayMs / 1000}s...`
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      break;
    }

    if (res.body.errors) {
      throw new Error(`Finance API v2024-06-19 failed: ${JSON.stringify(res.body.errors)}`);
    }

    const payload = res.body.payload || {};
    const transactions = payload.transactions || [];
    allTransactions.push(...transactions);

    nextToken = payload.nextToken || null;
    pageCount++;
    logger.info(
      `[Finance API v2024-06-19] Page ${pageCount}: fetched ${transactions.length} transactions. nextToken: ${nextToken ? "yes" : "no"}`
    );
  } while (nextToken);

  logger.info(`[Finance API v2024-06-19] Total transactions: ${allTransactions.length}`);
  return allTransactions;
}

// ─────────────────────────────────────────────
// 6. AMAZON FEE CLASSIFICATION
//    Maps v2024-06-19 breakdownType strings to our internal categories.
//    The new API uses descriptive strings (not v0's FeeType enum).
// ─────────────────────────────────────────────
const AMAZON_FEE_CATEGORIES = new Set([
  "Referral Commission", "Closing Fee", "FBA Fulfillment Fee",
  "Shipping / Easy Ship Fee", "Shipping Chargeback",
  "FBA Storage Fee", "FBA Disposal Fee", "FBA Removal Fee",
  "FBA Inbound Transportation Fee", "Subscription Fee", "Technology Fee",
  "FBA Liquidation Fee", "Deal Fee", "Coupon Redemption Fee",
  "Imaging Services Fee", "FBA Capacity Reservation Fee",
  "Value Added Service Fee", "Early Reviewer Program Fee",
]);

function isAmazonFee(category) { return AMAZON_FEE_CATEGORIES.has(category); }

/**
 * Map a v2024-06-19 breakdown to our internal expense category, using the
 * full path through the breakdown tree.
 *
 * The real v2024-06-19 structure (verified with live India seller data) is:
 *
 *   ProductCharges
 *     OurPricePrincipal       ← REVENUE (product price)
 *   Tax
 *     OurPriceTax             ← Tax collected from buyer
 *     OurPriceTaxDiscount     ← Tax discount
 *     ShippingTax             ← Shipping tax collected
 *     ShippingTaxDiscount     ← Shipping tax discount
 *   Shipping
 *     ShippingPrincipal       ← Shipping revenue
 *   PromoRebates
 *     OurPriceDiscount        ← Discount given to customer
 *     ShippingDiscount        ← Shipping discount given
 *   AmazonFees
 *     Commission > Base       ← Referral commission base
 *     Commission > Promo      ← Commission on promo amount
 *     FBAPerUnitFulfillmentFee > Base / Tax
 *     FBAWeightBasedFee       > Base / Tax
 *     FixedClosingFee         > Base / Tax
 *     VariableClosingFee      > Base / Tax
 *     TechnologyFee           > Base / Tax
 *     ShippingChargeback      > Base / Tax
 *     FBARemovalFee           > Base / Tax
 *     FBAInboundTransportationFee > Base / Tax
 *     RefundCommission        > Base / Tax
 *   TaxWithholding
 *     ItemTDS                 ← TDS deducted (India)
 *   TaxCollectedAtSource
 *     TCS-IGST / TCS-CGST / TCS-SGST  ← TCS collected (India)
 *
 * Returns the category. The single breakdownType (leaf) is also accepted
 * for backward compat, in which case we use heuristics on the leaf alone.
 */
function categorizeBreakdownByPath(path) {
  if (!Array.isArray(path) || path.length === 0) return "Other Fee";
  const fullPath = path.join(">");
  const leaf = path[path.length - 1];
  const parent = path.length >= 2 ? path[path.length - 2] : "";
  const grandparent = path.length >= 3 ? path[path.length - 3] : "";

  // ── REVENUE leaves (Principal-like) ──
  if (leaf === "OurPricePrincipal" || leaf === "Principal" || leaf === "Principle") {
    return "Product Sales";
  }
  if (leaf === "ShippingPrincipal") return "Shipping Revenue";
  if (leaf === "GiftwrapPrincipal" || leaf === "GiftWrapPrincipal") return "Gift Wrap Revenue";
  // ★ FBA Inventory Reimbursement — Amazon paying you back for lost/damaged inventory
  if (leaf === "FBAInventoryReimbursement") return "FBA Inventory Reimbursement";
  // ★ Refund of an FBA fee (Amazon returning a fee they overcharged)
  if (leaf === "FulfillmentFeeRefund") return "Fulfillment Fee Refund";
  // ★ Generic reimbursement (catches Sales>Reimbursements rollup)
  if (leaf === "Reimbursements") return "Reimbursement";
  // ★ Seller reward (Amazon promotional credit / incentive)
  if (leaf === "SellerReward") return "Seller Reward";
  // ★ SERRAC reimbursement (Seller Reimbursement Access program — adjustments)
  if (leaf === "SERRACReimbursement") return "SERRAC Reimbursement";
  // ★ Disbursement / fund transfer (payout from Amazon to seller's bank)
  if (leaf === "FundTransfer") return "Disbursement";

  // ── TAX collected (passes through to gov't) ──
  if (leaf === "OurPriceTax") return "Sales Tax Collected";
  if (leaf === "ShippingTax") return "Shipping Tax Collected";
  if (leaf === "GiftwrapTax" || leaf === "GiftWrapTax") return "Gift Wrap Tax Collected";

  // ── MARKETPLACE FACILITATOR TAX (US — Amazon collects & remits to state) ──
  // These appear as negative amounts that offset the positive Sales Tax Collected.
  // Net effect is $0 on seller's P&L — it's a pass-through.
  // MarketplaceFacilitatorTax-Principal offsets OurPriceTax (product tax)
  // MarketplaceFacilitatorTax-Shipping offsets ShippingTax (shipping tax)
  // MarketplaceFacilitatorTax-Other offsets other tax types
  if (/^MarketplaceFacilitatorTax/i.test(leaf) || /marketplace.facilitator/i.test(leaf)) {
    return "Marketplace Facilitator Tax";
  }

  // ── DISCOUNTS / PROMOS ──
  if (leaf === "OurPriceDiscount") return "Promotions / Discounts";
  if (leaf === "ShippingDiscount") return "Shipping Discount";
  if (leaf === "OurPriceTaxDiscount") return "Tax Discount";
  if (leaf === "ShippingTaxDiscount") return "Shipping Tax Discount";

  // ── TAX WITHHELD (India: TDS / TCS) ──
  if (leaf === "ItemTDS" || /tds/i.test(leaf) || /TaxWithholding/i.test(parent) ||
      /tax.deducted.at.source/i.test(leaf) || leaf === "TaxDeductedAtSource") {
    return "TDS (Tax Deducted at Source)";
  }
  if (/^TCS[-_]/i.test(leaf) || leaf === "TCS" || /TaxCollectedAtSource/i.test(parent) ||
      /tax.collected.at.source/i.test(leaf) || leaf === "TaxCollectedAtSource") {
    return "TCS (Tax Collected at Source)";
  }

  // ── AMAZON FEES (path = AmazonFees > <FeeType> > Base|Tax|Promo) ──
  if (parent === "Commission" || grandparent === "Commission" || /^Commission$/i.test(leaf)) {
    return "Referral Commission";
  }
  if (parent === "RefundCommission" || grandparent === "RefundCommission" || /refund.commission/i.test(leaf)) {
    return "Refund Commission";
  }
  if (parent === "FBAPerUnitFulfillmentFee" || grandparent === "FBAPerUnitFulfillmentFee" ||
      parent === "FBAWeightBasedFee" || grandparent === "FBAWeightBasedFee" ||
      /fba.*fulfillment/i.test(leaf) || /fba.*weight/i.test(leaf) ||
      leaf === "FBA Fees" || leaf === "FBAFees") {
    return "FBA Fulfillment Fee";
  }
  if (parent === "FixedClosingFee" || grandparent === "FixedClosingFee" ||
      parent === "VariableClosingFee" || grandparent === "VariableClosingFee" ||
      /closing.fee/i.test(leaf)) {
    return "Closing Fee";
  }
  if (parent === "TechnologyFee" || grandparent === "TechnologyFee" || /technology.fee/i.test(leaf)) {
    return "Technology Fee";
  }
  if (parent === "ShippingChargeback" || grandparent === "ShippingChargeback" ||
      /shipping.chargeback/i.test(leaf) || leaf === "ShippingHB") {
    return "Shipping Chargeback";
  }
  // ★ Gift wrap chargeback (fee Amazon charges seller for gift wrap service)
  if (parent === "GiftwrapChargeback" || grandparent === "GiftwrapChargeback" ||
      parent === "GiftWrapChargeback" || grandparent === "GiftWrapChargeback" ||
      /giftwrap.chargeback/i.test(leaf)) {
    return "Gift Wrap Chargeback";
  }
  if (parent === "FBARemovalFee" || grandparent === "FBARemovalFee" || /removal.fee/i.test(leaf)) {
    return "FBA Removal Fee";
  }
  if (parent === "FBAInboundTransportationFee" || grandparent === "FBAInboundTransportationFee" ||
      /inbound.transportation/i.test(leaf) || leaf === "InboundTransportationFee") {
    return "FBA Inbound Transportation Fee";
  }
  // ★ FBA Inbound Convenience Fee (additional inbound handling charge)
  if (parent === "FBAInboundConvenienceFee" || grandparent === "FBAInboundConvenienceFee" ||
      /inbound.convenience/i.test(leaf)) {
    return "FBA Inbound Convenience Fee";
  }
  if (parent === "FBADisposalFee" || grandparent === "FBADisposalFee" || /disposal.fee/i.test(leaf)) {
    return "FBA Disposal Fee";
  }
  if (parent === "FBAStorageFee" || grandparent === "FBAStorageFee" || /storage.fee/i.test(leaf) ||
      leaf === "StorageBillingFee") {
    return "FBA Storage Fee";
  }
  if (/easy.?ship/i.test(leaf) || leaf === "EasyShipCharge") {
    return "Shipping / Easy Ship Fee";
  }
  if (/subscription/i.test(leaf)) return "Subscription Fee";
  if (/capacity.reservation/i.test(leaf)) return "FBA Capacity Reservation Fee";
  if (/liquidation.fee/i.test(leaf)) return "FBA Liquidation Fee";
  if (/liquidation.proceed/i.test(leaf)) return "FBA Liquidation Proceeds";
  if (/deal.fee/i.test(leaf)) return "Deal Fee";
  if (/coupon/i.test(leaf)) return "Coupon Redemption Fee";
  if (/imaging.service/i.test(leaf)) return "Imaging Services Fee";
  if (/value.added.service/i.test(leaf)) return "Value Added Service Fee";
  if (/early.reviewer/i.test(leaf)) return "Early Reviewer Program Fee";

  // ── ADVERTISING ──
  if (/advertising|product.ads|ppc/i.test(leaf) || /advertising/i.test(parent)) {
    return "Advertising / PPC";
  }

  // ── REIMBURSEMENT / REFUND-RELATED ──
  // ★ Restocking deduction (Amazon charges buyer a restocking fee on return,
  //   reducing the refund amount — positive value = money retained by seller)
  if (/restocking/i.test(leaf) || /restocking/i.test(parent) ||
      parent === "RestockingDeductionPrincipal" || leaf === "RestockingDeductionPrincipal") {
    return "Restocking Fee";
  }
  // ★ Compensated clawback (Amazon reverses a previous reimbursement — negative value)
  if (/compensated.?clawback/i.test(leaf) || /compensated.?clawback/i.test(parent) ||
      parent === "CompensatedClawback" || leaf === "CompensatedClawback") {
    return "Compensated Clawback";
  }
  if (/safe.?t/i.test(leaf) || /safe.?t/i.test(parent) || leaf === "SAFETReimbursement") {
    return "SAFE-T Reimbursement";
  }
  // ★ FBA Reversed Reimbursement (Amazon claws back a previous reimbursement)
  if (parent === "FBAReversedReimbursement" || grandparent === "FBAReversedReimbursement" ||
      /payment.retraction/i.test(leaf) || /reversed.reimbursement/i.test(leaf)) {
    return "FBA Reversed Reimbursement";
  }
  if (/reimbursement/i.test(leaf)) return "Reimbursement";
  if (/charge.refund/i.test(leaf)) return "Charge Refund";
  if (/debt.recovery/i.test(leaf)) return "Debt Recovery";
  if (/loan/i.test(leaf)) return "Loan Servicing";
  if (/retrocharge/i.test(leaf)) return "Retrocharge";
  if (/rental/i.test(leaf)) return "Rental Fee";
  if (/network.commingling/i.test(leaf)) return "Network Commingling";
  if (/service.provider.credit/i.test(leaf)) return "Service Provider Credit";
  if (/affordability/i.test(leaf)) return "Affordability Promotion Expense";
  if (/adhoc.disbursement/i.test(leaf)) return "Adhoc Disbursement";
  if (/ebt/i.test(leaf)) return "EBT Refund Reimbursement";
  if (/pay.with.amazon/i.test(leaf)) return "Pay With Amazon Fee";
  // ★ Reserve hold/release (temporary fund holds, always net to $0 in pairs)
  if (leaf === "ReserveDebit" || /reserve.?debit/i.test(leaf)) return "Reserve Hold";
  if (leaf === "ReserveCredit" || /reserve.?credit/i.test(leaf)) return "Reserve Release";

  // Pass-through aggregator names (rollup nodes — we shouldn't see them as leaves
  // unless something unusual happened, but guard anyway)
  if (leaf === "Sales" || leaf === "ProductCharges" || leaf === "Product Charges" ||
      leaf === "AmazonFees" || leaf === "Tax" || leaf === "Shipping" || leaf === "PromoRebates" ||
      leaf === "Other" || leaf === "Expenses") {
    return leaf;
  }

  // Generic fallback
  if (/fee/i.test(leaf)) return "Other Fee";

  return leaf;
}

/**
 * Backward-compat single-breakdown-type categorization.
 * Wraps the path-aware version with a single-element path.
 *
 * Kept for any external callers (tests, debugging) that import this directly.
 */
function mapBreakdownTypeToCategory(breakdownType) {
  return categorizeBreakdownByPath([breakdownType || "Other Fee"]);
}

/**
 * Identify which categories represent revenue (positive money inflow that
 * isn't a fee). Used when separating revenue rows from expense rows.
 *
 * Note: Disbursements are technically not revenue (they're transfers OUT
 * of Amazon to your bank), but we include them here as "money inflow" so
 * they get captured separately rather than dumped into the expense bucket.
 * Treat them as a separate "Disbursement" category in your dashboard.
 */
const REVENUE_CATEGORIES = new Set([
  // Core sales
  "Product Sales",
  "Shipping Revenue",
  "Gift Wrap Revenue",
  // Reimbursements / rewards (money Amazon pays you)
  "FBA Inventory Reimbursement",
  "Fulfillment Fee Refund",
  "Reimbursement",
  "SAFE-T Reimbursement",
  "SERRAC Reimbursement",
  "Seller Reward",
  // Disbursement is a payout — list it here so it's not classified as expense
  "Disbursement",
  // Reserve release (temporary hold released back — pairs with Reserve Hold)
  "Reserve Release",
  // Legacy / aggregator names that might leak through
  "Sales", "Product Charges", "ProductCharges", "Principal", "Principle",
]);

function isRevenueCategory(category) {
  return REVENUE_CATEGORIES.has(category);
}

// ─────────────────────────────────────────────
// 7. HELPER: Build expense row
//    Output shape: same fields as before + new `asin` field.
//    The asin is extracted from items[].contexts[].ProductContext in v2024-06-19.
// ─────────────────────────────────────────────
function makeExpenseRow({ amount, category, isAmazonFeeOverride, amountType = "", amountDescription = "", sku = "N/A", asin = "", orderId = "", transactionType = "", postedDate = null, transactionId = "" }) {
  return {
    amount, absoluteAmount: Math.abs(amount), category,
    isAmazonFee: typeof isAmazonFeeOverride === "boolean" ? isAmazonFeeOverride : isAmazonFee(category),
    amountType, amountDescription, sku, asin, orderId, transactionType,
    postedDate, postedDateStr: postedDate ? formatDateYYYYMMDD(postedDate) : "",
    transactionId,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. v2024-06-19 RESPONSE PARSING HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Extract the related identifiers from a transaction or item.
 * Returns a map: { ORDER_ID, SHIPMENT_ID, FINANCIAL_EVENT_GROUP_ID, ... }
 */
function extractRelatedIdentifiers(relatedIdentifiers) {
  const map = {};
  if (!Array.isArray(relatedIdentifiers)) return map;
  for (const id of relatedIdentifiers) {
    const name = id.relatedIdentifierName || id.itemRelatedIdentifierName;
    const value = id.relatedIdentifierValue || id.itemRelatedIdentifierValue;
    if (name && value) map[name] = value;
  }
  return map;
}

/**
 * Extract ProductContext (sku, asin, quantityShipped, fulfillmentNetwork)
 * from an item's contexts[] array.
 *
 * In v2024-06-19, SKU and ASIN live in items[].contexts[] where contextType="ProductContext".
 * This is a major change from v0 where they lived directly on item.SellerSKU.
 */
function extractProductContext(contexts) {
  if (!Array.isArray(contexts)) return {};
  for (const ctx of contexts) {
    if (ctx.contextType === "ProductContext") {
      return {
        sku: ctx.sku || "",
        asin: ctx.asin || "",
        quantityShipped: ctx.quantityShipped || 0,
        fulfillmentNetwork: ctx.fulfillmentNetwork || "",
      };
    }
  }
  return {};
}

/**
 * Recursively walk a breakdowns[] tree and yield every leaf breakdown
 * (the deepest level — these are the actual fee/charge entries).
 *
 * v2024-06-19 nests breakdowns. Example:
 *   { breakdownType: "Sales", breakdownAmount: ..., breakdowns: [
 *     { breakdownType: "Product Charges", breakdownAmount: ..., breakdowns: [
 *       { breakdownType: "Principal", breakdownAmount: ..., breakdowns: [] }
 *     ]}
 *   ]}
 *
 * We walk to the leaves so we get the most granular categorization.
 */
function* walkBreakdowns(breakdowns, parentPath = []) {
  if (!Array.isArray(breakdowns)) return;
  for (const b of breakdowns) {
    const path = [...parentPath, b.breakdownType];
    if (Array.isArray(b.breakdowns) && b.breakdowns.length > 0) {
      yield* walkBreakdowns(b.breakdowns, path);
    } else {
      // Leaf node — this is an actual fee/charge entry
      yield { breakdown: b, path };
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. PARSE v2024-06-19 TRANSACTIONS
//
// New flat structure: a single transactions[] array. Each Transaction has:
//   - relatedIdentifiers[]  → ORDER_ID, SHIPMENT_ID, FINANCIAL_EVENT_GROUP_ID, etc.
//   - transactionType       → "Shipment" (currently the only documented value)
//   - postedDate            → ISO 8601 date-time
//   - totalAmount           → { currencyAmount, currencyCode }
//   - marketplaceDetails    → { marketplaceId, marketplaceName }
//   - items[]               → per-SKU breakdowns
//   - contexts[]            → AmazonPay / Deferred / Business contexts
//   - breakdowns[]          → transaction-level fee/charge breakdowns
//
// Each Item has:
//   - description           → item title
//   - relatedIdentifiers[]  → ORDER_ADJUSTMENT_ITEM_ID, COUPON_ID, etc.
//   - totalAmount           → item subtotal
//   - breakdowns[]          → item-level fee/charge breakdowns (leaf = real entry)
//   - contexts[]            → ProductContext (sku, asin), etc.
// ═════════════════════════════════════════════════════════════════════════════
function parseTransactionsV2024(transactions) {
  const expenses = [];

  for (const txn of transactions) {
    const txnIdentifiers = extractRelatedIdentifiers(txn.relatedIdentifiers);
    const txnOrderId = txnIdentifiers.ORDER_ID || "";
    const txnPostedDate = txn.postedDate ? new Date(txn.postedDate) : null;
    const txnType = txn.transactionType || "Unknown";
    const txnDescription = txn.description || "";
    const txnId = txn.transactionId || "";

    // ────────────────────────────────────────
    // ITEM-LEVEL EXPENSES
    //   Each item has its own breakdowns[] and contexts[] (ProductContext → SKU + ASIN)
    //   This is where most fees live (FBA fees, referral, etc.)
    // ────────────────────────────────────────
    const items = Array.isArray(txn.items) ? txn.items : [];

    // Track whether any item produced a leaf — used to detect cases where
    // items[] is populated but their breakdowns[] is null/empty
    // (e.g. FBAInventoryReimbursement). In those cases the real breakdowns
    // live at the transaction level and need to be attributed to the items.
    let totalItemLeaves = 0;

    for (const item of items) {
      const product = extractProductContext(item.contexts);
      const sku = product.sku || "N/A";
      const asin = product.asin || "";

      // Resolve order ID for this item — prefer item-level identifiers,
      // fall back to transaction-level
      const itemIdentifiers = extractRelatedIdentifiers(item.relatedIdentifiers);
      const itemOrderId = itemIdentifiers.ORDER_ID || txnOrderId || "";

      // Walk every leaf breakdown for this item
      let itemLeavesHere = 0;
      for (const { breakdown, path } of walkBreakdowns(item.breakdowns)) {
        itemLeavesHere++;
        const amount = parseFloat(breakdown.breakdownAmount?.currencyAmount || 0);
        if (amount === 0) continue;

        const category = categorizeBreakdownByPath(path);

        // Skip revenue entries — those are extracted separately by extractRevenueFromTransactions()
        if (isRevenueCategory(category)) continue;

        expenses.push(makeExpenseRow({
          amount,
          category,
          amountType: txnType,
          amountDescription: path.join(" > "), // full breakdown path for traceability
          sku,
          asin,                                // ★ NEW: ASIN propagated to expense row
          orderId: itemOrderId,
          transactionType: txnType,
          postedDate: txnPostedDate,
          transactionId: txnId,
        }));
      }
      totalItemLeaves += itemLeavesHere;
    }

    // ────────────────────────────────────────
    // TRANSACTION-LEVEL EXPENSES
    //
    // The transaction-level breakdowns are usually a roll-up of the item-level
    // ones (same totals). But two cases require us to use them directly:
    //
    //   (a) NO items at all (Transfer, some Adjustments, TaxWithholding)
    //       → use txn-level breakdowns, no SKU/ASIN context
    //
    //   (b) items[] is populated but their breakdowns are empty/null
    //       (FBAInventoryReimbursement, some ServiceFee variants)
    //       → attribute txn-level breakdowns to the first item's SKU/ASIN
    //         (these txns typically have exactly 1 item)
    //
    // In all other cases (Shipment, normal Refund), item-level produced
    // leaves and txn-level is just a duplicate roll-up — skip it.
    // ────────────────────────────────────────
    const txnBreakdowns = Array.isArray(txn.breakdowns)
      ? txn.breakdowns
      : (txn.breakdowns?.breakdowns || []);

    const useTxnLevel = items.length === 0 || totalItemLeaves === 0;

    if (useTxnLevel) {
      // If items exist but had no breakdowns, borrow SKU/ASIN from first item
      let fallbackSku = "N/A";
      let fallbackAsin = "";
      if (items.length > 0) {
        const product = extractProductContext(items[0].contexts);
        fallbackSku = product.sku || "N/A";
        fallbackAsin = product.asin || "";
      }

      for (const { breakdown, path } of walkBreakdowns(txnBreakdowns)) {
        const amount = parseFloat(breakdown.breakdownAmount?.currencyAmount || 0);
        if (amount === 0) continue;

        const category = categorizeBreakdownByPath(path);

        // Skip revenue and disbursement-class categories — handled by extractRevenueFromTransactions
        if (isRevenueCategory(category)) continue;

        expenses.push(makeExpenseRow({
          amount,
          category,
          amountType: txnType,
          amountDescription: path.join(" > "),
          sku: fallbackSku,
          asin: fallbackAsin,
          orderId: txnOrderId,
          transactionType: txnType,
          postedDate: txnPostedDate,
          transactionId: txnId,
        }));
      }
    }
  }

  return expenses;
}

/**
 * NEW: Extract revenue (Principal / Sales) from v2024-06-19 transactions.
 *
 * This is what enables the Sellerboard-style approach — revenue and expenses
 * arrive together in the same transaction, so we never get expenses
 * without matching revenue.
 *
 * Returns rows with positive amounts representing revenue.
 */
function extractRevenueFromTransactions(transactions) {
  const revenueRows = [];

  for (const txn of transactions) {
    const txnIdentifiers = extractRelatedIdentifiers(txn.relatedIdentifiers);
    const txnOrderId = txnIdentifiers.ORDER_ID || "";
    const txnPostedDate = txn.postedDate ? new Date(txn.postedDate) : null;
    const txnType = txn.transactionType || "";
    const txnId = txn.transactionId || "";

    const items = Array.isArray(txn.items) ? txn.items : [];
    let totalItemLeaves = 0;

    // Try item-level breakdowns first
    for (const item of items) {
      const product = extractProductContext(item.contexts);
      const sku = product.sku || "N/A";
      const asin = product.asin || "";
      const quantity = product.quantityShipped || 0;

      const itemIdentifiers = extractRelatedIdentifiers(item.relatedIdentifiers);
      const itemOrderId = itemIdentifiers.ORDER_ID || txnOrderId || "";

      for (const { breakdown, path } of walkBreakdowns(item.breakdowns)) {
        totalItemLeaves++;
        const category = categorizeBreakdownByPath(path);

        // Only revenue categories
        if (!isRevenueCategory(category)) continue;

        const amount = parseFloat(breakdown.breakdownAmount?.currencyAmount || 0);
        if (amount === 0) continue;

        revenueRows.push({
          amount,
          category,
          sku,
          asin,
          quantity,
          orderId: itemOrderId,
          transactionType: txnType,
          postedDate: txnPostedDate,
          postedDateStr: txnPostedDate ? formatDateYYYYMMDD(txnPostedDate) : "",
          breakdownPath: path.join(" > "),
          transactionId: txnId,
        });
      }
    }

    // Fall back to transaction-level breakdowns when item-level is empty
    // (FBAInventoryReimbursement, Transfer/Disbursement, Adjustment, TaxWithholding)
    if (items.length === 0 || totalItemLeaves === 0) {
      let fallbackSku = "N/A";
      let fallbackAsin = "";
      let fallbackQuantity = 0;
      if (items.length > 0) {
        const product = extractProductContext(items[0].contexts);
        fallbackSku = product.sku || "N/A";
        fallbackAsin = product.asin || "";
        fallbackQuantity = product.quantityShipped || 0;
      }

      const txnBreakdowns = Array.isArray(txn.breakdowns)
        ? txn.breakdowns
        : (txn.breakdowns?.breakdowns || []);

      for (const { breakdown, path } of walkBreakdowns(txnBreakdowns)) {
        const category = categorizeBreakdownByPath(path);

        if (!isRevenueCategory(category)) continue;

        const amount = parseFloat(breakdown.breakdownAmount?.currencyAmount || 0);
        if (amount === 0) continue;

        revenueRows.push({
          amount,
          category,
          sku: fallbackSku,
          asin: fallbackAsin,
          quantity: fallbackQuantity,
          orderId: txnOrderId,
          transactionType: txnType,
          postedDate: txnPostedDate,
          postedDateStr: txnPostedDate ? formatDateYYYYMMDD(txnPostedDate) : "",
          breakdownPath: path.join(" > "),
          transactionId: txnId,
        });
      }
    }
  }

  return revenueRows;
}

// ─────────────────────────────────────────────
// 10. EXPENSE ANALYSIS ENGINE (UNCHANGED)
//     Same aggregation logic as before — works on the
//     same expenseRows shape produced by parseTransactionsV2024().
// ─────────────────────────────────────────────
function analyzeExpenses(expenseRows) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const expenses = expenseRows.map((e) => ({ ...e, postedDate: e.postedDate instanceof Date ? e.postedDate : parseDate(e.postedDate || e.postedDateStr) }));

  // Build SKU↔ASIN map across all rows so a SKU's ASIN can be carried even if
  // some individual rows lacked an ASIN (e.g. promo or storage rows).
  const skuToAsin = new Map();
  const asinToSku = new Map();
  for (const e of expenses) {
    if (e.sku && e.sku !== "N/A" && e.asin) {
      skuToAsin.set(e.sku, e.asin);
      asinToSku.set(e.asin, e.sku);
    }
  }
  function lookupAsin(sku) { return skuToAsin.get(sku) || ""; }
  function lookupSku(asin) { return asinToSku.get(asin) || "N/A"; }

  function aggregateByCategory(filtered) {
    const catMap = {}; let total = 0;
    for (const exp of filtered) { total += exp.amount; if (!catMap[exp.category]) catMap[exp.category] = { category: exp.category, totalAmount: 0, count: 0 }; catMap[exp.category].totalAmount += exp.amount; catMap[exp.category].count++; }
    return { total: Math.round(total * 100) / 100, categories: Object.values(catMap).map((c) => ({ ...c, totalAmount: Math.round(c.totalAmount * 100) / 100 })).sort((a, b) => a.totalAmount - b.totalAmount) };
  }

  function aggregateBySku(filtered) {
    const skuMap = {};
    for (const exp of filtered) {
      const sku = exp.sku;
      if (!skuMap[sku]) skuMap[sku] = { sku, asin: lookupAsin(sku), totalAmount: 0, count: 0, breakdown: {} };
      // Prefer a non-empty asin if we encounter one mid-stream
      if (!skuMap[sku].asin && exp.asin) skuMap[sku].asin = exp.asin;
      skuMap[sku].totalAmount += exp.amount;
      skuMap[sku].count++;
      if (!skuMap[sku].breakdown[exp.category]) skuMap[sku].breakdown[exp.category] = 0;
      skuMap[sku].breakdown[exp.category] += exp.amount;
    }
    return Object.values(skuMap).map((s) => ({
      sku: s.sku,
      asin: s.asin,
      totalAmount: Math.round(s.totalAmount * 100) / 100,
      count: s.count,
      breakdown: Object.entries(s.breakdown).map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 })).sort((a, b) => a.amount - b.amount),
    })).sort((a, b) => a.totalAmount - b.totalAmount);
  }

  // ★ NEW: aggregate by ASIN. One ASIN can have multiple SKUs across
  //   marketplaces, so we track the canonical SKU but list all SKUs seen.
  function aggregateByAsin(filtered) {
    const asinMap = {};
    for (const exp of filtered) {
      const asin = exp.asin || lookupAsin(exp.sku) || "";
      if (!asin) continue; // skip rows without any ASIN information
      if (!asinMap[asin]) asinMap[asin] = { asin, sku: lookupSku(asin), skus: new Set(), totalAmount: 0, count: 0, breakdown: {} };
      if (exp.sku && exp.sku !== "N/A") asinMap[asin].skus.add(exp.sku);
      asinMap[asin].totalAmount += exp.amount;
      asinMap[asin].count++;
      if (!asinMap[asin].breakdown[exp.category]) asinMap[asin].breakdown[exp.category] = 0;
      asinMap[asin].breakdown[exp.category] += exp.amount;
    }
    return Object.values(asinMap).map((a) => ({
      asin: a.asin,
      sku: a.sku,
      skus: [...a.skus],
      totalAmount: Math.round(a.totalAmount * 100) / 100,
      count: a.count,
      breakdown: Object.entries(a.breakdown).map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 })).sort((a, b) => a.amount - b.amount),
    })).sort((a, b) => a.totalAmount - b.totalAmount);
  }

  function aggregateBySkuAndDate(filtered) {
    const map = {};
    for (const exp of filtered) {
      const dateKey = exp.postedDateStr || "Unknown";
      const sku = exp.sku;
      const key = `${sku}||${dateKey}`;
      if (!map[key]) map[key] = { sku, asin: lookupAsin(sku), date: dateKey, totalAmount: 0, count: 0, breakdown: {} };
      if (!map[key].asin && exp.asin) map[key].asin = exp.asin;
      map[key].totalAmount += exp.amount;
      map[key].count++;
      if (!map[key].breakdown[exp.category]) map[key].breakdown[exp.category] = 0;
      map[key].breakdown[exp.category] += exp.amount;
    }
    return Object.values(map).map((entry) => ({
      sku: entry.sku,
      asin: entry.asin,
      date: entry.date,
      totalAmount: Math.round(entry.totalAmount * 100) / 100,
      count: entry.count,
      breakdown: Object.entries(entry.breakdown).map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 })).sort((a, b) => a.amount - b.amount),
    })).sort((a, b) => { if (a.date !== b.date) return a.date > b.date ? -1 : 1; return a.sku.localeCompare(b.sku); });
  }

  function aggregateByDate(filtered) {
    const dateMap = {};
    for (const exp of filtered) { const dateKey = exp.postedDateStr || "Unknown"; if (!dateMap[dateKey]) dateMap[dateKey] = { date: dateKey, totalAmount: 0, count: 0, breakdown: {} }; dateMap[dateKey].totalAmount += exp.amount; dateMap[dateKey].count++; if (!dateMap[dateKey].breakdown[exp.category]) dateMap[dateKey].breakdown[exp.category] = 0; dateMap[dateKey].breakdown[exp.category] += exp.amount; }
    return Object.values(dateMap).map((entry) => ({ ...entry, totalAmount: Math.round(entry.totalAmount * 100) / 100, breakdown: Object.entries(entry.breakdown).map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 })).sort((a, b) => a.amount - b.amount) })).sort((a, b) => { if (a.date !== b.date) return a.date > b.date ? -1 : 1; return 0; });
  }

  const last7 = expenses.filter((e) => e.postedDate && e.postedDate >= sevenDaysAgo);
  const last14 = expenses.filter((e) => e.postedDate && e.postedDate >= fourteenDaysAgo);
  const amazonFeesAll = expenses.filter((e) => e.isAmazonFee);
  const amazonFeesLast7 = last7.filter((e) => e.isAmazonFee);
  const amazonFeesLast14 = last14.filter((e) => e.isAmazonFee);
  const expenseEarliest = expenses.reduce((min, e) => (e.postedDate && (!min || e.postedDate < min) ? e.postedDate : min), null);
  const expenseLatest = expenses.reduce((max, e) => (e.postedDate && (!max || e.postedDate > max) ? e.postedDate : max), null);

  return {
    totalExpenses: aggregateByCategory(expenses),
    totalExpensesLast7Days: aggregateByCategory(last7),
    totalExpensesLast14Days: aggregateByCategory(last14),

    // SKU-level (now carries `asin` on each row)
    skuWiseExpenses: aggregateBySku(expenses),
    skuWiseExpensesLast7Days: aggregateBySku(last7),
    skuWiseExpensesLast14Days: aggregateBySku(last14),

    // ★ NEW: ASIN-level aggregation
    asinWiseExpenses: aggregateByAsin(expenses),
    asinWiseExpensesLast7Days: aggregateByAsin(last7),
    asinWiseExpensesLast14Days: aggregateByAsin(last14),

    skuDateWiseExpenses: aggregateBySkuAndDate(expenses),
    dateWiseExpenses: aggregateByDate(expenses),

    totalAmazonFees: aggregateByCategory(amazonFeesAll),
    totalAmazonFeesLast7Days: aggregateByCategory(amazonFeesLast7),
    totalAmazonFeesLast14Days: aggregateByCategory(amazonFeesLast14),
    dateWiseAmazonFees: aggregateByDate(amazonFeesAll),

    metadata: {
      totalExpenseRows: expenses.length,
      totalAmazonFeeRows: amazonFeesAll.length,
      uniqueAsins: skuToAsin.size,
      uniqueSkus: new Set(expenses.map((e) => e.sku).filter((s) => s && s !== "N/A")).size,
      amazonFeeCategories: Array.from(AMAZON_FEE_CATEGORIES),
      nonAmazonFeeCategories: ["TCS (Tax Collected at Source)", "TDS (Tax Deducted at Source)", "Advertising / PPC", "Promotions / Discounts", "Affordability Promotion Expense", "SAFE-T Reimbursement", "Debt Recovery", "Loan Servicing", "Retrocharge", "Rental Fee", "Network Commingling", "Service Provider Credit", "Charge Refund", "FBA Liquidation Proceeds", "Adhoc Disbursement", "Failed Adhoc Disbursement", "EBT Refund Reimbursement", "Pay With Amazon Fee", "Tax Withheld", "Trial Shipment Fee"],
      dateRange: { from: expenseEarliest, to: expenseLatest, fromFormatted: formatDateDDMMYYYY(expenseEarliest), toFormatted: formatDateDDMMYYYY(expenseLatest) },
      generatedAt: now.toISOString(),
      apiVersion: "2024-06-19",
    },
  };
}

// ─────────────────────────────────────────────
// 11. FETCH FINANCE DATA — uses v2024-06-19
// ─────────────────────────────────────────────
async function fetchNewFinanceData(config) {
  const {
    country,
    daysBack = getDefaultExpenseFinanceDaysBack(),
    accessToken: providedAccessToken,
    refreshToken,
    clientId,
    clientSecret,
    // Optional explicit window overrides
    postedAfter: postedAfterOverride,
    postedBefore: postedBeforeOverride,
    from,
    to,
    // ★ NEW: Override marketplaceId if you want a specific marketplace
    //   (otherwise resolved from country)
    marketplaceIdOverride,
    // ★ NEW: () => Promise<string>. If supplied, fetchTransactions uses this
    //   to renew the access token mid-pagination when Amazon returns
    //   Unauthorized/expired. Without it, callers fall back to the old
    //   behaviour (throw on first token failure).
    tokenRefresher,
  } = config;

  const countryUpper = country.toUpperCase();
  const { baseUrl, region, marketplaceId: resolvedMarketplaceId } = resolveMarketplaceAndRegion(countryUpper, config.region);

  // Use override if provided, else use the resolved marketplaceId
  const marketplaceId = marketplaceIdOverride || resolvedMarketplaceId;

  logger.info(`[Finance Fetch v2024-06-19] Country: ${countryUpper} | Region: ${region}`);
  logger.info(`[Finance Fetch v2024-06-19] Marketplace ID: ${marketplaceId}`);
  logger.info(`[Finance Fetch v2024-06-19] Base URL: ${baseUrl}`);

  let accessToken = providedAccessToken;
  if (!accessToken) {
    logger.info("[Finance Fetch v2024-06-19] Getting access token...");
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
    logger.info("[Finance Fetch v2024-06-19] Access token obtained.");
  }

  let postedAfter;
  let postedBefore;

  if (postedAfterOverride) postedAfter = new Date(postedAfterOverride).toISOString();
  if (postedBeforeOverride) postedBefore = new Date(postedBeforeOverride).toISOString();

  if (!postedAfter && from) {
    const d = new Date(`${from}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid from date (expected YYYY-MM-DD): ${from}`);
    postedAfter = d.toISOString();
  }
  if (!postedBefore && to) {
    const d = new Date(`${to}T23:59:59.999Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid to date (expected YYYY-MM-DD): ${to}`);
    postedBefore = d.toISOString();
  }

  if (!postedAfter || !postedBefore) {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1 - daysBack, 0, 0, 0);
    postedAfter = postedAfter || startDate.toISOString();
    postedBefore = postedBefore || yesterday.toISOString();
    logger.info(`[Finance Fetch v2024-06-19] Window: ${formatDateDDMMYYYY(startDate)} → ${formatDateDDMMYYYY(yesterday)} (${daysBack} days)`);
  } else {
    const startDate = new Date(postedAfter);
    const endDate = new Date(postedBefore);
    logger.info(`[Finance Fetch v2024-06-19] Explicit window: ${formatDateDDMMYYYY(startDate)} → ${formatDateDDMMYYYY(endDate)}`);
  }

  // ★ Pass marketplaceId to filter at the API level — solves multi-marketplace mixing.
  // ★ Pass tokenRefresher (when provided) so mid-pagination expiry is recoverable
  //   without restarting from page 1.
  const transactions = await fetchTransactions(accessToken, baseUrl, postedAfter, postedBefore, marketplaceId, tokenRefresher);

  const expenseRows = parseTransactionsV2024(transactions);
  const revenueRows = extractRevenueFromTransactions(transactions);

  logger.info(`[Finance Fetch v2024-06-19] Parsed ${expenseRows.length} expense rows, ${revenueRows.length} revenue rows.`);

  if (expenseRows.length > 0) {
    const dates = expenseRows.filter(e => e.postedDateStr).map(e => e.postedDateStr).sort();
    logger.info(`[Finance Fetch v2024-06-19] Expense data range: ${dates[0]} → ${dates[dates.length - 1]}`);
  }

  return {
    hasNewData: expenseRows.length > 0 || revenueRows.length > 0,
    expenseRows,
    revenueRows,        // ★ NEW: revenue alongside expenses
    transactions,        // ★ NEW: raw transactions for debugging / future use
    postedAfter,
    postedBefore,
    marketplaceId,
  };
}

// ─────────────────────────────────────────────
// 12. CONVENIENCE — fetch + analyze
// ─────────────────────────────────────────────
async function fetchAndAnalyze(config) {
  const result = await fetchNewFinanceData(config);
  if (!result.hasNewData) {
    return {
      data: null,
      postedAfter: result.postedAfter,
      postedBefore: result.postedBefore,
      marketplaceId: result.marketplaceId,
    };
  }
  const analysis = analyzeExpenses(result.expenseRows);
  logger.info(`[Analyze] Total expenses: ${analysis.totalExpenses.total} | Amazon fees: ${analysis.totalAmazonFees.total}`);
  return {
    data: analysis,
    revenueRows: result.revenueRows,
    postedAfter: result.postedAfter,
    postedBefore: result.postedBefore,
    marketplaceId: result.marketplaceId,
  };
}

// ─────────────────────────────────────────────
// 13. OFFLINE MODE — Parse local JSON files
//     Now expects v2024-06-19 transaction format.
// ─────────────────────────────────────────────
const fs = require("fs");
const path = require("path");

function analyzeLocalFinanceFiles(filePaths) {
  const allTransactions = [];
  for (const filePath of filePaths) {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(rawContent);
    // Accept: { payload: { transactions: [] } } or { transactions: [] } or { financialEvents: [] } or [] directly
    const transactions = data.payload?.transactions || data.transactions || data.financialEvents || (Array.isArray(data) ? data : []);
    allTransactions.push(...transactions);
    logger.info(`Parsed ${path.basename(filePath)}: ${transactions.length} transactions`);
  }
  const expenseRows = parseTransactionsV2024(allTransactions);
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
  // Main API (same names as before for backward compatibility)
  fetchNewFinanceData,
  analyzeExpenses,
  fetchAndAnalyze,
  analyzeLocalFinanceFiles,

  // Parsing functions (renamed to reflect v2024-06-19, aliases preserved)
  parseTransactionsV2024,
  parseFinancialEvents: parseTransactionsV2024, // alias for backward compat
  extractRevenueFromTransactions,                // ★ NEW: revenue extraction

  // Fee classification helpers
  isAmazonFee,
  AMAZON_FEE_CATEGORIES,
  mapBreakdownTypeToCategory,
  categorizeBreakdownByPath,                     // ★ NEW: path-aware categorization
  isRevenueCategory,                             // ★ NEW: revenue check
  REVENUE_CATEGORIES,                            // ★ NEW: set of revenue category names

  // Date helpers
  formatDateDDMMYYYY,

  // Auth & low-level fetching
  getAccessToken,
  fetchTransactions,
  fetchFinancialEvents: fetchTransactions, // alias for backward compat

  // Region/marketplace resolution
  resolveMarketplaceAndRegion,
  COUNTRY_TO_INTERNAL_REGION,
  REGION_BASE_URLS,
};
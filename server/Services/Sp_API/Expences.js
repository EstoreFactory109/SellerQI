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

// ─────────────────────────────────────────────
// 5. FINANCE API — FETCH FINANCIAL EVENTS
// ─────────────────────────────────────────────
async function fetchFinancialEvents(accessToken, baseUrl, postedAfter, postedBefore) {
  const allEvents = {};
  let nextToken = null;
  let pageCount = 0;
  const MAX_RETRIES = 5;
  do {
    let path;
    if (nextToken) {
      path = `/finances/v0/financialEvents?NextToken=${encodeURIComponent(nextToken)}`;
    } else {
      const params = new URLSearchParams({ PostedAfter: postedAfter, MaxResultsPerPage: "100" });
      if (postedBefore) params.set("PostedBefore", postedBefore);
      path = `/finances/v0/financialEvents?${params.toString()}`;
    }
    let res;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      res = await httpsRequest({ hostname: baseUrl, path, method: "GET", headers: { "x-amz-access-token": accessToken } });
      const isThrottled = res.statusCode === 429 || (Array.isArray(res.body.errors) && res.body.errors.some((e) => e.code === "QuotaExceeded"));
      if (isThrottled && attempt < MAX_RETRIES) {
        const delayMs = Math.min(10000 * Math.pow(2, attempt), 60000);
        logger.warn(`[Finance API] Throttled on page ${pageCount + 1}, attempt ${attempt + 1}/${MAX_RETRIES}. Retrying in ${delayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      break;
    }
    if (res.body.errors) throw new Error(`Finance API failed: ${JSON.stringify(res.body.errors)}`);
    const payload = res.body.payload || {};
    const events = payload.FinancialEvents || {};
    for (const [key, val] of Object.entries(events)) {
      if (Array.isArray(val)) { if (!allEvents[key]) allEvents[key] = []; allEvents[key].push(...val); }
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
  "Referral Commission", "Closing Fee", "FBA Fulfillment Fee",
  "Shipping / Easy Ship Fee", "Shipping Chargeback",
  "FBA Storage Fee", "FBA Disposal Fee", "FBA Removal Fee",
  "FBA Inbound Transportation Fee", "Subscription Fee", "Technology Fee",
  "FBA Liquidation Fee", "Deal Fee", "Coupon Redemption Fee",
  "Imaging Services Fee", "FBA Capacity Reservation Fee",
  "Value Added Service Fee", "Early Reviewer Program Fee",
]);

function isAmazonFee(category) { return AMAZON_FEE_CATEGORIES.has(category); }

function mapFeeTypeToCategory(feeType) {
  switch (feeType) {
    case "Commission": case "RefundCommission": return "Referral Commission";
    case "FBAPerUnitFulfillmentFee": case "FBAWeightBasedFee": return "FBA Fulfillment Fee";
    case "FixedClosingFee": case "VariableClosingFee": return "Closing Fee";
    case "ShippingChargeback": case "ShippingHB": return "Shipping Chargeback";
    case "EasyShipCharge": return "Shipping / Easy Ship Fee";
    case "TechnologyFee": return "Technology Fee";
    case "FBAStorageFee": return "FBA Storage Fee";
    case "FBAInboundTransportationFee": return "FBA Inbound Transportation Fee";
    case "FBARemovalFee": return "FBA Removal Fee";
    case "Subscription": return "Subscription Fee";
    case "GiftwrapChargeback": return "Other Fee";
    default: return feeType || "Other Fee";
  }
}

// ─────────────────────────────────────────────
// 7. HELPER: Build expense row
// ─────────────────────────────────────────────
function makeExpenseRow({ amount, category, isAmazonFeeOverride, amountType = "", amountDescription = "", sku = "N/A", orderId = "", transactionType = "", postedDate = null }) {
  return {
    amount, absoluteAmount: Math.abs(amount), category,
    isAmazonFee: typeof isAmazonFeeOverride === "boolean" ? isAmazonFeeOverride : isAmazonFee(category),
    amountType, amountDescription, sku, orderId, transactionType,
    postedDate, postedDateStr: postedDate ? formatDateYYYYMMDD(postedDate) : "",
  };
}

// ─────────────────────────────────────────────
// 8. HELPER: Parse ShipmentEvent-shaped items
//    (Shipments, Refunds, GuaranteeClaims,
//     Chargebacks, ShipmentSettle)
// ─────────────────────────────────────────────
function parseShipmentEventItems(event, transactionType) {
  const expenses = [];
  const orderId = event.AmazonOrderId || "";
  const postedDate = event.PostedDate ? new Date(event.PostedDate) : null;
  const itemList = event.ShipmentItemAdjustmentList || event.ShipmentItemList || [];

  for (const item of itemList) {
    const sku = item.SellerSKU || "N/A";

    // Item Fees / Fee Adjustments
    const feeList = item.ItemFeeAdjustmentList || item.ItemFeeList || [];
    for (const fee of feeList) {
      const amount = parseFloat(fee.FeeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      const category = mapFeeTypeToCategory(fee.FeeType);
      expenses.push(makeExpenseRow({ amount, category, amountType: "ItemFees", amountDescription: fee.FeeType || "", sku, orderId, transactionType, postedDate }));
    }

    // Promotions / Promotion Adjustments
    const promoList = item.PromotionAdjustmentList || item.PromotionList || [];
    for (const promo of promoList) {
      const amount = parseFloat(promo.PromotionAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      expenses.push(makeExpenseRow({ amount, category: "Promotions / Discounts", isAmazonFeeOverride: false, amountType: "Promotion", amountDescription: promo.PromotionType || "Promotion", sku, orderId, transactionType, postedDate }));
    }

    // Item-level Tax Withheld (TDS/TCS per order item — India)
    for (const twh of item.ItemTaxWithheldList || []) {
      for (const tax of twh.TaxesWithheld || []) {
        const amount = parseFloat(tax.ChargeAmount?.CurrencyAmount || 0);
        if (amount === 0) continue;
        const chargeType = tax.ChargeType || "";
        let category = "Tax Withheld";
        if (chargeType.includes("TDS")) category = "TDS (Tax Deducted at Source)";
        if (chargeType.includes("TCS")) category = "TCS (Tax Collected at Source)";
        expenses.push(makeExpenseRow({ amount, category, isAmazonFeeOverride: false, amountType: twh.TaxCollectionModel || chargeType, amountDescription: chargeType, sku, orderId, transactionType, postedDate }));
      }
    }
  }
  return expenses;
}

// ─────────────────────────────────────────────
// 9. PARSE ALL SP-API FINANCIAL EVENTS
//    Handles every event list from the Finance
//    API across all marketplaces (NA/EU/FE).
// ─────────────────────────────────────────────
function parseFinancialEvents(financialEvents) {
  const expenses = [];

  // 1. ShipmentEventList (order fees)
  for (const e of financialEvents.ShipmentEventList || []) expenses.push(...parseShipmentEventItems(e, "Order"));

  // 2. RefundEventList (refund fee adjustments)
  for (const e of financialEvents.RefundEventList || []) expenses.push(...parseShipmentEventItems(e, "Refund"));

  // 3. GuaranteeClaimEventList — A-to-Z claims (same ShipmentEvent schema)
  for (const e of financialEvents.GuaranteeClaimEventList || []) expenses.push(...parseShipmentEventItems(e, "GuaranteeClaim"));

  // 4. ChargebackEventList — payment chargebacks (same ShipmentEvent schema)
  for (const e of financialEvents.ChargebackEventList || []) expenses.push(...parseShipmentEventItems(e, "Chargeback"));

  // 5. ShipmentSettleEventList — settlement-time adjustments (same ShipmentEvent schema)
  for (const e of financialEvents.ShipmentSettleEventList || []) expenses.push(...parseShipmentEventItems(e, "ShipmentSettle"));

  // 6. ServiceFeeEventList (Storage, Subscription, Inbound Transport, Removal, etc.)
  for (const sfe of financialEvents.ServiceFeeEventList || []) {
    for (const fee of sfe.FeeList || []) {
      const amount = parseFloat(fee.FeeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      const category = mapFeeTypeToCategory(fee.FeeType);
      expenses.push(makeExpenseRow({ amount, category, amountType: "ServiceFee", amountDescription: fee.FeeType || "", sku: sfe.SellerSKU || "N/A", orderId: sfe.AmazonOrderId || "", transactionType: "ServiceFee", postedDate: new Date() }));
    }
  }

  // 7. ProductAdsPaymentEventList (Advertising / PPC)
  for (const ad of financialEvents.ProductAdsPaymentEventList || []) {
    const amount = parseFloat(ad.transactionValue?.CurrencyAmount || 0);
    if (amount === 0) continue;
    const postedDate = ad.postedDate ? new Date(ad.postedDate) : null;
    expenses.push(makeExpenseRow({ amount, category: "Advertising / PPC", isAmazonFeeOverride: false, amountType: "Cost of Advertising", amountDescription: ad.transactionType || "Advertising", orderId: ad.invoiceId || "", transactionType: "Advertising", postedDate }));
  }

  // 8. RemovalShipmentEventList (FBA removal/disposal)
  for (const removal of financialEvents.RemovalShipmentEventList || []) {
    const postedDate = removal.PostedDate ? new Date(removal.PostedDate) : null;
    for (const item of removal.RemovalShipmentItemList || []) {
      const amount = parseFloat(item.FeeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      expenses.push(makeExpenseRow({ amount: -Math.abs(amount), category: "FBA Disposal Fee", isAmazonFeeOverride: true, amountType: "other-transaction", amountDescription: "DisposalComplete", sku: item.SellerSKU || "N/A", orderId: removal.OrderId || "", transactionType: "Removal", postedDate }));
    }
  }

  // 9. RemovalShipmentAdjustmentEventList
  for (const adj of financialEvents.RemovalShipmentAdjustmentEventList || []) {
    const postedDate = adj.PostedDate ? new Date(adj.PostedDate) : null;
    for (const item of adj.RemovalShipmentItemAdjustmentList || []) {
      const amount = parseFloat(item.AdjustmentAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      expenses.push(makeExpenseRow({ amount, category: "FBA Removal Fee", isAmazonFeeOverride: true, amountType: "RemovalAdjustment", amountDescription: "RemovalShipmentAdjustment", sku: item.SellerSKU || "N/A", orderId: adj.OrderId || "", transactionType: "RemovalAdjustment", postedDate }));
    }
  }

  // 10. AdjustmentEventList (reimbursements, reserves, postage, etc.)
  for (const adj of financialEvents.AdjustmentEventList || []) {
    const postedDate = adj.PostedDate ? new Date(adj.PostedDate) : null;
    const adjType = adj.AdjustmentType || "";
    for (const item of adj.AdjustmentItemList || []) {
      const amount = parseFloat(item.TotalAmount?.CurrencyAmount || item.PerUnitAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      let category = adjType || "Other Fee";
      if (adjType.includes("Storage")) category = "FBA Storage Fee";
      expenses.push(makeExpenseRow({ amount, category, amountType: "Adjustment", amountDescription: adjType, sku: item.SellerSKU || "N/A", transactionType: "Adjustment", postedDate }));
    }
  }

  // 11. SAFETReimbursementEventList (SAFE-T claims)
  for (const safet of financialEvents.SAFETReimbursementEventList || []) {
    const postedDate = safet.PostedDate ? new Date(safet.PostedDate) : null;
    const topAmount = parseFloat(safet.ReimbursedAmount?.CurrencyAmount || 0);
    if (topAmount !== 0) {
      expenses.push(makeExpenseRow({ amount: topAmount, category: "SAFE-T Reimbursement", isAmazonFeeOverride: false, amountType: "SAFETReimbursement", amountDescription: safet.ReasonCode || "SAFE-T", orderId: safet.SAFETClaimId || "", transactionType: "SAFETReimbursement", postedDate }));
    }
  }

  // 12. TDSReimbursementEventList (India TDS)
  for (const tds of financialEvents.TDSReimbursementEventList || []) {
    const amount = parseFloat(tds.ReimbursedAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    const postedDate = tds.PostedDate ? new Date(tds.PostedDate) : null;
    expenses.push(makeExpenseRow({ amount: -Math.abs(amount), category: "TDS (Tax Deducted at Source)", isAmazonFeeOverride: false, amountType: "ItemTDS", amountDescription: "TDS", transactionType: "TDS", postedDate }));
  }

  // 13. TaxWithholdingEventList (TCS — India)
  //     FIX: Handles BOTH WithheldAmount (top-level) AND TaxWithholdingComponentList (legacy)
  for (const tax of financialEvents.TaxWithholdingEventList || []) {
    const postedDate = tax.PostedDate ? new Date(tax.PostedDate) : null;
    // Structure (a): Top-level WithheldAmount
    const withheldAmount = parseFloat(tax.WithheldAmount?.CurrencyAmount || 0);
    if (withheldAmount !== 0) {
      expenses.push(makeExpenseRow({ amount: withheldAmount, category: "TCS (Tax Collected at Source)", isAmazonFeeOverride: false, amountType: "TaxWithholding", amountDescription: "TCS", transactionType: "TaxWithholding", postedDate }));
    }
    // Structure (b): TaxWithholdingComponentList (fallback if WithheldAmount is absent)
    if (withheldAmount === 0) {
      for (const component of tax.TaxWithholdingComponentList || []) {
        const amount = parseFloat(component.TaxAmount?.CurrencyAmount || 0);
        if (amount === 0) continue;
        expenses.push(makeExpenseRow({ amount: -Math.abs(amount), category: "TCS (Tax Collected at Source)", isAmazonFeeOverride: false, amountType: "ItemTCS", amountDescription: component.TaxType || "TCS", transactionType: "TaxWithholding", postedDate }));
      }
    }
  }

  // 14. AffordabilityExpenseEventList (India EMI / No-Cost EMI)
  for (const aff of financialEvents.AffordabilityExpenseEventList || []) {
    const amount = parseFloat(aff.TotalExpense?.CurrencyAmount || 0);
    if (amount === 0) continue;
    const postedDate = aff.PostedDate ? new Date(aff.PostedDate) : null;
    expenses.push(makeExpenseRow({ amount, category: "Affordability Promotion Expense", isAmazonFeeOverride: false, amountType: "AffordabilityExpense", amountDescription: aff.TransactionType || "AffordabilityExpense", orderId: aff.AmazonOrderId || "", transactionType: "AffordabilityExpense", postedDate }));
  }

  // 15. AffordabilityExpenseReversalEventList
  for (const aff of financialEvents.AffordabilityExpenseReversalEventList || []) {
    const amount = parseFloat(aff.TotalExpense?.CurrencyAmount || 0);
    if (amount === 0) continue;
    const postedDate = aff.PostedDate ? new Date(aff.PostedDate) : null;
    expenses.push(makeExpenseRow({ amount, category: "Affordability Promotion Expense", isAmazonFeeOverride: false, amountType: "AffordabilityExpenseReversal", amountDescription: aff.TransactionType || "Reversal", orderId: aff.AmazonOrderId || "", transactionType: "AffordabilityExpenseReversal", postedDate }));
  }

  // 16. SellerDealPaymentEventList (Lightning Deals, etc.)
  for (const deal of financialEvents.SellerDealPaymentEventList || []) {
    const postedDate = deal.PostedDate ? new Date(deal.PostedDate) : null;
    const feeAmt = parseFloat(deal.FeeComponent?.FeeAmount?.CurrencyAmount || 0);
    if (feeAmt !== 0) expenses.push(makeExpenseRow({ amount: feeAmt, category: "Deal Fee", isAmazonFeeOverride: true, amountType: "DealFee", amountDescription: deal.FeeComponent?.FeeType || "DealFee", orderId: deal.DealId || "", transactionType: "DealPayment", postedDate }));
    const chargeAmt = parseFloat(deal.ChargeComponent?.ChargeAmount?.CurrencyAmount || 0);
    if (chargeAmt !== 0) expenses.push(makeExpenseRow({ amount: chargeAmt, category: "Deal Fee", isAmazonFeeOverride: true, amountType: "DealCharge", amountDescription: deal.ChargeComponent?.ChargeType || "DealCharge", orderId: deal.DealId || "", transactionType: "DealPayment", postedDate }));
    const totalAmt = parseFloat(deal.TotalAmount?.CurrencyAmount || 0);
    if (totalAmt !== 0 && feeAmt === 0 && chargeAmt === 0) expenses.push(makeExpenseRow({ amount: totalAmt, category: "Deal Fee", isAmazonFeeOverride: true, amountType: "DealTotal", amountDescription: deal.DealDescription || "DealPayment", orderId: deal.DealId || "", transactionType: "DealPayment", postedDate }));
  }

  // 17. CouponPaymentEventList
  for (const coupon of financialEvents.CouponPaymentEventList || []) {
    const postedDate = coupon.PostedDate ? new Date(coupon.PostedDate) : null;
    const feeAmt = parseFloat(coupon.FeeComponent?.FeeAmount?.CurrencyAmount || 0);
    if (feeAmt !== 0) expenses.push(makeExpenseRow({ amount: feeAmt, category: "Coupon Redemption Fee", isAmazonFeeOverride: true, amountType: "CouponFee", amountDescription: coupon.FeeComponent?.FeeType || "CouponFee", orderId: coupon.CouponId || "", transactionType: "Coupon", postedDate }));
    const chargeAmt = parseFloat(coupon.ChargeComponent?.ChargeAmount?.CurrencyAmount || 0);
    if (chargeAmt !== 0) expenses.push(makeExpenseRow({ amount: chargeAmt, category: "Promotions / Discounts", isAmazonFeeOverride: false, amountType: "CouponCharge", amountDescription: coupon.ChargeComponent?.ChargeType || "CouponDiscount", orderId: coupon.CouponId || "", transactionType: "Coupon", postedDate }));
    const totalAmt = parseFloat(coupon.TotalAmount?.CurrencyAmount || 0);
    if (totalAmt !== 0 && feeAmt === 0 && chargeAmt === 0) expenses.push(makeExpenseRow({ amount: totalAmt, category: "Coupon Redemption Fee", isAmazonFeeOverride: true, amountType: "CouponTotal", amountDescription: "CouponPayment", orderId: coupon.CouponId || "", transactionType: "Coupon", postedDate }));
  }

  // 18. DebtRecoveryEventList
  for (const debt of financialEvents.DebtRecoveryEventList || []) {
    const amount = parseFloat(debt.RecoveryAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "Debt Recovery", isAmazonFeeOverride: false, amountType: "DebtRecovery", amountDescription: debt.DebtRecoveryType || "DebtRecovery", transactionType: "DebtRecovery", postedDate: null }));
  }

  // 19. LoanServicingEventList
  for (const loan of financialEvents.LoanServicingEventList || []) {
    const amount = parseFloat(loan.LoanAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "Loan Servicing", isAmazonFeeOverride: false, amountType: "LoanServicing", amountDescription: loan.SourceBusinessEventType || "Loan", transactionType: "LoanServicing", postedDate: null }));
  }

  // 20. FBALiquidationEventList
  for (const liq of financialEvents.FBALiquidationEventList || []) {
    const postedDate = liq.PostedDate ? new Date(liq.PostedDate) : null;
    const feeAmt = parseFloat(liq.LiquidationFeeAmount?.CurrencyAmount || 0);
    if (feeAmt !== 0) expenses.push(makeExpenseRow({ amount: feeAmt, category: "FBA Liquidation Fee", isAmazonFeeOverride: true, amountType: "LiquidationFee", amountDescription: "FBALiquidationFee", orderId: liq.OriginalRemovalOrderId || "", transactionType: "FBALiquidation", postedDate }));
    const proceedsAmt = parseFloat(liq.LiquidationProceedsAmount?.CurrencyAmount || 0);
    if (proceedsAmt !== 0) expenses.push(makeExpenseRow({ amount: proceedsAmt, category: "FBA Liquidation Proceeds", isAmazonFeeOverride: false, amountType: "LiquidationProceeds", amountDescription: "FBALiquidationProceeds", orderId: liq.OriginalRemovalOrderId || "", transactionType: "FBALiquidation", postedDate }));
  }

  // 21. RetrochargeEventList
  for (const retro of financialEvents.RetrochargeEventList || []) {
    const postedDate = retro.PostedDate ? new Date(retro.PostedDate) : null;
    const amount = parseFloat(retro.RetrochargeTaxWithheldAmount?.CurrencyAmount || retro.BaseTax?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "Retrocharge", isAmazonFeeOverride: false, amountType: "Retrocharge", amountDescription: retro.RetrochargeEventType || "Retrocharge", orderId: retro.AmazonOrderId || "", transactionType: "Retrocharge", postedDate }));
  }

  // 22. RentalTransactionEventList
  for (const rental of financialEvents.RentalTransactionEventList || []) {
    const postedDate = rental.PostedDate ? new Date(rental.PostedDate) : null;
    for (const fee of rental.RentalFeeList || []) {
      const amount = parseFloat(fee.FeeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      expenses.push(makeExpenseRow({ amount, category: "Rental Fee", isAmazonFeeOverride: false, amountType: "RentalFee", amountDescription: fee.FeeType || "RentalFee", orderId: rental.AmazonOrderId || "", transactionType: "Rental", postedDate }));
    }
    for (const charge of rental.RentalChargeList || []) {
      const amount = parseFloat(charge.ChargeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      expenses.push(makeExpenseRow({ amount, category: "Rental Fee", isAmazonFeeOverride: false, amountType: "RentalCharge", amountDescription: charge.ChargeType || "RentalCharge", orderId: rental.AmazonOrderId || "", transactionType: "Rental", postedDate }));
    }
  }

  // 23. NetworkComminglingTransactionEventList
  for (const nc of financialEvents.NetworkComminglingTransactionEventList || []) {
    const postedDate = nc.PostedDate ? new Date(nc.PostedDate) : null;
    const amount = parseFloat(nc.NetCoTransactionCharge?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "Network Commingling", isAmazonFeeOverride: false, amountType: "NetworkCommingling", amountDescription: nc.TransactionType || "NetworkCommingling", sku: nc.ASIN || "N/A", transactionType: "NetworkCommingling", postedDate }));
  }

  // 24. SellerReviewEnrollmentPaymentEventList (Early Reviewer Program)
  for (const srep of financialEvents.SellerReviewEnrollmentPaymentEventList || []) {
    const postedDate = srep.PostedDate ? new Date(srep.PostedDate) : null;
    const feeAmt = parseFloat(srep.FeeComponent?.FeeAmount?.CurrencyAmount || 0);
    if (feeAmt !== 0) expenses.push(makeExpenseRow({ amount: feeAmt, category: "Early Reviewer Program Fee", isAmazonFeeOverride: true, amountType: "EarlyReviewerFee", amountDescription: srep.FeeComponent?.FeeType || "EarlyReviewerFee", transactionType: "EarlyReviewerProgram", postedDate }));
    const chargeAmt = parseFloat(srep.ChargeComponent?.ChargeAmount?.CurrencyAmount || 0);
    if (chargeAmt !== 0) expenses.push(makeExpenseRow({ amount: chargeAmt, category: "Early Reviewer Program Fee", isAmazonFeeOverride: true, amountType: "EarlyReviewerCharge", amountDescription: srep.ChargeComponent?.ChargeType || "EarlyReviewerCharge", transactionType: "EarlyReviewerProgram", postedDate }));
    const totalAmt = parseFloat(srep.TotalAmount?.CurrencyAmount || 0);
    if (totalAmt !== 0 && feeAmt === 0 && chargeAmt === 0) expenses.push(makeExpenseRow({ amount: totalAmt, category: "Early Reviewer Program Fee", isAmazonFeeOverride: true, amountType: "EarlyReviewerTotal", amountDescription: "EarlyReviewerPayment", transactionType: "EarlyReviewerProgram", postedDate }));
  }

  // 25. ImagingServicesFeeEventList
  for (const img of financialEvents.ImagingServicesFeeEventList || []) {
    const postedDate = img.PostedDate ? new Date(img.PostedDate) : null;
    for (const fee of img.FeeList || []) {
      const amount = parseFloat(fee.FeeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      expenses.push(makeExpenseRow({ amount, category: "Imaging Services Fee", isAmazonFeeOverride: true, amountType: "ImagingServicesFee", amountDescription: fee.FeeType || "ImagingServicesFee", sku: img.ASIN || "N/A", transactionType: "ImagingServices", postedDate }));
    }
  }

  // 26. PayWithAmazonEventList
  for (const pwa of financialEvents.PayWithAmazonEventList || []) {
    const postedDate = pwa.PostedDate ? new Date(pwa.PostedDate) : null;
    for (const fee of pwa.FeeList || []) {
      const amount = parseFloat(fee.FeeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      expenses.push(makeExpenseRow({ amount, category: "Pay With Amazon Fee", isAmazonFeeOverride: false, amountType: "PayWithAmazonFee", amountDescription: fee.FeeType || "PayWithAmazonFee", orderId: pwa.SellerOrderId || "", transactionType: "PayWithAmazon", postedDate }));
    }
    for (const charge of pwa.ChargeList || []) {
      const amount = parseFloat(charge.ChargeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      expenses.push(makeExpenseRow({ amount, category: "Pay With Amazon Fee", isAmazonFeeOverride: false, amountType: "PayWithAmazonCharge", amountDescription: charge.ChargeType || "PayWithAmazonCharge", orderId: pwa.SellerOrderId || "", transactionType: "PayWithAmazon", postedDate }));
    }
  }

  // 27. ServiceProviderCreditEventList
  for (const spc of financialEvents.ServiceProviderCreditEventList || []) {
    const amount = parseFloat(spc.TransactionAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    const postedDate = spc.PostedDate ? new Date(spc.PostedDate) : null;
    expenses.push(makeExpenseRow({ amount, category: "Service Provider Credit", isAmazonFeeOverride: false, amountType: "ServiceProviderCredit", amountDescription: spc.TransactionType || "ServiceProviderCredit", orderId: spc.SellerOrderId || "", transactionType: "ServiceProviderCredit", postedDate }));
  }

  // 28. TrialShipmentEventList
  for (const trial of financialEvents.TrialShipmentEventList || []) {
    const postedDate = trial.PostedDate ? new Date(trial.PostedDate) : null;
    for (const fee of trial.FeeList || []) {
      const amount = parseFloat(fee.FeeAmount?.CurrencyAmount || 0);
      if (amount === 0) continue;
      expenses.push(makeExpenseRow({ amount, category: "Trial Shipment Fee", isAmazonFeeOverride: false, amountType: "TrialShipmentFee", amountDescription: fee.FeeType || "TrialShipmentFee", sku: trial.SKU || "N/A", transactionType: "TrialShipment", postedDate }));
    }
  }

  // 29. ValueAddedServiceChargeEventList
  for (const vas of financialEvents.ValueAddedServiceChargeEventList || []) {
    const postedDate = vas.PostedDate ? new Date(vas.PostedDate) : null;
    const amount = parseFloat(vas.TransactionAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "Value Added Service Fee", isAmazonFeeOverride: true, amountType: "ValueAddedServiceCharge", amountDescription: vas.TransactionType || "ValueAddedService", orderId: vas.OrderId || "", transactionType: "ValueAddedService", postedDate }));
  }

  // 30. CapacityReservationBillingEventList
  for (const cap of financialEvents.CapacityReservationBillingEventList || []) {
    const postedDate = cap.PostedDate ? new Date(cap.PostedDate) : null;
    const amount = parseFloat(cap.TransactionAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "FBA Capacity Reservation Fee", isAmazonFeeOverride: true, amountType: "CapacityReservation", amountDescription: cap.TransactionType || "CapacityReservation", transactionType: "CapacityReservation", postedDate }));
  }

  // 31. ChargeRefundEventList
  for (const cr of financialEvents.ChargeRefundEventList || []) {
    const postedDate = cr.PostedDate ? new Date(cr.PostedDate) : null;
    const amount = parseFloat(cr.ChargeRefundAmount?.CurrencyAmount || cr.TransactionAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "Charge Refund", isAmazonFeeOverride: false, amountType: "ChargeRefund", amountDescription: cr.ChargeRefundType || cr.TransactionType || "ChargeRefund", transactionType: "ChargeRefund", postedDate }));
  }

  // 32. AdhocDisbursementEventList
  for (const adhoc of financialEvents.AdhocDisbursementEventList || []) {
    const postedDate = adhoc.PostedDate ? new Date(adhoc.PostedDate) : null;
    const amount = parseFloat(adhoc.TransactionAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "Adhoc Disbursement", isAmazonFeeOverride: false, amountType: "AdhocDisbursement", amountDescription: adhoc.TransactionType || "AdhocDisbursement", transactionType: "AdhocDisbursement", postedDate }));
  }

  // 33. FailedAdhocDisbursementEventList
  for (const failed of financialEvents.FailedAdhocDisbursementEventList || []) {
    const postedDate = failed.PostedDate ? new Date(failed.PostedDate) : null;
    const amount = parseFloat(failed.TransactionAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "Failed Adhoc Disbursement", isAmazonFeeOverride: false, amountType: "FailedAdhocDisbursement", amountDescription: failed.TransactionType || "FailedAdhocDisbursement", transactionType: "FailedAdhocDisbursement", postedDate }));
  }

  // 34. EBTRefundReimbursementOnlyEventList (US marketplace)
  for (const ebt of financialEvents.EBTRefundReimbursementOnlyEventList || []) {
    const postedDate = ebt.PostedDate ? new Date(ebt.PostedDate) : null;
    const amount = parseFloat(ebt.TransactionAmount?.CurrencyAmount || 0);
    if (amount === 0) continue;
    expenses.push(makeExpenseRow({ amount, category: "EBT Refund Reimbursement", isAmazonFeeOverride: false, amountType: "EBTRefundReimbursement", amountDescription: ebt.TransactionType || "EBTRefundReimbursement", transactionType: "EBTRefundReimbursement", postedDate }));
  }

  return expenses;
}

// ─────────────────────────────────────────────
// 10. EXPENSE ANALYSIS ENGINE
// ─────────────────────────────────────────────
function analyzeExpenses(expenseRows) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const expenses = expenseRows.map((e) => ({ ...e, postedDate: e.postedDate instanceof Date ? e.postedDate : parseDate(e.postedDate || e.postedDateStr) }));

  function aggregateByCategory(filtered) {
    const catMap = {}; let total = 0;
    for (const exp of filtered) { total += exp.amount; if (!catMap[exp.category]) catMap[exp.category] = { category: exp.category, totalAmount: 0, count: 0 }; catMap[exp.category].totalAmount += exp.amount; catMap[exp.category].count++; }
    return { total: Math.round(total * 100) / 100, categories: Object.values(catMap).map((c) => ({ ...c, totalAmount: Math.round(c.totalAmount * 100) / 100 })).sort((a, b) => a.totalAmount - b.totalAmount) };
  }
  function aggregateBySku(filtered) {
    const skuMap = {};
    for (const exp of filtered) { const sku = exp.sku; if (!skuMap[sku]) skuMap[sku] = { sku, totalAmount: 0, count: 0, breakdown: {} }; skuMap[sku].totalAmount += exp.amount; skuMap[sku].count++; if (!skuMap[sku].breakdown[exp.category]) skuMap[sku].breakdown[exp.category] = 0; skuMap[sku].breakdown[exp.category] += exp.amount; }
    return Object.values(skuMap).map((s) => ({ ...s, totalAmount: Math.round(s.totalAmount * 100) / 100, breakdown: Object.entries(s.breakdown).map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 })).sort((a, b) => a.amount - b.amount) })).sort((a, b) => a.totalAmount - b.totalAmount);
  }
  function aggregateBySkuAndDate(filtered) {
    const map = {};
    for (const exp of filtered) { const dateKey = exp.postedDateStr || "Unknown"; const sku = exp.sku; const key = `${sku}||${dateKey}`; if (!map[key]) map[key] = { sku, date: dateKey, totalAmount: 0, count: 0, breakdown: {} }; map[key].totalAmount += exp.amount; map[key].count++; if (!map[key].breakdown[exp.category]) map[key].breakdown[exp.category] = 0; map[key].breakdown[exp.category] += exp.amount; }
    return Object.values(map).map((entry) => ({ ...entry, totalAmount: Math.round(entry.totalAmount * 100) / 100, breakdown: Object.entries(entry.breakdown).map(([cat, amt]) => ({ category: cat, amount: Math.round(amt * 100) / 100 })).sort((a, b) => a.amount - b.amount) })).sort((a, b) => { if (a.date !== b.date) return a.date > b.date ? -1 : 1; return a.sku.localeCompare(b.sku); });
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
    totalExpenses: aggregateByCategory(expenses), totalExpensesLast7Days: aggregateByCategory(last7), totalExpensesLast14Days: aggregateByCategory(last14),
    skuWiseExpenses: aggregateBySku(expenses), skuWiseExpensesLast7Days: aggregateBySku(last7), skuWiseExpensesLast14Days: aggregateBySku(last14),
    skuDateWiseExpenses: aggregateBySkuAndDate(expenses), dateWiseExpenses: aggregateByDate(expenses),
    totalAmazonFees: aggregateByCategory(amazonFeesAll), totalAmazonFeesLast7Days: aggregateByCategory(amazonFeesLast7), totalAmazonFeesLast14Days: aggregateByCategory(amazonFeesLast14),
    dateWiseAmazonFees: aggregateByDate(amazonFeesAll),
    metadata: {
      totalExpenseRows: expenses.length, totalAmazonFeeRows: amazonFeesAll.length,
      amazonFeeCategories: Array.from(AMAZON_FEE_CATEGORIES),
      nonAmazonFeeCategories: ["TCS (Tax Collected at Source)", "TDS (Tax Deducted at Source)", "Advertising / PPC", "Promotions / Discounts", "Affordability Promotion Expense", "SAFE-T Reimbursement", "Debt Recovery", "Loan Servicing", "Retrocharge", "Rental Fee", "Network Commingling", "Service Provider Credit", "Charge Refund", "FBA Liquidation Proceeds", "Adhoc Disbursement", "Failed Adhoc Disbursement", "EBT Refund Reimbursement", "Pay With Amazon Fee", "Tax Withheld", "Trial Shipment Fee"],
      dateRange: { from: expenseEarliest, to: expenseLatest, fromFormatted: formatDateDDMMYYYY(expenseEarliest), toFormatted: formatDateDDMMYYYY(expenseLatest) },
      generatedAt: now.toISOString(),
    },
  };
}

// ─────────────────────────────────────────────
// 11. FETCH FINANCE DATA
// ─────────────────────────────────────────────
async function fetchNewFinanceData(config) {
  const {
    country,
    daysBack = getDefaultExpenseFinanceDaysBack(),
    accessToken: providedAccessToken,
    refreshToken,
    clientId,
    clientSecret,
    // Optional explicit window overrides:
    // - postedAfter / postedBefore: ISO strings
    // - from / to: YYYY-MM-DD (UTC day boundaries)
    postedAfter: postedAfterOverride,
    postedBefore: postedBeforeOverride,
    from,
    to,
  } = config;
  const countryUpper = country.toUpperCase();
  const { baseUrl, region } = resolveMarketplaceAndRegion(countryUpper, config.region);
  logger.info(`[Finance Fetch] Country: ${countryUpper} | Region: ${region}`);
  logger.info(`[Finance Fetch] Base URL: ${baseUrl}`);
  let accessToken = providedAccessToken;
  if (!accessToken) { logger.info("[Finance Fetch] Getting access token..."); accessToken = await getAccessToken(clientId, clientSecret, refreshToken); logger.info("[Finance Fetch] Access token obtained."); }

  let postedAfter;
  let postedBefore;

  // 1) Explicit ISO overrides win
  if (postedAfterOverride) {
    postedAfter = new Date(postedAfterOverride).toISOString();
  }
  if (postedBeforeOverride) {
    postedBefore = new Date(postedBeforeOverride).toISOString();
  }

  // 2) from/to (YYYY-MM-DD) override (UTC day boundaries)
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

  // 3) Fallback: rolling (yesterday - daysBack) → yesterday (local time)
  if (!postedAfter || !postedBefore) {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1 - daysBack, 0, 0, 0);
    postedAfter = postedAfter || startDate.toISOString();
    postedBefore = postedBefore || yesterday.toISOString();
    logger.info(`[Finance Fetch] Fetching window: ${formatDateDDMMYYYY(startDate)} → ${formatDateDDMMYYYY(yesterday)} (${daysBack} days)`);
  } else {
    const startDate = new Date(postedAfter);
    const endDate = new Date(postedBefore);
    logger.info(`[Finance Fetch] Fetching explicit window: ${formatDateDDMMYYYY(startDate)} → ${formatDateDDMMYYYY(endDate)}`);
  }

  const financialEvents = await fetchFinancialEvents(accessToken, baseUrl, postedAfter, postedBefore);
  const expenseRows = parseFinancialEvents(financialEvents);
  logger.info(`[Finance Fetch] Parsed ${expenseRows.length} expense rows.`);
  if (expenseRows.length > 0) { const dates = expenseRows.filter(e => e.postedDateStr).map(e => e.postedDateStr).sort(); logger.info(`[Finance Fetch] Data date range: ${dates[0]} → ${dates[dates.length - 1]}`); }
  return { hasNewData: expenseRows.length > 0, expenseRows, postedAfter, postedBefore };
}

// ─────────────────────────────────────────────
// 12. CONVENIENCE — fetch + analyze
// ─────────────────────────────────────────────
async function fetchAndAnalyze(config) {
  const result = await fetchNewFinanceData(config);
  if (!result.hasNewData) return { data: null, postedAfter: result.postedAfter, postedBefore: result.postedBefore };
  const analysis = analyzeExpenses(result.expenseRows);
  logger.info(`[Analyze] Total expenses: ${analysis.totalExpenses.total} | Amazon fees: ${analysis.totalAmazonFees.total}`);
  return { data: analysis, postedAfter: result.postedAfter, postedBefore: result.postedBefore };
}

// ─────────────────────────────────────────────
// 13. OFFLINE MODE — Parse local JSON files
// ─────────────────────────────────────────────
const fs = require("fs");
const path = require("path");

function analyzeLocalFinanceFiles(filePaths) {
  const allEvents = {};
  for (const filePath of filePaths) {
    const rawContent = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(rawContent);
    const events = data.payload?.FinancialEvents || data.FinancialEvents || data;
    for (const [key, val] of Object.entries(events)) { if (Array.isArray(val)) { if (!allEvents[key]) allEvents[key] = []; allEvents[key].push(...val); } }
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
  fetchNewFinanceData, analyzeExpenses, fetchAndAnalyze,
  parseFinancialEvents, analyzeLocalFinanceFiles, isAmazonFee, AMAZON_FEE_CATEGORIES, formatDateDDMMYYYY,
  getAccessToken, fetchFinancialEvents, resolveMarketplaceAndRegion, COUNTRY_TO_INTERNAL_REGION, REGION_BASE_URLS,
};
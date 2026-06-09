/**
 * SellerOpsEngine — deterministic answer engine for operational/data-lookup
 * domains: listing issues, inventory, account health, reimbursements,
 * product/BSR. Same design as FinanceEngine/AdsEngine: pull deterministic data
 * from the EXISTING QMate domain services, let the LLM only narrate.
 *
 * This phase implements the Listing Issues handlers (PART 3 Category A). The
 * classifier covers all SellerOps domains so isSellerOpsQuery is accurate for
 * pipeline wiring; inventory/account/reimbursement/product handlers land in
 * later phases (handleSellerOpsQuery returns a 'not_implemented' marker for them
 * for now, so the pipeline can fall through cleanly).
 *
 * Data access reuses the services discovered in the codebase rather than
 * re-querying models:
 *   - QMateIssuesService.getQMateIssuesContext  (account-wide issues, pre-computed)
 *   - QMateProductsService.getAsinIssues        (single-ASIN issues)
 * Both return a { success, source, data } envelope — we unwrap `.data`.
 */

// ── SECTION 1 — Imports ──
const logger = require('../../../../utils/Logger.js');
const QMateIssuesService = require('../../QMateIssuesService.js');
const QMateProductsService = require('../../QMateProductsService.js');
const QMateInventoryService = require('../../QMateInventoryService.js');
const QMateMetricsService = require('../../QMateMetricsService.js');
const QMateReimbursementService = require('../../QMateReimbursementService.js');
const FbaInventoryReadService = require('../../../inventory/FbaInventoryReadService.js');
// Finance access for restock-advice profitability gating (per-ASIN profit).
const FinanceEngine = require('./FinanceEngine.js');
const FinanceDashboardReadService = require('../../../Finance/FinanceDashboardReadService.js');

// ── SECTION 2 — Detection + classification ──
// Detection lives in helpers/SellerOpsQueryDetector.js (ZERO engine imports) so
// StrategyQueryDetector can defer to it without a circular dependency. Imported
// here and re-exported for back-compat; the engine adds the handlers below.
const {
  isSellerOpsQuery,
  classifySellerOpsQueryType,
  extractPromptText,
} = require('./helpers/SellerOpsQueryDetector.js');

// ── Listing-issue severity map (judgment-based, keyed by ACTUAL type strings
//    emitted by QMateIssuesService's transforms). Drives bySeverity/urgent. ──
const LISTING_ISSUE_SEVERITY = {
  // conversion
  no_buybox: 'critical',
  low_rating: 'high',
  low_image_count: 'high',
  no_aplus: 'medium',
  no_video: 'medium',
  no_brand_story: 'low',
  // ranking
  restricted_words: 'high',
  character_limit: 'medium',
  special_characters: 'low',
  // inventory-as-listing
  stranded: 'critical',
  suppressed: 'critical',
};
function severityOf(issueType) {
  return LISTING_ISSUE_SEVERITY[issueType] || 'medium';
}
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

// ── SECTION 3 — Listing Issues Handlers ──

/**
 * HANDLER — account-wide listing-issues summary (Category A: #1-7, #12-15).
 * Reuses QMateIssuesService.getQMateIssuesContext (pre-computed) and aggregates
 * its per-product issue arrays into by-type / by-severity / most-affected views.
 *
 * @param {{ userId, country, region }} userContext
 * @param {Object} [dateRange] - accepted for signature parity; issues are a
 *        current snapshot (not date-windowed), so it is not used here.
 * @returns {Promise<Object>} { type:'listing_issues_summary', ... }
 */
async function getListingIssuesSummary(userContext, dateRange) {
  const ctx = await QMateIssuesService.getQMateIssuesContext(
    userContext.userId,
    userContext.country,
    userContext.region
  );
  if (!ctx || !ctx.success || !ctx.data) {
    return {
      type: 'listing_issues_summary',
      totalIssues: 0,
      byType: [],
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      mostAffectedProducts: [],
      urgentIssues: [],
      notFound: true,
    };
  }
  const data = ctx.data;

  // Aggregate per-issue-type across the ranking + conversion + inventory product
  // arrays. Each product entry is { asin, title, issues: [{ section?, type, ... }] }.
  // We surface the ACTUAL type strings the service emits (no invented buckets).
  const byTypeMap = new Map(); // issueType -> { issueType, count, affectedAsins:Set }
  const collect = (productArray, prefixSectionForRanking) => {
    for (const p of productArray || []) {
      for (const iss of p.issues || []) {
        const baseType = iss.type || 'unknown';
        const issueType = prefixSectionForRanking && iss.section ? `${iss.section}:${baseType}` : baseType;
        const e = byTypeMap.get(issueType) || { issueType, baseType, count: 0, affectedAsins: new Set() };
        e.count += 1;
        if (p.asin) e.affectedAsins.add(p.asin);
        byTypeMap.set(issueType, e);
      }
    }
  };
  collect(data.rankingIssues, true);
  collect(data.conversionIssues, false);
  collect(data.inventoryIssues, false);

  const byType = Array.from(byTypeMap.values())
    .map((e) => ({
      issueType: e.issueType,
      count: e.count,
      severity: severityOf(e.baseType),
      affectedAsins: Array.from(e.affectedAsins),
    }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);

  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of byType) bySeverity[t.severity] += t.count;

  // Most-affected products come straight from the service's topErrorAsins
  // (already sorted by error count by the service).
  const mostAffectedProducts = (data.topErrorAsins || []).slice(0, 10).map((p) => ({
    asin: p.asin,
    productName: p.name || 'Unknown',
    issueCount: p.errors || 0,
  }));

  const urgentIssues = byType.filter((t) => t.severity === 'critical' || t.severity === 'high');

  return {
    type: 'listing_issues_summary',
    totalIssues: data.summary?.totalIssues || 0,
    categoryCounts: {
      ranking: data.summary?.rankingErrors || 0,
      conversion: data.summary?.conversionErrors || 0,
      inventory: data.summary?.inventoryErrors || 0,
    },
    byType,
    bySeverity,
    mostAffectedProducts,
    urgentIssues,
    numberOfProductsWithIssues: data.summary?.numberOfProductsWithIssues || 0,
    totalActiveProducts: data.summary?.totalActiveProducts || 0,
  };
}

/**
 * HANDLER — listing issues for one ASIN (Category A: #8, #11). Uses the
 * purpose-built single-ASIN path (QMateProductsService.getAsinIssues).
 *
 * @param {string} asin
 * @param {{ userId, country, region }} userContext
 * @returns {Promise<Object>} { type:'listing_issues_asin', asin, productName, issues, ... }
 */
async function getListingIssuesForAsin(asin, userContext) {
  const normalizedAsin = String(asin || '').trim().toUpperCase();
  if (!normalizedAsin) {
    return { type: 'listing_issues_asin', asin: null, productName: null, issues: [], notFound: true };
  }
  const res = await QMateProductsService.getAsinIssues(
    userContext.userId,
    userContext.country,
    userContext.region,
    normalizedAsin
  );
  if (!res || !res.success || !res.data) {
    return { type: 'listing_issues_asin', asin: normalizedAsin, productName: null, issues: [], notFound: true };
  }
  const d = res.data;
  return {
    type: 'listing_issues_asin',
    asin: normalizedAsin,
    productName: d.productName || normalizedAsin,
    hasIssues: !!d.hasIssues,
    totalErrors: d.totalErrors || 0,
    categoryBreakdown: d.categoryBreakdown || null,
    issues: d.issues || [],
    notFound: !d.hasIssues && (d.totalErrors || 0) === 0,
  };
}

// ── Listing Issue Fix Knowledge Base (Category A: #9, #10) ──
const LISTING_FIX_KNOWLEDGE = {
  suppressed: {
    title: 'How to Fix a Suppressed Listing',
    steps: [
      'Go to Seller Central → Inventory → Manage All Inventory → Suppressed',
      'Identify the suppression reason (missing image, pricing, restricted product, etc.)',
      'For missing image: upload a main image that meets Amazon requirements (white background, 1000x1000px minimum, no watermarks)',
      "For pricing issues: ensure your price is within Amazon's fair pricing guidelines",
      'For restricted products: submit an approval application or ungating request',
      'After fixing, the listing typically reactivates within 24-48 hours',
      'If not reactivated, open a case with Seller Support referencing the ASIN',
    ],
  },
  missing_image: {
    title: 'How to Fix Missing Image Issues',
    steps: [
      'Go to Seller Central → Inventory → Manage All Inventory → Edit the listing',
      'Upload a main image (MAIN) with: white background, at least 1000x1000 pixels, product fills 85% of frame',
      'Do NOT use illustrations, graphics, or placeholder images',
      'Additional images (PT01-PT08) should show different angles, usage, size comparison',
      'Images must be JPEG, PNG, TIFF, or GIF format',
      'Allow 24 hours for images to process and appear',
    ],
  },
  missing_bullets: {
    title: 'How to Fix Missing Bullet Points',
    steps: [
      'Go to Seller Central → Inventory → Manage All Inventory → Edit the listing',
      'Navigate to the "Description" or "Product Details" tab',
      'Add 5 bullet points (each 200 characters max for readability)',
      'Lead each bullet with a CAPITAL benefit keyword',
      'Include relevant search terms naturally',
      'Focus on benefits, not just features',
    ],
  },
  missing_title: {
    title: 'How to Fix a Missing or Weak Title',
    steps: [
      'Go to Seller Central → Inventory → Manage All Inventory → Edit the listing',
      'Write a title under your category\'s character limit (often 200 chars; many categories recommend ≤ 80)',
      'Lead with Brand, then the core product, then key differentiators (size, color, count)',
      'Avoid promotional language ("best", "sale"), ALL CAPS, and special characters',
      'Include your top search keywords naturally — do not keyword-stuff',
    ],
  },
  missing_description: {
    title: 'How to Fix a Missing Product Description',
    steps: [
      'Go to Seller Central → Inventory → Manage All Inventory → Edit the listing',
      'Add a product description (or A+ Content if brand-registered) of at least a few sentences',
      'Expand on the bullet points: use cases, materials, dimensions, what\'s in the box',
      'Use simple HTML line breaks for readability where allowed',
      'If brand-registered, prefer A+ Content for richer formatting and images',
    ],
  },
  no_aplus: {
    title: 'How to Add A+ Content',
    steps: [
      'Enroll in Amazon Brand Registry if you have not already (requires a registered trademark)',
      'Go to Seller Central → Advertising → A+ Content Manager → Start creating A+ content',
      'Choose modules (comparison charts, lifestyle images, feature callouts)',
      'Apply the content to the relevant ASINs and submit for review',
      'Approval typically takes up to 7 days',
    ],
  },
  low_image_count: {
    title: 'How to Add More Product Images',
    steps: [
      'Aim for at least 7 images: main (white background) plus lifestyle, infographic, size/scale, and detail shots',
      'Go to Seller Central → Inventory → Manage All Inventory → Edit → Images',
      'Upload to slots PT01-PT08; each at least 1000x1000px for zoom',
      'Show the product in use and call out key features visually',
    ],
  },
  no_buybox: {
    title: 'How to Win the Buy Box',
    steps: [
      'Ensure your price (incl. shipping) is competitive vs. other offers on the ASIN',
      'Maintain strong seller metrics (low ODR, low late-shipment/cancellation rates)',
      'Prefer FBA or Seller-Fulfilled Prime for faster delivery promises',
      'Keep the item in stock — out-of-stock offers lose the Buy Box',
      'Confirm the listing is in "Active" status and not suppressed',
    ],
  },
  pricing_error: {
    title: 'How to Fix a Pricing Error / Pricing Suppression',
    steps: [
      'Go to Seller Central → Inventory → Manage All Inventory → filter by "Pricing"',
      'Set your price within Amazon\'s fair-pricing guardrails (not far above recent market price)',
      'Check the "Your Price" and any min/max pricing rules or repricer settings',
      'Remove or correct any reference/list price that triggered the suppression',
      'The offer typically reactivates shortly after a compliant price is set',
    ],
  },
};

// Map free-text fix requests to a knowledge-base key.
function parseFixIssueType(prompt) {
  if (/suppress/i.test(prompt)) return 'suppressed';
  if (/image|photo|picture/i.test(prompt)) return 'missing_image';
  if (/bullet/i.test(prompt)) return 'missing_bullets';
  if (/title/i.test(prompt)) return 'missing_title';
  if (/description/i.test(prompt)) return 'missing_description';
  if (/a\+|aplus|a plus/i.test(prompt)) return 'no_aplus';
  if (/buy\s*box|buybox/i.test(prompt)) return 'no_buybox';
  if (/pric/i.test(prompt)) return 'pricing_error';
  return null;
}

/**
 * HANDLER — knowledge-based fix steps for a listing issue type (Category A:
 * #9, #10). `issueType` may be a knowledge-base key or a raw issue type string;
 * a small alias map normalizes the common ones.
 *
 * @param {string} issueType
 * @returns {Object} { type:'listing_issue_fix', issueType, title, steps, found }
 */
function getListingIssueFix(issueType) {
  const ALIASES = {
    // raw service issue-types → knowledge keys
    low_image_count: 'low_image_count',
    no_video: 'low_image_count',
    no_brand_story: 'no_aplus',
    character_limit: 'missing_title',
    restricted_words: 'missing_title',
    special_characters: 'missing_title',
    image: 'missing_image',
    bullets: 'missing_bullets',
    bullet_points: 'missing_bullets',
    title: 'missing_title',
    description: 'missing_description',
  };
  const key = LISTING_FIX_KNOWLEDGE[issueType] ? issueType : (ALIASES[issueType] || issueType);
  const entry = LISTING_FIX_KNOWLEDGE[key];
  if (!entry) {
    return {
      type: 'listing_issue_fix',
      issueType,
      found: false,
      title: 'Fix steps not available',
      steps: [
        'Open Seller Central → Inventory → Manage All Inventory and edit the affected listing.',
        'Review the specific error Amazon reports for the listing and follow its inline guidance.',
        'If unclear, open a case with Seller Support referencing the ASIN.',
      ],
    };
  }
  return { type: 'listing_issue_fix', issueType: key, found: true, title: entry.title, steps: entry.steps };
}

// ════════════════════════════════════════════════════════════════════════════
// INVENTORY HANDLERS (Category B) — real data via QMateInventoryService +
// FbaInventoryReadService. NOTE: inventory $VALUE is not aggregated by any
// service (units exist; per-unit price isn't joined), so totalValue/value are
// returned as null with a flag rather than fabricated.
// ════════════════════════════════════════════════════════════════════════════

const LOW_STOCK_DAYS = 14;
const OVERSTOCK_DAYS = 180;

/** Account-wide FBA inventory summary. */
async function getInventorySummary(userContext) {
  const rec = await QMateInventoryService.getReplenishmentRecommendations(
    userContext.userId, userContext.country, userContext.region
  );
  if (!rec || !rec.success || !rec.data) {
    return { type: 'inventory_summary', available: false, message: 'Inventory data is not yet available in SellerQI' };
  }
  const products = rec.data.products || [];
  const totalUnits = products.reduce((s, p) => s + (p.available || 0) + (p.inbound || 0), 0);
  const withDos = products.filter((p) => (p.daysOfSupply || 0) > 0);
  const avgDaysOfSupply = withDos.length
    ? Math.round(withDos.reduce((s, p) => s + p.daysOfSupply, 0) / withDos.length)
    : 0;

  // Velocity-sorted breakdown (fastest sellers first).
  const breakdown = products
    .slice()
    .sort((a, b) => (b.unitsSoldLast30Days || 0) - (a.unitsSoldLast30Days || 0))
    .slice(0, 25)
    .map((p) => ({
      asin: p.asin,
      productName: p.productName,
      units: (p.available || 0) + (p.inbound || 0),
      available: p.available || 0,
      inbound: p.inbound || 0,
      daysOfSupply: p.daysOfSupply || 0,
      unitsSoldLast30Days: p.unitsSoldLast30Days || 0,
      status: p.status,
    }));

  return {
    type: 'inventory_summary',
    totalUnits,
    totalValue: null, // not available — per-unit price isn't joined to inventory
    totalValueAvailable: false,
    productCount: rec.data.summary?.totalProducts || products.length,
    avgDaysOfSupply,
    counts: {
      needsRestock: rec.data.summary?.needsRestock || 0,
      lowStock: rec.data.summary?.lowStock || 0,
      outOfStock: rec.data.summary?.outOfStock || 0,
    },
    breakdown,
  };
}

/** FBA inventory for one ASIN. */
async function getInventoryForAsin(asin, userContext) {
  const normalizedAsin = String(asin || '').trim().toUpperCase();
  if (!normalizedAsin) return { type: 'inventory_asin', asin: null, notFound: true };

  const res = await FbaInventoryReadService.getByAsin({
    userId: userContext.userId, country: userContext.country, region: userContext.region, asin: normalizedAsin,
  });
  const summary = res && res.summary;
  if (!summary || (summary.skuCount || 0) === 0) {
    return { type: 'inventory_asin', asin: normalizedAsin, units: 0, value: null, daysOfSupply: null, status: 'no_data', notFound: true };
  }

  // Enrich days-of-supply / status from the replenishment recommendations if present.
  let daysOfSupply = null;
  let status = 'in_stock';
  try {
    const rec = await QMateInventoryService.getReplenishmentRecommendations(userContext.userId, userContext.country, userContext.region);
    const p = (rec?.data?.products || []).find((x) => String(x.asin).toUpperCase() === normalizedAsin);
    if (p) { daysOfSupply = p.daysOfSupply; status = p.status || status; }
  } catch (_) { /* best-effort enrichment */ }

  const units = summary.totalFulfillable != null ? summary.totalFulfillable : (summary.totalQuantity || 0);
  return {
    type: 'inventory_asin',
    asin: normalizedAsin,
    units,
    totalQuantity: summary.totalQuantity || 0,
    inbound: summary.totalInbound || 0,
    reserved: summary.totalReserved || 0,
    unfulfillable: summary.totalUnfulfillable || 0,
    value: null, // not available — per-unit price isn't joined to inventory
    valueAvailable: false,
    daysOfSupply,
    status,
  };
}

/** Products running low / out of stock. */
async function getLowStockAlerts(userContext) {
  const rec = await QMateInventoryService.getReplenishmentRecommendations(
    userContext.userId, userContext.country, userContext.region
  );
  if (!rec || !rec.success || !rec.data) {
    return { type: 'low_stock', available: false, message: 'Inventory data is not yet available in SellerQI' };
  }
  const products = (rec.data.products || []).filter(
    (p) => p.status === 'out_of_stock' || p.status === 'low_stock' || (p.daysOfSupply || 0) < LOW_STOCK_DAYS
  );
  return {
    type: 'low_stock',
    thresholdDays: LOW_STOCK_DAYS,
    products: products.map((p) => ({
      asin: p.asin, productName: p.productName, available: p.available || 0,
      daysOfSupply: p.daysOfSupply || 0, unitsSoldLast30Days: p.unitsSoldLast30Days || 0,
      recommendedQty: p.recommendedQty || 0, status: p.status, urgency: p.urgency,
    })),
    urgentCount: products.filter((p) => p.urgency === 'critical' || p.status === 'out_of_stock').length,
    total: products.length,
  };
}

/** Overstocked / aging inventory (uses aging-inventory analysis). */
async function getOverstockAlerts(userContext) {
  const aging = await QMateInventoryService.getAgingInventory(
    userContext.userId, userContext.country, userContext.region
  );
  if (!aging || !aging.success || !aging.data) {
    return { type: 'overstock', available: false, message: 'Aging-inventory data is not yet available in SellerQI' };
  }
  const d = aging.data;
  return {
    type: 'overstock',
    thresholdDays: OVERSTOCK_DAYS,
    products: (d.agingProducts || []).map((p) => ({
      asin: p.asin,
      totalAgingUnits: p.totalAgingUnits || 0,
      unfulfillable: p.unfulfillable || 0,
      agingBreakdown: p.agingBreakdown || null,
      urgency: p.urgency || 'medium',
    })),
    summary: d.summary || null,
    // Storage-cost impact: long-term storage fees aren't exposed per-ASIN by the
    // aging service; surfaced as the aging-unit totals. A finance cross-ref would
    // require the overhead breakdown (storage fee line) — left as a known gap.
    storageCostImpact: null,
    storageCostImpactAvailable: false,
    total: (d.agingProducts || []).length,
  };
}

/** Restock advice — low-stock products that are ALSO profitable (FinanceEngine). */
async function getRestockAdvice(userContext, dateRange) {
  const rec = await QMateInventoryService.getReplenishmentRecommendations(
    userContext.userId, userContext.country, userContext.region
  );
  if (!rec || !rec.success || !rec.data) {
    return { type: 'restock_advice', available: false, message: 'Inventory data is not yet available in SellerQI' };
  }
  const needRestock = (rec.data.products || []).filter(
    (p) => p.status === 'out_of_stock' || p.status === 'low_stock' || (p.recommendedQty || 0) > 0
  );

  // Per-ASIN profitability from the SAME finance path the dashboard uses.
  const profitByAsin = new Map();
  try {
    const dr = dateRange && dateRange.startDate
      ? dateRange
      : await FinanceEngine.resolveFinanceDateRange({}, userContext, dateRange);
    const dashboardData = await FinanceDashboardReadService.getDashboard({
      userId: userContext.userId, country: userContext.country, region: userContext.region,
      startDate: dr.startDate, endDate: dr.endDate,
    });
    const cogs = await FinanceEngine.fetchCogsForUser(userContext);
    for (const row of dashboardData.asinWise || []) {
      const e = FinanceEngine.computeAsinRowEntry(row, cogs && cogs.cogsMap);
      profitByAsin.set(String(e.asin).toUpperCase(), e);
    }
  } catch (err) {
    logger.warn('[SellerOpsEngine] restock-advice profitability lookup failed; recommending without profit filter', { message: err.message });
  }

  const haveProfit = profitByAsin.size > 0;
  const toRestock = needRestock
    .map((p) => {
      const e = profitByAsin.get(String(p.asin).toUpperCase());
      const profitMargin = e ? e.profitMargin : null;
      const dailyVelocity = (p.unitsSoldLast30Days || 0) / 30;
      return {
        asin: p.asin,
        productName: p.productName,
        currentStock: p.available || 0,
        dailyVelocity: Math.round(dailyVelocity * 100) / 100,
        daysRemaining: p.daysOfSupply || 0,
        suggestedUnits: p.recommendedQty || 0,
        profitMargin,
        status: p.status,
      };
    })
    // Only recommend restocking products that are profitable (or whose profit is
    // unknown when finance data is unavailable — don't hide everything then).
    .filter((r) => (haveProfit ? (r.profitMargin != null && r.profitMargin > 0) : true))
    .sort((a, b) => (a.daysRemaining || 0) - (b.daysRemaining || 0));

  return {
    type: 'restock_advice',
    profitFiltered: haveProfit,
    toRestock,
    total: toRestock.length,
    note: haveProfit ? undefined : 'Profitability data unavailable — showing all low-stock products.',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ACCOUNT HEALTH HANDLERS (Category C) — real data via QMateMetricsService.
// NOTE: V2 seller-performance metrics are STATUS STRINGS (e.g. "Healthy"/a
// status label), not numeric rates — so currentValue is the status string.
// ════════════════════════════════════════════════════════════════════════════

const ACCOUNT_HEALTH_KNOWLEDGE = {
  odr: {
    threshold: 1.0,
    name: 'Order Defect Rate',
    consequences: 'Account suspension if ODR exceeds 1% over a 60-day window',
    actions: [
      'Review recent A-to-Z claims and respond to all open ones within 48 hours',
      'Address negative feedback by contacting buyers and resolving issues',
      'Check for listing accuracy issues causing chargebacks',
      'Review your product quality — defects drive returns and claims',
      'If you use FBM, ensure shipment tracking is always uploaded',
    ],
    urgencyThresholds: { critical: 0.9, warning: 0.7, safe: 0.5 },
  },
  lateShipment: {
    threshold: 4.0,
    name: 'Late Shipment Rate',
    consequences: 'Account suspension if late shipment rate exceeds 4%',
    actions: [
      'Switch to FBA for high-volume products to eliminate shipping delays',
      'Set realistic handling times in your shipping settings',
      'Use Amazon Buy Shipping for discounted, tracked labels',
      'Ship and confirm orders the same day when possible',
    ],
    urgencyThresholds: { critical: 3.5, warning: 2.5, safe: 1.5 },
  },
  preFulfillmentCancel: {
    threshold: 2.5,
    name: 'Pre-Fulfillment Cancel Rate',
    consequences: 'Account suspension if cancellation rate exceeds 2.5%',
    actions: [
      'Keep inventory counts accurate — cancellations often come from out-of-stock',
      'Use FBA to reduce cancellations from inventory issues',
      "Don't list items you can't ship within the handling time",
    ],
    urgencyThresholds: { critical: 2.0, warning: 1.5, safe: 0.5 },
  },
};

/** Map a free-text metric reference / V2 metric key → knowledge-base key. */
function resolveHealthMetricKey(text) {
  const t = String(text || '').toLowerCase();
  if (/odr|order\s*defect|defect|orderdefects/.test(t)) return 'odr';
  if (/late\s*shipment|lateshipment/.test(t)) return 'lateShipment';
  if (/cancel|preFulfillment|cancellation/i.test(t)) return 'preFulfillmentCancel';
  return null;
}

/** Overall account health snapshot. */
async function getAccountHealth(userContext) {
  const res = await QMateMetricsService.getAccountHealthData(
    userContext.userId, userContext.country, userContext.region
  );
  if (!res || !res.success || !res.data) {
    return { type: 'account_health', available: false, message: 'Account health data is not yet available in SellerQI' };
  }
  const d = res.data;
  const accountErrors = d.AccountErrors || {};
  // At-risk metrics = AccountErrors entries with status 'Error'.
  const atRiskMetrics = Object.entries(accountErrors)
    .filter(([k, v]) => k !== 'TotalErrors' && v && v.status === 'Error')
    .map(([metric, v]) => ({ metric, message: v.Message, howToSolve: v.HowTOSolve }));

  return {
    type: 'account_health',
    overallStatus: d.accountHealthPercentage?.status || d.status || 'Unknown',
    healthPercentage: d.accountHealthPercentage?.Percentage ?? d.percentage ?? null,
    ahrScore: d.ahrScore ?? null,
    metrics: d.metrics || {}, // { cancellationRate, orderDefects, lateShipmentRate, validTrackingRate, policyViolations } (status strings)
    atRiskMetrics,
    totalErrors: accountErrors.TotalErrors || atRiskMetrics.length,
  };
}

/** Action guidance for a specific account-health metric (knowledge-based). */
async function getAccountHealthAction(userContext, specificMetric) {
  const key = resolveHealthMetricKey(specificMetric) || 'odr';
  const kb = ACCOUNT_HEALTH_KNOWLEDGE[key];

  // Current value (status string) from the live metrics, best-effort.
  let currentValue = null;
  let status = 'unknown';
  try {
    const res = await QMateMetricsService.getAccountHealthData(userContext.userId, userContext.country, userContext.region);
    if (res?.success && res.data) {
      const m = res.data.metrics || {};
      currentValue = key === 'odr' ? m.orderDefects : key === 'lateShipment' ? m.lateShipmentRate : m.cancellationRate;
      const err = (res.data.AccountErrors || {});
      // Map kb key → AccountErrors key heuristically.
      const errKey = Object.keys(err).find((k) => resolveHealthMetricKey(k) === key);
      status = errKey && err[errKey]?.status === 'Error' ? 'at_risk' : 'ok';
    }
  } catch (_) { /* best-effort */ }

  return {
    type: 'account_health_action',
    metric: kb.name,
    metricKey: key,
    currentValue,
    threshold: `${kb.threshold}%`,
    status,
    steps: kb.actions,
    consequences: kb.consequences,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// REIMBURSEMENT HANDLERS (Category D) — real data via QMateReimbursementService.
// ════════════════════════════════════════════════════════════════════════════

/** Received-reimbursement summary + monthly trend. */
async function getReimbursementSummary(userContext, dateRange) {
  const [received, trends] = await Promise.all([
    QMateReimbursementService.getReimbursementSummary(userContext.userId, userContext.country, userContext.region),
    QMateReimbursementService.getReimbursementTrends(userContext.userId, userContext.country, userContext.region),
  ]);
  if (!received || !received.success || !received.data) {
    return { type: 'reimbursement_summary', available: false, message: 'Reimbursement data is not yet available in SellerQI' };
  }
  const d = received.data;
  return {
    type: 'reimbursement_summary',
    totalReimbursed: d.summary?.totalAmount || 0,
    totalUnits: d.summary?.totalUnits || 0,
    totalClaims: d.summary?.totalClaims || 0,
    currency: d.summary?.currency || 'USD',
    byType: d.byReason || {},
    topAsins: d.topAsinsByReimbursement || [],
    recent: d.recentReimbursements || [],
    byMonth: trends?.success && trends.data ? (trends.data.monthlyTrends || []) : [],
  };
}

/** Unclaimed/potential reimbursement opportunities. */
async function getReimbursementOpportunities(userContext) {
  const res = await QMateReimbursementService.getRecoverableReimbursements(
    userContext.userId, userContext.country, userContext.region
  );
  if (!res || !res.success || !res.data) {
    return { type: 'reimbursement_opportunities', available: false, message: 'Recoverable-reimbursement data is not yet available in SellerQI' };
  }
  const d = res.data;
  const cat = (c) => (c ? { count: c.count || 0, totalAmount: c.totalAmount || 0, items: c.items || [] } : { count: 0, totalAmount: 0, items: [] });
  return {
    type: 'reimbursement_opportunities',
    potentialAmount: d.summary?.totalRecoverable || 0,
    breakdown: {
      shipmentDiscrepancy: cat(d.shipmentDiscrepancy),
      lostInventory: cat(d.lostInventory),
      damagedInventory: cat(d.damagedInventory),
      disposedInventory: cat(d.disposedInventory),
    },
    cases: [
      ...(d.shipmentDiscrepancy?.items || []).map((i) => ({ ...i, category: 'shipment_discrepancy' })),
      ...(d.lostInventory?.items || []).map((i) => ({ ...i, category: 'lost_inventory' })),
      ...(d.damagedInventory?.items || []).map((i) => ({ ...i, category: 'damaged_inventory' })),
      ...(d.disposedInventory?.items || []).map((i) => ({ ...i, category: 'disposed_inventory' })),
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PRODUCT / BSR HANDLERS (Category E) — products via QMateProductsService.
// BSR (Best Seller Rank) is NOT tracked anywhere in SellerQI — confirmed zero
// occurrences of salesRank/bestSellerRank/BSR in any model. So bsr_analysis and
// the BSR field of product_details return available:false.
// ════════════════════════════════════════════════════════════════════════════

/** Product catalog summary. */
async function getProductSummary(userContext) {
  const res = await QMateProductsService.getQMateProductsContext(
    userContext.userId, userContext.country, userContext.region
  );
  if (!res || !res.success || !res.data) {
    return { type: 'product_summary', available: false, message: 'Product data is not yet available in SellerQI' };
  }
  const phs = res.data.productHealthSummary || {};
  return {
    type: 'product_summary',
    totalProducts: phs.totalProducts || 0,
    activeCount: phs.activeProducts || 0,
    inactiveCount: phs.nonSellableProducts ?? (phs.totalProducts && phs.activeProducts != null ? phs.totalProducts - phs.activeProducts : 0),
    averageRating: phs.averageRating ?? null,
    categories: res.data.categorization?.summary || res.data.categorization || null,
  };
}

/** Per-ASIN product details. BSR not available. */
async function getProductDetails(asin, userContext) {
  const normalizedAsin = String(asin || '').trim().toUpperCase();
  if (!normalizedAsin) return { type: 'product_details', asin: null, notFound: true };
  const res = await QMateProductsService.getFullAsinIssues(
    userContext.userId, userContext.country, userContext.region, normalizedAsin
  );
  const d = res && res.success ? res.data : null;
  if (!d || !d.name) {
    return { type: 'product_details', asin: normalizedAsin, notFound: true, bsr: null, bsrAvailable: false };
  }
  return {
    type: 'product_details',
    asin: normalizedAsin,
    name: d.name,
    sku: d.sku || null,
    price: d.price || 0,
    quantity: d.quantity || 0,
    sales: d.sales || 0,
    bsr: null, // NOT tracked in SellerQI
    bsrAvailable: false,
    category: null, // category/salesRank not stored
    categoryAvailable: false,
  };
}

/** BSR trend analysis — not supported (BSR is not ingested). */
async function getBSRAnalysis(userContext, dateRange) {
  return {
    type: 'bsr_analysis',
    available: false,
    message: 'Best Seller Rank (BSR) is not currently tracked in SellerQI, so BSR trends cannot be analyzed.',
    trending_up: [],
    trending_down: [],
  };
}

// ── SECTION 4 — handleSellerOpsQuery (listing issues wired; rest stubbed) ──

/**
 * Main entry point. Classifies the SellerOps sub-type and routes. Listing-issue
 * types are fully handled; other SellerOps types return a 'not_implemented'
 * marker (so layers/index.js falls through to the existing pipeline) until their
 * handlers land in later phases.
 *
 * @param {Object} interpretation
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate }} [requestDateRange]
 * @returns {Promise<Object>} structured result, or { type:'error', message }
 */
async function handleSellerOpsQuery(interpretation, userContext, requestDateRange) {
  try {
    const queryType = classifySellerOpsQueryType(interpretation);
    const prompt = extractPromptText(interpretation);
    const asin = (interpretation?.entities?.asins || [])[0] || null;
    logger.info(`[SellerOpsEngine] handleSellerOpsQuery — queryType=${queryType}`);

    switch (queryType) {
      // Listing issues
      case 'listing_issues_summary':
        return await getListingIssuesSummary(userContext, requestDateRange);
      case 'listing_issues_asin':
        return await getListingIssuesForAsin(asin, userContext);
      case 'listing_issue_fix':
        return getListingIssueFix(parseFixIssueType(prompt) || 'suppressed');
      // Inventory
      case 'inventory_summary':
        return await getInventorySummary(userContext);
      case 'inventory_asin':
        return await getInventoryForAsin(asin, userContext);
      case 'low_stock':
        return await getLowStockAlerts(userContext);
      case 'overstock':
        return await getOverstockAlerts(userContext);
      case 'restock_advice':
        return await getRestockAdvice(userContext, requestDateRange);
      // Account health
      case 'account_health':
        return await getAccountHealth(userContext);
      case 'account_health_action':
        return await getAccountHealthAction(userContext, prompt);
      // Reimbursements
      case 'reimbursement_summary':
        return await getReimbursementSummary(userContext, requestDateRange);
      case 'reimbursement_opportunities':
        return await getReimbursementOpportunities(userContext);
      // Product / BSR
      case 'product_summary':
        return await getProductSummary(userContext);
      case 'product_details':
        return await getProductDetails(asin, userContext);
      case 'bsr_analysis':
        return await getBSRAnalysis(userContext, requestDateRange);
      default:
        return { type: 'not_implemented', queryType };
    }
  } catch (err) {
    logger.error('[SellerOpsEngine] Error in handleSellerOpsQuery:', err.message);
    return { type: 'error', message: err.message };
  }
}

// ── Narrator (LLM formats the deterministic result; fallback is template) ──

const SELLEROPS_NARRATOR_MODEL = process.env.QMATE_NARRATOR_MODEL || 'gpt-4o-mini';
const SELLEROPS_NARRATOR_SYSTEM_PROMPT = `You are QMate, an Amazon seller operations assistant. You receive pre-computed operational data (listing issues, inventory, account health, reimbursements, products). Present it clearly and help the seller act.

RULES:
1. EVERY number/fact must come from the result data. Do NOT invent ASINs, counts, or amounts.
2. Currency: $1,234.56. Percentages: 12.3%.
3. Be concise and specific; lead with the headline (the count, the urgent items, the recommendation).
4. For listing issues: lead with the total, then the most-affected products and the urgent issue types.
5. For inventory: lead with what needs action (low/out of stock), then the summary.
6. For account health: state the overall status and any at-risk metrics.
7. For reimbursements: state the dollar amount and the breakdown.
8. For 'fix'/operational steps: present the numbered steps clearly.
9. If the result has 'available: false' or 'notFound: true', say the data isn't available yet — do NOT fabricate.
10. Never say 'approximately'. Numbers are exact.`;

function sFmtMoney(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

/** Deterministic per-type fallback narration. */
function buildSellerOpsFallback(r) {
  if (!r || typeof r !== 'object') return 'I was unable to format the result.';
  if (r.available === false || r.notFound) return r.message || 'That data is not available yet in SellerQI.';
  switch (r.type) {
    case 'listing_issues_summary':
      return `You have ${r.totalIssues} listing issue(s) across ${r.numberOfProductsWithIssues} product(s). Most affected: ${(r.mostAffectedProducts || []).slice(0, 3).map((p) => `${p.asin} (${p.issueCount})`).join(', ') || 'n/a'}. Urgent types: ${(r.urgentIssues || []).slice(0, 3).map((t) => t.issueType).join(', ') || 'none'}.`;
    case 'listing_issues_asin':
      return `${r.productName || r.asin} has ${r.totalErrors || 0} issue(s)${r.categoryBreakdown ? ` (ranking ${r.categoryBreakdown.ranking}, conversion ${r.categoryBreakdown.conversion}, inventory ${r.categoryBreakdown.inventory})` : ''}.`;
    case 'listing_issue_fix':
    case 'operational_advice':
      return `${r.title}:\n${(r.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    case 'inventory_summary':
      return `You have ${r.totalUnits} unit(s) across ${r.productCount} product(s), avg ${r.avgDaysOfSupply} days of supply. ${r.counts?.outOfStock || 0} out of stock, ${r.counts?.lowStock || 0} low.`;
    case 'inventory_asin':
      return `${r.asin}: ${r.units} fulfillable unit(s)${r.daysOfSupply != null ? `, ~${r.daysOfSupply} days of supply` : ''} (${r.status}).`;
    case 'low_stock':
      return `${r.total} product(s) are low or out of stock (${r.urgentCount} urgent).`;
    case 'overstock':
      return `${r.total} product(s) have aging/overstocked inventory.`;
    case 'restock_advice':
      return `${r.total} product(s) recommended to restock${r.profitFiltered ? ' (profitable only)' : ''}.`;
    case 'account_health':
      return `Account health: ${r.overallStatus}${r.healthPercentage != null ? ` (${r.healthPercentage}%)` : ''}. At-risk metrics: ${(r.atRiskMetrics || []).map((m) => m.metric).join(', ') || 'none'}.`;
    case 'account_health_action':
      return `${r.metric} (threshold ${r.threshold}, status ${r.status}). ${r.consequences}\nSteps:\n${(r.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    case 'reimbursement_summary':
      return `You've been reimbursed ${sFmtMoney(r.totalReimbursed)} across ${r.totalClaims || 0} claim(s).`;
    case 'reimbursement_opportunities':
      return `You have an estimated ${sFmtMoney(r.potentialAmount)} in recoverable reimbursements across ${(r.cases || []).length} case(s).`;
    case 'product_summary':
      return `You have ${r.totalProducts} product(s) (${r.activeCount} active)${r.averageRating != null ? `, average rating ${r.averageRating}` : ''}.`;
    case 'product_details':
      return `${r.name || r.asin}${r.price ? ` — ${sFmtMoney(r.price)}` : ''}. Note: BSR is not tracked in SellerQI.`;
    case 'bsr_analysis':
      return r.message || 'BSR is not currently tracked in SellerQI.';
    default:
      return 'Here are your results.';
  }
}

/**
 * Narrate a SellerOps result via the LLM, with deterministic fallback.
 * @param {Object} result
 * @param {string} userQuestion
 * @param {Object} [modelTools] - { client }
 * @returns {Promise<string>}
 */
async function narrateSellerOpsResult(result, userQuestion, modelTools) {
  const client = modelTools && modelTools.client;
  if (client && client.chat && client.chat.completions && typeof client.chat.completions.create === 'function') {
    try {
      const completion = await client.chat.completions.create({
        model: SELLEROPS_NARRATOR_MODEL,
        messages: [
          { role: 'system', content: SELLEROPS_NARRATOR_SYSTEM_PROMPT },
          { role: 'user', content: `User asked: '${userQuestion}'\n\nPre-computed result:\n${JSON.stringify(result, null, 2)}\n\nPresent this as a clear answer.` },
        ],
        temperature: 0.1,
        max_tokens: 800,
      });
      const content = completion?.choices?.[0]?.message?.content;
      if (content && content.trim()) return content.trim();
    } catch (err) {
      logger.warn('[SellerOpsEngine] Narrator LLM failed; using fallback', { message: err.message });
    }
  }
  return buildSellerOpsFallback(result);
}

module.exports = {
  isSellerOpsQuery,
  classifySellerOpsQueryType,
  handleSellerOpsQuery,
  narrateSellerOpsResult,
  // listing-issue handlers
  getListingIssuesSummary,
  getListingIssuesForAsin,
  getListingIssueFix,
  // inventory handlers
  getInventorySummary,
  getInventoryForAsin,
  getLowStockAlerts,
  getOverstockAlerts,
  getRestockAdvice,
  // account-health handlers
  getAccountHealth,
  getAccountHealthAction,
  // reimbursement handlers
  getReimbursementSummary,
  getReimbursementOpportunities,
  // product / BSR handlers
  getProductSummary,
  getProductDetails,
  getBSRAnalysis,
  // exported for later phases / testing
  LISTING_FIX_KNOWLEDGE,
  ACCOUNT_HEALTH_KNOWLEDGE,
  parseFixIssueType,
  extractPromptText,
};

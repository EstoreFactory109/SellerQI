/**
 * FinanceEngine — deterministic finance answer engine for QMate.
 *
 * Computes every finance number using the SAME code path as the dashboard
 * (FinanceDashboardReadService + server/shared/financeCalculations) and returns
 * structured result objects. The LLM narrator (added later) only formats these
 * numbers into prose — it never invents them.
 *
 * Critical fix vs. the legacy path: dates are anchored to the user's
 * DataFetchTracking.dataRange.endDate (same as the dashboard), NOT to `new Date()`
 * (today), which previously produced empty/misaligned windows.
 */

// ── SECTION 1 — Imports ──
const logger = require('../../../../utils/Logger.js');
const FinanceDashboardReadService = require('../../../Finance/FinanceDashboardReadService.js');
const {
  computeDisplayTotalExpenses,
  computeDisplayProfit,
  computeTotalCogsFromAsinWise,
  computeRowProfit,
} = require('../../../../shared/financeCalculations.js');
const DataFetchTracking = require('../../../../models/system/DataFetchTrackingModel.js');
const Cogs = require('../../../../models/finance/CogsModel.js');
const { getDefaultReportDateRange } = require('../../../../utils/reportDateRange.js');

// ── Date helpers (YYYY-MM-DD string math via UTC to avoid TZ drift) ──

/** Normalize any date-ish value to a YYYY-MM-DD string (or null). */
function normalizeYmd(value) {
  if (!value) return null;
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

/** Subtract n days from a YYYY-MM-DD string, returning YYYY-MM-DD. */
function subtractDaysYmd(ymd, n) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD strings. */
function dayCountInclusive(startYmd, endYmd) {
  const a = normalizeYmd(startYmd);
  const b = normalizeYmd(endYmd);
  if (!a || !b) return 1;
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  const diff = Math.round((t2 - t1) / (24 * 60 * 60 * 1000));
  return diff >= 0 ? diff + 1 : 1;
}

/** Smaller of two YYYY-MM-DD strings (ISO string compare is correct). */
function minYmd(a, b) {
  const na = normalizeYmd(a);
  const nb = normalizeYmd(b);
  if (!na) return nb;
  if (!nb) return na;
  return na <= nb ? na : nb;
}

/**
 * Parse the requested period length (in days) from the interpretation/prompt
 * and the frontend calendar mode. Defaults to 30.
 * Mirrors dashboard semantics: last7 = 7 days, last14 = 14 days.
 */
function parsePeriodDays(interpretation, calendarMode) {
  const mode = String(calendarMode || '').toLowerCase();
  if (mode === 'last7') return 7;
  if (mode === 'last14') return 14;

  const tr = interpretation?.entities?.timeRange;
  // Relative value can be "last_7_days", "last 7 days", "last week", etc.
  const raw = String(tr?.value || tr?.raw || interpretation?.raw?.normalizedPrompt || '').toLowerCase();
  const m = raw.match(/(?:last|past)[_\s]+(\d+)[_\s]*days?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (/last\s*week|last_7|past\s*week/.test(raw)) return 7;
  if (/last\s*month|last_30|past\s*month/.test(raw)) return 30;
  return 30;
}

// ── SECTION 2 — resolveFinanceDateRange ──

/**
 * Resolve the finance query window, anchored to the user's data end date
 * (DataFetchTracking.dataRange.endDate), exactly like the dashboard.
 *
 * @param {Object} interpretation - interpretPrompt() output
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, calendarMode }} [requestDateRange] - frontend calendar
 * @returns {Promise<{ startDate, endDate, mode, source, dayCount }>}
 */
async function resolveFinanceDateRange(interpretation, userContext, requestDateRange) {
  // a) Get the data anchor (same source the dashboard calendar uses).
  let anchorEndDate = null;
  let anchorStartDate = null;
  try {
    const tracking = await DataFetchTracking.findOne({
      User: userContext.userId,
      country: userContext.country,
      region: userContext.region,
      status: { $in: ['completed', 'partial'] },
    }).sort({ fetchedAt: -1 });
    anchorEndDate = normalizeYmd(tracking?.dataRange?.endDate);
    anchorStartDate = normalizeYmd(tracking?.dataRange?.startDate);
  } catch (err) {
    logger.warn('[FinanceEngine] DataFetchTracking lookup failed; will use Pacific-yesterday anchor', {
      message: err.message,
    });
  }

  // b) Fallback anchor: Pacific yesterday (same default the ingest paths use).
  if (!anchorEndDate) {
    anchorEndDate = getDefaultReportDateRange().endDate;
    logger.info('[FinanceEngine] No DataFetchTracking anchor found; falling back to Pacific yesterday', {
      anchorEndDate,
    });
  }

  const timeRange = interpretation?.entities?.timeRange || null;

  // c) Explicit start/end from the user prompt → use them, capped at anchor.
  const trStart = normalizeYmd(timeRange?.startDate);
  const trEnd = normalizeYmd(timeRange?.endDate);
  if (trStart && trEnd) {
    const startDate = trStart;
    const endDate = minYmd(trEnd, anchorEndDate);
    const resolved = {
      startDate,
      endDate,
      mode: 'custom',
      source: 'user_explicit',
      dayCount: dayCountInclusive(startDate, endDate),
    };
    logger.info('[FinanceEngine] Date range resolved from explicit user dates', resolved);
    return resolved;
  }

  // d) Frontend calendar passed concrete dates → use as-is.
  const reqStart = normalizeYmd(requestDateRange?.startDate);
  const reqEnd = normalizeYmd(requestDateRange?.endDate);
  if (reqStart && reqEnd) {
    const resolved = {
      startDate: reqStart,
      endDate: reqEnd,
      mode: requestDateRange.calendarMode || 'custom',
      source: 'frontend_calendar',
      dayCount: dayCountInclusive(reqStart, reqEnd),
    };
    logger.info('[FinanceEngine] Date range resolved from frontend calendar', resolved);
    return resolved;
  }

  // e) Relative period anchored to the data end date (same as the dashboard).
  const periodDays = parsePeriodDays(interpretation, requestDateRange?.calendarMode);
  const endDate = anchorEndDate;
  let startDate = subtractDaysYmd(endDate, periodDays - 1);
  // Don't reach before the anchor's known start when we have one.
  if (anchorStartDate && startDate < anchorStartDate && periodDays >= 30) {
    startDate = anchorStartDate;
  }
  const resolved = {
    startDate,
    endDate,
    mode: periodDays === 7 ? 'last7' : periodDays === 14 ? 'last14' : 'default',
    source: 'period_anchored',
    dayCount: dayCountInclusive(startDate, endDate),
  };
  logger.info('[FinanceEngine] Date range resolved from anchored relative period', resolved);
  return resolved;
}

// ── SECTION 3 — fetchCogsForUser ──

/**
 * Load the user's COGS doc and expose it in two convenient shapes.
 *
 * @param {{ userId, country }} userContext
 * @returns {Promise<{ hasCOGS: boolean, entries: Array<{asin, sku, cogs}>, cogsMap: Map<string, number> }>}
 */
async function fetchCogsForUser(userContext) {
  const empty = { hasCOGS: false, entries: [], cogsMap: new Map() };
  try {
    const doc = await Cogs.findOne({
      userId: userContext.userId,
      countryCode: userContext.country,
    }).lean();

    const rawEntries = (doc && Array.isArray(doc.cogsEntries)) ? doc.cogsEntries : [];
    const entries = rawEntries.map((e) => ({
      asin: e.asin,
      sku: e.sku || null,
      cogs: Number(e.cogs || 0),
    }));

    const cogsMap = new Map();
    for (const e of entries) {
      if (e.asin) cogsMap.set(e.asin, Number(e.cogs || 0));
    }

    return { hasCOGS: entries.length > 0, entries, cogsMap };
  } catch (err) {
    logger.warn('[FinanceEngine] COGS lookup failed; proceeding with zero COGS', {
      message: err.message,
    });
    return empty;
  }
}

// ── Query classifier (stubbed for now; expanded in a later phase) ──

/**
 * Extract the user's prompt text from an interpretation, robust to both the
 * full interpreter output (where `raw` is `{ prompt, normalizedPrompt }`) and
 * the layer contract (where only `rewrittenQuestion` is present). Lower-cased.
 *
 * @param {Object} interpretation
 * @returns {string}
 */
function extractPromptText(interpretation) {
  const rawField = interpretation && interpretation.raw;
  const fromRaw =
    typeof rawField === 'string'
      ? rawField
      : (rawField && (rawField.normalizedPrompt || rawField.prompt)) || '';
  const text = fromRaw || (interpretation && interpretation.rewrittenQuestion) || '';
  return String(text).toLowerCase();
}

/**
 * Classify a question into a finance sub-handler queryType.
 * First match wins, checked in strict priority order. Returns 'not_finance'
 * when nothing finance-related matches (signals layers/index.js to skip the
 * FinanceEngine and use the normal pipeline).
 *
 * @param {Object} interpretation - interpretPrompt() output (or layer contract)
 * @returns {string} one of the 12 queryType values
 */
function classifyFinanceQueryType(interpretation) {
  const intent = interpretation?.intent || '';
  const metrics = (interpretation?.entities?.metrics || []).join(' ').toLowerCase();
  const queryShape = interpretation?.entities?.queryShape || '';
  const asinCount = (interpretation?.entities?.asins || []).length;
  const hasAsin = asinCount > 0;
  const prompt = extractPromptText(interpretation);

  // Combined haystack for keyword checks that may live in either field.
  const metricsOrPrompt = `${metrics} ${prompt}`;

  const queryType = (() => {
    // 0. ASIN COMPARISON — 2+ ASINs with a comparison cue. Checked BEFORE
    //    single_asin so "compare A vs B" / "which is more profitable, A or B"
    //    routes to the side-by-side handler instead of single-ASIN.
    if (
      asinCount >= 2 &&
      /compar|\bvs\.?\b|versus|which (is|one)|better|more profitable/.test(prompt)
    ) {
      return 'asin_comparison';
    }

    // 0.5 SUGGESTION / STRATEGY — NOT handled by FinanceEngine directly.
    // These need the suggestion engine's multi-domain reasoning (PPC, issues,
    // inventory). SuggestionEngineService injects accurate FinanceEngine numbers
    // via buildFinanceSuggestionContext. Returning 'not_finance' keeps these out
    // of the index.js finance intercept so they flow to the suggestion engine.
    // Gated on suggestion_engine routing so it never hijacks a plain finance
    // lookup. Checked BEFORE single_asin so a how-to about a specific product
    // ("how to improve sales of B0X") routes to suggestions, not the ASIN P&L.
    if (
      (interpretation?.routing?.engine === 'suggestion_engine') &&
      /how (can|do|should) (i|we)|how to|what (should|can) (i|we)|suggest|recommend|improve|optimi[sz]e|reduce|strateg|advice|focus on|which products? should|discontinue|\bdrop\b|\bmistakes?\b/.test(prompt)
    ) {
      return 'not_finance';
    }

    // 1. SINGLE ASIN — an ASIN plus any financial angle (incl. units/orders).
    if (
      hasAsin &&
      (/profit|fee|expense|margin|loss|sale|revenue|cogs|\bunits?\b|\bsold\b|\bsell\b|\borders?\b/.test(metricsOrPrompt) ||
        /profitable|losing|break.?even/.test(prompt))
    ) {
      return 'single_asin';
    }

    // 2. WHY / DIAGNOSTIC.
    if (
      queryShape === 'explanation' ||
      /^why\b/.test(prompt) ||
      /(what|whats|what's).*(wrong|mistake|issue|problem)|eating into|eating|hurting/.test(prompt)
    ) {
      return 'why_analysis';
    }

    // 3. AVERAGE/PER-UNIT METRICS → summary. Checked before time_series so
    //    "average daily sales" is treated as a metric, not a daily trend.
    if (/\baverage\b|\bavg\b/.test(prompt) && /sale|profit|revenue|margin|order|unit|price|sell|sold|income/.test(prompt)) {
      return 'summary_metrics';
    }

    // 4. COGS-SPECIFIC (before top_bottom so "which products lack COGS" wins).
    if (/cogs|cost of goods|product cost|landed cost/.test(metricsOrPrompt)) {
      return 'cogs_query';
    }

    // 5. OVERHEAD / ACCOUNT-LEVEL (before fee_specific).
    if (
      /storage fee|overhead|inbound|\bsubscription\b|removal fee|capacity|account.?level/.test(prompt)
    ) {
      return 'overhead_query';
    }

    // 6. TIME SERIES / TREND. Before comparison so "daily ... vs sales" and
    //    "what day had the highest sales" route to the trend handler.
    if (
      /trend|trending|over time|graph|chart|\bdaily\b|\bweekly\b|day.?by.?day|show me.*over|increasing|rising|going up|what day|which day|best day|highest.*(sales|profit).*day|day.*highest/.test(prompt)
    ) {
      return 'time_series';
    }

    // 7. COMPARISON. Requires an explicit comparison cue (a bare "last week"
    //    is a time range, NOT a comparison — so "how many orders last week"
    //    stays a summary lookup).
    if (
      intent === 'comparison' ||
      /compar|\bvs\.?\b|versus|better or worse|better.*than|worse.*than|than before|more.*than|\bprevious\b|\bbefore\b/.test(prompt)
    ) {
      return 'comparison';
    }

    // 8. TOP / BOTTOM PRODUCTS.
    if (
      /top \d|bottom \d|\bbest\b|\bworst\b|highest|lowest|most profit|most profitable|least profitable|which product|losing money|unprofitable|below \d|under \d|refund rate/.test(
        prompt
      )
    ) {
      return 'top_bottom_products';
    }

    // 9. EXPENSE BREAKDOWN — expense-ish AND a breakdown intent (not one fee).
    const expenseLike = /expense|fee|cost|referral|fba fee|refund|reimbursement|promotion|breakdown/.test(
      metricsOrPrompt
    );
    const breakdownIntent = /break ?down|itemize|itemise|\ball (my )?(fees?|expenses?|costs?)\b|list (my )?(fees?|expenses?|costs?)|where.*(money|cash).*go|what are my (fees?|expenses?|costs?)|total (fees?|expenses?|costs?)|amazon fees|other fees|percentage.*(fee|expense|cost)/.test(
      prompt
    );
    if (expenseLike && breakdownIntent) {
      return 'expense_breakdown';
    }

    // 10. FEE-SPECIFIC (a single named fee / spend amount / PPC metric).
    if (
      /how much.*(pay|paying|spend|spending|lose|losing|going|cost|costing)|(what|whats|what's).*(fee|charge)|\bacos\b|\broas\b|\btacos\b|reimbursement|tax (was )?collected|how much tax|\btax\b/.test(prompt)
    ) {
      return 'fee_specific';
    }

    // 11. GENERAL FINANCE.
    if (
      /sale|profit|revenue|margin|income|earning|\bunits?\b|\bsold\b|\bsell\b|\borders?\b|\bmake\b|\bmade\b|financial|finances|\bsummary\b/.test(metricsOrPrompt)
    ) {
      return 'summary_metrics';
    }

    // 12. DEFAULT.
    return 'not_finance';
  })();

  logger.info(`[QMate][FinanceEngine] Classified as: ${queryType} from intent=${intent}, metrics=${metrics}`);
  return queryType;
}

/**
 * True when the question maps to any finance handler (i.e. not 'not_finance').
 * Used by layers/index.js to decide whether to route to the FinanceEngine.
 *
 * @param {Object} interpretation
 * @returns {boolean}
 */
function isFinanceQuery(interpretation) {
  return classifyFinanceQueryType(interpretation) !== 'not_finance';
}

/*
 * Inline classification test cases (expected outputs):
 *  1. "What is my profit?"                        → summary_metrics    ✓
 *  2. "Why is my profit dropping?"                → why_analysis       ✓ (^why)
 *  3. "Show me profitability for B0ABC12345"      → single_asin        ✓ (asin + profit)
 *  4. "Compare this month to last month"          → comparison         ✓ (compar/last month)
 *  5. "Show me my sales trend"                    → time_series        ✓ (trend)
 *  6. "Top 5 products by sales"                   → top_bottom_products ✓ (top 5)
 *  7. "Which products are losing money?"          → top_bottom_products ✓ (which product/losing money)
 *  8. "What are my COGS?"                          → cogs_query         ✓ (cogs in prompt)
 *  9. "What are my storage fees?"                 → overhead_query     ✓ (storage fee)
 * 10. "Break down my expenses"                    → expense_breakdown  ✓ (expense + breakdown)
 * 11. "How much am I paying in FBA fees?"         → fee_specific       ✓ (how much paying)
 * 12. "What is my referral fee?"                  → fee_specific       ✓ (what...fee)
 * 13. "What is my revenue?"                       → summary_metrics    ✓ (revenue)
 * 14. "Am I profitable?"                          → summary_metrics    ✓ (profit metric; not "most/least/un-profitable")
 * 15. "What are the FBA fees for B0XYZ99999?"     → single_asin        ✓ (asin + fee)
 * 16. "What mistakes am I making?"                → why_analysis       ✓ (what...mistake)
 * 17. "What's eating into my profits?"            → why_analysis       ✓ (eating)
 * 18. "sales over time"                           → time_series        ✓ (over time)
 * 19. "worst performing products"                → top_bottom_products ✓ (worst)
 * 20. "What are my overhead costs?"               → overhead_query     ✓ (overhead)
 * 21. "What's the weather today?"                 → not_finance        ✓ (no finance keywords)
 * 22. "Itemize all my fees"                       → expense_breakdown  ✓ (fee + itemize)
 */

// ── SECTION 4 — handleFinanceQuery (main entry point) ──

/**
 * Main finance entry point. Resolves dates, fetches dashboard data + COGS,
 * computes the canonical finance summary using shared formulas, then routes to
 * the appropriate response builder.
 *
 * @param {Object} interpretation
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, calendarMode }} [requestDateRange]
 * @returns {Promise<Object>} structured result object (see builders) or { type: 'error', message }
 */
async function handleFinanceQuery(interpretation, userContext, requestDateRange) {
  try {
    // a) Resolve the date window (anchored to data end date).
    const dateRange = await resolveFinanceDateRange(interpretation, userContext, requestDateRange);

    // b) Fetch the SAME data the dashboard fetches.
    const dashboardData = await FinanceDashboardReadService.getDashboard({
      userId: userContext.userId,
      country: userContext.country,
      region: userContext.region,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });

    // c) Fetch COGS.
    const cogs = await fetchCogsForUser(userContext);

    // d) Compute derived values using the SAME formulas as the frontend.
    const totals = dashboardData.totals || {};
    const totalSales = totals.productSales || 0;
    const adSpend = totals.adsSpend || 0;
    const displayTotalExpenses = computeDisplayTotalExpenses(totals, dashboardData.overhead, adSpend);
    const totalCogs = computeTotalCogsFromAsinWise(dashboardData.asinWise, cogs);
    const displayProfit = computeDisplayProfit(totalSales, displayTotalExpenses, totalCogs);
    const profitMargin = totalSales > 0 ? (displayProfit / totalSales) * 100 : 0;

    // e) Canonical finance summary.
    const financeSummary = {
      dateRange,
      totalSales,
      totalUnits: totals.units || 0,
      totalOrders: totals.orderCount || 0,
      displayTotalExpenses,
      adSpend,
      totalCogs,
      displayProfit,
      profitMargin,
      overheadTotal: dashboardData.overheadTotal || 0,
      reimbursements: Math.abs(totals.fbaInventoryReimbursement || 0),
      // Refund cost (positive) — used by the comparison/why-analysis refund delta.
      refunds: Math.abs(totals.refundedAmount || 0),
    };

    // f) Classify and g) route.
    const queryType = classifyFinanceQueryType(interpretation);
    logger.info('[FinanceEngine] Handling finance query', {
      queryType,
      source: dateRange.source,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      hasCOGS: cogs.hasCOGS,
    });

    switch (queryType) {
      case 'summary_metrics':
        return buildSummaryResponse(financeSummary, dateRange);
      case 'expense_breakdown':
        return buildExpenseBreakdownResponse(financeSummary, dashboardData, dateRange);
      case 'fee_specific':
        return buildFeeSpecificResponse(dashboardData, interpretation?.entities?.metrics, dateRange);
      case 'single_asin': {
        const asin = (interpretation?.entities?.asins || [])[0];
        if (!asin) {
          logger.info('[FinanceEngine] single_asin requested without an ASIN; falling back to summary');
          return buildSummaryResponse(financeSummary, dateRange);
        }
        return await buildSingleAsinResponse(asin, userContext, dateRange, cogs);
      }
      case 'asin_comparison':
        return await buildAsinComparisonResponse(interpretation?.entities?.asins, userContext, dateRange, cogs);
      case 'top_bottom_products':
        return buildTopBottomResponse(dashboardData, cogs, interpretation, dateRange);
      case 'asin_profitability':
        return buildAsinProfitabilityResponse(dashboardData, cogs, adSpend, dateRange);
      case 'comparison':
        return await buildComparisonResponse(financeSummary, userContext, dateRange);
      case 'why_analysis':
        return await buildWhyAnalysisResponse(financeSummary, userContext, dateRange, dashboardData);
      case 'time_series':
        return buildTimeSeriesResponse(dashboardData, cogs, dateRange);
      case 'cogs_query':
        return buildCogsResponse(cogs, dashboardData.asinWise, financeSummary);
      case 'overhead_query':
        return buildOverheadResponse(dashboardData.overhead, dateRange);
      default:
        return buildSummaryResponse(financeSummary, dateRange);
    }
  } catch (err) {
    logger.error('[FinanceEngine] handleFinanceQuery failed', {
      message: err.message,
      stack: err.stack,
    });
    return { type: 'error', message: 'Unable to retrieve finance data' };
  }
}

// ── SECTION 5 — buildSummaryResponse ──

/**
 * Structured summary metrics (totals, profit, margin, per-unit/order/day averages).
 *
 * @param {Object} financeSummary
 * @param {Object} dateRange
 * @returns {Object} { type:'summary_metrics', dateRange, metrics:{...}, healthIndicator }
 */
function buildSummaryResponse(financeSummary, dateRange) {
  return {
    type: 'summary_metrics',
    dateRange,
    metrics: {
      totalSales: financeSummary.totalSales,
      totalUnits: financeSummary.totalUnits,
      totalOrders: financeSummary.totalOrders,
      displayTotalExpenses: financeSummary.displayTotalExpenses,
      adSpend: financeSummary.adSpend,
      totalCogs: financeSummary.totalCogs,
      displayProfit: financeSummary.displayProfit,
      profitMargin: financeSummary.profitMargin,
      overheadTotal: financeSummary.overheadTotal,
      reimbursements: financeSummary.reimbursements,
      avgDailySales: financeSummary.totalSales / (dateRange.dayCount || 1),
      avgOrderValue:
        financeSummary.totalOrders > 0
          ? financeSummary.totalSales / financeSummary.totalOrders
          : 0,
      avgSellingPricePerUnit:
        financeSummary.totalUnits > 0
          ? financeSummary.totalSales / financeSummary.totalUnits
          : 0,
      // ── Category J edge-case fields ──
      // "How much do I keep from each sale?"
      netPerUnit:
        financeSummary.totalUnits > 0
          ? financeSummary.displayProfit / financeSummary.totalUnits
          : 0,
      // "What percentage goes to Amazon?" (Amazon/overhead fees only — excludes PPC and COGS)
      amazonFeePercent:
        financeSummary.totalSales > 0
          ? ((financeSummary.displayTotalExpenses - financeSummary.adSpend - financeSummary.totalCogs) /
              financeSummary.totalSales) *
            100
          : 0,
      // "Am I profitable?"
      isProfitable: financeSummary.displayProfit > 0,
    },
    healthIndicator:
      financeSummary.profitMargin > 15
        ? 'HEALTHY'
        : financeSummary.profitMargin > 5
          ? 'CAUTION'
          : 'CRITICAL',
  };
}

// ── SECTION 6 — buildExpenseBreakdownResponse ──

/**
 * Fee-by-fee expense breakdown. All amounts positive (Math.abs); reimbursements
 * are reported positive but are conceptually subtracted in the total.
 *
 * @param {Object} financeSummary
 * @param {Object} dashboardData - getDashboard() result
 * @param {Object} dateRange
 * @returns {Object} { type:'expense_breakdown', dateRange, total, categories, overheadBreakdown, otherFeesBreakdown, percentOfRevenue }
 */
function buildExpenseBreakdownResponse(financeSummary, dashboardData, dateRange) {
  const abs = Math.abs;
  const totals = dashboardData.totals || {};
  return {
    type: 'expense_breakdown',
    dateRange,
    total: financeSummary.displayTotalExpenses,
    categories: {
      fbaFees: abs(totals.fbaFulfillmentFee || 0),
      referralFees: abs(totals.referralCommission || 0),
      closingFees: abs(totals.closingFee || 0),
      technologyFees: abs(totals.technologyFee || 0),
      refundCosts: abs(totals.refundedAmount || 0),
      promotions: abs(totals.promotionsDiscount || 0),
      shippingCharges: abs(totals.shippingChargeback || 0),
      adSpend: financeSummary.adSpend,
      overhead: financeSummary.overheadTotal,
      cogs: financeSummary.totalCogs,
      reimbursements: financeSummary.reimbursements, // subtracted in the total
      otherFees: abs(totals.otherExpenses || 0),
    },
    overheadBreakdown: (dashboardData.overhead || []).map((item) => ({
      category: item.category,
      amount: abs(item.amount || 0),
      isRevenue: item.isRevenue || false,
    })),
    otherFeesBreakdown: (totals.otherExpensesBreakdown || []).map((item) => ({
      category: item.category,
      amount: abs(item.amount || 0),
    })),
    percentOfRevenue:
      financeSummary.totalSales > 0
        ? (financeSummary.displayTotalExpenses / financeSummary.totalSales) * 100
        : 0,
  };
}

// ── SECTION 7 — buildFeeSpecificResponse ──

/**
 * Resolve a specific fee asked about (e.g. "how much are my FBA fees?").
 * Each resolver returns a positive amount derived from the totals/overhead.
 */
const FEE_RESOLVERS = [
  { name: 'FBA Fulfillment Fee', match: ['fba fulfillment', 'fba fee', 'fulfillment fee'], get: (t) => Math.abs(t.fbaFulfillmentFee || 0) },
  { name: 'Referral Fee', match: ['referral'], get: (t) => Math.abs(t.referralCommission || 0) },
  { name: 'Refund Costs', match: ['refund'], get: (t) => Math.abs(t.refundedAmount || 0) },
  { name: 'Promotions & Discounts', match: ['promotion', 'discount'], get: (t) => Math.abs(t.promotionsDiscount || 0) },
  { name: 'Shipping Chargeback', match: ['shipping'], get: (t) => Math.abs(t.shippingChargeback || 0) },
  { name: 'Disposal Fee', match: ['disposal'], get: (t) => Math.abs(t.fbaDisposalFee || 0) },
  { name: 'FBA Inventory Reimbursement', match: ['reimbursement'], get: (t) => Math.abs(t.fbaInventoryReimbursement || 0) },
  { name: 'Tax Collected', match: ['tax'], get: (t) => Math.abs(t.salesTaxCollected || 0) + Math.abs(t.marketplaceFacilitatorTax || 0) },
  { name: 'Ad Spend (PPC)', match: ['ad spend', 'ppc', 'advertising'], get: (t) => Math.abs(t.adsSpend || 0) },
  { name: 'Closing Fee', match: ['closing'], get: (t) => Math.abs(t.closingFee || 0) },
  { name: 'Technology Fee', match: ['technology'], get: (t) => Math.abs(t.technologyFee || 0) },
];

/**
 * @param {Object} dashboardData - getDashboard() result
 * @param {Array<string>} requestedMetrics - interpretation.entities.metrics
 * @param {Object} dateRange
 * @returns {Object} { type:'fee_specific', dateRange, fee:{ name, amount, percentOfRevenue, percentOfTotalExpenses } }
 */
function buildFeeSpecificResponse(dashboardData, requestedMetrics, dateRange) {
  const totals = dashboardData.totals || {};
  const overhead = dashboardData.overhead || [];
  const haystack = (Array.isArray(requestedMetrics) ? requestedMetrics.join(' ') : String(requestedMetrics || '')).toLowerCase();

  // Storage fee lives in overhead, not totals — handle it before the totals-based resolvers.
  let resolved = null;
  if (/storage/.test(haystack)) {
    const amount = overhead
      .filter((it) => /storage/i.test(it.category || ''))
      .reduce((sum, it) => sum + Math.abs(it.amount || 0), 0);
    resolved = { name: 'FBA Storage Fee', amount };
  } else {
    for (const r of FEE_RESOLVERS) {
      if (r.match.some((kw) => haystack.includes(kw))) {
        resolved = { name: r.name, amount: r.get(totals) };
        break;
      }
    }
  }

  if (!resolved) {
    logger.info('[FinanceEngine] fee_specific: no fee keyword matched; returning total expenses placeholder', {
      requestedMetrics,
    });
    resolved = { name: 'Unrecognized fee', amount: 0 };
  }

  const totalSales = totals.productSales || 0;
  // Total expenses for percentage context (mirror of computeDisplayTotalExpenses inputs).
  const displayTotalExpenses = computeDisplayTotalExpenses(totals, overhead, totals.adsSpend || 0);

  return {
    type: 'fee_specific',
    dateRange,
    fee: {
      name: resolved.name,
      amount: resolved.amount,
      percentOfRevenue: totalSales > 0 ? (resolved.amount / totalSales) * 100 : 0,
      percentOfTotalExpenses:
        displayTotalExpenses > 0 ? (resolved.amount / displayTotalExpenses) * 100 : 0,
    },
  };
}

// ── SECTION 8 — Per-product handlers (Category C, #32-47) ──

/**
 * Compute a single ASIN row's profit fields from a getAsinWisePL() row.
 * Per-ASIN expenses ONLY (no account-level overhead) via computeRowProfit.
 * Returns the canonical per-product entry shape used across handlers.
 *
 * @param {Object} row - getAsinWisePL() row (carries every fee field)
 * @param {Map<string, number>} cogsMap - asin → per-unit COGS
 * @returns {{ asin, productName, productSales, units, totalExpenses, cogs, adSpend, grossProfit, profitMargin }}
 */
function computeAsinRowEntry(row, cogsMap) {
  const cogsPerUnit = (cogsMap && cogsMap.get(row.asin)) || 0;
  const rowAdSpend = row.adsSpend || 0;
  const p = computeRowProfit(row, cogsPerUnit, rowAdSpend);
  return {
    asin: row.asin,
    productName: row.productName || null,
    productSales: p.productSales,
    units: Number(row.units || 0),
    totalExpenses: p.totalExpenses,
    cogs: p.cogs,
    adSpend: p.adSpend,
    grossProfit: p.grossProfit,
    profitMargin: p.profitMargin,
  };
}

/**
 * HANDLER 1 — Single-ASIN P&L.
 * For "Show me profitability for B0XXXXXXXXX" / "FBA fees for B0XXXXXXXXX".
 *
 * getAsinSnapshot returns AGGREGATED expense fields (not individual fee fields),
 * so per the spec we fall back to snapshot.totalExpenses + snapshot.breakdown.
 * snapshot.totalExpenses already includes ad spend and nets reimbursements.
 *
 * @returns {Object} { type:'single_asin', dateRange, asin, productName, metrics, feeBreakdown, healthIndicator }
 */
async function buildSingleAsinResponse(asin, userContext, dateRange, cogs) {
  const normalizedAsin = String(asin || '').trim().toUpperCase();
  const snapshot = await FinanceDashboardReadService.getAsinSnapshot({
    userId: userContext.userId,
    country: userContext.country,
    region: userContext.region,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    asin: normalizedAsin,
  });

  if (!snapshot) {
    logger.info('[FinanceEngine] No snapshot for ASIN; returning empty single_asin', { asin: normalizedAsin });
    return {
      type: 'single_asin',
      dateRange,
      asin: normalizedAsin,
      productName: normalizedAsin,
      notFound: true,
      metrics: {
        productSales: 0, unitsSold: 0, orderCount: 0,
        totalExpenses: 0, cogs: 0, cogsPerUnit: 0,
        grossProfit: 0, profitMargin: 0, adSpend: 0, reimbursements: 0,
      },
      feeBreakdown: [],
      healthIndicator: 'LOSS_MAKING',
    };
  }

  const productSales = snapshot.totalSales || 0;
  const unitsSold = snapshot.unitsSold || 0;
  const cogsPerUnit = (cogs?.cogsMap && cogs.cogsMap.get(normalizedAsin)) || 0;
  const totalCogs = cogsPerUnit * unitsSold;

  // Fallback path: snapshot exposes aggregated totalExpenses (incl. ad spend,
  // net of reimbursements) rather than individual fee fields.
  const displayExpenses = snapshot.totalExpenses || 0;
  const profit = productSales - displayExpenses - totalCogs;
  const profitMargin = productSales > 0 ? (profit / productSales) * 100 : 0;

  return {
    type: 'single_asin',
    dateRange,
    asin: normalizedAsin,
    productName: snapshot.productName || normalizedAsin,
    metrics: {
      productSales,
      unitsSold,
      orderCount: snapshot.orderCount || 0,
      totalExpenses: displayExpenses,
      cogs: totalCogs,
      cogsPerUnit,
      grossProfit: profit,
      profitMargin,
      adSpend: snapshot.adsSpend || 0,
      reimbursements: Math.abs(snapshot.reimbursements || snapshot.fbaInventoryReimbursement || 0),
    },
    feeBreakdown: (snapshot.breakdown || [])
      .map((item) => ({
        category: item.category || item.name,
        amount: Math.abs(item.amount || 0),
      }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    healthIndicator: profitMargin > 15 ? 'PROFITABLE' : profitMargin > 0 ? 'LOW_MARGIN' : 'LOSS_MAKING',
  };
}

/**
 * Compute one ASIN's P&L from its snapshot (same approach as
 * buildSingleAsinResponse: getAsinSnapshot exposes AGGREGATED expenses, not
 * individual fee fields, so we use snapshot.totalExpenses + COGS). Returns the
 * canonical per-product comparison entry shape.
 *
 * @returns {Promise<Object>} { asin, productName, productSales, units, totalExpenses, cogs, adSpend, grossProfit, profitMargin, feeBreakdown, notFound? }
 */
async function computeAsinComparisonEntry(asin, userContext, dateRange, cogs) {
  const normalizedAsin = String(asin || '').trim().toUpperCase();
  const snapshot = await FinanceDashboardReadService.getAsinSnapshot({
    userId: userContext.userId,
    country: userContext.country,
    region: userContext.region,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    asin: normalizedAsin,
  });

  if (!snapshot) {
    return {
      asin: normalizedAsin,
      productName: normalizedAsin,
      notFound: true,
      productSales: 0,
      units: 0,
      totalExpenses: 0,
      cogs: 0,
      adSpend: 0,
      grossProfit: 0,
      profitMargin: 0,
      feeBreakdown: [],
    };
  }

  const productSales = snapshot.totalSales || 0;
  const units = snapshot.unitsSold || 0;
  const cogsPerUnit = (cogs?.cogsMap && cogs.cogsMap.get(normalizedAsin)) || 0;
  const totalCogs = cogsPerUnit * units;
  const totalExpenses = snapshot.totalExpenses || 0; // aggregated, incl. ad spend, net reimbursements
  const grossProfit = productSales - totalExpenses - totalCogs;
  const profitMargin = productSales > 0 ? (grossProfit / productSales) * 100 : 0;

  return {
    asin: normalizedAsin,
    productName: snapshot.productName || normalizedAsin,
    productSales,
    units,
    totalExpenses,
    cogs: totalCogs,
    adSpend: snapshot.adsSpend || 0,
    grossProfit,
    profitMargin,
    feeBreakdown: (snapshot.breakdown || [])
      .map((item) => ({ category: item.category || item.name, amount: Math.abs(item.amount || 0) }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount),
  };
}

/**
 * HANDLER — Side-by-side ASIN comparison (Category C / question #43).
 * For "Compare B0A vs B0B", "Which is more profitable, A or B?".
 *
 * @param {Array<string>} asins
 * @param {{ userId, country, region }} userContext
 * @param {Object} dateRange
 * @param {Object} cogs - fetchCogsForUser() result
 * @returns {Promise<Object>} { type:'asin_comparison', dateRange, products, winner, differences }
 */
async function buildAsinComparisonResponse(asins, userContext, dateRange, cogs) {
  const list = (Array.isArray(asins) ? asins : [])
    .map((a) => String(a || '').trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 5); // cap — comparisons are pairwise but tolerate a few

  if (list.length < 2) {
    logger.info('[FinanceEngine] asin_comparison needs 2+ ASINs; falling back to single ASIN', { count: list.length });
    if (list.length === 1) {
      return buildSingleAsinResponse(list[0], userContext, dateRange, cogs);
    }
    return { type: 'asin_comparison', dateRange, products: [], winner: null, differences: null, note: 'Provide at least two ASINs to compare.' };
  }

  const products = [];
  for (const asin of list) {
    products.push(await computeAsinComparisonEntry(asin, userContext, dateRange, cogs));
  }

  // Winner per dimension (highest value wins). Generalizes to 2+ products.
  const winnerBy = (key) =>
    products.reduce((best, p) => (p[key] > best[key] ? p : best), products[0]).asin;
  const winner = {
    bySales: winnerBy('productSales'),
    byProfit: winnerBy('grossProfit'),
    byMargin: winnerBy('profitMargin'),
    byUnits: winnerBy('units'),
  };

  // Differences are pairwise between the first two products (A vs B).
  const a = products[0];
  const b = products[1];
  const differences = {
    salesDiff: Math.abs((a.productSales || 0) - (b.productSales || 0)),
    profitDiff: Math.abs((a.grossProfit || 0) - (b.grossProfit || 0)),
    marginDiff: Math.abs((a.profitMargin || 0) - (b.profitMargin || 0)),
    unitsDiff: Math.abs((a.units || 0) - (b.units || 0)),
    expenseDiff: Math.abs((a.totalExpenses || 0) - (b.totalExpenses || 0)),
  };

  logger.info('[FinanceEngine] ASIN comparison built', { asins: list, winnerByProfit: winner.byProfit });

  return { type: 'asin_comparison', dateRange, products, winner, differences };
}

/**
 * Parse a top/bottom request from the interpretation/prompt.
 * @returns {{ sortField, direction, count, filterLossMaking }}
 */
function parseTopBottomRequest(interpretation) {
  const raw = String(
    interpretation?.rewrittenQuestion ||
    interpretation?.raw?.normalizedPrompt ||
    interpretation?.raw?.prompt ||
    ''
  ).toLowerCase();

  let direction = 'top';
  let count = 5;
  let sortField = 'sales';
  let filterLossMaking = false;

  // "top N" / "best N" / "bottom N" / "worst N"
  const m = raw.match(/\b(top|best|bottom|worst)\s+(\d+)\b/);
  if (m) {
    direction = (m[1] === 'bottom' || m[1] === 'worst') ? 'bottom' : 'top';
    count = Math.max(1, Math.min(100, parseInt(m[2], 10)));
  } else if (/\b(bottom|worst|lowest)\b/.test(raw)) {
    direction = 'bottom';
  } else if (/\b(top|best|highest)\b/.test(raw)) {
    direction = 'top';
  }

  // Loss-making filter
  if (/losing money|unprofitable|loss[- ]?making|\bloss(es)?\b|negative profit/.test(raw)) {
    filterLossMaking = true;
    direction = 'bottom';
    sortField = 'profit';
  } else if (/highest margin|best margin|margin/.test(raw)) {
    sortField = 'margin';
  } else if (/most refund|refund/.test(raw)) {
    sortField = 'refunds';
  } else if (/\bunits?\b|quantity|volume/.test(raw)) {
    sortField = 'units';
  } else if (/\bfees?\b|expenses?\b/.test(raw)) {
    sortField = 'fees';
  } else if (/profit/.test(raw)) {
    sortField = 'profit';
  } else if (/sales|revenue/.test(raw)) {
    sortField = 'sales';
  }

  return { sortField, direction, count, filterLossMaking };
}

/** Value extractor for sorting a product entry by the requested field. */
function sortValueForField(entry, row, sortField) {
  switch (sortField) {
    case 'profit': return entry.grossProfit;
    case 'units': return entry.units;
    case 'margin': return entry.profitMargin;
    case 'fees': return entry.totalExpenses;
    case 'refunds': return Math.abs(row.refundedAmount || 0);
    case 'sales':
    default: return entry.productSales;
  }
}

/**
 * HANDLER 2 — Top/Bottom products.
 * For "top 5 products by sales", "worst products by profit", "losing money".
 *
 * @returns {Object} { type:'top_bottom_products', dateRange, sortedBy, direction, count, products, totalProductCount }
 */
function buildTopBottomResponse(dashboardData, cogs, interpretation, dateRange) {
  const { sortField, direction, count, filterLossMaking } = parseTopBottomRequest(interpretation);
  const rows = Array.isArray(dashboardData.asinWise) ? dashboardData.asinWise : [];
  const cogsMap = cogs?.cogsMap;

  let entries = rows.map((row) => ({ entry: computeAsinRowEntry(row, cogsMap), row }));

  if (filterLossMaking) {
    entries = entries.filter(({ entry }) => entry.profitMargin < 0);
  }

  entries.sort((a, b) => {
    const av = sortValueForField(a.entry, a.row, sortField);
    const bv = sortValueForField(b.entry, b.row, sortField);
    return direction === 'top' ? bv - av : av - bv;
  });

  const products = entries.slice(0, count).map(({ entry }) => entry);

  return {
    type: 'top_bottom_products',
    dateRange,
    sortedBy: sortField,
    direction,
    count: products.length,
    products,
    totalProductCount: rows.length,
  };
}

/**
 * HANDLER 3 — ASIN-wise profitability, bucketed by margin band.
 * For "Show me ASIN-wise profitability" / "Break down profit by product".
 *
 * @returns {Object} { type:'asin_profitability', dateRange, categories, summary }
 */
function buildAsinProfitabilityResponse(dashboardData, cogs, adSpend, dateRange) {
  const rows = Array.isArray(dashboardData.asinWise) ? dashboardData.asinWise : [];
  const cogsMap = cogs?.cogsMap;

  const all = rows.map((row) => computeAsinRowEntry(row, cogsMap));

  const buckets = {
    highMargin: [],   // > 30%
    healthyMargin: [], // 15-30%
    lowMargin: [],     // 0-15%
    lossMaking: [],    // < 0%
  };

  let marginSum = 0;
  let profitableCount = 0;
  let lossMakingCount = 0;

  for (const e of all) {
    marginSum += e.profitMargin;
    if (e.profitMargin < 0) {
      buckets.lossMaking.push(e);
      lossMakingCount += 1;
    } else {
      profitableCount += 1;
      if (e.profitMargin > 30) buckets.highMargin.push(e);
      else if (e.profitMargin >= 15) buckets.healthyMargin.push(e);
      else buckets.lowMargin.push(e);
    }
  }

  // Each category: count + top 10 by grossProfit desc.
  const topTenByProfit = (arr) =>
    [...arr].sort((a, b) => b.grossProfit - a.grossProfit).slice(0, 10);

  return {
    type: 'asin_profitability',
    dateRange,
    categories: {
      highMargin: { count: buckets.highMargin.length, products: topTenByProfit(buckets.highMargin) },
      healthyMargin: { count: buckets.healthyMargin.length, products: topTenByProfit(buckets.healthyMargin) },
      lowMargin: { count: buckets.lowMargin.length, products: topTenByProfit(buckets.lowMargin) },
      lossMaking: { count: buckets.lossMaking.length, products: topTenByProfit(buckets.lossMaking) },
    },
    summary: {
      totalProducts: all.length,
      profitableCount,
      lossMakingCount,
      avgMargin: all.length > 0 ? marginSum / all.length : 0,
    },
  };
}

// ── SECTION 9 — Trend / comparison / why handlers (Categories D, E, F) ──

/** Percent change with the spec's zero-guard. */
function pctChange(current, previous) {
  if (previous > 0) return ((current - previous) / previous) * 100;
  return current > 0 ? 100 : 0;
}

/** One delta record { current, previous, change, changePct }. */
function makeDelta(current, previous) {
  const cur = Number(current || 0);
  const prev = Number(previous || 0);
  return { current: cur, previous: prev, change: cur - prev, changePct: pctChange(cur, prev) };
}

/**
 * Rank the factors driving the profit change, by absolute impact (desc).
 * Mirrors the spec's rankProfitDrivers, extended with COGS and per-factor changePct.
 */
function rankProfitDrivers(deltas, cogsChange) {
  const drivers = [
    {
      factor: 'Sales',
      impact: deltas.sales.change,
      direction: deltas.sales.change >= 0 ? 'positive' : 'negative',
      changePct: deltas.sales.changePct,
    },
    {
      // Non-ad expense change (total expenses already include ad spend, so back it out).
      factor: 'Amazon Fees & Expenses',
      impact: -(deltas.expenses.change - deltas.adSpend.change),
      direction: (deltas.expenses.change - deltas.adSpend.change) > 0 ? 'negative' : 'positive',
      changePct: deltas.expenses.changePct,
    },
    {
      factor: 'PPC/Ad Spend',
      impact: -deltas.adSpend.change,
      direction: deltas.adSpend.change > 0 ? 'negative' : 'positive',
      changePct: deltas.adSpend.changePct,
    },
    {
      factor: 'COGS',
      impact: -(cogsChange || 0),
      direction: (cogsChange || 0) > 0 ? 'negative' : 'positive',
      changePct: 0,
    },
  ];
  return drivers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}

/**
 * HANDLER 1 — Period-over-period comparison.
 * For "Compare this month to last month", "Are things getting better?".
 * Fetches the immediately-preceding period of equal length and computes deltas
 * + ranked profit drivers using the SAME shared calculation functions.
 *
 * @returns {Object} { type:'comparison', currentPeriod, previousPeriod, currentSummary, previousSummary, deltas, profitDrivers, overallDirection, previousDataAvailable, note? }
 */
async function buildComparisonResponse(currentSummary, userContext, currentDateRange) {
  // a) Previous period of equal length, immediately before the current one.
  const dayCount = dayCountInclusive(currentDateRange.startDate, currentDateRange.endDate);
  const prevEndDate = subtractDaysYmd(currentDateRange.startDate, 1);
  const prevStartDate = subtractDaysYmd(prevEndDate, dayCount - 1);

  // b) Fetch previous period from the SAME service.
  const prevDashboard = await FinanceDashboardReadService.getDashboard({
    userId: userContext.userId,
    country: userContext.country,
    region: userContext.region,
    startDate: prevStartDate,
    endDate: prevEndDate,
  });

  // c) COGS (per-unit cost is time-independent — reuse one fetch for the prev period).
  const cogs = await fetchCogsForUser(userContext);

  // d) Previous-period summary via shared formulas.
  const prevTotals = prevDashboard.totals || {};
  const prevTotalSales = prevTotals.productSales || 0;
  const prevAdSpend = prevTotals.adsSpend || 0;
  const prevDisplayTotalExpenses = computeDisplayTotalExpenses(prevTotals, prevDashboard.overhead, prevAdSpend);
  const prevTotalCogs = computeTotalCogsFromAsinWise(prevDashboard.asinWise, cogs);
  const prevDisplayProfit = computeDisplayProfit(prevTotalSales, prevDisplayTotalExpenses, prevTotalCogs);
  const prevProfitMargin = prevTotalSales > 0 ? (prevDisplayProfit / prevTotalSales) * 100 : 0;
  const prevUnits = prevTotals.units || 0;
  const prevOrders = prevTotals.orderCount || 0;
  const prevRefunds = Math.abs(prevTotals.refundedAmount || 0);

  const previousSummary = {
    totalSales: prevTotalSales,
    displayTotalExpenses: prevDisplayTotalExpenses,
    displayProfit: prevDisplayProfit,
    profitMargin: prevProfitMargin,
    totalUnits: prevUnits,
    totalOrders: prevOrders,
    adSpend: prevAdSpend,
    totalCogs: prevTotalCogs,
  };

  const currentSummaryOut = {
    totalSales: currentSummary.totalSales,
    displayTotalExpenses: currentSummary.displayTotalExpenses,
    displayProfit: currentSummary.displayProfit,
    profitMargin: currentSummary.profitMargin,
    totalUnits: currentSummary.totalUnits,
    totalOrders: currentSummary.totalOrders,
    adSpend: currentSummary.adSpend,
    totalCogs: currentSummary.totalCogs,
  };

  // e) Deltas. `refunds` is an extension used by buildWhyAnalysisResponse.
  const deltas = {
    sales: makeDelta(currentSummary.totalSales, prevTotalSales),
    expenses: makeDelta(currentSummary.displayTotalExpenses, prevDisplayTotalExpenses),
    adSpend: makeDelta(currentSummary.adSpend, prevAdSpend),
    profit: makeDelta(currentSummary.displayProfit, prevDisplayProfit),
    units: makeDelta(currentSummary.totalUnits, prevUnits),
    orders: makeDelta(currentSummary.totalOrders, prevOrders),
    profitMargin: makeDelta(currentSummary.profitMargin, prevProfitMargin),
    refunds: makeDelta(Math.abs((currentSummary.refunds != null ? currentSummary.refunds : 0)), prevRefunds),
  };

  // f) Ranked profit drivers.
  const cogsChange = (currentSummary.totalCogs || 0) - prevTotalCogs;
  const profitDrivers = rankProfitDrivers(deltas, cogsChange);

  const previousDataAvailable =
    prevTotalSales > 0 || prevUnits > 0 || (prevDashboard.asinWise || []).length > 0;

  const result = {
    type: 'comparison',
    currentPeriod: currentDateRange,
    previousPeriod: { startDate: prevStartDate, endDate: prevEndDate, dayCount },
    currentSummary: currentSummaryOut,
    previousSummary,
    deltas,
    profitDrivers,
    overallDirection: currentSummary.displayProfit > prevDisplayProfit ? 'improving' : 'declining',
    previousDataAvailable,
  };
  if (!previousDataAvailable) {
    result.note = 'No data found for the previous period — comparison baseline is zero (likely a new seller or first reporting period).';
  }

  logger.info('[FinanceEngine] Comparison built', {
    current: `${currentDateRange.startDate}..${currentDateRange.endDate}`,
    previous: `${prevStartDate}..${prevEndDate}`,
    overallDirection: result.overallDirection,
    previousDataAvailable,
  });
  return result;
}

/**
 * HANDLER 2 — Data-grounded "why" analysis.
 * For "Why is my profit dropping?", "What mistakes am I making?".
 * Builds the comparison, derives ranked insights from the deltas, finds the
 * worst loss-making products, and emits template-based (NOT LLM) action items.
 *
 * Can generate up to 6 insight types: sales_decline, ad_spend_increase,
 * expense_increase, margin_compression, fixed_cost_pressure, refund_spike.
 *
 * @returns {Object} { type:'why_analysis', comparison, insights, profitDrivers, losingProducts, overheadBreakdown, actionableItems }
 */
async function buildWhyAnalysisResponse(currentSummary, userContext, dateRange, dashboardData) {
  // a) Comparison (drives the deltas every insight is grounded in).
  const comparison = await buildComparisonResponse(currentSummary, userContext, dateRange);
  const d = comparison.deltas;

  // b) Ranked insights — each only fires when its data condition is true.
  const insights = [];

  if (d.sales.changePct < -5) {
    insights.push({
      type: 'sales_decline',
      severity: Math.abs(d.sales.changePct) > 20 ? 'high' : 'medium',
      message: `Sales decreased by ${d.sales.changePct.toFixed(1)}% ($${Math.abs(d.sales.change).toFixed(2)})`,
      data: d.sales,
    });
  }

  if (d.adSpend.changePct > 10) {
    insights.push({
      type: 'ad_spend_increase',
      severity: d.adSpend.changePct > 30 ? 'high' : 'medium',
      message: `PPC spend increased by ${d.adSpend.changePct.toFixed(1)}% ($${Math.abs(d.adSpend.change).toFixed(2)})`,
      data: d.adSpend,
    });
  }

  if (d.expenses.changePct > 10) {
    insights.push({
      type: 'expense_increase',
      severity: d.expenses.changePct > 25 ? 'high' : 'medium',
      message: `Total expenses increased by ${d.expenses.changePct.toFixed(1)}% ($${Math.abs(d.expenses.change).toFixed(2)})`,
      data: d.expenses,
    });
  }

  // Margin dropped more than 5 percentage points (change is current - previous).
  if (d.profitMargin.change < -5) {
    insights.push({
      type: 'margin_compression',
      severity: d.profitMargin.change < -10 ? 'high' : 'medium',
      message: `Profit margin dropped ${Math.abs(d.profitMargin.change).toFixed(1)} percentage points (from ${d.profitMargin.previous.toFixed(1)}% to ${d.profitMargin.current.toFixed(1)}%)`,
      data: d.profitMargin,
    });
  }

  // Units declined but expenses stayed roughly flat → fixed-cost pressure.
  if (d.units.change < 0 && Math.abs(d.expenses.changePct) < 5) {
    insights.push({
      type: 'fixed_cost_pressure',
      severity: 'medium',
      message: `Units sold fell ${Math.abs(d.units.changePct).toFixed(1)}% while expenses stayed essentially flat (${d.expenses.changePct.toFixed(1)}%) — fixed costs now spread over fewer units`,
      data: { units: d.units, expenses: d.expenses },
    });
  }

  // Refunds spiked (>20%).
  if (d.refunds.changePct > 20) {
    insights.push({
      type: 'refund_spike',
      severity: d.refunds.changePct > 50 ? 'high' : 'medium',
      message: `Refunds increased by ${d.refunds.changePct.toFixed(1)}% ($${Math.abs(d.refunds.change).toFixed(2)})`,
      data: d.refunds,
    });
  }

  // Sort insights by severity (high first).
  const severityRank = { high: 2, medium: 1, low: 0 };
  insights.sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));

  // c) Loss-making products (canonical per-ASIN profit incl. COGS + ad spend),
  //    consistent with the top/bottom + profitability handlers.
  const cogs = await fetchCogsForUser(userContext);
  const losingProducts = (dashboardData.asinWise || [])
    .map((row) => computeAsinRowEntry(row, cogs.cogsMap))
    .filter((e) => e.grossProfit < 0)
    .sort((a, b) => a.grossProfit - b.grossProfit)
    .slice(0, 5);

  // d) Template-based action items (NOT LLM-generated) — one per insight found.
  const actionableItems = [];
  for (const ins of insights) {
    switch (ins.type) {
      case 'sales_decline':
        actionableItems.push(`Sales fell ${Math.abs(d.sales.changePct).toFixed(1)}% — review traffic, buy-box, and pricing on your top products; check for stockouts in the period.`);
        break;
      case 'ad_spend_increase':
        actionableItems.push(`Review PPC campaigns — ad spend increased ${d.adSpend.changePct.toFixed(1)}% ($${Math.abs(d.adSpend.change).toFixed(2)}). Audit high-ACOS campaigns and wasted-spend keywords.`);
        break;
      case 'expense_increase':
        actionableItems.push(`Total expenses rose ${d.expenses.changePct.toFixed(1)}% — inspect the fee-by-fee breakdown for the categories that grew most.`);
        break;
      case 'margin_compression':
        actionableItems.push(`Margin compressed ${Math.abs(d.profitMargin.change).toFixed(1)} pts — costs grew faster than revenue; prioritize the highest-impact profit driver below.`);
        break;
      case 'fixed_cost_pressure':
        actionableItems.push(`Units dropped ${Math.abs(d.units.changePct).toFixed(1)}% with flat expenses — focus on restoring sales volume or trimming fixed overhead.`);
        break;
      case 'refund_spike':
        actionableItems.push(`Investigate refund causes for your top refunded products — refunds rose ${d.refunds.changePct.toFixed(1)}%.`);
        break;
      default:
        break;
    }
  }
  if (losingProducts.length > 0) {
    actionableItems.push(`Address ${losingProducts.length} loss-making product(s); the worst is ${losingProducts[0].asin} at $${losingProducts[0].grossProfit.toFixed(2)} profit.`);
  }

  logger.info('[FinanceEngine] Why-analysis built', {
    insightCount: insights.length,
    losingProductCount: losingProducts.length,
    overallDirection: comparison.overallDirection,
  });

  return {
    type: 'why_analysis',
    comparison,
    insights,
    profitDrivers: comparison.profitDrivers,
    losingProducts,
    overheadBreakdown: dashboardData.overhead || [],
    actionableItems,
  };
}

/**
 * HANDLER 3 — Date-wise time series.
 * For "Show me sales trend", "Graph my expenses".
 *
 * Limitation: dateWise has no per-day PPC or per-day COGS, so daily grossProfit
 * = productSales - |totalExpenses| only (no ad spend / COGS subtracted). This is
 * surfaced in `limitations`.
 *
 * @returns {Object} { type:'time_series', dateRange, dataPoints, trend, peakDay, lowestDay, charts, limitations }
 */
function buildTimeSeriesResponse(dashboardData, cogs, dateRange) {
  const rows = Array.isArray(dashboardData.dateWise) ? dashboardData.dateWise : [];

  const dataPoints = rows.map((r) => {
    const totalSales = Number(r.productSales || 0);
    const totalExpenses = Math.abs(Number(r.totalExpenses || 0));
    return {
      date: String(r.date || '').slice(0, 10),
      totalSales,
      totalExpenses,
      grossProfit: totalSales - totalExpenses,
      units: Number(r.units || 0),
      orderCount: Number(r.orderCount || 0),
    };
  });

  // Trend: first-half avg vs second-half avg of totalSales.
  const n = dataPoints.length;
  let trend = { direction: 'flat', metric: 'totalSales', firstHalfAvg: 0, secondHalfAvg: 0, changePct: 0 };
  if (n >= 2) {
    const mid = Math.floor(n / 2);
    const firstHalf = dataPoints.slice(0, mid);
    const secondHalf = dataPoints.slice(mid);
    const avg = (arr) => (arr.length ? arr.reduce((s, p) => s + p.totalSales, 0) / arr.length : 0);
    const firstHalfAvg = avg(firstHalf);
    const secondHalfAvg = avg(secondHalf);
    const changePct = pctChange(secondHalfAvg, firstHalfAvg);
    let direction = 'flat';
    if (changePct > 2) direction = 'up';
    else if (changePct < -2) direction = 'down';
    trend = { direction, metric: 'totalSales', firstHalfAvg, secondHalfAvg, changePct };
  }

  // Peak / lowest day by totalSales.
  let peakDay = null;
  let lowestDay = null;
  for (const p of dataPoints) {
    if (!peakDay || p.totalSales > peakDay.value) peakDay = { date: p.date, value: p.totalSales, metric: 'totalSales' };
    if (!lowestDay || p.totalSales < lowestDay.value) lowestDay = { date: p.date, value: p.totalSales, metric: 'totalSales' };
  }

  return {
    type: 'time_series',
    dateRange,
    dataPoints,
    trend,
    peakDay,
    lowestDay,
    // QMateChart renders a LineChart and reads yFields as { field, label } objects.
    charts: [
      {
        type: 'line',
        title: 'Sales vs Profit Over Time',
        data: dataPoints,
        xField: 'date',
        yFields: [
          { field: 'totalSales', label: 'Sales' },
          { field: 'grossProfit', label: 'Gross Profit' },
        ],
      },
    ],
    limitations: 'Daily gross profit excludes per-day PPC and COGS (not available at day granularity); it is productSales minus Amazon/overhead expenses only.',
  };
}

// ── SECTION 10 — COGS / Overhead handlers (Categories H, I) ──

/**
 * HANDLER — COGS query (Category H, #88-92).
 * For "What are my COGS?", "Which products don't have COGS entered?".
 *
 * @param {Object} cogs - fetchCogsForUser() result { hasCOGS, entries, cogsMap }
 * @param {Array} asinWise - getAsinWisePL() rows
 * @param {Object} financeSummary - canonical summary from handleFinanceQuery
 * @returns {Object} { type:'cogs_query', hasCOGS, totalCOGS, productsWithCOGS, productsWithoutCOGS, missingCOGSCount, avgCOGSPerUnit, profitImpact }
 */
function buildCogsResponse(cogs, asinWise, financeSummary) {
  const cogsMap = (cogs && cogs.cogsMap) || new Map();
  const rows = Array.isArray(asinWise) ? asinWise : [];

  const productsWithCOGS = [];
  const productsWithoutCOGS = [];

  for (const row of rows) {
    const asin = row.asin;
    if (!asin) continue;
    const cogsPerUnit = Number(cogsMap.get(asin) || 0);
    const unitsSold = Number(row.units || 0);
    const productSales = Number(row.productSales || 0);

    if (cogsPerUnit > 0) {
      productsWithCOGS.push({
        asin,
        productName: row.productName || null,
        cogsPerUnit,
        unitsSold,
        totalCOGSForProduct: cogsPerUnit * unitsSold,
      });
    } else if (productSales > 0 || unitsSold > 0) {
      // Has activity but no COGS entered.
      productsWithoutCOGS.push({
        asin,
        productName: row.productName || null,
        unitsSold,
        productSales,
      });
    }
  }

  productsWithCOGS.sort((a, b) => b.totalCOGSForProduct - a.totalCOGSForProduct);
  productsWithoutCOGS.sort((a, b) => b.productSales - a.productSales);

  const totalCOGS = financeSummary.totalCogs || 0;
  const totalUnits = financeSummary.totalUnits || 0;
  const totalSales = financeSummary.totalSales || 0;

  return {
    type: 'cogs_query',
    hasCOGS: (cogs && cogs.hasCOGS) || false,
    totalCOGS,
    avgCOGSPerUnit: totalUnits > 0 ? totalCOGS / totalUnits : 0,
    productsWithCOGS,
    productsWithoutCOGS,
    missingCOGSCount: productsWithoutCOGS.length,
    profitImpact: {
      profitWithCOGS: financeSummary.displayProfit,
      profitWithoutCOGS: financeSummary.displayProfit + totalCOGS,
      cogsAsPercentOfSales: totalSales > 0 ? (totalCOGS / totalSales) * 100 : 0,
    },
  };
}

/**
 * HANDLER — Overhead query (Category I, #93-100).
 * For "What are my storage fees?", "What are my overhead costs?".
 * Splits overhead items by the isRevenue flag.
 *
 * @param {Array} overhead - getOverhead().items: { category, isRevenue, amount }
 * @param {Object} dateRange
 * @returns {Object} { type:'overhead_query', dateRange, totalOverheadExpenses, totalOverheadRevenue, netOverhead, expenses, revenue }
 */
function buildOverheadResponse(overhead, dateRange) {
  const abs = Math.abs;
  const items = Array.isArray(overhead) ? overhead : [];

  const expenseItems = items.filter((it) => !it.isRevenue);
  const revenueItems = items.filter((it) => it.isRevenue);

  const totalOverheadExpenses = expenseItems.reduce((s, it) => s + abs(it.amount || 0), 0);
  const totalOverheadRevenue = revenueItems.reduce((s, it) => s + abs(it.amount || 0), 0);

  const expenses = expenseItems
    .map((it) => ({
      category: it.category,
      amount: abs(it.amount || 0),
      percentOfTotal: totalOverheadExpenses > 0 ? (abs(it.amount || 0) / totalOverheadExpenses) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const revenue = revenueItems
    .map((it) => ({
      category: it.category,
      amount: abs(it.amount || 0),
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    type: 'overhead_query',
    dateRange,
    totalOverheadExpenses,
    totalOverheadRevenue,
    netOverhead: totalOverheadExpenses - totalOverheadRevenue,
    expenses,
    revenue,
  };
}

// ── SECTION 11 — LLM Narrator ──

// Model for narration. The narrator needs PLAIN TEXT (not JSON), so we call the
// OpenAI client directly rather than createCompletionWithFallback (which forces
// response_format: json_object). gpt-4o-mini matches the LLMIntentClassifier
// precedent for direct, non-JSON calls; override via env if desired.
const NARRATOR_MODEL = process.env.QMATE_NARRATOR_MODEL || 'gpt-4o-mini';

const NARRATOR_SYSTEM_PROMPT = `You are QMate, a financial analyst assistant for an Amazon seller. You receive pre-computed financial results. Your ONLY job is to present these numbers clearly in natural language.

ABSOLUTE RULES:
1. EVERY number you state MUST come from the result data below. Do NOT calculate, estimate, round differently, or invent any number.
2. Format currency with dollar sign and two decimal places: $1,234.56. Format percentages to one decimal: 12.3%.
3. Be concise. Answer the specific question. Do not add filler or repeat the question back.
4. If the result includes 'insights' or 'profitDrivers', present them ranked by impact — highest first.
5. If the result includes 'comparison', always state both current and previous period values with the percentage change.
6. Never say 'approximately', 'about', 'roughly', or 'around'. The numbers are exact.
7. If a profitMargin is provided, classify it: above 15% is healthy, 5-15% needs attention, below 5% is critical.
8. When presenting expense breakdowns, list from largest to smallest.
9. Do NOT add caveats like 'please note' or 'keep in mind' unless the result includes a specific warning.
10. If the result type is 'why_analysis', structure your answer as: 1) State what changed, 2) List drivers by impact, 3) List specific products contributing, 4) Actionable next steps from the actionableItems field.
11. When the result has chart data, mention that a chart is displayed but do NOT describe the chart data points in text — the chart speaks for itself.`;

/** Currency formatter: $1,234.56 */
function fmtMoney(n) {
  const v = Number(n || 0);
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Percentage formatter: 12.3% */
function fmtPct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

/** Human-ish date range label. */
function fmtRange(dr) {
  if (!dr || !dr.startDate || !dr.endDate) return 'the selected period';
  return `${dr.startDate} to ${dr.endDate}`;
}

/**
 * Deterministic template fallback when the LLM narrator is unavailable or fails.
 * Produces a basic, number-faithful sentence per result type — no LLM needed.
 *
 * @param {Object} result - sub-handler result object
 * @returns {string}
 */
function buildFallbackNarration(result) {
  if (!result || typeof result !== 'object') return 'I was unable to format the finance result.';
  const dr = fmtRange(result.dateRange);

  switch (result.type) {
    case 'summary_metrics': {
      const m = result.metrics || {};
      return `For ${dr}, your total sales were ${fmtMoney(m.totalSales)}, total expenses ${fmtMoney(m.displayTotalExpenses)}, and profit ${fmtMoney(m.displayProfit)} (${fmtPct(m.profitMargin)} margin).`;
    }
    case 'expense_breakdown':
      return `Your total expenses for ${dr} were ${fmtMoney(result.total)}.`;
    case 'fee_specific':
      return result.fee
        ? `Your ${result.fee.name} for ${dr} was ${fmtMoney(result.fee.amount)}.`
        : `I could not find that fee for ${dr}.`;
    case 'single_asin': {
      const m = result.metrics || {};
      return `For ${result.asin}${result.productName ? ` (${result.productName})` : ''} over ${dr}: sales ${fmtMoney(m.productSales)}, profit ${fmtMoney(m.grossProfit)} (${fmtPct(m.profitMargin)} margin).`;
    }
    case 'asin_comparison': {
      const ps = result.products || [];
      if (ps.length < 2) return `I need two products to compare for ${dr}.`;
      const parts = ps
        .map((p) => `${p.asin}${p.productName ? ` (${p.productName})` : ''}: profit ${fmtMoney(p.grossProfit)} (${fmtPct(p.profitMargin)} margin)`)
        .join(' vs ');
      const byProfit = result.winner && result.winner.byProfit;
      return `For ${dr} — ${parts}.${byProfit ? ` ${byProfit} has the higher profit.` : ''}`;
    }
    case 'cogs_query':
      return `Your total COGS for ${dr} was ${fmtMoney(result.totalCOGS)}.`;
    case 'overhead_query':
      return `Your overhead expenses for ${dr} were ${fmtMoney(result.totalOverheadExpenses)}.`;
    case 'comparison': {
      const c = result.currentSummary || {};
      const p = result.previousSummary || {};
      return `Profit ${result.overallDirection === 'improving' ? 'improved' : 'declined'}: ${fmtMoney(c.displayProfit)} this period versus ${fmtMoney(p.displayProfit)} previously.`;
    }
    case 'top_bottom_products': {
      const n = (result.products || []).length;
      return `Here are the ${n} ${result.direction === 'bottom' ? 'lowest' : 'top'} products by ${result.sortedBy} for ${dr}.`;
    }
    case 'asin_profitability': {
      const s = result.summary || {};
      return `Across ${s.totalProducts || 0} products for ${dr}, ${s.profitableCount || 0} are profitable and ${s.lossMakingCount || 0} are losing money.`;
    }
    case 'why_analysis': {
      const dir = result.comparison?.overallDirection || 'changed';
      const msgs = (result.insights || []).map((i) => i.message).join(' ');
      return `Your profitability ${dir}. ${msgs}`.trim();
    }
    case 'time_series':
      return `Here is your ${result.trend?.metric || 'sales'} trend for ${dr} (${result.trend?.direction || 'flat'}). A chart is displayed.`;
    default:
      return 'Here are your finance results.';
  }
}

/**
 * Convert a pre-computed finance result into natural language via the LLM.
 * The LLM only formats the provided numbers (strict no-invention prompt). On
 * any failure (missing client, API error, empty response) it falls back to a
 * deterministic template — so a number is always returned.
 *
 * @param {Object} result - result object from any sub-handler
 * @param {string} userQuestion - the original user question
 * @param {Object} modelTools - { client, createCompletionWithFallback }
 * @returns {Promise<string>} narrated answer text
 */
async function narrateFinanceResult(result, userQuestion, modelTools) {
  const client = modelTools && modelTools.client;

  if (client && client.chat && client.chat.completions && typeof client.chat.completions.create === 'function') {
    try {
      const messages = [
        { role: 'system', content: NARRATOR_SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `User asked: '${userQuestion}'\n\n` +
            `Pre-computed result:\n${JSON.stringify(result, null, 2)}\n\n` +
            'Present this data as a clear answer.',
        },
      ];

      const completion = await client.chat.completions.create({
        model: NARRATOR_MODEL,
        messages,
        temperature: 0.1,
        max_tokens: 800,
      });

      const content = completion?.choices?.[0]?.message?.content;
      if (content && content.trim()) {
        return content.trim();
      }
      logger.warn('[FinanceEngine] Narrator returned empty content; using template fallback');
    } catch (err) {
      logger.warn('[FinanceEngine] Narrator LLM call failed; using template fallback', { message: err.message });
    }
  } else {
    logger.warn('[FinanceEngine] No LLM client available for narrator; using template fallback');
  }

  return buildFallbackNarration(result);
}

// ── SECTION 12 — Finance context for the Suggestion Engine (Category G) ──

/**
 * Build an accurate, structured finance context for SuggestionEngineService to
 * INJECT into its multi-domain reasoning. This does NOT return a user-facing
 * response — it returns the same canonical finance numbers the dashboard shows
 * (so the suggestion LLM reasons over correct figures), plus a previous-period
 * comparison and pre-computed problem areas.
 *
 * @param {Object} interpretation
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, calendarMode }} [requestDateRange]
 * @returns {Promise<{ financeSummary, comparison, dateRange, problemAreas, healthIndicator }>}
 */
async function buildFinanceSuggestionContext(interpretation, userContext, requestDateRange) {
  const dateRange = await resolveFinanceDateRange(interpretation, userContext, requestDateRange);

  const dashboardData = await FinanceDashboardReadService.getDashboard({
    userId: userContext.userId,
    country: userContext.country,
    region: userContext.region,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const cogs = await fetchCogsForUser(userContext);

  // Canonical finance summary — same shared formulas as handleFinanceQuery.
  const totals = dashboardData.totals || {};
  const totalSales = totals.productSales || 0;
  const adSpend = totals.adsSpend || 0;
  const displayTotalExpenses = computeDisplayTotalExpenses(totals, dashboardData.overhead, adSpend);
  const totalCogs = computeTotalCogsFromAsinWise(dashboardData.asinWise, cogs);
  const displayProfit = computeDisplayProfit(totalSales, displayTotalExpenses, totalCogs);
  const profitMargin = totalSales > 0 ? (displayProfit / totalSales) * 100 : 0;

  const financeSummary = {
    dateRange,
    totalSales,
    totalUnits: totals.units || 0,
    totalOrders: totals.orderCount || 0,
    displayTotalExpenses,
    adSpend,
    totalCogs,
    displayProfit,
    profitMargin,
    overheadTotal: dashboardData.overheadTotal || 0,
    reimbursements: Math.abs(totals.fbaInventoryReimbursement || 0),
    refunds: Math.abs(totals.refundedAmount || 0),
  };

  // Previous-period comparison gives the suggestion LLM trend context.
  let comparison = null;
  try {
    comparison = await buildComparisonResponse(financeSummary, userContext, dateRange);
  } catch (err) {
    logger.warn('[FinanceEngine] suggestion-context comparison failed', { message: err.message });
  }

  // Problem areas — pre-computed so the LLM references real products/numbers.
  const rows = Array.isArray(dashboardData.asinWise) ? dashboardData.asinWise : [];
  const cogsMap = cogs.cogsMap;

  const losingProducts = rows
    .map((r) => computeAsinRowEntry(r, cogsMap))
    .filter((e) => e.grossProfit < 0)
    .sort((a, b) => a.grossProfit - b.grossProfit)
    .slice(0, 10);

  const lowMarginProducts = rows
    .map((r) => computeAsinRowEntry(r, cogsMap))
    .filter((e) => e.profitMargin >= 0 && e.profitMargin < 15)
    .slice(0, 10);

  const highFeeProducts = rows
    .filter((a) => (a.productSales || 0) > 0)
    .sort(
      (a, b) =>
        (Math.abs(b.totalExpenses || 0) / (b.productSales || 1)) -
        (Math.abs(a.totalExpenses || 0) / (a.productSales || 1))
    )
    .slice(0, 10)
    .map((r) => computeAsinRowEntry(r, cogsMap));

  const productsMissingCOGS = rows
    .filter((a) => (a.units || 0) > 0 && !(cogsMap && cogsMap.has(a.asin)))
    .slice(0, 20)
    .map((a) => ({
      asin: a.asin,
      productName: a.productName || null,
      units: Number(a.units || 0),
      productSales: Number(a.productSales || 0),
    }));

  return {
    financeSummary,
    comparison,
    dateRange,
    problemAreas: {
      losingProducts,
      lowMarginProducts,
      highFeeProducts,
      productsMissingCOGS,
    },
    healthIndicator: profitMargin > 15 ? 'HEALTHY' : profitMargin > 5 ? 'CAUTION' : 'CRITICAL',
  };
}

module.exports = {
  resolveFinanceDateRange,
  fetchCogsForUser,
  classifyFinanceQueryType,
  isFinanceQuery,
  extractPromptText,
  handleFinanceQuery,
  buildSummaryResponse,
  buildExpenseBreakdownResponse,
  buildFeeSpecificResponse,
  buildSingleAsinResponse,
  buildAsinComparisonResponse,
  buildTopBottomResponse,
  buildAsinProfitabilityResponse,
  buildComparisonResponse,
  buildWhyAnalysisResponse,
  buildTimeSeriesResponse,
  buildCogsResponse,
  buildOverheadResponse,
  narrateFinanceResult,
  buildFallbackNarration,
  buildFinanceSuggestionContext,
  // exported for unit testing of date math
  parsePeriodDays,
  subtractDaysYmd,
  dayCountInclusive,
  parseTopBottomRequest,
  pctChange,
  rankProfitDrivers,
};

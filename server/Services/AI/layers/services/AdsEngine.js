/**
 * AdsEngine — deterministic ads (PPC) answer engine for QMate.
 *
 * Mirrors the FinanceEngine design: every number is computed via the SAME
 * service the Campaign Audit Dashboard uses (PPCCampaignAnalysisService), and
 * the LLM narrator only formats those numbers — it never invents them.
 *
 * Like the FinanceEngine, dates are anchored to the user's
 * DataFetchTracking.dataRange.endDate (same as the dashboard), NOT to `new Date()`,
 * so the window always lines up with the data that actually exists.
 *
 * Phase 1 scope: resolveAdsDateRange + resolveKPIs + getAdsSummary. The
 * classifier is fully implemented (so isAdsQuery is accurate for pipeline
 * wiring), but handleAdsQuery routes every ads query to getAdsSummary for now;
 * the remaining handlers land in later phases.
 */

// ── SECTION 1 — Imports ──
const mongoose = require('mongoose');
const logger = require('../../../../utils/Logger.js');
const PPCCampaignAnalysisService = require('../../../Calculations/PPCCampaignAnalysisService.js');
const PPCMetrics = require('../../../../models/amazon-ads/PPCMetricsModel.js');
const DataFetchTracking = require('../../../../models/system/DataFetchTrackingModel.js');
const ProductWiseSponsoredAdsItem = require('../../../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const adsKeywordsPerformance = require('../../../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const SearchTerms = require('../../../../models/amazon-ads/SearchTermsModel.js');
const Campaign = require('../../../../models/amazon-ads/CampaignModel.js');
const { loadLatestSnapshotDoc } = require('../../../../utils/ppcSnapshotLoader.js');
const { getDefaultReportDateRange } = require('../../../../utils/reportDateRange.js');
// Standalone detector (no engine imports) — lets isAdsQuery defer cross-domain
// strategy questions without a circular dependency.
const { isGeneralStrategyQuery } = require('./helpers/StrategyQueryDetector.js');
// SellerOps/Advisory run LATER in the pipeline, so Ads must defer their queries
// (pure detectors → no circular dependency).
const { isSellerOpsQuery } = require('./helpers/SellerOpsQueryDetector.js');
const { isAdvisoryQuery } = require('./helpers/AdvisoryQueryDetector.js');

// ── Date helpers (YYYY-MM-DD string math via UTC to avoid TZ drift) ──
// Mirror of the FinanceEngine helpers; kept module-private so AdsEngine is
// self-contained and its date semantics can never silently drift from finance.

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
 * Period length (in days) requested by the prompt/calendar. Defaults to 30.
 * Mirrors dashboard semantics: last7 = 7 days, last14 = 14 days.
 */
function parsePeriodDays(interpretation, calendarMode) {
  const mode = String(calendarMode || '').toLowerCase();
  if (mode === 'last7') return 7;
  if (mode === 'last14') return 14;

  const tr = interpretation?.entities?.timeRange;
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

/**
 * Period the user EXPLICITLY typed ("last 14 days", "last week", "last month").
 * Reads ONLY the extracted timeRange entity, so it returns null when no period
 * was named — letting a typed span override the frontend calendar window.
 *
 * @returns {number|null} number of days, or null if no explicit period typed
 */
function parseExplicitRelativePeriod(interpretation) {
  const tr = interpretation?.entities?.timeRange;
  if (!tr) return null;
  const raw = String(tr.value || tr.raw || '').toLowerCase();
  if (!raw) return null;
  const m = raw.match(/(?:last|past)[_\s]+(\d+)[_\s]*days?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (/last[_\s]*7\b|last\s*week|past\s*week/.test(raw)) return 7;
  if (/last[_\s]*14\b/.test(raw)) return 14;
  if (/last[_\s]*30\b|last\s*month|past\s*month/.test(raw)) return 30;
  return null;
}

// ── SECTION 2 — resolveAdsDateRange ──

/**
 * Resolve the ads query window, anchored to the user's data end date
 * (DataFetchTracking.dataRange.endDate), exactly like the dashboard.
 *
 * Precedence (same pattern as FinanceEngine.resolveFinanceDateRange):
 *   c)  explicit absolute start/end typed by the user → use, cap at anchor
 *   c2) explicit typed relative period ("last 14 days") → overrides calendar
 *   d)  frontend calendar concrete dates → use as-is
 *   e)  relative period anchored to the data end date (dashboard default)
 *
 * @param {Object} interpretation - interpretPrompt() output
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, calendarMode }} [requestDateRange] - frontend calendar
 * @returns {Promise<{ startDate, endDate, mode, source, dayCount }>}
 */
async function resolveAdsDateRange(interpretation, userContext, requestDateRange) {
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
    logger.warn('[AdsEngine] DataFetchTracking lookup failed; will use Pacific-yesterday anchor', {
      message: err.message,
    });
  }

  // b) Fallback anchor: Pacific yesterday (same default the ingest paths use).
  if (!anchorEndDate) {
    anchorEndDate = getDefaultReportDateRange().endDate;
    logger.info('[AdsEngine] No DataFetchTracking anchor found; falling back to Pacific yesterday', {
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
    logger.info('[AdsEngine] Date range resolved from explicit user dates', resolved);
    return resolved;
  }

  // c2) Explicit relative period typed by the user OVERRIDES the frontend
  //     calendar's default window (anchored to the same data end date).
  const promptPeriodDays = parseExplicitRelativePeriod(interpretation);
  if (promptPeriodDays) {
    const endDate = anchorEndDate;
    let startDate = subtractDaysYmd(endDate, promptPeriodDays - 1);
    if (anchorStartDate && startDate < anchorStartDate && promptPeriodDays >= 30) {
      startDate = anchorStartDate;
    }
    const resolved = {
      startDate,
      endDate,
      mode: promptPeriodDays === 7 ? 'last7' : promptPeriodDays === 14 ? 'last14' : promptPeriodDays === 30 ? 'default' : 'custom',
      source: 'prompt_relative',
      dayCount: dayCountInclusive(startDate, endDate),
    };
    logger.info('[AdsEngine] Date range resolved from explicit prompt period (overrides frontend calendar)', resolved);
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
    logger.info('[AdsEngine] Date range resolved from frontend calendar', resolved);
    return resolved;
  }

  // e) Relative period anchored to the data end date (same as the dashboard).
  const periodDays = parsePeriodDays(interpretation, requestDateRange?.calendarMode);
  const endDate = anchorEndDate;
  let startDate = subtractDaysYmd(endDate, periodDays - 1);
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
  logger.info('[AdsEngine] Date range resolved from anchored relative period', resolved);
  return resolved;
}

// ── SECTION 3 — resolveKPIs ──

/**
 * Canonical KPI computation. Uses PPCCampaignAnalysisService.getPPCKPISummary —
 * THE SAME service (and therefore the same numbers) as the Campaign Audit
 * Dashboard. Do NOT call PPCMetrics.rollupLastDays separately: getPPCKPISummary
 * already reads from PPCMetrics internally, plus SalesOnlyMetrics for TACOS.
 *
 * The KPI summary returns `sales`/`spend` (PPC-attributed); we expose them as
 * `ppcSales`/`ppcSpend` for clarity and add a handful of derived metrics.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} dateRange - from resolveAdsDateRange
 * @returns {Promise<Object>} canonical KPI object (see return shape below)
 */
async function resolveKPIs(userContext, dateRange) {
  const kpiSummary = await PPCCampaignAnalysisService.getPPCKPISummary(
    userContext.userId,
    userContext.country,
    userContext.region,
    dateRange.startDate,
    dateRange.endDate
  );

  return {
    ppcSales: kpiSummary.sales || 0,
    ppcSpend: kpiSummary.spend || 0,
    totalSales: kpiSummary.totalSales || 0, // organic + PPC (TACOS denominator)
    acos: kpiSummary.acos || 0,
    tacos: kpiSummary.tacos || 0,
    roas: kpiSummary.roas || 0,
    impressions: kpiSummary.impressions || 0,
    clicks: kpiSummary.clicks || 0,
    ctr: kpiSummary.ctr || 0,
    cpc: kpiSummary.cpc || 0,
    unitsSold: kpiSummary.unitsSold || 0,
    orders: kpiSummary.orders || 0,
    totalIssues: kpiSummary.totalIssues || 0,
    timeseries: kpiSummary.timeseries || [],
    dateRange,
    // Derived metrics
    conversionRate: kpiSummary.clicks > 0 ? ((kpiSummary.orders || 0) / kpiSummary.clicks) * 100 : 0,
    costPerOrder: (kpiSummary.orders || 0) > 0 ? (kpiSummary.spend || 0) / kpiSummary.orders : 0,
    avgDailySpend: dateRange.dayCount > 0 ? (kpiSummary.spend || 0) / dateRange.dayCount : 0,
    ppcSalesPercent: kpiSummary.totalSales > 0 ? ((kpiSummary.sales || 0) / kpiSummary.totalSales) * 100 : 0,
  };
}

// ── SECTION 4 — handleAdsQuery (entry point) ──

/**
 * Main entry point for the ads answer engine.
 *
 * Phase 1: classification is complete (so isAdsQuery is accurate), but every
 * ads query is answered with getAdsSummary until the remaining handlers land.
 *
 * @param {Object} interpretation - interpretPrompt() output
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, calendarMode }} [requestDateRange] - frontend calendar
 * @returns {Promise<Object>} structured result object, or { type:'error', message }
 */
async function handleAdsQuery(interpretation, userContext, requestDateRange) {
  try {
    // a) Resolve the window (anchored to the dashboard's data end date).
    const dateRange = await resolveAdsDateRange(interpretation, userContext, requestDateRange);

    // b) Classify the ads sub-intent.
    const queryType = classifyAdsQueryType(interpretation);
    logger.info(`[AdsEngine] handleAdsQuery — queryType=${queryType}, window=${dateRange.startDate}..${dateRange.endDate} (${dateRange.source})`);

    // c) Route to a handler. Phase 1 implements only ads_summary; everything
    //    else falls through to the summary until later phases add handlers.
    switch (queryType) {
      case 'ads_summary':
        return await getAdsSummary(userContext, dateRange);
      case 'wasted_spend':
        return await getWastedSpendAnalysis(userContext, dateRange);
      case 'top_performers':
        return await getTopPerformers(userContext, dateRange, interpretation);
      case 'campaign_performance':
        return await getCampaignPerformance(userContext, dateRange, interpretation);
      case 'campaign_type_breakdown':
        return await getCampaignTypeBreakdown(userContext, dateRange);
      case 'budget_analysis':
        return await getAdsBudgetAnalysis(userContext, dateRange);
      case 'search_term_analysis':
        return await getSearchTermAnalysis(userContext, dateRange, interpretation);
      case 'organic_vs_paid':
        return await getOrganicVsPaidSplit(userContext, dateRange);
      case 'asin_ads':
        return await getAsinAdsPerformance(
          (interpretation?.entities?.asins || [])[0],
          userContext,
          dateRange
        );
      case 'ads_comparison':
        return await getAdsComparison(userContext, dateRange);
      case 'ads_why_analysis':
        return await getAdsWhyAnalysis(userContext, dateRange);
      case 'ads_time_series':
        return await getAdsTimeSeries(userContext, dateRange, interpretation);
      case 'keyword_deep_dive':
        return await getKeywordDeepDive(
          interpretation?.entities?.keywordText,
          userContext,
          dateRange
        );
      default:
        return await getAdsSummary(userContext, dateRange);
    }
  } catch (err) {
    logger.error('[AdsEngine] Error in handleAdsQuery:', err.message);
    return { type: 'error', message: err.message };
  }
}

// ── SECTION 5 — getAdsSummary ──

/**
 * Overall PPC KPI summary plus optimization-opportunity flags.
 * All amounts are positive. tabCounts are pulled for the SAME window so the
 * opportunity flags line up with the Campaign Audit Dashboard tabs.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} dateRange
 * @returns {Promise<Object>} { type:'ads_summary', dateRange, kpis, tabCounts,
 *   optimizationOpportunities, healthIndicator }
 */
async function getAdsSummary(userContext, dateRange) {
  // a) Canonical KPIs (same service as the dashboard).
  const kpis = await resolveKPIs(userContext, dateRange);

  // b) Tab counts for the SAME window (dashboard parity). getTabCounts returns
  //    short keys { highAcos, wastedSpend, noNegatives, topKeywords, zeroSales,
  //    autoInsights }; we re-key them to descriptive names.
  const rawCounts = await PPCCampaignAnalysisService.getTabCounts(
    userContext.userId,
    userContext.country,
    userContext.region,
    dateRange.startDate,
    dateRange.endDate
  );

  const tabCounts = {
    highAcosCampaigns: rawCounts?.highAcos || 0,
    wastedSpendKeywords: rawCounts?.wastedSpend || 0,
    campaignsWithoutNegatives: rawCounts?.noNegatives || 0,
    topPerformingKeywords: rawCounts?.topKeywords || 0,
    searchTermsZeroSales: rawCounts?.zeroSales || 0,
    autoCampaignInsights: rawCounts?.autoInsights || 0,
  };

  // c) Result package. Add explicit, self-describing aliases so neither the LLM
  //    narrator nor any downstream code can confuse "ad sales" (revenue FROM
  //    ads) with "ad spend" (money spent ON ads).
  const kpisWithAliases = {
    ...kpis,
    revenueFromAds: kpis.ppcSales, // "ad sales" / "PPC sales" = revenue generated by ads
    moneySpentOnAds: kpis.ppcSpend, // "ad spend" / "advertising cost" = money paid for ads
  };

  return {
    type: 'ads_summary',
    dateRange,
    kpis: kpisWithAliases,
    tabCounts,
    optimizationOpportunities: {
      hasWastedSpend: tabCounts.wastedSpendKeywords > 0,
      hasHighAcos: tabCounts.highAcosCampaigns > 0,
      needsNegatives: tabCounts.campaignsWithoutNegatives > 0,
      hasZeroSalesTerms: tabCounts.searchTermsZeroSales > 0,
    },
    healthIndicator: kpis.acos < 20 ? 'EFFICIENT' : kpis.acos < 40 ? 'MODERATE' : 'NEEDS_ATTENTION',
  };
}

// ── round2 helper ──
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Robustly extract the user's prompt text from an interpretation, in ORIGINAL
 * case. The real interpreter (PromptInterpreter.js) sets `interpretation.raw` to
 * an OBJECT `{ prompt, normalizedPrompt }`, NOT a string — so a naive
 * `String(interpretation.raw)` yields "[object Object]" and defeats all
 * prompt-based regex matching (this caused "ads sales" to be missed and routed
 * to the FinanceEngine). Mirrors FinanceEngine.extractPromptText. Callers that
 * need case-insensitive matching should `.toLowerCase()` the result.
 *
 * @param {Object} interpretation
 * @returns {string} the prompt text (original case), or ''
 */
function extractPromptText(interpretation) {
  const rawField = interpretation && interpretation.raw;
  const fromRaw =
    typeof rawField === 'string'
      ? rawField
      : (rawField && (rawField.normalizedPrompt || rawField.prompt)) || '';
  const text = fromRaw || (interpretation && interpretation.rewrittenQuestion) || (interpretation && interpretation.rawQuestion) || '';
  return String(text);
}

// ── HANDLER 1 — getWastedSpendAnalysis ──

/**
 * Wasted-spend analysis (PART 3 Category B, #15-23). Combines wasted keywords
 * (spend > $0, sales < $0.01) and zero-sales search terms (clicks >= 10,
 * sales < $0.01) — BOTH from PPCCampaignAnalysisService, so the thresholds and
 * numbers match the Campaign Audit Dashboard exactly (NOT the legacy
 * QMatePPCService 50%/$5 thresholds).
 *
 * The `wasted_keywords` array is shaped for the frontend's interactive pause/
 * negative table and includes keywordId/campaignId/adGroupId for action buttons.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} dateRange
 * @returns {Promise<Object>} { type:'wasted_spend', ... }
 */
async function getWastedSpendAnalysis(userContext, dateRange) {
  // a + b) Pull both wasted sources for the SAME window (dashboard parity).
  const [wastedKeywords, zeroSalesTerms] = await Promise.all([
    PPCCampaignAnalysisService.getWastedSpendKeywords(
      userContext.userId, userContext.country, userContext.region, 1, 50, dateRange.startDate, dateRange.endDate
    ),
    PPCCampaignAnalysisService.getSearchTermsZeroSales(
      userContext.userId, userContext.country, userContext.region, 1, 50, dateRange.startDate, dateRange.endDate
    ),
  ]);

  const wastedKwData = wastedKeywords?.data || [];
  const zeroTermData = zeroSalesTerms?.data || [];

  // getWastedSpendKeywords returns a facet-wide totalWastedSpend; getSearchTermsZeroSales
  // does not, so sum its (page-limited) data spend — same approach as getQMatePPCContext.
  const wastedKwTotalSpend = round2(
    wastedKeywords?.totalWastedSpend != null
      ? wastedKeywords.totalWastedSpend
      : wastedKwData.reduce((sum, k) => sum + (k.spend || 0), 0)
  );
  const zeroTermTotalSpend = round2(zeroTermData.reduce((sum, t) => sum + (t.spend || 0), 0));

  // c) Combined total wasted.
  const totalWastedSpend = round2(wastedKwTotalSpend + zeroTermTotalSpend);

  // d) Group wasted keywords by campaign to surface the worst offenders.
  const byCampaign = new Map();
  for (const k of wastedKwData) {
    const name = k.campaignName || 'Unknown Campaign';
    const entry = byCampaign.get(name) || { campaignName: name, wastedSpend: 0, wastedKeywordCount: 0 };
    entry.wastedSpend += k.spend || 0;
    entry.wastedKeywordCount += 1;
    byCampaign.set(name, entry);
  }
  const worstCampaigns = Array.from(byCampaign.values())
    .map((c) => ({ ...c, wastedSpend: round2(c.wastedSpend) }))
    .sort((a, b) => b.wastedSpend - a.wastedSpend);

  const wastedKwTotal = wastedKeywords?.pagination?.totalItems || 0;
  const zeroTermTotal = zeroSalesTerms?.pagination?.totalItems || 0;

  // e) Result package.
  return {
    type: 'wasted_spend',
    dateRange,
    totalWastedSpend,
    wastedKeywords: {
      data: wastedKwData,
      total: wastedKwTotal,
      totalSpend: wastedKwTotalSpend,
      criteria: 'spend > $0, sales < $0.01',
    },
    zeroSalesTerms: {
      data: zeroTermData,
      total: zeroTermTotal,
      totalSpend: zeroTermTotalSpend,
      criteria: 'clicks >= 10, sales < $0.01',
    },
    worstCampaigns,
    savingsOpportunity: `Pausing these keywords could save $${totalWastedSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/period`,
    // For the frontend interactive table — must carry the IDs for pause/negative actions.
    wasted_keywords: wastedKwData.map((k) => ({
      keyword: k.keyword,
      campaignName: k.campaignName,
      adGroupName: k.adGroupName,
      spend: k.spend ?? k.totalCost ?? k.cost ?? 0,
      keywordId: k.keywordId,
      campaignId: k.campaignId,
      adGroupId: k.adGroupId,
    })),
    wasted_keywords_total: wastedKwTotal,
    load_more_available: wastedKwTotal > 50,
  };
}

// ── HANDLER 2 — getTopPerformers ──

/**
 * Determine what "top" means from the prompt: whether the user wants keywords
 * or campaigns, and which metric to sort by.
 *
 * @returns {{ ranking: 'keywords'|'campaigns', sortedBy: 'sales'|'roas'|'acos'|'spend' }}
 */
function parseTopPerformerIntent(interpretation) {
  const prompt = extractPromptText(interpretation).toLowerCase();
  const ranking = /campaign/.test(prompt) && !/keyword/.test(prompt) ? 'campaigns' : 'keywords';

  let sortedBy = 'sales';
  if (/\broas\b|return on ad spend/.test(prompt)) sortedBy = 'roas';
  else if (/lowest.*acos|best.*acos|\bacos\b/.test(prompt)) sortedBy = 'acos';
  else if (/\bspend\b|spends? the most|highest.*spend/.test(prompt)) sortedBy = 'spend';
  else if (/most sales|drive.*sales|by sales|highest.*sales/.test(prompt)) sortedBy = 'sales';

  return { ranking, sortedBy };
}

/**
 * Aggregate per-campaign ad metrics from ProductWiseSponsoredAdsItem for the
 * window (mirrors the dashboard's getHighAcosCampaigns aggregation, minus the
 * ACOS > 40% filter so all campaigns are rankable). All amounts positive.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate }} dateRange
 * @param {string[]|null} [campaignIds] - optional whitelist of campaignIds to include
 * @returns {Promise<Array<{ campaignId, name, spend, sales, acos, roas, impressions, clicks, ctr, cpc, units }>>}
 */
async function aggregateCampaignMetrics(userContext, dateRange, campaignIds = null) {
  // ProductWiseSponsoredAdsItem.userId is an ObjectId; date is a STRING.
  const userIdObj = mongoose.Types.ObjectId.isValid(userContext.userId)
    ? new mongoose.Types.ObjectId(userContext.userId)
    : userContext.userId;

  const match = {
    userId: userIdObj,
    country: userContext.country,
    region: userContext.region,
    date: { $gte: dateRange.startDate, $lte: dateRange.endDate },
  };
  if (Array.isArray(campaignIds)) {
    if (campaignIds.length === 0) return []; // explicit empty filter → no rows
    match.campaignId = { $in: campaignIds };
  }

  const rows = await ProductWiseSponsoredAdsItem.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$campaignId',
        campaignName: { $first: '$campaignName' },
        totalSpend: { $sum: { $ifNull: ['$spend', 0] } },
        totalSales: { $sum: { $ifNull: ['$sales', { $ifNull: ['$salesIn30Days', 0] }] } },
        totalImpressions: { $sum: { $ifNull: ['$impressions', 0] } },
        totalClicks: { $sum: { $ifNull: ['$clicks', 0] } },
        totalUnits: { $sum: { $ifNull: ['$unitsSoldClicks', 0] } },
      },
    },
  ]);

  return rows.map((r) => {
    const spend = round2(r.totalSpend);
    const sales = round2(r.totalSales);
    return {
      campaignId: r._id,
      name: r.campaignName || 'Unknown Campaign',
      spend,
      sales,
      acos: sales > 0 ? round2((spend / sales) * 100) : 0,
      roas: spend > 0 ? round2(sales / spend) : 0,
      impressions: r.totalImpressions || 0,
      clicks: r.totalClicks || 0,
      ctr: r.totalImpressions > 0 ? round2((r.totalClicks / r.totalImpressions) * 100) : 0,
      cpc: r.totalClicks > 0 ? round2(spend / r.totalClicks) : 0,
      units: Math.round(r.totalUnits || 0),
    };
  });
}

// ── HANDLER 3 — resolveCampaignEntity + getCampaignPerformance ──

/**
 * Identify which campaign(s) a question targets. Reads the campaign entities
 * the EntityExtractor produced (id / quoted name / auto-manual type), then
 * fuzzy-resolves a name against the latest Campaign snapshot.
 *
 * Precedence: explicit ID → (quoted name | "campaign called/named X") fuzzy
 * resolve → auto/manual type filter. Returns null when no campaign target is
 * expressed (the caller then treats the query as a ranking over all campaigns).
 *
 * NOTE: the bare/greedy "campaign <word>" name hint from the architecture doc
 * is intentionally NOT used — it false-matches ranking phrasing like "which
 * campaign spends the most", routing it to a (failed) name lookup. Only quoted
 * names and the explicit "called/named" form are treated as name hints.
 *
 * @param {Object} interpretation
 * @param {{ userId, country, region }} userContext
 * @returns {Promise<{type:'id'|'resolved'|'name_unresolved'|'campaignType', ...}|null>}
 */
async function resolveCampaignEntity(interpretation, userContext) {
  const entities = interpretation?.entities || {};
  const prompt = extractPromptText(interpretation);

  // 1) Explicit campaign ID (entity or prompt).
  if (entities.campaign?.type === 'id' && entities.campaign.campaignId) {
    return { type: 'id', campaignId: entities.campaign.campaignId };
  }
  const idMatch = prompt.match(/campaign\s*(?:id[:\s]*)?\s*(\d{10,})/i);
  if (idMatch) return { type: 'id', campaignId: idMatch[1] };

  // 2) Quoted / explicitly-named campaign → collect a name hint.
  let nameHint = null;
  if (entities.campaign?.type === 'name' && entities.campaign.campaignName) {
    nameHint = entities.campaign.campaignName;
  }
  if (!nameHint) {
    const quoted = prompt.match(/(?:campaign|camp)\s+['"]([^'"]+)['"]/i);
    if (quoted) nameHint = quoted[1];
  }
  if (!nameHint) {
    const named = prompt.match(/campaign\s+(?:called|named)\s+([A-Za-z0-9][\w\s-]{1,40}?)(?:\s+(?:campaign|doing|performance|perform|ads?)\b|[?.!]|$)/i);
    if (named) nameHint = named[1].trim();
  }

  // 3) Campaign type filter (auto / manual).
  const typeFromEntities = entities.campaignType;
  if (!nameHint && typeFromEntities) {
    return { type: 'campaignType', campaignType: typeFromEntities };
  }
  if (!nameHint) {
    const typeMatch = prompt.match(/\b(auto|manual)\b\s*campaigns?/i);
    if (typeMatch) return { type: 'campaignType', campaignType: typeMatch[1].toLowerCase() };
  }

  // 4) Fuzzy-resolve the name hint against the latest Campaign snapshot.
  if (nameHint) {
    const userIdStr = userContext.userId?.toString() || userContext.userId;
    const snapshot = await loadLatestSnapshotDoc(Campaign, userIdStr, userContext.country, userContext.region);
    const campaignData = snapshot?.campaignData || [];
    const hintLower = nameHint.toLowerCase();
    const match =
      campaignData.find((c) => (c.name || '').toLowerCase() === hintLower) ||
      campaignData.find((c) => (c.name || '').toLowerCase().includes(hintLower));
    if (match) return { type: 'resolved', campaignId: match.campaignId, campaignName: match.name };
    return { type: 'name_unresolved', searchTerm: nameHint };
  }

  return null;
}

/**
 * Decide how to sort a campaign ranking from the prompt.
 * @returns {{ sortField: 'spend'|'acos'|'roas', direction: 'asc'|'desc' }}
 */
function parseCampaignRankIntent(interpretation) {
  const prompt = extractPromptText(interpretation).toLowerCase();
  if (/worst.*acos|highest.*acos/.test(prompt)) return { sortField: 'acos', direction: 'desc' };
  if (/best.*acos|lowest.*acos/.test(prompt)) return { sortField: 'acos', direction: 'asc' };
  if (/best.*roas|highest.*roas/.test(prompt)) return { sortField: 'roas', direction: 'desc' };
  if (/worst.*roas|lowest.*roas/.test(prompt)) return { sortField: 'roas', direction: 'asc' };
  // "spends the most", "biggest spender", or a plain list → by spend desc.
  return { sortField: 'spend', direction: 'desc' };
}

/**
 * Campaign-level performance (PART 3 Category C, #24-34). Three modes:
 *   - 'single'      → one resolved campaign (by ID or fuzzy-matched name)
 *   - 'type_filter' → all auto / manual campaigns
 *   - 'ranking'     → all campaigns, sorted (spends most / worst ACOS / best ROAS / list)
 *
 * Metrics come from ProductWiseSponsoredAdsItem (per-campaign per-day rows);
 * targetingType and dailyBudget are enriched from the latest Campaign snapshot.
 * Ranking and type_filter are capped at the top 20 by the sort metric.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} dateRange
 * @param {Object} interpretation
 * @returns {Promise<Object>} { type:'campaign_performance', mode, campaigns, total, ... }
 */
async function getCampaignPerformance(userContext, dateRange, interpretation) {
  const resolved = await resolveCampaignEntity(interpretation, userContext);

  // Snapshot metadata for enrichment (name, targetingType, dailyBudget) and
  // type filtering — loaded once.
  const userIdStr = userContext.userId?.toString() || userContext.userId;
  const snapshot = await loadLatestSnapshotDoc(Campaign, userIdStr, userContext.country, userContext.region);
  const campaignData = snapshot?.campaignData || [];
  const metaById = new Map(
    campaignData.map((c) => [
      String(c.campaignId),
      {
        name: c.name,
        targetingType: c.targetingType || c.campaignType || null,
        dailyBudget: c.dailyBudget != null ? c.dailyBudget : null,
        state: c.state || null,
      },
    ])
  );

  // Decide mode + the campaignId filter passed to the aggregation.
  let mode = 'ranking';
  let filterIds = null;
  let resolvedInfo = resolved || null;

  if (resolved?.type === 'id' || resolved?.type === 'resolved') {
    mode = 'single';
    filterIds = [String(resolved.campaignId)];
  } else if (resolved?.type === 'campaignType') {
    mode = 'type_filter';
    filterIds = campaignData
      .filter((c) => (c.targetingType || c.campaignType || '').toLowerCase() === resolved.campaignType)
      .map((c) => String(c.campaignId));
  } else if (resolved?.type === 'name_unresolved') {
    // We understood they named a campaign but couldn't find it → empty result
    // with a note, rather than silently ranking everything.
    mode = 'single';
    filterIds = [];
  }

  let rows = await aggregateCampaignMetrics(userContext, dateRange, filterIds);

  // Enrich with snapshot metadata (targetingType, dailyBudget; prefer snapshot name).
  rows = rows.map((r) => {
    const meta = metaById.get(String(r.campaignId)) || {};
    return {
      campaignId: r.campaignId,
      campaignName: meta.name || r.name,
      targetingType: meta.targetingType || null,
      spend: r.spend,
      sales: r.sales,
      acos: r.acos,
      roas: r.roas,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      cpc: r.cpc,
      units: r.units,
      dailyBudget: meta.dailyBudget != null ? meta.dailyBudget : null,
    };
  });

  // Sort + cap. Single mode keeps its (0-1) rows; the others rank and limit.
  if (mode !== 'single') {
    const { sortField, direction } = parseCampaignRankIntent(interpretation);
    // For ACOS ascending ("best ACOS"), exclude no-sales (acos === 0) campaigns
    // so they don't masquerade as the most efficient.
    let ranked = rows;
    if (sortField === 'acos' && direction === 'asc') ranked = rows.filter((c) => c.acos > 0);
    ranked.sort((a, b) =>
      direction === 'asc' ? (a[sortField] || 0) - (b[sortField] || 0) : (b[sortField] || 0) - (a[sortField] || 0)
    );
    rows = ranked.slice(0, 20);
  }

  return {
    type: 'campaign_performance',
    dateRange,
    mode,
    resolved: resolvedInfo,
    activeCampaignCount: campaignData.length,
    campaigns: rows,
    total: rows.length,
    notFound: mode === 'single' && rows.length === 0,
  };
}

/**
 * Top performers (PART 3 Category E, #41-50). Keyword ranking comes from
 * PPCCampaignAnalysisService.getTopPerformingKeywords (dashboard criteria:
 * ACOS < 20%, sales > 100, impressions > 1000). Campaign ranking aggregates
 * ProductWiseSponsoredAdsItem by campaign.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} dateRange
 * @param {Object} interpretation
 * @returns {Promise<Object>} { type:'top_performers', ... }
 */
async function getTopPerformers(userContext, dateRange, interpretation) {
  const { ranking, sortedBy } = parseTopPerformerIntent(interpretation);

  // For ACOS, lower is better; for everything else, higher is better.
  const sortComparator = (a, b) =>
    sortedBy === 'acos' ? (a[sortedBy] || 0) - (b[sortedBy] || 0) : (b[sortedBy] || 0) - (a[sortedBy] || 0);

  let items = [];
  if (ranking === 'campaigns') {
    // c) Aggregate campaigns from ProductWiseSponsoredAdsItem.
    const campaigns = await aggregateCampaignMetrics(userContext, dateRange);
    // For ACOS ranking, exclude zero-ACOS (no-sales) campaigns so "best ACOS" is meaningful.
    const ranked = (sortedBy === 'acos' ? campaigns.filter((c) => c.acos > 0) : campaigns).sort(sortComparator);
    items = ranked.slice(0, 20).map((c) => ({
      name: c.name,
      spend: c.spend,
      sales: c.sales,
      acos: c.acos,
      roas: c.roas,
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: c.ctr,
    }));
  } else {
    // b) Top keywords via dashboard service (criteria baked into the query).
    const topKeywords = await PPCCampaignAnalysisService.getTopPerformingKeywords(
      userContext.userId, userContext.country, userContext.region, 1, 20, dateRange.startDate, dateRange.endDate
    );
    const data = (topKeywords?.data || []).slice().sort(sortComparator);
    items = data.map((k) => ({
      name: k.keyword,
      spend: round2(k.spend),
      sales: round2(k.sales),
      acos: round2(k.acos),
      roas: round2(k.roas),
      impressions: k.impressions || 0,
      clicks: k.clicks || 0,
      ctr: round2(k.ctr),
    }));
  }

  return {
    type: 'top_performers',
    dateRange,
    ranking,
    sortedBy,
    items,
    total: items.length,
  };
}

// ── HANDLER 4 — getCampaignTypeBreakdown ──

/**
 * SP vs SB vs SD breakdown (PART 3 Category D, #35-40). The per-type metrics
 * live ONLY on PPCMetrics per-day docs (found by metricDate) under
 * `campaignTypeBreakdown.{sponsoredProducts,sponsoredBrands,sponsoredDisplay}`
 * — the rollup path returns null for this, so we read the daily docs directly
 * and sum. Output is keyed sp/sb/sd. All amounts positive.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate }} dateRange
 * @returns {Promise<Object>} { type:'campaign_type_breakdown', ... }
 */
async function getCampaignTypeBreakdown(userContext, dateRange) {
  // PPCMetrics.userId is a STRING; metricDate is a YYYY-MM-DD string.
  const userIdStr = userContext.userId?.toString() || userContext.userId;
  const dailyDocs = await PPCMetrics.find({
    userId: userIdStr,
    country: userContext.country,
    region: userContext.region,
    metricDate: { $gte: dateRange.startDate, $lte: dateRange.endDate },
  }).lean();

  // Schema stores full names; the response uses the short sp/sb/sd keys.
  const keyMap = { sp: 'sponsoredProducts', sb: 'sponsoredBrands', sd: 'sponsoredDisplay' };
  const breakdown = {};
  for (const type of ['sp', 'sb', 'sd']) {
    const m = { sales: 0, spend: 0, impressions: 0, clicks: 0 };
    for (const doc of dailyDocs) {
      const b = doc.campaignTypeBreakdown && doc.campaignTypeBreakdown[keyMap[type]];
      if (b) {
        m.sales += b.sales || 0;
        m.spend += b.spend || 0;
        m.impressions += b.impressions || 0;
        m.clicks += b.clicks || 0;
      }
    }
    m.sales = round2(m.sales);
    m.spend = round2(m.spend);
    m.acos = m.sales > 0 ? round2((m.spend / m.sales) * 100) : 0;
    m.roas = m.spend > 0 ? round2(m.sales / m.spend) : 0;
    m.ctr = m.impressions > 0 ? round2((m.clicks / m.impressions) * 100) : 0;
    m.cpc = m.clicks > 0 ? round2(m.spend / m.clicks) : 0;
    breakdown[type] = m;
  }

  const totalSpend = round2(breakdown.sp.spend + breakdown.sb.spend + breakdown.sd.spend);
  const pct = (v) => (totalSpend > 0 ? round2((v / totalSpend) * 100) : 0);

  return {
    type: 'campaign_type_breakdown',
    dateRange,
    breakdown,
    totalSpend,
    spendDistribution: {
      sp: breakdown.sp.spend,
      sb: breakdown.sb.spend,
      sd: breakdown.sd.spend,
      spPercent: pct(breakdown.sp.spend),
      sbPercent: pct(breakdown.sb.spend),
      sdPercent: pct(breakdown.sd.spend),
    },
    daysWithData: dailyDocs.length,
  };
}

// ── HANDLER 5 — getAdsBudgetAnalysis ──

/**
 * Budget utilization (PART 3 Category I, #75-80). Pairs each campaign's
 * dailyBudget (latest Campaign snapshot) with its average daily spend
 * (ProductWiseSponsoredAdsItem total over the window / dayCount), then
 * categorizes utilization. All amounts positive.
 *
 * NOTE: Amazon SP v3 often omits dailyBudget, so many campaigns may have no
 * budget figure — those get status 'no_budget_data' and are excluded from the
 * budget-limited / under-spending buckets. Utilization > 100% is legitimate
 * (Amazon auto-adjusts daily budgets).
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} dateRange
 * @returns {Promise<Object>} { type:'budget_analysis', ... }
 */
async function getAdsBudgetAnalysis(userContext, dateRange) {
  const userIdStr = userContext.userId?.toString() || userContext.userId;

  // a/b) Campaigns + their daily budgets.
  const snapshot = await loadLatestSnapshotDoc(Campaign, userIdStr, userContext.country, userContext.region);
  const campaignData = snapshot?.campaignData || [];

  // c) Spend per campaign over the window (reuses the campaign aggregation).
  const spendRows = await aggregateCampaignMetrics(userContext, dateRange);
  const spendById = new Map(spendRows.map((r) => [String(r.campaignId), r.spend]));
  const nameById = new Map(spendRows.map((r) => [String(r.campaignId), r.name]));
  const dayCount = dateRange.dayCount && dateRange.dayCount > 0
    ? dateRange.dayCount
    : dayCountInclusive(dateRange.startDate, dateRange.endDate);

  const campaigns = campaignData.map((c) => {
    const id = String(c.campaignId);
    const dailyBudget = c.dailyBudget != null ? c.dailyBudget : 0;
    const totalSpend = spendById.get(id) || 0;
    const avgDailySpend = round2(totalSpend / dayCount);
    const utilization = dailyBudget > 0 ? round2((avgDailySpend / dailyBudget) * 100) : 0;
    // d/e) Categorize.
    let status;
    if (dailyBudget <= 0) status = 'no_budget_data';
    else if (utilization > 95) status = 'budget_limited';
    else if (utilization >= 50) status = 'healthy';
    else status = 'under_spending';
    return {
      campaignId: c.campaignId,
      campaignName: c.name || nameById.get(id) || 'Unknown Campaign',
      dailyBudget,
      avgDailySpend,
      utilization,
      status,
    };
  });

  const withBudget = campaigns.filter((c) => c.dailyBudget > 0);
  const totalDailyBudget = round2(campaigns.reduce((s, c) => s + (c.dailyBudget || 0), 0));
  // Sum avg daily spend only for budgeted campaigns so overallUtilization is meaningful.
  const totalAvgDailySpend = round2(withBudget.reduce((s, c) => s + (c.avgDailySpend || 0), 0));
  const overallUtilization = totalDailyBudget > 0 ? round2((totalAvgDailySpend / totalDailyBudget) * 100) : 0;

  return {
    type: 'budget_analysis',
    dateRange,
    totalDailyBudget,
    totalAvgDailySpend,
    overallUtilization,
    campaigns: campaigns.sort((a, b) => (b.utilization || 0) - (a.utilization || 0)),
    budgetLimited: withBudget.filter((c) => c.utilization > 95),
    underSpending: withBudget.filter((c) => c.utilization < 50),
    campaignsWithBudget: withBudget.length,
    total: campaigns.length,
  };
}

// ── HANDLER 6 — getSearchTermAnalysis ──

/**
 * Search-term insights (PART 3 Category F, #51-58). findMergedSearchTermData
 * returns a FLAT array of per-day rows, so we first aggregate by
 * searchTerm + campaign + adGroup (matching the dashboard's grouping) before
 * categorizing. Auto→manual migration candidates come from
 * PPCCampaignAnalysisService.getAutoCampaignInsights (dashboard parity).
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate }} dateRange
 * @param {Object} interpretation
 * @returns {Promise<Object>} { type:'search_term_analysis', ... }
 */
async function getSearchTermAnalysis(userContext, dateRange, interpretation) {
  const userIdStr = userContext.userId?.toString() || userContext.userId;

  // a) Merged per-day rows for the window.
  const rows = await SearchTerms.findMergedSearchTermData(
    userIdStr,
    userContext.country,
    userContext.region,
    { startDate: dateRange.startDate, endDate: dateRange.endDate }
  );

  // Aggregate rows by searchTerm + campaign + adGroup so window-wide thresholds
  // (spend > $5, etc.) and ACOS reflect the full period, not a single day.
  const byKey = new Map();
  for (const r of rows || []) {
    const key = `${r.searchTerm}||${r.campaignId}||${r.adGroupId || r.adGroupName || ''}`;
    const e =
      byKey.get(key) ||
      {
        searchTerm: r.searchTerm,
        keyword: r.keyword,
        campaignName: r.campaignName,
        campaignId: r.campaignId,
        adGroupName: r.adGroupName,
        adGroupId: r.adGroupId,
        sales: 0,
        spend: 0,
        clicks: 0,
        impressions: 0,
      };
    e.sales += r.sales || 0;
    e.spend += r.spend || 0;
    e.clicks += r.clicks || 0;
    e.impressions += r.impressions || 0;
    byKey.set(key, e);
  }
  const terms = Array.from(byKey.values()).map((t) => {
    const sales = round2(t.sales);
    const spend = round2(t.spend);
    return {
      ...t,
      sales,
      spend,
      acos: sales > 0 ? round2((spend / sales) * 100) : 0,
    };
  });

  // b) Categorize.
  const convertingAll = terms.filter((t) => t.sales > 0).sort((a, b) => b.sales - a.sales);
  const wastingAll = terms
    .filter((t) => t.spend > 5 && t.sales < 0.01)
    .sort((a, b) => b.spend - a.spend);
  const highPotentialAll = terms
    .filter((t) => t.clicks > 20 && t.sales > 0 && t.acos < 30)
    .sort((a, b) => b.sales - a.sales);
  const toNegativeAll = terms
    .filter((t) => t.spend > 5 && t.sales < 0.01 && t.clicks >= 5)
    .sort((a, b) => b.spend - a.spend);

  const withRec = (arr, recommendation) =>
    arr.map((t) => ({
      searchTerm: t.searchTerm,
      keyword: t.keyword,
      campaignName: t.campaignName,
      campaignId: t.campaignId,
      adGroupName: t.adGroupName,
      adGroupId: t.adGroupId,
      sales: t.sales,
      spend: t.spend,
      clicks: t.clicks,
      impressions: t.impressions,
      acos: t.acos,
      recommendation,
    }));

  // c) Auto→manual migration candidates (dashboard service).
  let autoInsights = { data: [], pagination: { totalItems: 0 } };
  try {
    autoInsights = await PPCCampaignAnalysisService.getAutoCampaignInsights(
      userContext.userId, userContext.country, userContext.region, 1, 20, dateRange.startDate, dateRange.endDate
    );
  } catch (err) {
    logger.warn('[AdsEngine] getAutoCampaignInsights failed; autoToManual empty', { message: err.message });
  }

  return {
    type: 'search_term_analysis',
    dateRange,
    converting: {
      terms: withRec(convertingAll.slice(0, 20), 'Consider adding as exact match keyword'),
      total: convertingAll.length,
    },
    wasting: {
      terms: withRec(wastingAll.slice(0, 20), 'Consider adding as negative keyword'),
      total: wastingAll.length,
      totalWastedSpend: round2(wastingAll.reduce((s, t) => s + t.spend, 0)),
    },
    highPotential: {
      terms: withRec(highPotentialAll.slice(0, 10), 'High-converting — promote to exact match'),
      total: highPotentialAll.length,
    },
    toNegative: {
      terms: withRec(toNegativeAll.slice(0, 20), 'Add as negative keyword'),
      total: toNegativeAll.length,
    },
    autoToManual: {
      terms: autoInsights?.data || [],
      total: autoInsights?.pagination?.totalItems || 0,
    },
  };
}

// ── HANDLER 7 — getOrganicVsPaidSplit ──

/**
 * Organic vs paid sales split (PART 3 Category J, #81-85). Uses the canonical
 * KPIs (ppcSales, totalSales) so the numbers match the dashboard.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} dateRange
 * @returns {Promise<Object>} { type:'organic_vs_paid', ... }
 */
async function getOrganicVsPaidSplit(userContext, dateRange) {
  const kpis = await resolveKPIs(userContext, dateRange);

  const ppcSales = round2(kpis.ppcSales);
  const totalSales = round2(kpis.totalSales);
  const ppcSpend = round2(kpis.ppcSpend);
  const organicSales = round2(Math.max(0, totalSales - ppcSales));

  const ppcPercent = totalSales > 0 ? round2((ppcSales / totalSales) * 100) : 0;
  const organicPercent = totalSales > 0 ? round2(100 - ppcPercent) : 0;

  const dependencyLevel =
    ppcPercent > 60 ? 'high_dependency' : ppcPercent >= 30 ? 'balanced' : 'organic_dominant';

  return {
    type: 'organic_vs_paid',
    dateRange,
    ppcSales,
    organicSales,
    totalSales,
    ppcPercent,
    organicPercent,
    dependencyLevel,
    ppcSpend,
    effectiveROAS: ppcSpend > 0 ? round2(ppcSales / ppcSpend) : 0,
  };
}

// ── HANDLER 8 — getAsinAdsPerformance ──

/**
 * Per-ASIN ad performance (PART 3 Category K, #86-93). Aggregates
 * ProductWiseSponsoredAdsItem for one ASIN over the window (overall + a
 * per-campaign breakdown). All amounts positive.
 *
 * @param {string} asin
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate }} dateRange
 * @returns {Promise<Object>} { type:'asin_ads', ... }
 */
async function getAsinAdsPerformance(asin, userContext, dateRange) {
  if (!asin) {
    return { type: 'asin_ads', dateRange, asin: null, notFound: true, metrics: null, campaignBreakdown: [] };
  }

  // ProductWiseSponsoredAdsItem.userId is an ObjectId; date is a STRING.
  const userIdObj = mongoose.Types.ObjectId.isValid(userContext.userId)
    ? new mongoose.Types.ObjectId(userContext.userId)
    : userContext.userId;
  const match = {
    userId: userIdObj,
    country: userContext.country,
    region: userContext.region,
    date: { $gte: dateRange.startDate, $lte: dateRange.endDate },
    asin: String(asin).toUpperCase(),
  };

  // a/c) Overall + per-campaign aggregation in one pass.
  const [overallRows, campaignRows] = await Promise.all([
    ProductWiseSponsoredAdsItem.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          spend: { $sum: { $ifNull: ['$spend', 0] } },
          sales: { $sum: { $ifNull: ['$sales', { $ifNull: ['$salesIn30Days', 0] }] } },
          clicks: { $sum: { $ifNull: ['$clicks', 0] } },
          impressions: { $sum: { $ifNull: ['$impressions', 0] } },
          units: { $sum: { $ifNull: ['$unitsSoldClicks', 0] } },
        },
      },
    ]),
    ProductWiseSponsoredAdsItem.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$campaignId',
          campaignName: { $first: '$campaignName' },
          spend: { $sum: { $ifNull: ['$spend', 0] } },
          sales: { $sum: { $ifNull: ['$sales', { $ifNull: ['$salesIn30Days', 0] }] } },
          clicks: { $sum: { $ifNull: ['$clicks', 0] } },
          impressions: { $sum: { $ifNull: ['$impressions', 0] } },
        },
      },
      { $sort: { spend: -1 } },
    ]),
  ]);

  const agg = overallRows[0] || { spend: 0, sales: 0, clicks: 0, impressions: 0, units: 0 };
  const spend = round2(agg.spend);
  const sales = round2(agg.sales);
  const acos = sales > 0 ? round2((spend / sales) * 100) : 0;

  const campaignBreakdown = campaignRows.map((c) => {
    const cSpend = round2(c.spend);
    const cSales = round2(c.sales);
    return {
      campaignId: c._id,
      campaignName: c.campaignName || 'Unknown Campaign',
      spend: cSpend,
      sales: cSales,
      acos: cSales > 0 ? round2((cSpend / cSales) * 100) : 0,
      roas: cSpend > 0 ? round2(cSales / cSpend) : 0,
    };
  });

  return {
    type: 'asin_ads',
    dateRange,
    asin: String(asin).toUpperCase(),
    notFound: overallRows.length === 0,
    metrics: {
      spend,
      sales,
      acos,
      roas: spend > 0 ? round2(sales / spend) : 0,
      impressions: agg.impressions || 0,
      clicks: agg.clicks || 0,
      ctr: agg.impressions > 0 ? round2((agg.clicks / agg.impressions) * 100) : 0,
      cpc: agg.clicks > 0 ? round2(spend / agg.clicks) : 0,
      units: Math.round(agg.units || 0),
    },
    campaignBreakdown,
    // Spec formula (acos<20 EFFICIENT / <40 MODERATE / else NEEDS_ATTENTION),
    // but spend-with-no-sales (acos 0) is wasteful, not efficient.
    healthIndicator:
      spend > 0 && sales < 0.01
        ? 'NEEDS_ATTENTION'
        : acos < 20
        ? 'EFFICIENT'
        : acos < 40
        ? 'MODERATE'
        : 'NEEDS_ATTENTION',
  };
}

// ── HANDLER 9 — getAdsComparison ──

/**
 * Period-over-period ads comparison (PART 3 Category G, #59-66). The previous
 * period is the same-length window immediately preceding the current one,
 * anchored off currentDateRange.startDate. Both periods are computed via the
 * canonical resolveKPIs (dashboard parity). All amounts positive.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} currentDateRange
 * @returns {Promise<Object>} { type:'ads_comparison', ... }
 */
async function getAdsComparison(userContext, currentDateRange) {
  const dayCount = currentDateRange.dayCount && currentDateRange.dayCount > 0
    ? currentDateRange.dayCount
    : dayCountInclusive(currentDateRange.startDate, currentDateRange.endDate);

  // a) Previous window = the dayCount days immediately before the current start.
  const prevEndDate = subtractDaysYmd(currentDateRange.startDate, 1);
  const prevStartDate = subtractDaysYmd(prevEndDate, dayCount - 1);
  const previousPeriod = { startDate: prevStartDate, endDate: prevEndDate, dayCount };

  // b) Both periods in parallel.
  const [currentKPIs, prevKPIs] = await Promise.all([
    resolveKPIs(userContext, currentDateRange),
    resolveKPIs(userContext, previousPeriod),
  ]);

  // c/d) Deltas for every comparable metric.
  const deltas = {};
  for (const key of ['ppcSales', 'ppcSpend', 'acos', 'tacos', 'roas', 'impressions', 'clicks', 'ctr', 'cpc', 'unitsSold', 'orders']) {
    const cur = Number(currentKPIs[key] || 0);
    const prev = Number(prevKPIs[key] || 0);
    deltas[key] = {
      current: round2(cur),
      previous: round2(prev),
      change: round2(cur - prev),
      changePct: prev > 0 ? round2(((cur - prev) / prev) * 100) : 0,
    };
  }

  // e) Direction map — which way is "good" for each metric.
  const metricDirection = {
    ppcSales: 'higher_is_better', ppcSpend: 'lower_is_better',
    acos: 'lower_is_better', tacos: 'lower_is_better', roas: 'higher_is_better',
    impressions: 'higher_is_better', clicks: 'higher_is_better',
    ctr: 'higher_is_better', cpc: 'lower_is_better',
    unitsSold: 'higher_is_better', orders: 'higher_is_better',
  };

  return {
    type: 'ads_comparison',
    currentPeriod: currentDateRange,
    previousPeriod,
    currentKPIs,
    prevKPIs,
    deltas,
    metricDirection,
    overallDirection: deltas.roas.change > 0 ? 'improving' : deltas.roas.change < 0 ? 'declining' : 'flat',
  };
}

// ── HANDLER 10 — getAdsWhyAnalysis ──

/** Rank severity for sorting (high first). */
const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Diagnostic "why" analysis (PART 3 Category H, #67-74). It CALLS
 * getAdsComparison and derives DATA-GROUNDED insights — every insight references
 * real numbers from the comparison deltas (no LLM invention). It then attaches
 * the concrete contributors (wasted keywords, high-ACOS campaigns) and builds
 * template-based actionableItems that name specific campaigns/keywords + numbers.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} dateRange
 * @returns {Promise<Object>} { type:'ads_why_analysis', ... }
 */
async function getAdsWhyAnalysis(userContext, dateRange) {
  // a) Period comparison (the evidence base).
  const comparison = await getAdsComparison(userContext, dateRange);
  const d = comparison.deltas;
  const insights = [];

  // b) Data-grounded insights. Each references actual delta numbers.

  // ACOS increased > 5 percentage points (absolute change in ACOS points).
  if (d.acos.change > 5) {
    insights.push({
      type: 'acos_increase',
      severity: d.acos.change > 10 ? 'high' : 'medium',
      data: { from: d.acos.previous, to: d.acos.current, changePoints: d.acos.change },
      message: `ACOS increased from ${d.acos.previous}% to ${d.acos.current}% (+${d.acos.change} pts)`,
    });
  }

  // Spend up > 20% but sales grew less than spend → efficiency drop.
  if (d.ppcSpend.changePct > 20 && d.ppcSales.changePct < d.ppcSpend.changePct) {
    insights.push({
      type: 'spend_efficiency_drop',
      severity: d.ppcSales.changePct <= 0 ? 'high' : 'medium',
      data: { spendChangePct: d.ppcSpend.changePct, salesChangePct: d.ppcSales.changePct, spendFrom: d.ppcSpend.previous, spendTo: d.ppcSpend.current },
      message: `Ad spend rose ${d.ppcSpend.changePct}% ($${d.ppcSpend.previous} → $${d.ppcSpend.current}) while PPC sales changed only ${d.ppcSales.changePct}% — spend is outpacing returns`,
    });
  }

  // CTR dropped > 15%.
  if (d.ctr.changePct < -15) {
    insights.push({
      type: 'ctr_decline',
      severity: d.ctr.changePct < -30 ? 'high' : 'medium',
      data: { from: d.ctr.previous, to: d.ctr.current, changePct: d.ctr.changePct },
      message: `CTR dropped ${Math.abs(d.ctr.changePct)}% (${d.ctr.previous}% → ${d.ctr.current}%) — ads may be less relevant or competition increased`,
    });
  }

  // CPC increased > 20%.
  if (d.cpc.changePct > 20) {
    insights.push({
      type: 'cpc_increase',
      severity: d.cpc.changePct > 40 ? 'high' : 'medium',
      data: { from: d.cpc.previous, to: d.cpc.current, changePct: d.cpc.changePct },
      message: `Cost per click is up ${d.cpc.changePct}% ($${d.cpc.previous} → $${d.cpc.current}) — bid competition may have increased`,
    });
  }

  // Impressions dropped > 20%.
  if (d.impressions.changePct < -20) {
    insights.push({
      type: 'impression_decline',
      severity: d.impressions.changePct < -40 ? 'high' : 'medium',
      data: { from: d.impressions.previous, to: d.impressions.current, changePct: d.impressions.changePct },
      message: `Impressions down ${Math.abs(d.impressions.changePct)}% — check if budgets are being exhausted or keywords are losing rank`,
    });
  }

  // Conversion rate (orders / clicks) dropped. Not in deltas, so derive it.
  const curCvr = round2(comparison.currentKPIs.conversionRate || 0);
  const prevCvr = round2(comparison.prevKPIs.conversionRate || 0);
  if (prevCvr > 0 && curCvr < prevCvr) {
    const cvrChangePct = round2(((curCvr - prevCvr) / prevCvr) * 100);
    insights.push({
      type: 'conversion_decline',
      severity: cvrChangePct < -25 ? 'high' : 'medium',
      data: { from: prevCvr, to: curCvr, changePct: cvrChangePct },
      message: `Conversion rate fell from ${prevCvr}% to ${curCvr}% — clicks are converting to orders less often`,
    });
  }

  insights.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));

  // c/d) Concrete contributors (real keywords/campaigns), for the same window.
  let wastedContributors = [];
  let highAcosContributors = [];
  try {
    const [wasted, highAcos] = await Promise.all([
      PPCCampaignAnalysisService.getWastedSpendKeywords(
        userContext.userId, userContext.country, userContext.region, 1, 5, dateRange.startDate, dateRange.endDate
      ),
      PPCCampaignAnalysisService.getHighAcosCampaigns(
        userContext.userId, userContext.country, userContext.region, 1, 5, dateRange.startDate, dateRange.endDate
      ),
    ]);
    wastedContributors = wasted?.data || [];
    highAcosContributors = highAcos?.data || [];
  } catch (err) {
    logger.warn('[AdsEngine] why-analysis contributor lookup failed', { message: err.message });
  }

  // e) Template-based actionable items referencing real numbers.
  const actionableItems = [];
  if (wastedContributors.length > 0) {
    const wastedTotal = round2(wastedContributors.reduce((s, k) => s + (k.spend || 0), 0));
    actionableItems.push(
      `Review the ${wastedContributors.length} keyword${wastedContributors.length === 1 ? '' : 's'} wasting $${wastedTotal} with no sales — consider pausing them`
    );
  }
  for (const c of highAcosContributors.slice(0, 2)) {
    actionableItems.push(
      `Campaign "${c.campaignName || c.campaignId}" has ACOS of ${c.acos}% — reduce bids or pause underperforming ad groups`
    );
  }
  // Insight-specific actions.
  for (const ins of insights) {
    if (ins.type === 'cpc_increase') actionableItems.push(`CPC rose ${ins.data.changePct}% — tighten bids on low-converting keywords and add negatives to cut wasted clicks`);
    else if (ins.type === 'impression_decline') actionableItems.push(`Impressions fell ${Math.abs(ins.data.changePct)}% — verify campaign budgets aren't capping out and check keyword rank/bids`);
    else if (ins.type === 'conversion_decline') actionableItems.push(`Conversion rate dropped to ${ins.data.to}% — review listing content, price, and search-term relevance`);
    else if (ins.type === 'spend_efficiency_drop') actionableItems.push(`Spend grew ${ins.data.spendChangePct}% but sales only ${ins.data.salesChangePct}% — cap or rebalance budget toward your best-ROAS campaigns`);
  }

  return {
    type: 'ads_why_analysis',
    dateRange,
    comparison,
    insights,
    wastedContributors,
    highAcosContributors,
    actionableItems,
  };
}

// ── HANDLER 11 — getAdsTimeSeries ──

// Every per-day ads field getPPCKPISummary's timeseries exposes, with a label
// for the chart. The handler picks which of these to plot from the prompt.
const ADS_TS_FIELDS = {
  sales: { label: 'PPC Sales', match: /\bppc sales\b|\bsales\b|revenue/ },
  spend: { label: 'Ad Spend', match: /\bspend\b|ad spend|\bcost\b/ },
  impressions: { label: 'Impressions', match: /\bimpressions?\b|\bimpr\b/ },
  clicks: { label: 'Clicks', match: /\bclicks?\b/ },
  unitsSold: { label: 'Units Sold', match: /\bunits?\b|units sold|\bsold\b/ },
  acos: { label: 'ACOS %', match: /\bacos\b/ },
  ctr: { label: 'CTR %', match: /\bctr\b|click.?through/ },
  cpc: { label: 'CPC', match: /\bcpc\b|cost per click/ },
  roas: { label: 'ROAS', match: /\broas\b/ },
};

/**
 * Pick which ads daily fields the user asked to plot. Returns the matched field
 * keys in a stable order; falls back to the canonical Sales-vs-Spend pair when
 * the prompt names no specific metric.
 */
function selectAdsTimeSeriesFields(interpretation) {
  const prompt = extractPromptText(interpretation).toLowerCase();
  const order = ['sales', 'spend', 'impressions', 'clicks', 'unitsSold', 'acos', 'ctr', 'cpc', 'roas'];
  const picked = order.filter((k) => ADS_TS_FIELDS[k].match.test(prompt));
  return picked.length ? picked : ['sales', 'spend'];
}

/**
 * Ads trend over time (PART 3 Category L, #94-100). Uses the daily timeseries
 * already returned by getPPCKPISummary (via resolveKPIs) — no extra query.
 * METRIC-AWARE: plots whichever ads fields the user named (impressions, clicks,
 * ctr, cpc, acos, roas, spend, sales, units), defaulting to Sales vs Spend.
 * Trend / peak / lowest are computed on the first selected field.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, dayCount }} dateRange
 * @param {Object} [interpretation] - used to pick which metric(s) to plot
 * @returns {Promise<Object>} { type:'ads_time_series', ... }
 */
async function getAdsTimeSeries(userContext, dateRange, interpretation) {
  const kpis = await resolveKPIs(userContext, dateRange);
  const dataPoints = Array.isArray(kpis.timeseries) ? kpis.timeseries : [];

  const fields = selectAdsTimeSeriesFields(interpretation);
  const metric = fields[0]; // trend/peak computed on the primary requested field

  // First-half vs second-half average of the primary metric.
  const avg = (arr) => (arr.length ? round2(arr.reduce((s, p) => s + (p[metric] || 0), 0) / arr.length) : 0);
  const mid = Math.floor(dataPoints.length / 2);
  const firstHalfAvg = avg(dataPoints.slice(0, mid));
  const secondHalfAvg = avg(dataPoints.slice(mid));
  const changePct = firstHalfAvg > 0 ? round2(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100) : 0;
  const direction = changePct > 5 ? 'increasing' : changePct < -5 ? 'decreasing' : 'stable';

  // Peak and lowest days by the primary metric.
  let peakDay = null;
  let lowestDay = null;
  for (const p of dataPoints) {
    const v = p[metric] || 0;
    if (!peakDay || v > peakDay.value) peakDay = { date: p.date, value: round2(v), metric };
    if (!lowestDay || v < lowestDay.value) lowestDay = { date: p.date, value: round2(v), metric };
  }

  const yFields = fields.map((k) => ({ field: k, label: ADS_TS_FIELDS[k].label }));
  const title = `${yFields.map((y) => y.label).join(' vs ')} Over Time`;

  return {
    type: 'ads_time_series',
    dateRange,
    metric,
    metrics: fields,
    dataPoints,
    trend: { direction, metric, firstHalfAvg, secondHalfAvg, changePct },
    peakDay,
    lowestDay,
    charts: [
      {
        type: 'line',
        title,
        data: dataPoints,
        xField: 'date',
        yFields,
      },
    ],
  };
}

// ── HANDLER 12 — getKeywordDeepDive ──

/** Add derived ad metrics (acos/roas/ctr/cpc) to a {spend,sales,impressions,clicks} bucket. */
function withDerivedAdMetrics(m) {
  const spend = round2(m.spend);
  const sales = round2(m.sales);
  return {
    spend,
    sales,
    impressions: m.impressions || 0,
    clicks: m.clicks || 0,
    acos: sales > 0 ? round2((spend / sales) * 100) : 0,
    roas: spend > 0 ? round2(sales / spend) : 0,
    ctr: m.impressions > 0 ? round2((m.clicks / m.impressions) * 100) : 0,
    cpc: m.clicks > 0 ? round2(spend / m.clicks) : 0,
  };
}

/**
 * Single-keyword deep dive (PART 1 Problem 10; Category E, #44/#45). Merges the
 * keyword's rows across all daily docs, then breaks performance down by match
 * type and by campaign.
 *
 * Field note: adsKeywordsPerformance.keywordsData[].attributedSales30d actually
 * holds 7-day attribution data — we surface it as `sales` so the narrator never
 * says "30-day". The collection has no purchase/order count, so a true
 * conversion rate isn't derivable (conversionRate = null).
 *
 * @param {string} keywordText
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate }} dateRange
 * @returns {Promise<Object>} { type:'keyword_deep_dive', ... }
 */
async function getKeywordDeepDive(keywordText, userContext, dateRange) {
  if (!keywordText || !String(keywordText).trim()) {
    return { type: 'keyword_deep_dive', dateRange, keyword: keywordText || null, notFound: true };
  }
  const needle = String(keywordText).trim().toLowerCase();

  // a) Merge keyword rows across all daily docs for the window.
  const rows = await adsKeywordsPerformance.findMergedKeywordsData(
    userContext.userId,
    userContext.country,
    userContext.region,
    { startDate: dateRange.startDate, endDate: dateRange.endDate }
  );

  // Case-insensitive partial match on the keyword text.
  const matched = (rows || []).filter((r) => (r.keyword || '').toLowerCase().includes(needle));

  if (matched.length === 0) {
    return { type: 'keyword_deep_dive', dateRange, keyword: keywordText, notFound: true };
  }

  // b) Aggregate across days. (attributedSales30d → sales; 7-day attribution.)
  const total = { spend: 0, sales: 0, impressions: 0, clicks: 0 };
  // c) By match type, and (d) by campaign+matchType.
  const matchTypeAgg = new Map();
  const campaignAgg = new Map();
  for (const r of matched) {
    const spend = r.cost || 0;
    const sales = r.attributedSales30d || 0;
    const clicks = r.clicks || 0;
    const impressions = r.impressions || 0;

    total.spend += spend;
    total.sales += sales;
    total.clicks += clicks;
    total.impressions += impressions;

    const mt = (r.matchType || 'UNKNOWN').toUpperCase();
    const mte = matchTypeAgg.get(mt) || { spend: 0, sales: 0, impressions: 0, clicks: 0 };
    mte.spend += spend; mte.sales += sales; mte.clicks += clicks; mte.impressions += impressions;
    matchTypeAgg.set(mt, mte);

    const cName = r.campaignName || 'Unknown Campaign';
    const cKey = `${cName}||${mt}`;
    const ce = campaignAgg.get(cKey) || { campaignName: cName, matchType: mt, spend: 0, sales: 0, impressions: 0, clicks: 0 };
    ce.spend += spend; ce.sales += sales; ce.clicks += clicks; ce.impressions += impressions;
    campaignAgg.set(cKey, ce);
  }

  // e) Compute aggregated metrics.
  const aggBase = withDerivedAdMetrics(total);
  const aggregated = {
    spend: aggBase.spend,
    sales: aggBase.sales,
    acos: aggBase.acos,
    roas: aggBase.roas,
    impressions: aggBase.impressions,
    clicks: aggBase.clicks,
    ctr: aggBase.ctr,
    cpc: aggBase.cpc,
    conversionRate: null, // no purchase/order count in this collection
  };

  const byMatchType = {};
  for (const [mt, m] of matchTypeAgg.entries()) byMatchType[mt] = withDerivedAdMetrics(m);

  const byCampaign = Array.from(campaignAgg.values())
    .map((c) => {
      const d = withDerivedAdMetrics(c);
      return { campaignName: c.campaignName, matchType: c.matchType, spend: d.spend, sales: d.sales, acos: d.acos };
    })
    .sort((a, b) => b.spend - a.spend);

  // f) ACOS-based recommendation (spend-with-no-sales → review).
  const recommendation =
    aggregated.spend > 0 && aggregated.sales < 0.01
      ? 'review'
      : aggregated.acos > 0 && aggregated.acos < 20
      ? 'scale'
      : aggregated.acos <= 40
      ? 'optimize'
      : 'review';

  return {
    type: 'keyword_deep_dive',
    dateRange,
    keyword: keywordText,
    matchedCount: matched.length,
    aggregated,
    byMatchType,
    byCampaign,
    recommendation,
  };
}

// ── Ads Query Classifier ──

/**
 * Classify a question into an ads sub-handler queryType. FIRST MATCH WINS.
 *
 * Returns exactly one of these 14 values:
 *   'asin_ads', 'keyword_deep_dive', 'campaign_type_breakdown', 'budget_analysis',
 *   'search_term_analysis', 'organic_vs_paid', 'campaign_performance',
 *   'ads_why_analysis', 'ads_time_series', 'ads_comparison', 'wasted_spend',
 *   'top_performers', 'ads_summary', 'not_ads_engine'
 * ('not_ads_engine' signals layers/index.js to skip the AdsEngine and use the
 * normal pipeline — it's both the post-action short-circuit and the default.)
 *
 * PRIORITY ORDER (as implemented — each rule short-circuits):
 *   1.  Post-action intent (pause/negative)        → not_ads_engine
 *   2.  Keyword entity (quoted keyword)            → keyword_deep_dive
 *   3.  ASIN + ads term                            → asin_ads
 *   4.  SP/SB/SD or "ad type" breakdown            → campaign_type_breakdown
 *   5.  Budget patterns                            → budget_analysis
 *   6.  Search-term patterns                       → search_term_analysis
 *   7.  Organic-vs-paid patterns                   → organic_vs_paid
 *   8.  Campaign entity / which-campaign ranking   → campaign_performance
 *   9.  Keyword phrasing (no entity)               → keyword_deep_dive
 *   10. Why / diagnostic patterns                  → ads_why_analysis
 *   11. Trend / chart / over-time patterns         → ads_time_series
 *   12. Comparison patterns                        → ads_comparison
 *   13. Wasted / bleeding patterns                 → wasted_spend
 *   14. Top / best patterns                        → top_performers
 *   15. Specific metric (acos/roas/tacos/ctr/cpc)  → ads_summary
 *   16. General ads keyword (ppc/ads/campaign)     → ads_summary
 *   17. Default                                    → not_ads_engine
 *
 * NOTE ON ORDER — this intentionally DIFFERS from the architecture doc's literal
 * numbering, which places comparison and the generic campaign branch ahead of
 * the more-specific breakdown/budget/organic/time-series branches. That literal
 * order misroutes (all verified): "compare SP vs SB vs SD" → comparison instead
 * of campaign_type_breakdown; "which campaigns are budget-limited" →
 * campaign_performance instead of budget_analysis; "organic vs paid split" →
 * comparison instead of organic_vs_paid; "daily sales vs spend" → comparison
 * instead of ads_time_series. The more-specific rules are therefore evaluated
 * first. Entity-driven rules (keyword, ASIN) win earliest because an explicit
 * entity is the strongest signal.
 *
 * Inline test cases (input → expected; verified):
 *   "pause my worst keywords" (intent=post_action)        → not_ads_engine
 *   "how is keyword 'running shoes' performing"           → keyword_deep_dive
 *   "which match type works best for 'organic protein'"   → keyword_deep_dive
 *   "what's the acos for B0ABC12345"                      → asin_ads
 *   "how much am I spending on ads for B0ABC12345"        → asin_ads
 *   "compare SP vs SB vs SD performance"                  → campaign_type_breakdown
 *   "how much am I spending on Sponsored Products"        → campaign_type_breakdown
 *   "which ad type has the best roas"                     → campaign_type_breakdown
 *   "which campaigns are budget-limited"                  → budget_analysis
 *   "what is my total daily budget across campaigns"      → budget_analysis
 *   "what are customers searching for"                    → search_term_analysis
 *   "show me auto campaign insights"                      → search_term_analysis
 *   "what percentage of sales come from ads"              → organic_vs_paid
 *   "am I too dependent on PPC"                           → organic_vs_paid
 *   "which campaign spends the most"                      → campaign_performance
 *   "show me my auto campaign performance"                → campaign_performance
 *   "why is my acos so high"                              → ads_why_analysis
 *   "show me my ad spend trend"                           → ads_time_series
 *   "is my cpc increasing over time"                      → ads_time_series
 *   "compare this week to last week"                      → ads_comparison
 *   "are my clicks increasing"                            → ads_comparison
 *   "show me my wasted keywords"                          → wasted_spend
 *   "what are my top performing keywords"                 → top_performers
 *   "what is my acos"                                     → ads_summary
 *   "what is my profit"                                   → not_ads_engine
 *   "tell me a joke"                                      → not_ads_engine
 *
 * @param {Object} interpretation - interpretPrompt() output (or layer contract)
 * @returns {string} an ads queryType, or 'not_ads_engine'
 */
function classifyAdsQueryType(interpretation) {
  const prompt = extractPromptText(interpretation).toLowerCase();
  const metrics = (interpretation?.entities?.metrics || []).join(' ').toLowerCase();
  const hasAsin = (interpretation?.entities?.asins || []).length > 0;
  const hasCampaign = interpretation?.entities?.campaign != null;
  const intent = interpretation?.intent;

  // Post-action (pause/negative/disable) → handled by PostOperationService, not
  // AdsEngine. Guard on BOTH the intent AND the extracted queryShape ('action',
  // set by EntityExtractor for pause/negative/disable/block/stop-bidding), so a
  // mislabeled intent can never leak a mutation into the read-only ads engine.
  if (intent === 'post_action' || intent === 'implementation_request') return 'not_ads_engine';
  if (interpretation?.entities?.queryShape === 'action') return 'not_ads_engine';

  // Strategy / how-to questions route to the multi-domain Suggestion Engine
  // (which injects accurate AdsEngine numbers via buildFinanceSuggestionContext
  // and the ads context), NOT the deterministic read-only ads engine. Gated on
  // the interpreter's suggestion routing so a plain lookup (e.g. "should I
  // increase my budgets" → budget_analysis) is never hijacked. (Category N.)
  if (
    interpretation?.routing?.engine === 'suggestion_engine' &&
    /how (can|do|should) (i|we)|how to|what (should|can) (i|we)|should (i|we)|suggest|recommend|improve|optimi[sz]e|\breduce\b|strateg|advice|\bscale\b|biggest.*problem|what changes/i.test(prompt)
  ) {
    return 'not_ads_engine';
  }

  // ── Ads-context gate ──
  // QMate rule: a query that does NOT mention advertising defaults to Finance.
  // The (read-only) AdsEngine runs BEFORE the FinanceEngine, and several branches
  // below match GENERIC cues that also apply to finance — time-series ("datewise",
  // "daily", "trend"), comparison ("vs", "improving"), and "why". Without this
  // gate, a pure-finance question like "sales and profit datewise" or "why did my
  // sales drop" gets hijacked by the ads engine. So only proceed when the query
  // has real ads context: an ads metric/term in the prompt or extracted metrics,
  // or an ads entity (campaign / keyword). Otherwise → not_ads_engine (Finance).
  // NOTE: "negatives" (plural noun = negative keywords) is ads; "negative"
  // (singular, as in "negative profit/margin") is NOT — so match \bnegatives\b
  // only. Search-term phrasings ("customers searching", "searching for") are ads.
  const ADS_CONTEXT_RE = /\bppc\b|\bacos\b|\btacos\b|\broas\b|\bads?\b|advertis|ad[\s-]?spend|sponsored|\bsp\b|\bsb\b|\bsd\b|campaign|keyword|customers?\s+search|searching|search[\s-]?term|search[\s-]?quer|impression|\bctr\b|\bcpc\b|\bclicks?\b|\borganic\b|negative[\s-]?keyword|\bnegatives\b|\bbudgets?\b/i;
  const hasAdsContext =
    ADS_CONTEXT_RE.test(prompt) ||
    ADS_CONTEXT_RE.test(metrics) ||
    !!interpretation?.entities?.keywordText ||
    interpretation?.entities?.campaign != null ||
    interpretation?.entities?.campaignType != null;
  if (!hasAdsContext) return 'not_ads_engine';

  // Explicit keyword deep dive — a quoted keyword entity always wins (Category
  // E, #44/#45). Checked early so it isn't shadowed by the campaign/top branches.
  if (interpretation?.entities?.keywordText) return 'keyword_deep_dive';

  // ASIN-specific ads question (Category K, #86-93). Check the prompt too —
  // the metric entity is often empty for "spending on ads for B0…". Uses
  // ad-only terms so a finance ASIN question ("profit/sales for B0…") is left
  // to the FinanceEngine, which runs before the AdsEngine.
  if (
    hasAsin &&
    (metrics.match(/ppc|acos|roas|ad|spend|keyword|campaign|sponsored/) ||
      prompt.match(/\bppc\b|\bacos\b|\broas\b|\btacos\b|\bads?\b|ad\s*spend|sponsored|keyword|campaign|impression|\bctr\b|\bcpc\b/i))
  ) {
    return 'asin_ads';
  }

  // Campaign TYPE breakdown — SP vs SB vs SD (Category D, #35-40). Checked
  // early: it's more specific than comparison/top-performers/campaign ranking,
  // which would otherwise steal "compare SP vs SB", "which ad type has best
  // ROAS", "% of spend by ad type".
  if (prompt.match(/sponsored\s*(products?|brands?|display)|\bsp\s+vs|\bsb\s+vs|\bsd\s+vs|\bad\s+types?\b|\bcampaign\s+types?\b|by\s+(ad\s+)?type|each\s+(ad\s+)?type|breakdown.*type|type.*breakdown/i)) {
    return 'campaign_type_breakdown';
  }

  // Budget analysis (Category I, #75-80). Checked before the campaign branch so
  // "which campaigns are budget-limited / underspending" reach the budget
  // handler instead of the generic campaign ranking.
  if (prompt.match(/\bbudgets?\b|budget utiliz|running out|over.?spend|under.?spend(ing)?/i)) {
    return 'budget_analysis';
  }

  // Search-term analysis (Category F, #51-58). Checked before the campaign
  // branch so "auto campaign insights" / "search terms to manual" aren't stolen
  // by the campaign ranking. search_term_analysis is the dedicated home for all
  // search-term questions (it splits converting / wasting / to-negative /
  // high-potential / auto→manual), so zero-sales/wasting SEARCH TERMS land here
  // too — the wasted_spend handler is for wasted KEYWORDS.
  if (prompt.match(/search\s*term|customer.*search|what.*people.*search|converting.*term|search.*query|auto\s+campaign\s+insight/i)) {
    return 'search_term_analysis';
  }

  // Organic vs paid (Category J, #81-85). Checked before comparison so
  // "organic vs paid" / "organic ranking improving" aren't stolen by the
  // vs/improv comparison patterns.
  if (prompt.match(/\borganic\b|paid.*organic|sales.*from.*ads|dependent.*ppc|ppc.*dependenc|ad.*attributed|without ads|revenue.*lose|lose.*without/i)) {
    return 'organic_vs_paid';
  }

  // Campaign-specific question (Category C, #24-34): an explicit campaign
  // entity, a quoted/ID/named campaign, an auto/manual filter, or a
  // which/list/how-many campaign ranking. Placed before top_performers so
  // "which campaign spends the most / worst ACOS" gets the richer
  // campaign-level handler (with targetingType + dailyBudget).
  // A waste/bleed cue means the user wants the wasted-spend view (which has a
  // per-campaign worst-offenders list), even when phrased "which campaigns…".
  const isWastePhrasing = /wasted|wasting|\bwaste\b|bleed/i.test(prompt);
  if (
    hasCampaign ||
    prompt.match(/campaign\s+['"]|campaign\s+(id|called|named)|my\s+(auto|manual)\s+campaign/i) ||
    (!isWastePhrasing &&
      (prompt.match(/\bwhich\s+campaigns?\b/i) ||
        prompt.match(/\b(list|show)\b.*\bcampaigns?\b/i) ||
        prompt.match(/\bhow many\b.*\bcampaigns?\b/i) ||
        prompt.match(/\bcampaigns?\b.*\bneeds?\s+attention\b/i)))
  ) {
    return 'campaign_performance';
  }

  // Keyword deep dive.
  if (prompt.match(/keyword\s+['"]|how is.*(keyword|term)\b.*performing|everything about.*(keyword|term)/i)) return 'keyword_deep_dive';

  // Why/diagnostic.
  if (prompt.match(/^why\b|what.*wrong.*ppc|why.*acos.*(high|increas)|why.*roas.*(low|decreas)|why.*spend.*(high|increas)/)) return 'ads_why_analysis';

  // "average/avg daily …" is a SCALAR KPI (avgDailySpend), not a trend — claim
  // it for ads_summary before the time-series branch sees the word "daily".
  if (/\b(average|avg)\s+daily\b/.test(prompt)) return 'ads_summary';

  // Trend / time series (Category L). Checked BEFORE comparison so a question
  // with explicit time-series cues ("daily", "over time", "graph") isn't stolen
  // by the comparison branch's "vs"/"increasing" patterns. Peak-day questions
  // ("when do I…", "what day…") are time-series too (peakDay analysis).
  if (prompt.match(/trend|over time|graph|chart|daily|weekly|day.?by.?day|date.?wise|day.?wise|per day|each day|by date|by day|over the (last|past)|what day|peak day|when (do|did|is|are|am)\b/)) return 'ads_time_series';

  // Comparison (Category G, #59-66). Includes "more … than before" and bare
  // "increasing/decreasing" (period-over-period) — but only AFTER the
  // time-series check above has claimed the "over time" phrasings.
  if (prompt.match(/compar|vs\.?|versus|better.*than|worse.*than|more.*than|than before|last (month|week)|previous|improv|getting better|getting worse|increas|decreas|rising|falling/)) return 'ads_comparison';

  // Wasted spend. (Includes "wasting", "bleeding", the "spend but no sales"
  // phrasing, and the "how many to pause" count — Category B #15/#17/#19/#23.)
  if (prompt.match(/wasted|wasting|waste|bleed|bleeding|drain|zero.?sale|money.*lost|throwing.*away|burning|spend.*no sale|no sale.*spend|how many.*pause|should i pause|save.*paus|paus.*save/)) return 'wasted_spend';

  // Top performers. (Includes "best ROAS" and "drive the most sales" — canonical
  // Category E questions #42/#43.)
  if (prompt.match(/top.*keyword|best.*keyword|top.*campaign|best.*campaign|highest.*roas|best.*roas|lowest.*acos|top.*performing|drive.*(the )?most.*sale|most sales/)) return 'top_performers';

  // Specific metric lookup. Check the prompt too: acos/roas/tacos/cpc/ctr are
  // unambiguous ads-only terms, so a bare "what is my acos" must classify even
  // when the interpreter didn't populate entities.metrics.
  if (metrics.match(/acos|roas|tacos|ctr|cpc|ad.?spend|ppc.?spend|impression|click/)) return 'ads_summary';
  if (prompt.match(/\bacos\b|\broas\b|\btacos\b|\bctr\b|\bcpc\b|ad.?spend|ppc.?spend|cost per (order|acquisition|click|conversion)|\bcpa\b|\bimpressions?\b|how many\s+clicks?|total\s+clicks?/i)) return 'ads_summary';

  // General ads question.
  if (metrics.match(/ppc|ads?|campaign|keyword|sponsored/) || prompt.match(/ppc|ads?|campaign|keyword|sponsored/)) return 'ads_summary';

  return 'not_ads_engine';
}

// ── Ads Narrator (deterministic data → natural language) ──

const ADS_NARRATOR_MODEL = process.env.QMATE_NARRATOR_MODEL || 'gpt-4o-mini';

const ADS_NARRATOR_SYSTEM_PROMPT = `You are QMate, a PPC advertising analyst for an Amazon seller. You receive pre-computed ads performance data. Your ONLY job is to present these numbers clearly.

RULES:
1. EVERY number must come from the result data. Do NOT estimate or invent.
2. Currency: $1,234.56. Percentages: 12.3%.
3. Be concise. Answer the specific question.
4. For ACOS: below 20% is efficient, 20-40% is moderate, above 40% needs attention.
5. For wasted_spend results: emphasize the total savings opportunity and list top wasters.
6. For comparisons: state both current and previous values with the change.
7. For why_analysis: present insights ranked by severity, then actionable items.
8. Never say 'approximately'. Numbers are exact.
9. If wasted_keywords are included, mention that the user can pause them directly.
10. When charts are included, mention a chart is displayed but don't describe data points.

CRITICAL FIELD DEFINITIONS — do NOT confuse these:
- ppcSales (alias revenueFromAds) = Revenue generated FROM ads. This is the dollar amount of products sold because a customer clicked an ad. When the user asks about 'ad sales', 'PPC sales', or 'sales from ads', this is the number to use.
- ppcSpend (alias moneySpentOnAds) = Money spent ON ads. This is what the seller paid to Amazon for advertising. When the user asks about 'ad spend', 'PPC spend', 'how much I spent on ads', or 'advertising cost', this is the number to use.
- These are DIFFERENT numbers. ppcSales is always larger than ppcSpend if ads are profitable (ROAS > 1).`;

/** Currency formatter: $1,234.56 */
function fmtAdsMoney(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Percentage formatter: 12.3% */
function fmtAdsPct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

/** Human-ish date-range label. */
function fmtAdsRange(dr) {
  if (!dr || !dr.startDate || !dr.endDate) return 'the selected period';
  return `${dr.startDate} to ${dr.endDate}`;
}

/**
 * Deterministic template fallback when the LLM narrator is unavailable or fails.
 * Number-faithful sentence per result type — no LLM needed.
 *
 * @param {Object} result - AdsEngine handler result object
 * @returns {string}
 */
function buildAdsFallbackNarration(result) {
  if (!result || typeof result !== 'object') return 'I was unable to format the ads result.';
  const dr = fmtAdsRange(result.dateRange);

  switch (result.type) {
    case 'ads_summary': {
      const k = result.kpis || {};
      return `For ${dr}, your PPC sales were ${fmtAdsMoney(k.ppcSales)} on ${fmtAdsMoney(k.ppcSpend)} of ad spend (ACOS ${fmtAdsPct(k.acos)}, ROAS ${Number(k.roas || 0).toFixed(2)}, TACOS ${fmtAdsPct(k.tacos)}).`;
    }
    case 'wasted_spend':
      return `For ${dr}, you have ${result.wastedKeywords?.total || 0} wasted keyword(s) and ${result.zeroSalesTerms?.total || 0} zero-sales search term(s), totaling ${fmtAdsMoney(result.totalWastedSpend)} in wasted spend. You can pause these keywords directly.`;
    case 'campaign_performance': {
      const n = (result.campaigns || []).length;
      return `Found ${n} campaign(s) for ${dr} (mode: ${result.mode}).`;
    }
    case 'campaign_type_breakdown': {
      const b = result.breakdown || {};
      return `For ${dr}, ad spend split — SP ${fmtAdsMoney(b.sp?.spend)}, SB ${fmtAdsMoney(b.sb?.spend)}, SD ${fmtAdsMoney(b.sd?.spend)} (total ${fmtAdsMoney(result.totalSpend)}).`;
    }
    case 'budget_analysis':
      return `For ${dr}, total daily budget is ${fmtAdsMoney(result.totalDailyBudget)} against ${fmtAdsMoney(result.totalAvgDailySpend)} average daily spend (${fmtAdsPct(result.overallUtilization)} utilization). ${(result.budgetLimited || []).length} campaign(s) are budget-limited.`;
    case 'search_term_analysis':
      return `For ${dr}: ${result.converting?.total || 0} converting search term(s), ${result.wasting?.total || 0} wasting ${fmtAdsMoney(result.wasting?.totalWastedSpend)}, and ${result.toNegative?.total || 0} candidate(s) to add as negatives.`;
    case 'organic_vs_paid':
      return `For ${dr}, ${fmtAdsPct(result.ppcPercent)} of your ${fmtAdsMoney(result.totalSales)} total sales came from ads (${fmtAdsMoney(result.ppcSales)} PPC vs ${fmtAdsMoney(result.organicSales)} organic) — ${result.dependencyLevel}.`;
    case 'asin_ads': {
      if (result.notFound) return `I found no ad data for ${result.asin} in ${dr}.`;
      const m = result.metrics || {};
      return `For ${result.asin} over ${dr}: ${fmtAdsMoney(m.spend)} spend, ${fmtAdsMoney(m.sales)} sales, ACOS ${fmtAdsPct(m.acos)}, ROAS ${Number(m.roas || 0).toFixed(2)}.`;
    }
    case 'ads_comparison': {
      const d = result.deltas || {};
      return `Comparing ${dr} to the prior period: ACOS ${fmtAdsPct(d.acos?.previous)} → ${fmtAdsPct(d.acos?.current)}, ROAS ${Number(d.roas?.previous || 0).toFixed(2)} → ${Number(d.roas?.current || 0).toFixed(2)}. Overall ${result.overallDirection}.`;
    }
    case 'ads_why_analysis': {
      const msgs = (result.insights || []).map((i) => i.message).join(' ');
      return `${msgs || 'No significant changes detected.'}`.trim();
    }
    case 'keyword_deep_dive': {
      if (result.notFound) return `I found no data for the keyword "${result.keyword}" in ${dr}.`;
      const a = result.aggregated || {};
      return `For "${result.keyword}" over ${dr}: ${fmtAdsMoney(a.spend)} spend, ${fmtAdsMoney(a.sales)} sales, ACOS ${fmtAdsPct(a.acos)} (recommendation: ${result.recommendation}).`;
    }
    case 'top_performers': {
      const n = (result.items || []).length;
      return `Here are your top ${n} ${result.ranking} by ${result.sortedBy} for ${dr}.`;
    }
    case 'ads_time_series':
      return `Here is your ${result.trend?.metric || 'sales'} trend for ${dr} (${result.trend?.direction || 'flat'}). A chart is displayed.`;
    default:
      return 'Here are your ads results.';
  }
}

/**
 * Convert a pre-computed AdsEngine result into natural language via the LLM.
 * The LLM only formats provided numbers (strict no-invention prompt). On any
 * failure it falls back to a deterministic template — so a number is always
 * returned. Mirrors FinanceEngine.narrateFinanceResult.
 *
 * @param {Object} result - result object from any AdsEngine handler
 * @param {string} userQuestion - the original user question
 * @param {Object} modelTools - { client, createCompletionWithFallback }
 * @returns {Promise<string>} narrated answer text
 */
async function narrateAdsResult(result, userQuestion, modelTools) {
  const client = modelTools && modelTools.client;

  if (client && client.chat && client.chat.completions && typeof client.chat.completions.create === 'function') {
    try {
      const messages = [
        { role: 'system', content: ADS_NARRATOR_SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            `User asked: '${userQuestion}'\n\n` +
            `Pre-computed result:\n${JSON.stringify(result, null, 2)}\n\n` +
            'Present this data as a clear answer.',
        },
      ];

      const completion = await client.chat.completions.create({
        model: ADS_NARRATOR_MODEL,
        messages,
        temperature: 0.1,
        max_tokens: 800,
      });

      const content = completion?.choices?.[0]?.message?.content;
      if (content && content.trim()) return content.trim();
      logger.warn('[AdsEngine] Narrator returned empty content; using template fallback');
    } catch (err) {
      logger.warn('[AdsEngine] Narrator LLM call failed; using template fallback', { message: err.message });
    }
  } else {
    logger.warn('[AdsEngine] No LLM client available for narrator; using template fallback');
  }

  return buildAdsFallbackNarration(result);
}

// ── SECTION 6 — isAdsQuery ──

/**
 * True when the interpretation maps to an ads sub-handler (anything other than
 * 'not_ads_engine'). Used by layers/index.js to decide whether to intercept
 * with the AdsEngine (after the FinanceEngine intercept, before the general
 * pipeline).
 *
 * @param {Object} interpretation
 * @returns {boolean}
 */
function isAdsQuery(interpretation) {
  // Defer to the downstream engines that own these queries: GeneralStrategyEngine
  // (cross-domain) and SellerOps/Advisory (which run AFTER Ads in the pipeline).
  // All three detectors are standalone helpers (no engine imports → no cycle).
  if (isGeneralStrategyQuery(interpretation) || isSellerOpsQuery(interpretation) || isAdvisoryQuery(interpretation)) {
    return false;
  }
  return classifyAdsQueryType(interpretation) !== 'not_ads_engine';
}

module.exports = {
  handleAdsQuery,
  isAdsQuery,
  classifyAdsQueryType,
  narrateAdsResult,
  resolveKPIs,
  resolveAdsDateRange,
  getAdsSummary,
  getWastedSpendAnalysis,
  getTopPerformers,
  resolveCampaignEntity,
  getCampaignPerformance,
  getCampaignTypeBreakdown,
  getAdsBudgetAnalysis,
  getSearchTermAnalysis,
  getOrganicVsPaidSplit,
  getAsinAdsPerformance,
  getAdsComparison,
  getAdsWhyAnalysis,
  getAdsTimeSeries,
  getKeywordDeepDive,
};

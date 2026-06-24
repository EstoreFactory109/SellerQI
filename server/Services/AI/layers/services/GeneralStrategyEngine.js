/**
 * GeneralStrategyEngine — cross-domain (finance + ads) strategy answer engine.
 *
 * Where FinanceEngine and AdsEngine each answer single-domain questions, this
 * engine handles CROSS-DOMAIN strategy questions ("why is my profit dropping?",
 * "what should I fix first?", "give me a complete health check") by fetching
 * BOTH domains' deterministic data and connecting them.
 *
 * Design (same as the other engines): pull deterministic numbers from the SAME
 * internal functions the domain engines use (NOT their narrated handlers), then
 * let the LLM narrate. This file is Phase-1 scaffolding: detection + both
 * context fetchers + a skeleton handler. Cross-domain insights / health score /
 * ranked issues / action plan / narration land in later phases.
 *
 * NOTE: not yet wired into layers/index.js — dormant until pipeline integration.
 */

// ── SECTION 1 — Imports ──
const logger = require('../../../../utils/Logger.js');
const FinanceEngine = require('./FinanceEngine.js');
const AdsEngine = require('./AdsEngine.js');
const FinanceDashboardReadService = require('../../../Finance/FinanceDashboardReadService.js');
const PPCCampaignAnalysisService = require('../../../Calculations/PPCCampaignAnalysisService.js');
const DataFetchTracking = require('../../../../models/system/DataFetchTrackingModel.js');

// ── SECTION 2 — Detection ──
// Detection lives in helpers/StrategyQueryDetector.js (ZERO engine imports) so
// FinanceEngine/AdsEngine can defer strategy questions without a circular
// dependency on this file. Re-exported here for back-compat.
const { isGeneralStrategyQuery, hasStrongDomainSignal, classifyStrategyType } = require('./helpers/StrategyQueryDetector.js');

// ── Date range ──

/**
 * Resolve the strategy window. Delegates to FinanceEngine.resolveFinanceDateRange
 * so the window is anchored to DataFetchTracking.dataRange.endDate exactly like
 * every other engine (both domain contexts then use the SAME window). The
 * DataFetchTracking import is kept available for any future strategy-specific
 * anchoring needs.
 *
 * @param {Object} interpretation
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, calendarMode }} [requestDateRange]
 * @returns {Promise<{ startDate, endDate, mode, source, dayCount }>}
 */
async function resolveStrategyDateRange(interpretation, userContext, requestDateRange) {
  return FinanceEngine.resolveFinanceDateRange(interpretation, userContext, requestDateRange);
}

// ── SECTION 3 — getFinanceContext ──

/**
 * Raw finance context for cross-domain reasoning. Reuses FinanceEngine's
 * internal computation functions (NOT handleFinanceQuery) so we get structured
 * data, not a narrated response. Ad spend is resolved the same way the dashboard
 * does (PPCMetrics) for parity.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate }} dateRange
 * @returns {Promise<Object>} { summary, comparison, lossMakingProducts, productsMissingCOGS, expenseBreakdown, overhead }
 */
async function getFinanceContext(userContext, dateRange) {
  const dashboardData = await FinanceDashboardReadService.getDashboard({
    userId: userContext.userId,
    country: userContext.country,
    region: userContext.region,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const cogs = await FinanceEngine.fetchCogsForUser(userContext);

  // Dashboard-parity ad spend (PPCMetrics; falls back to finance adsSpend).
  const adSpend = await FinanceEngine.resolvePpcAdSpend(
    userContext,
    dateRange.startDate,
    dateRange.endDate,
    (dashboardData.totals || {}).adsSpend
  );

  const financeSummary = FinanceEngine.computeFinanceSummary(dashboardData, cogs, adSpend, dateRange);
  // Product count — used by the health score's COGS-coverage ratio.
  financeSummary.totalProducts = (Array.isArray(dashboardData.asinWise) ? dashboardData.asinWise : []).length;

  // Period-over-period trend context (deltas: profit, sales, expenses, …).
  let comparison = null;
  try {
    comparison = await FinanceEngine.buildComparisonResponse(financeSummary, userContext, dateRange);
  } catch (err) {
    logger.warn('[GeneralStrategyEngine] finance comparison failed', { message: err.message });
  }

  // Problem products: per-ASIN profit via the shared row-entry helper.
  const asinWise = Array.isArray(dashboardData.asinWise) ? dashboardData.asinWise : [];
  const cogsMap = cogs && cogs.cogsMap;
  const lossMakingProducts = asinWise
    .map((row) => FinanceEngine.computeAsinRowEntry(row, cogsMap))
    .filter((e) => (e.grossProfit || 0) < 0)
    .sort((a, b) => (a.grossProfit || 0) - (b.grossProfit || 0))
    .slice(0, 10);

  const productsMissingCOGS = asinWise
    .filter((a) => (a.units || 0) > 0 && !(cogsMap && cogsMap.has(a.asin)))
    .slice(0, 20);

  return {
    summary: financeSummary,
    comparison,
    lossMakingProducts,
    productsMissingCOGS,
    expenseBreakdown: dashboardData.totals || {},
    overhead: dashboardData.overhead || [],
  };
}

// ── SECTION 4 — getAdsContext ──

/**
 * Raw ads context for cross-domain reasoning. Reuses AdsEngine.resolveKPIs +
 * PPCCampaignAnalysisService (NOT handleAdsQuery) so we get structured data.
 *
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate }} dateRange
 * @returns {Promise<Object>} { kpis, comparison, totalWastedSpend, wastedKeywordsCount, tabCounts, optimizationOpportunities }
 */
async function getAdsContext(userContext, dateRange) {
  const kpis = await AdsEngine.resolveKPIs(userContext, dateRange);

  const [wastedData, tabCounts, comparison] = await Promise.all([
    PPCCampaignAnalysisService.getWastedSpendKeywords(
      userContext.userId, userContext.country, userContext.region, 1, 20, dateRange.startDate, dateRange.endDate
    ),
    PPCCampaignAnalysisService.getTabCounts(
      userContext.userId, userContext.country, userContext.region, dateRange.startDate, dateRange.endDate
    ),
    AdsEngine.getAdsComparison(userContext, dateRange),
  ]);

  const totalWastedSpend = (wastedData && wastedData.totalWastedSpend) || 0;
  const wastedKeywordsCount = (wastedData && wastedData.pagination && wastedData.pagination.totalItems) || 0;

  return {
    kpis,
    comparison,
    totalWastedSpend,
    wastedKeywordsCount,
    tabCounts: tabCounts || {},
    optimizationOpportunities: {
      wastedSpend: totalWastedSpend,
      highAcosCampaigns: (tabCounts && tabCounts.highAcos) || 0,
      campaignsNeedingNegatives: (tabCounts && tabCounts.noNegatives) || 0,
      zeroSalesTerms: (tabCounts && tabCounts.zeroSales) || 0,
    },
  };
}

// ── FUNCTION 1 — buildCrossDomainInsights ──

/**
 * Connect finance + ads data — the unique value of the strategy engine. Every
 * figure here requires BOTH domains, so if either context is missing we return
 * { available: false } and downstream builders skip the cross-domain section.
 *
 * @param {Object|null} finance - getFinanceContext() result
 * @param {Object|null} ads - getAdsContext() result
 * @returns {Object}
 */
function buildCrossDomainInsights(finance, ads) {
  if (!finance || !ads) return { available: false };

  const totalSales = finance.summary.totalSales || 0;
  const totalExpenses = finance.summary.displayTotalExpenses || 0;
  const adSpend = ads.kpis.ppcSpend || 0;
  const ppcSales = ads.kpis.ppcSales || 0;
  const profit = finance.summary.displayProfit || 0;
  const wasted = ads.totalWastedSpend || 0;

  return {
    available: true,

    // Ad spend as a share of total expenses and of total sales.
    adSpendAsPercentOfExpenses: totalExpenses > 0 ? (adSpend / totalExpenses) * 100 : 0,
    adSpendAsPercentOfSales: totalSales > 0 ? (adSpend / totalSales) * 100 : 0,

    // PPC-attributed vs organic sales split.
    ppcSalesPercent: totalSales > 0 ? (ppcSales / totalSales) * 100 : 0,
    organicSalesPercent: totalSales > 0 ? ((totalSales - ppcSales) / totalSales) * 100 : 0,

    // Effective ad profitability.
    adProfit: ppcSales - adSpend,
    adROI: adSpend > 0 ? ((ppcSales - adSpend) / adSpend) * 100 : 0,

    // Wasted spend relative to profit, and the upside of fixing it.
    wastedSpendAsPercentOfProfit: profit > 0 ? (wasted / profit) * 100 : 0,
    profitImpactOfFixingWaste: wasted,
    profitMarginAfterFixingWaste: totalSales > 0 ? ((profit + wasted) / totalSales) * 100 : 0,

    // Finance ↔ ads trend correlation.
    profitTrend: finance.comparison?.deltas?.profit?.changePct || 0,
    acosTrend: ads.comparison?.deltas?.acos?.changePct || 0,
    adSpendTrend: ads.comparison?.deltas?.ppcSpend?.changePct || 0,
  };
}

// ── FUNCTION 2 — buildHealthScore ──

/**
 * Overall business health across up to 6 dimensions (0-10 each): profit margin,
 * COGS coverage, expense efficiency (finance); ACOS, ad waste, ROAS (ads). Only
 * the dimensions whose domain context is present are scored, so the percentage
 * is always out of the available max.
 *
 * @param {Object|null} finance
 * @param {Object|null} ads
 * @returns {Object} { scores, totalScore, maxScore, percentage, grade, label }
 */
function buildHealthScore(finance, ads) {
  const scores = [];

  if (finance) {
    // Profit margin: >20%=10, 10-20%=7, 0-10%=4, negative=0.
    const margin = finance.summary.profitMargin || 0;
    scores.push({ category: 'Profit Margin', score: margin > 20 ? 10 : margin > 10 ? 7 : margin > 0 ? 4 : 0, value: `${margin.toFixed(1)}%` });

    // COGS coverage: >90%=10, >50%=5, <50%=2. Robust to an unknown denominator.
    const totalProducts = finance.summary.totalProducts || 0;
    const missing = finance.productsMissingCOGS?.length || 0;
    let cogsRatio;
    if (missing === 0) cogsRatio = 1;
    else if (totalProducts > 0) cogsRatio = Math.max(0, 1 - missing / totalProducts);
    else cogsRatio = 0; // products are missing COGS but we can't size the base
    scores.push({ category: 'COGS Coverage', score: cogsRatio > 0.9 ? 10 : cogsRatio > 0.5 ? 5 : 2, value: `${(cogsRatio * 100).toFixed(0)}%` });

    // Expense efficiency (expenses as % of sales): <60%=10, 60-80%=6, >80%=2.
    const expenseRatio = finance.summary.totalSales > 0
      ? (finance.summary.displayTotalExpenses / finance.summary.totalSales) * 100 : 100;
    scores.push({ category: 'Expense Efficiency', score: expenseRatio < 60 ? 10 : expenseRatio < 80 ? 6 : 2, value: `${expenseRatio.toFixed(1)}%` });
  }

  if (ads) {
    // ACOS: <20%=10, 20-40%=6, >40%=2.
    const acos = ads.kpis.acos || 0;
    scores.push({ category: 'ACOS', score: acos < 20 ? 10 : acos < 40 ? 6 : 2, value: `${acos.toFixed(1)}%` });

    // Ad waste: <$1=10, <$100=7, <$500=4, >=$500=1.
    const wasted = ads.totalWastedSpend || 0;
    scores.push({ category: 'Ad Waste', score: wasted < 1 ? 10 : wasted < 100 ? 7 : wasted < 500 ? 4 : 1, value: `$${wasted.toFixed(2)}` });

    // ROAS: >5=10, 3-5=7, 1-3=4, <1=1.
    const roas = ads.kpis.roas || 0;
    scores.push({ category: 'ROAS', score: roas > 5 ? 10 : roas > 3 ? 7 : roas > 1 ? 4 : 1, value: `${roas.toFixed(2)}` });
  }

  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  const maxScore = scores.length * 10;
  const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

  return {
    scores,
    totalScore,
    maxScore,
    percentage,
    grade: percentage >= 80 ? 'A' : percentage >= 65 ? 'B' : percentage >= 50 ? 'C' : percentage >= 35 ? 'D' : 'F',
    label: percentage >= 80 ? 'Excellent' : percentage >= 65 ? 'Good' : percentage >= 50 ? 'Needs Work' : percentage >= 35 ? 'At Risk' : 'Critical',
  };
}

// ── FUNCTION 3 — rankAllIssues ──

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Build the unified, cross-domain issue list (finance + ads + cross-domain),
 * each with { domain, type, severity, profitImpact, title, description, action }.
 * Sorted by severity, then by absolute profit impact (biggest dollar first).
 *
 * @param {Object|null} finance
 * @param {Object|null} ads
 * @param {Object} crossDomain - buildCrossDomainInsights() result
 * @returns {Array<Object>}
 */
function rankAllIssues(finance, ads, crossDomain) {
  const issues = [];

  // ── Finance issues ──
  if (finance) {
    const s = finance.summary;
    if (s.profitMargin < 5) {
      issues.push({ domain: 'finance', type: 'low_margin', severity: 'critical', profitImpact: s.displayProfit, title: 'Critically low profit margin', description: `Margin is only ${s.profitMargin.toFixed(1)}%`, action: 'Review pricing, reduce expenses, or improve product mix' });
    }
    if (finance.lossMakingProducts?.length > 0) {
      const totalLoss = finance.lossMakingProducts.reduce((sum, p) => sum + Math.abs(p.grossProfit || 0), 0);
      issues.push({ domain: 'finance', type: 'loss_making_products', severity: 'high', profitImpact: -totalLoss, title: `${finance.lossMakingProducts.length} products are losing money`, description: `Combined loss: $${totalLoss.toFixed(2)}`, action: 'Consider repricing, reducing ad spend, or discontinuing worst performers' });
    }
    if (finance.productsMissingCOGS?.length > 5) {
      issues.push({ domain: 'finance', type: 'missing_cogs', severity: 'medium', profitImpact: 0, title: `${finance.productsMissingCOGS.length} products missing COGS`, description: 'Profit calculations are incomplete without COGS data', action: 'Enter COGS for all products in Settings → COGS' });
    }
    if (finance.comparison?.deltas?.expenses?.changePct > 15) {
      issues.push({ domain: 'finance', type: 'expense_spike', severity: 'high', profitImpact: -(finance.comparison.deltas.expenses.change || 0), title: 'Expenses increased significantly', description: `Up ${finance.comparison.deltas.expenses.changePct.toFixed(1)}% vs previous period`, action: 'Review the expense breakdown to find what increased' });
    }
  }

  // ── Ads issues ──
  if (ads) {
    if (ads.totalWastedSpend > 50) {
      issues.push({ domain: 'ads', type: 'wasted_spend', severity: ads.totalWastedSpend > 500 ? 'critical' : 'high', profitImpact: -ads.totalWastedSpend, title: `$${ads.totalWastedSpend.toFixed(2)} wasted on non-converting ads`, description: `${ads.wastedKeywordsCount} keywords with spend but zero sales`, action: 'Pause wasted keywords and add zero-sales search terms as negatives' });
    }
    if (ads.kpis.acos > 40) {
      issues.push({ domain: 'ads', type: 'high_acos', severity: 'high', profitImpact: -(ads.kpis.ppcSpend - ads.kpis.ppcSales * 0.4), title: `ACOS is ${ads.kpis.acos.toFixed(1)}% — above healthy range`, description: 'Spending too much on ads relative to sales generated', action: 'Lower bids on high-ACOS campaigns and pause non-converting keywords' });
    }
    if (ads.optimizationOpportunities.campaignsNeedingNegatives > 0) {
      issues.push({ domain: 'ads', type: 'missing_negatives', severity: 'medium', profitImpact: 0, title: `${ads.optimizationOpportunities.campaignsNeedingNegatives} campaigns without negative keywords`, description: 'These campaigns may be wasting money on irrelevant searches', action: 'Add negative keywords to these campaigns' });
    }
    if (ads.comparison?.deltas?.acos?.change > 5) {
      issues.push({ domain: 'ads', type: 'acos_increasing', severity: 'high', profitImpact: 0, title: 'ACOS is increasing', description: `Up ${ads.comparison.deltas.acos.changePct.toFixed(1)}% vs previous period`, action: 'Review keyword bids and campaign targeting' });
    }
  }

  // ── Cross-domain issues ──
  if (crossDomain?.available) {
    if (crossDomain.ppcSalesPercent > 70) {
      issues.push({ domain: 'cross', type: 'ppc_dependency', severity: 'medium', profitImpact: 0, title: `${crossDomain.ppcSalesPercent.toFixed(0)}% of sales depend on ads`, description: 'High PPC dependency — organic ranking may be weak', action: 'Invest in listing optimization and organic ranking improvements' });
    }
    if (crossDomain.wastedSpendAsPercentOfProfit > 10) {
      issues.push({ domain: 'cross', type: 'waste_vs_profit', severity: 'high', profitImpact: -(ads?.totalWastedSpend || 0), title: `Ad waste equals ${crossDomain.wastedSpendAsPercentOfProfit.toFixed(0)}% of your profit`, description: `Fixing ad waste would increase profit by $${(ads?.totalWastedSpend || 0).toFixed(2)}`, action: 'This is the single highest-impact fix available' });
    }
  }

  // Sort by severity, then by absolute profit impact (biggest dollar first).
  return issues.sort((a, b) => {
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    return Math.abs(b.profitImpact) - Math.abs(a.profitImpact);
  });
}

// ── FUNCTION 4 — buildActionPlan ──

/**
 * Top-5 action plan from the ranked issues. Each item carries a priority, the
 * issue's title + action, an estimated dollar impact, domain, and difficulty.
 *
 * @param {Array<Object>} rankedIssues - rankAllIssues() result
 * @returns {Array<Object>}
 */
function buildActionPlan(rankedIssues) {
  return (rankedIssues || []).slice(0, 5).map((issue, idx) => ({
    priority: idx + 1,
    title: issue.title,
    action: issue.action,
    estimatedImpact: issue.profitImpact !== 0
      ? `${issue.profitImpact > 0 ? '+' : '-'}$${Math.abs(issue.profitImpact).toFixed(2)} profit impact`
      : 'Improves accuracy/efficiency',
    domain: issue.domain,
    difficulty: issue.type === 'missing_cogs' ? 'easy' : issue.type === 'wasted_spend' ? 'easy' : 'medium',
  }));
}

// ── classifyStrategyType ──
// Imported from helpers/StrategyQueryDetector.js (single source of the strategy
// category patterns, shared with isGeneralStrategyQuery so detection and
// classification cannot drift). Used by handleStrategyQuery below.

// ── Cross-domain decline drivers (for why_declining) ──

/**
 * Pull the "hurting" period-over-period movements across both domains and rank
 * them by magnitude — the deterministic basis for explaining a decline.
 *
 * @param {Object|null} finance
 * @param {Object|null} ads
 * @returns {Array<{domain,metric,change,changePct,effect}>}
 */
function rankDeclineDrivers(finance, ads) {
  const drivers = [];
  const fd = finance?.comparison?.deltas || {};
  const ad = ads?.comparison?.deltas || {};

  // Finance: profit/sales DOWN hurts; expenses/refunds UP hurts.
  if (fd.profit && fd.profit.change < 0) drivers.push({ domain: 'finance', metric: 'profit', change: fd.profit.change, changePct: fd.profit.changePct, effect: 'hurting' });
  if (fd.sales && fd.sales.change < 0) drivers.push({ domain: 'finance', metric: 'sales', change: fd.sales.change, changePct: fd.sales.changePct, effect: 'hurting' });
  if (fd.expenses && fd.expenses.change > 0) drivers.push({ domain: 'finance', metric: 'expenses', change: fd.expenses.change, changePct: fd.expenses.changePct, effect: 'hurting' });
  if (fd.refunds && fd.refunds.change > 0) drivers.push({ domain: 'finance', metric: 'refunds', change: fd.refunds.change, changePct: fd.refunds.changePct, effect: 'hurting' });

  // Ads: ACOS/spend UP hurts; ROAS/ppcSales DOWN hurts.
  if (ad.acos && ad.acos.change > 0) drivers.push({ domain: 'ads', metric: 'acos', change: ad.acos.change, changePct: ad.acos.changePct, effect: 'hurting' });
  if (ad.ppcSpend && ad.ppcSpend.change > 0) drivers.push({ domain: 'ads', metric: 'ppcSpend', change: ad.ppcSpend.change, changePct: ad.ppcSpend.changePct, effect: 'hurting' });
  if (ad.roas && ad.roas.change < 0) drivers.push({ domain: 'ads', metric: 'roas', change: ad.roas.change, changePct: ad.roas.changePct, effect: 'hurting' });
  if (ad.ppcSales && ad.ppcSales.change < 0) drivers.push({ domain: 'ads', metric: 'ppcSales', change: ad.ppcSales.change, changePct: ad.ppcSales.changePct, effect: 'hurting' });

  return drivers.sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0));
}

// ── Response builders (structured data only — the narrator formats prose) ──

/** 1. Why is the business declining — both domains' deltas + ranked drivers. */
function buildWhyDecliningResponse(finance, ads, crossDomain, dateRange) {
  return {
    type: 'strategy',
    strategyType: 'why_declining',
    dateRange,
    financeDeltas: finance?.comparison?.deltas || null,
    adsDeltas: ads?.comparison?.deltas || null,
    drivers: rankDeclineDrivers(finance, ads),
    contributingProducts: (finance?.lossMakingProducts || []).slice(0, 5),
    contributingAdsFactors: ads
      ? { wastedSpend: ads.totalWastedSpend || 0, acos: ads.kpis?.acos || 0, highAcosCampaigns: ads.optimizationOpportunities?.highAcosCampaigns || 0 }
      : null,
    crossDomain,
  };
}

/** 2. How to improve — lead with the action plan + cross-domain upside. */
function buildHowToImproveResponse(finance, ads, rankedIssues, actionPlan, dateRange) {
  const totalEstimatedImpact = (rankedIssues || []).reduce((s, i) => s + Math.abs(i.profitImpact || 0), 0);
  return {
    type: 'strategy',
    strategyType: 'how_to_improve',
    dateRange,
    actionPlan,
    topIssues: (rankedIssues || []).slice(0, 5),
    totalEstimatedImpact,
    profitImpactOfFixingWaste: ads?.totalWastedSpend || 0,
    currentMargin: finance?.summary?.profitMargin ?? null,
    marginAfterFixingWaste: crossDomainSafe(finance, ads).profitMarginAfterFixingWaste,
  };
}

/** 3. Mistakes — every issue as a fixable mistake, sorted by profit impact. */
function buildMistakesResponse(finance, ads, rankedIssues, dateRange) {
  const mistakes = (rankedIssues || []).slice().sort((a, b) => Math.abs(b.profitImpact || 0) - Math.abs(a.profitImpact || 0));
  const profit = finance?.summary?.displayProfit || 0;
  const wasted = ads?.totalWastedSpend || 0;
  return {
    type: 'strategy',
    strategyType: 'what_mistakes',
    dateRange,
    mistakes,
    biggestMistake: mistakes[0] || null,
    wasteAsPercentOfProfit: profit > 0 ? (wasted / profit) * 100 : 0,
  };
}

/** 4. Focus — ONLY the action plan, with the #1 priority emphasized. */
function buildFocusResponse(actionPlan, rankedIssues, dateRange) {
  return {
    type: 'strategy',
    strategyType: 'what_to_focus',
    dateRange,
    actionPlan,
    topPriority: (actionPlan && actionPlan[0]) || null,
    totalActions: (actionPlan || []).length,
  };
}

/** 5. Complete summary — health grade + finance + ads + cross-domain + top 3 issues. */
function buildCompleteSummaryResponse(finance, ads, crossDomain, healthScore, dateRange) {
  const rankedIssues = rankAllIssues(finance, ads, crossDomain);
  return {
    type: 'strategy',
    strategyType: 'complete_summary',
    dateRange,
    healthScore,
    finance: finance
      ? {
          totalSales: finance.summary.totalSales,
          displayProfit: finance.summary.displayProfit,
          profitMargin: finance.summary.profitMargin,
          displayTotalExpenses: finance.summary.displayTotalExpenses,
          totalCogs: finance.summary.totalCogs,
        }
      : null,
    ads: ads
      ? {
          ppcSpend: ads.kpis.ppcSpend,
          ppcSales: ads.kpis.ppcSales,
          acos: ads.kpis.acos,
          roas: ads.kpis.roas,
          tacos: ads.kpis.tacos,
          totalWastedSpend: ads.totalWastedSpend,
        }
      : null,
    crossDomain,
    topIssues: rankedIssues.slice(0, 3),
  };
}

/** 6. Is advertising worth it — ad profit, ROI, organic/paid split, waste. */
function buildAdWorthResponse(finance, ads, crossDomain, dateRange) {
  const cd = crossDomain && crossDomain.available ? crossDomain : crossDomainSafe(finance, ads);
  const ppcSales = ads?.kpis?.ppcSales || 0;
  const ppcSpend = ads?.kpis?.ppcSpend || 0;
  return {
    type: 'strategy',
    strategyType: 'is_it_worth',
    dateRange,
    ppcSales,
    ppcSpend,
    adProfit: ppcSales - ppcSpend,
    adROI: cd.adROI || 0,
    roas: ads?.kpis?.roas || 0,
    acos: ads?.kpis?.acos || 0,
    ppcSalesPercent: cd.ppcSalesPercent || 0,
    organicSalesPercent: cd.organicSalesPercent || 0,
    salesAtRiskWithoutAds: ppcSales, // sales you'd lose if ads stopped
    wastedSpend: ads?.totalWastedSpend || 0,
    savablePotential: ads?.totalWastedSpend || 0,
    verdict: ppcSpend > 0 ? (ppcSales - ppcSpend > 0 ? 'profitable' : 'unprofitable') : 'no_ad_spend',
  };
}

/** 7. Where am I losing money — loss products + ad waste + overhead + total savings. */
function buildWhereLosing(finance, ads, crossDomain, dateRange) {
  const lossMakingProducts = (finance?.lossMakingProducts || []).slice(0, 10);
  const totalProductLoss = lossMakingProducts.reduce((s, p) => s + Math.abs(p.grossProfit || 0), 0);
  const wastedAdSpend = ads?.totalWastedSpend || 0;

  // Overhead expense lines (exclude revenue categories), largest first.
  const overheadExpenses = (finance?.overhead || [])
    .filter((o) => o && o.isRevenue === false)
    .map((o) => ({ category: o.category, amount: Math.abs(o.amount || 0) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return {
    type: 'strategy',
    strategyType: 'where_losing',
    dateRange,
    lossMakingProducts,
    totalProductLoss,
    wastedAdSpend,
    wastedKeywordsCount: ads?.wastedKeywordsCount || 0,
    overheadExpenses,
    totalPotentialSavings: totalProductLoss + wastedAdSpend,
  };
}

/** 8. Health check — score + dimensions + weakest areas + healthy benchmarks. */
function buildHealthCheckResponse(finance, ads, healthScore, dateRange) {
  const weakestDimensions = (healthScore?.scores || [])
    .slice()
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  return {
    type: 'strategy',
    strategyType: 'general_health',
    dateRange,
    healthScore,
    weakestDimensions,
    benchmarks: {
      profitMargin: '> 15%',
      expenseRatio: '< 70%',
      acos: '< 25%',
      roas: '> 4',
      cogsCoverage: '100%',
      adWaste: '< $50',
    },
  };
}

/** Cross-domain insights that always returns an object (avoids null guards in builders). */
function crossDomainSafe(finance, ads) {
  const cd = buildCrossDomainInsights(finance, ads);
  return cd && cd.available ? cd : {};
}

// ── SECTION 5 — handleStrategyQuery ──

/**
 * Main entry point for the cross-domain strategy engine. Resolves the window,
 * fetches BOTH domain contexts in parallel (tolerant of one domain failing via
 * Promise.allSettled), builds the shared analyses (cross-domain insights, health
 * score, ranked issues, action plan), classifies the strategy sub-type, and
 * routes to the matching structured response builder. The LLM narrator (later
 * phase) formats the returned structure into prose.
 *
 * @param {Object} interpretation
 * @param {{ userId, country, region }} userContext
 * @param {{ startDate, endDate, calendarMode }} [requestDateRange]
 * @returns {Promise<Object>} a strategy result object, or { type:'error', message }
 */
async function handleStrategyQuery(interpretation, userContext, requestDateRange) {
  try {
    // a) Resolve the window (same anchoring as the domain engines).
    const dateRange = await resolveStrategyDateRange(interpretation, userContext, requestDateRange);

    // b) Fetch BOTH domains in parallel; tolerate one side failing.
    const [financeSettled, adsSettled] = await Promise.allSettled([
      getFinanceContext(userContext, dateRange),
      getAdsContext(userContext, dateRange),
    ]);

    const finance = financeSettled.status === 'fulfilled' ? financeSettled.value : null;
    const ads = adsSettled.status === 'fulfilled' ? adsSettled.value : null;

    if (financeSettled.status === 'rejected') {
      logger.warn('[GeneralStrategyEngine] finance context failed', { message: financeSettled.reason?.message });
    }
    if (adsSettled.status === 'rejected') {
      logger.warn('[GeneralStrategyEngine] ads context failed', { message: adsSettled.reason?.message });
    }

    // b2) Shared analyses across both domains.
    const crossDomain = buildCrossDomainInsights(finance, ads);
    const healthScore = buildHealthScore(finance, ads);
    const rankedIssues = rankAllIssues(finance, ads, crossDomain);
    const actionPlan = buildActionPlan(rankedIssues);

    // c) Classify the specific strategy question.
    const strategyType = classifyStrategyType(interpretation);

    logger.info('[GeneralStrategyEngine] Strategy query handled', {
      window: `${dateRange.startDate}..${dateRange.endDate} (${dateRange.source})`,
      strategyType,
      grade: healthScore.grade,
      issueCount: rankedIssues.length,
      hasFinance: !!finance,
      hasAds: !!ads,
    });

    // d) Route to the matching structured builder.
    let result;
    switch (strategyType) {
      case 'why_declining':
        result = buildWhyDecliningResponse(finance, ads, crossDomain, dateRange);
        break;
      case 'how_to_improve':
        result = buildHowToImproveResponse(finance, ads, rankedIssues, actionPlan, dateRange);
        break;
      case 'what_mistakes':
        result = buildMistakesResponse(finance, ads, rankedIssues, dateRange);
        break;
      case 'what_to_focus':
        result = buildFocusResponse(actionPlan, rankedIssues, dateRange);
        break;
      case 'complete_summary':
        result = buildCompleteSummaryResponse(finance, ads, crossDomain, healthScore, dateRange);
        break;
      case 'is_it_worth':
        result = buildAdWorthResponse(finance, ads, crossDomain, dateRange);
        break;
      case 'where_losing':
        result = buildWhereLosing(finance, ads, crossDomain, dateRange);
        break;
      case 'general_health':
        result = buildHealthCheckResponse(finance, ads, healthScore, dateRange);
        break;
      default:
        result = buildCompleteSummaryResponse(finance, ads, crossDomain, healthScore, dateRange);
    }

    // Attach the shared analyses + raw contexts so the narrator/frontend always
    // has the full picture regardless of which builder ran. The builder's own
    // keys (`...result`) MUST win on any collision — e.g. buildCompleteSummary
    // emits slimmed `finance`/`ads` summary slices that must NOT be clobbered by
    // the raw contexts. So `...result` is spread LAST, and the raw contexts are
    // exposed under non-colliding names (financeContext/adsContext).
    return {
      healthScore,
      crossDomain,
      rankedIssues,
      actionPlan,
      financeContext: finance,
      adsContext: ads,
      ...result,
    };
  } catch (err) {
    logger.error('[GeneralStrategyEngine] Error in handleStrategyQuery', {
      message: err && err.message,
      stack: err && err.stack,
    });
    return { type: 'error', message: err.message };
  }
}

// ── SECTION 6 — Narrator ──

const STRATEGY_NARRATOR_MODEL = process.env.QMATE_NARRATOR_MODEL || 'gpt-4o-mini';

const STRATEGY_NARRATOR_SYSTEM_PROMPT = `You are QMate, a business strategy analyst for an Amazon seller. You receive pre-computed CROSS-DOMAIN (finance + advertising) analysis. Your ONLY job is to present it clearly and help the seller act.

RULES:
1. EVERY number must come from the result data. Do NOT estimate or invent.
2. Currency: $1,234.56. Percentages: 12.3%.
3. Connect finance and ads — that's the value. E.g. "ad waste of $X equals Y% of your profit".
4. Lead with the headline (the grade, the #1 driver, or the biggest opportunity), then specifics.
5. For 'why_declining': state what changed using both finance and ads deltas, then the ranked drivers, then contributing products/campaigns.
6. For 'how_to_improve' / 'what_to_focus': present the action plan in priority order with each action's estimated impact.
7. For 'what_mistakes': list mistakes by profit impact, biggest first.
8. For 'complete_summary' / 'general_health': lead with the health grade and the weakest dimensions.
9. For 'is_it_worth': state ad profit (PPC sales minus ad spend), ROI, the organic/paid split, and the savable waste.
10. For 'where_losing': total the losses (loss-making products + ad waste + overhead) and give the total potential savings.
11. Never say 'approximately'. Numbers are exact. Be concise and specific.`;

/** $ formatter. */
function sFmtMoney(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** % formatter. */
function sFmtPct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

/**
 * Deterministic fallback narration per strategyType — number-faithful, no LLM.
 * @param {Object} r - strategy result
 * @returns {string}
 */
function buildStrategyFallbackNarration(r) {
  if (!r || typeof r !== 'object') return 'I was unable to format the strategy result.';
  const hs = r.healthScore;
  switch (r.strategyType) {
    case 'why_declining': {
      const top = (r.drivers || [])[0];
      const lead = top ? `The biggest factor is ${top.domain} ${top.metric} (${sFmtPct(top.changePct)} vs the previous period).` : 'No significant declining drivers were detected.';
      return `${lead} ${(r.contributingProducts || []).length} loss-making product(s) are also weighing on profit.`;
    }
    case 'how_to_improve':
      return `Top priority: ${(r.actionPlan?.[0]?.title) || 'optimize your account'}. Fixing wasted ad spend alone would add ${sFmtMoney(r.profitImpactOfFixingWaste)} to profit. ${(r.actionPlan || []).length} prioritized actions are listed.`;
    case 'what_mistakes':
      return `Your biggest issue: ${(r.biggestMistake?.title) || 'none detected'}. Ad waste equals ${sFmtPct(r.wasteAsPercentOfProfit)} of your profit. ${(r.mistakes || []).length} issues found.`;
    case 'what_to_focus':
      return `#1 priority: ${(r.topPriority?.title) || 'none'} — ${(r.topPriority?.estimatedImpact) || ''}. ${(r.actionPlan || []).length} actions in your focus plan.`;
    case 'is_it_worth':
      return `Your ads generated ${sFmtMoney(r.ppcSales)} on ${sFmtMoney(r.ppcSpend)} of spend — ad profit ${sFmtMoney(r.adProfit)} (ROI ${sFmtPct(r.adROI)}). ${sFmtPct(r.ppcSalesPercent)} of sales come from ads; you could save ${sFmtMoney(r.savablePotential)} in waste. Verdict: ${r.verdict}.`;
    case 'where_losing':
      return `Total potential savings: ${sFmtMoney(r.totalPotentialSavings)} — ${(r.lossMakingProducts || []).length} loss-making product(s) (${sFmtMoney(r.totalProductLoss)}) plus ${sFmtMoney(r.wastedAdSpend)} of wasted ad spend across ${r.wastedKeywordsCount} keyword(s).`;
    case 'general_health':
      return `Business health: grade ${hs?.grade || '?'} (${sFmtPct(hs?.percentage)}, ${hs?.label || ''}). Weakest areas: ${(r.weakestDimensions || []).map((d) => d.category).join(', ') || 'n/a'}.`;
    case 'complete_summary':
    default:
      return `Overall grade ${hs?.grade || '?'} (${sFmtPct(hs?.percentage)}). Sales ${sFmtMoney(r.finance?.totalSales)}, profit ${sFmtMoney(r.finance?.displayProfit)} (${sFmtPct(r.finance?.profitMargin)} margin); ad spend ${sFmtMoney(r.ads?.ppcSpend)} at ${sFmtPct(r.ads?.acos)} ACOS. ${(r.topIssues || []).length} top issues identified.`;
  }
}

/**
 * Narrate a strategy result via the LLM (strict no-invention prompt), with a
 * deterministic template fallback on any failure. Mirrors the finance/ads
 * narrators.
 *
 * @param {Object} result - handleStrategyQuery() result
 * @param {string} userQuestion
 * @param {Object} modelTools - { client, createCompletionWithFallback }
 * @returns {Promise<string>}
 */
async function narrateStrategyResult(result, userQuestion, modelTools) {
  const client = modelTools && modelTools.client;
  if (client && client.chat && client.chat.completions && typeof client.chat.completions.create === 'function') {
    try {
      const completion = await client.chat.completions.create({
        model: STRATEGY_NARRATOR_MODEL,
        messages: [
          { role: 'system', content: STRATEGY_NARRATOR_SYSTEM_PROMPT },
          { role: 'user', content: `User asked: '${userQuestion}'\n\nPre-computed cross-domain result:\n${JSON.stringify(result, null, 2)}\n\nPresent this as a clear, actionable answer.` },
        ],
        temperature: 0.1,
        max_tokens: 900,
      });
      const content = completion?.choices?.[0]?.message?.content;
      if (content && content.trim()) return content.trim();
      logger.warn('[GeneralStrategyEngine] Narrator returned empty content; using template fallback');
    } catch (err) {
      logger.warn('[GeneralStrategyEngine] Narrator LLM call failed; using template fallback', { message: err.message });
    }
  } else {
    logger.warn('[GeneralStrategyEngine] No LLM client available for narrator; using template fallback');
  }
  return buildStrategyFallbackNarration(result);
}

// ── Follow-ups ──
// Strategy follow-up templates + generateStrategyFollowUps live in
// helpers/FollowUpGenerator.js (alongside the finance/ads follow-ups). The
// pipeline imports the generator from there. Re-exported here for back-compat
// so any caller using GeneralStrategyEngine.generateStrategyFollowUps still works.
const { generateStrategyFollowUps } = require('../helpers/FollowUpGenerator.js');

module.exports = {
  isGeneralStrategyQuery,
  handleStrategyQuery,
  narrateStrategyResult,
  generateStrategyFollowUps,
  // exported for later phases / testing
  hasStrongDomainSignal,
  getFinanceContext,
  getAdsContext,
  buildCrossDomainInsights,
  buildHealthScore,
  rankAllIssues,
  buildActionPlan,
  classifyStrategyType,
  resolveStrategyDateRange,
  // response builders
  buildWhyDecliningResponse,
  buildHowToImproveResponse,
  buildMistakesResponse,
  buildFocusResponse,
  buildCompleteSummaryResponse,
  buildAdWorthResponse,
  buildWhereLosing,
  buildHealthCheckResponse,
};

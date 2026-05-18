const QMateMetricsService = require('../QMateMetricsService.js');
const QMateIssuesService = require('../QMateIssuesService.js');
const QMatePPCService = require('../QMatePPCService.js');
const QMateProfitabilityService = require('../QMateProfitabilityService.js');
const QMateInventoryService = require('../QMateInventoryService.js');
const QMateReimbursementService = require('../QMateReimbursementService.js');
const QMateProductsService = require('../QMateProductsService.js');
const QMateAccountService = require('../QMateAccountService.js');
const QMateKeywordService = require('../QMateKeywordService.js');
const ProfitabilityReadService = require('../../Finance/ProfitabilityReadService.js');
const ProfitabilityIssuesService = require('../../Calculations/ProfitabilityIssuesService.js');
const PPCCampaignAnalysisService = require('../../Calculations/PPCCampaignAnalysisService.js');
const IssuesPaginationService = require('../../Calculations/IssuesPaginationService.js');
const IssuesDataService = require('../../Calculations/IssuesDataService.js');
const { AnalyseService } = require('../../main/Analyse.js');
const { analyseData } = require('../../Calculations/DashboardCalculation.js');
const {
    aggregateProductPerformance,
    enrichProductsWithPerformance,
} = require('../../Calculations/ProductPerformanceService.js');
const {
    buildErrorMaps,
    generateAllRecommendations,
    enrichProductsWithRecommendations,
} = require('../../Calculations/RecommendationService.js');
const { fetchAndEnrichWithComparison } = require('../../Calculations/ProductPerformanceComparisonService.js');
const ProfitabilityService = require('../../Calculations/ProfitabilityService.js');
const ExpenseReadService = require('../../Finance/ExpenseReadService.js');
const { buildExpenseReportResponseFromDB } = require('../../Sp_API/FinanceService.js');
const { pickSnapshotFeeTotalsForCalendar } = require('../../../utils/expenseSnapshotCalendar.js');
const { getTotalSalesFilteredData } = require('../../../controllers/analytics/TotalSalesFilterController.js');
const logger = require('../../../utils/Logger.js');
const {
    selectIssuesSource,
    buildIssuesChunksFromQMateContext,
} = require('./helpers/SourceSelector.js');

function safeResult(promiseFactory) {
    return promiseFactory().catch((error) => ({ success: false, error: error?.message || 'Unknown error' }));
}

function normalizeSourceResult(sourceKey, result) {
    const payload = result && typeof result === 'object' ? result : {};
    const success = Boolean(payload.success);
    const source = payload.source || sourceKey;
    const sourceMeta =
        payload.sourceMeta ||
        payload?.data?.sourceMeta ||
        { domain: sourceKey };
    return {
        ...payload,
        success,
        source,
        sourceMeta,
        error: success ? null : payload.error || 'Unknown error',
    };
}

function periodDaysForMode(calendarMode) {
    if (calendarMode === 'last7') return 7;
    if (calendarMode === 'last14') return 14;
    return 30;
}

function buildAnalyseIssueTotalsFromDashboard(dashboardData) {
    if (!dashboardData || typeof dashboardData !== 'object') return null;
    const ranking = Number(dashboardData.TotalRankingerrors || 0);
    const conversion = Number(dashboardData.totalErrorInConversion || 0);
    const inventory = Number(dashboardData.totalInventoryErrors || 0);
    const profitability = Number(dashboardData.totalProfitabilityErrors || 0);
    const ppc = Number(dashboardData.totalSponsoredAdsErrors || 0);
    const account = Number(dashboardData.totalErrorInAccount || 0);
    const totalIssues = ranking + conversion + inventory + profitability + ppc + account;
    return {
        totalIssues,
        totalRankingerrors: ranking,
        totalErrorInConversion: conversion,
        totalInventoryErrors: inventory,
        totalProfitabilityErrors: profitability,
        totalSponsoredAdsErrors: ppc,
        totalErrorInAccount: account,
    };
}

function attachIssuesSourceSelection(bySource, { userId, country, region }) {
    const issuesRes = bySource.issues;
    if (!issuesRes?.success || !issuesRes.data) return;

    const issueSummary = issuesRes.data.summary || null;
    const issuesChunks = buildIssuesChunksFromQMateContext(issuesRes.data);

    const parity = bySource.issuesByProductParity;
    let analyseData = null;
    if (parity?.success && parity.data?.issueTotals) {
        analyseData = parity.data.issueTotals;
    }

    if (
        issueSummary &&
        analyseData &&
        Number(issueSummary.totalIssues) !== Number(analyseData.totalIssues)
    ) {
        logger.info('[QMate] Issue source totals differ; selecting single source (no merge)', {
            userId,
            country,
            region,
            precomputedTotal: issueSummary.totalIssues,
            analyseTotal: analyseData.totalIssues,
        });
    }

    const selectedIssues = selectIssuesSource({ issueSummary, issuesChunks, analyseData });
    issuesRes.issuesSelection = selectedIssues;
    issuesRes.issuesSource = selectedIssues.source;

    logger.info('[QMate] Source Selection Debug', {
        userId,
        country,
        region,
        sourceUsed: selectedIssues.source,
        totalIssues:
            selectedIssues.data?.summary?.totalIssues ??
            selectedIssues.data?.totalIssues ??
            null,
    });
}

async function fetchProfitabilityParity({ userId, country, region, startDate, endDate, calendarMode }) {
    const useDateRange = Boolean(startDate && endDate && calendarMode === 'custom');
    const periodDays = periodDaysForMode(calendarMode);
    const tablePage = 1;
    const tableLimit = 10;
    const summaryPromise = useDateRange
        ? ProfitabilityReadService.getSummaryByDateRange({ userId, country, region, from: startDate, to: endDate })
        : ProfitabilityReadService.getSummaryByPeriod({ userId, country, region, periodDays });

    const chartPromise = useDateRange
        ? ProfitabilityReadService.getChartByDateRange({ userId, country, region, from: startDate, to: endDate })
        : ProfitabilityReadService.getChartByPeriod({ userId, country, region, periodDays });
    // Profitability page table parity: same service/path as /api/profitability/table*
    const tablePagePromise = useDateRange
        ? ProfitabilityReadService.getTableByDateRange({
              userId,
              country,
              region,
              from: startDate,
              to: endDate,
              page: tablePage,
              limit: tableLimit,
          })
        : ProfitabilityReadService.getTableByPeriod({
              userId,
              country,
              region,
              periodDays,
              page: tablePage,
              limit: tableLimit,
          });
    // Full table for AI reasoning while preserving page parity shape separately.
    const tableFullPromise = useDateRange
        ? ProfitabilityReadService.getTableByDateRange({
              userId,
              country,
              region,
              from: startDate,
              to: endDate,
              page: 1,
              limit: 5000,
          })
        : ProfitabilityReadService.getTableByPeriod({
              userId,
              country,
              region,
              periodDays,
              page: 1,
              limit: 5000,
          });
    const issuesPromise = safeResult(() => ProfitabilityIssuesService.getProfitabilityIssues(userId, country, region, 1, 10));
    const issuesSummaryPromise = safeResult(() => ProfitabilityIssuesService.getProfitabilityIssuesSummary(userId, country, region));
    const ppcGraphPromise = safeResult(() =>
        QMatePPCService.getQMatePPCContext(userId, country, region, {
            startDate,
            endDate,
            limit: 200,
        })
    );

    const expensesPromise = useDateRange
        ? ExpenseReadService.getTotalExpensesByDateRange({ userId, country, region, from: startDate, to: endDate })
        : ExpenseReadService.getTotalExpensesByPeriod({ userId, country, region, periodDays });

    const [summary, chart, tablePageData, tableFullData, issuesData, issuesSummaryData, ppcGraphData, totalExpenses, snapshot] = await Promise.all([
        summaryPromise,
        chartPromise,
        tablePagePromise,
        tableFullPromise,
        issuesPromise,
        issuesSummaryPromise,
        ppcGraphPromise,
        expensesPromise,
        buildExpenseReportResponseFromDB({ userId, country, regionModel: region }).catch(() => null),
    ]);

    const pickedSnapshot = snapshot
        ? pickSnapshotFeeTotalsForCalendar(snapshot, calendarMode || 'default', startDate || null, endDate || null)
        : null;

    return {
        success: true,
        source: 'profitability_page_parity',
        data: {
            summary,
            chart,
            tablePage: {
                page: tablePage,
                limit: tableLimit,
                rows: Array.isArray(tablePageData?.rows) ? tablePageData.rows : [],
                pagination: tablePageData?.pagination || null,
                sourceService: 'ProfitabilityReadService.getTableByPeriod/getTableByDateRange',
            },
            tableFullForAI: {
                rows: Array.isArray(tableFullData?.rows) ? tableFullData.rows : [],
                pagination: tableFullData?.pagination || null,
                sourceService: 'ProfitabilityReadService.getTableByPeriod/getTableByDateRange',
            },
            expenses: {
                total: Math.abs(Number(totalExpenses?.total || 0)),
                datewise: Array.isArray(totalExpenses?.datewise) ? totalExpenses.datewise : [],
                sourceService: 'ExpenseReadService.getTotalExpensesByPeriod/getTotalExpensesByDateRange',
            },
            snapshot: snapshot
                ? {
                      totals: pickedSnapshot || null,
                      dateWiseExpenses: snapshot.dateWiseExpenses || [],
                      dateWiseAmazonFees: snapshot.dateWiseAmazonFees || [],
                      sourceService: 'ExpenseReportService.buildExpenseReportResponseFromDB',
                  }
                : null,
            issuesPage: issuesData?.success ? issuesData.data || null : null,
            issuesSummary: issuesSummaryData?.success ? issuesSummaryData.data || null : null,
            ppcGraph: ppcGraphData?.success
                ? { graphData: ppcGraphData.data?.dateWiseMetrics || [], sourceService: 'QMatePPCService.getQMatePPCContext' }
                : { graphData: [], sourceService: 'QMatePPCService.getQMatePPCContext' },
            sourceMeta: {
                summary: 'ProfitabilityReadService.getSummaryByPeriod/getSummaryByDateRange',
                chart: 'ProfitabilityReadService.getChartByPeriod/getChartByDateRange',
                issues: 'ProfitabilityIssuesService.getProfitabilityIssues/getProfitabilityIssuesSummary',
            },
            mode: useDateRange ? 'date-range' : `period-${periodDays}`,
        },
    };
}

async function fetchCampaignAuditParity({ userId, country, region, startDate, endDate }) {
    const page = 1;
    const limit = 10;
    const s = startDate || null;
    const e = endDate || null;

    const [
        summary,
        tabCounts,
        highAcos,
        wastedSpend,
        noNegatives,
        topKeywords,
        zeroSales,
        autoInsights,
    ] = await Promise.all([
        PPCCampaignAnalysisService.getPPCKPISummary(userId, country, region),
        PPCCampaignAnalysisService.getTabCounts(userId, country, region),
        PPCCampaignAnalysisService.getHighAcosCampaigns(userId, country, region, page, limit, s, e),
        PPCCampaignAnalysisService.getWastedSpendKeywords(userId, country, region, page, limit, s, e),
        PPCCampaignAnalysisService.getCampaignsWithoutNegatives(userId, country, region, page, limit),
        PPCCampaignAnalysisService.getTopPerformingKeywords(userId, country, region, page, limit, s, e),
        PPCCampaignAnalysisService.getSearchTermsZeroSales(userId, country, region, page, limit, s, e),
        PPCCampaignAnalysisService.getAutoCampaignInsights(userId, country, region, page, limit, s, e),
    ]);

    return {
        success: true,
        source: 'campaign_audit_parity',
        data: {
            summary,
            tabCounts,
            highAcos,
            wastedSpend,
            campaignsWithoutNegatives: noNegatives,
            topKeywords,
            zeroSales,
            autoInsights,
            sourceMeta: {
                summary: 'PPCCampaignAnalysisService.getPPCKPISummary',
                tabCounts: 'PPCCampaignAnalysisService.getTabCounts',
                highAcos: 'PPCCampaignAnalysisService.getHighAcosCampaigns',
                wastedSpend: 'PPCCampaignAnalysisService.getWastedSpendKeywords',
                noNegatives: 'PPCCampaignAnalysisService.getCampaignsWithoutNegatives',
                topKeywords: 'PPCCampaignAnalysisService.getTopPerformingKeywords',
                zeroSales: 'PPCCampaignAnalysisService.getSearchTermsZeroSales',
                autoInsights: 'PPCCampaignAnalysisService.getAutoCampaignInsights',
            },
        },
    };
}

async function fetchIssuesPageParity({ userId, country, region }) {
    const page = 1;
    const limit = 10;
    const issuesProductsOptions = {
        page,
        limit: 6,
        sort: 'issues',
        sortOrder: 'desc',
        priority: null,
        search: null,
    };

    const [
        issuesData,
        summary,
        ranking,
        conversion,
        inventory,
        account,
        productsWithIssues,
    ] = await Promise.all([
        IssuesDataService.getIssuesData(userId, country, region, false),
        IssuesPaginationService.getIssuesSummary(userId, country, region),
        IssuesPaginationService.getRankingIssues(userId, country, region, page, limit),
        IssuesPaginationService.getConversionIssues(userId, country, region, page, limit),
        IssuesPaginationService.getInventoryIssues(userId, country, region, page, limit),
        IssuesPaginationService.getAccountIssues(userId, country, region),
        IssuesPaginationService.getProductsWithIssues(userId, country, region, issuesProductsOptions),
    ]);

    return {
        success: true,
        source: 'issues_page_parity',
        data: {
            issuesData: issuesData?.success ? issuesData.data || null : null,
            byCategory: {
                summary: summary?.success ? summary.data || null : null,
                ranking: ranking?.success ? ranking.data || null : null,
                conversion: conversion?.success ? conversion.data || null : null,
                inventory: inventory?.success ? inventory.data || null : null,
                account: account?.success ? account.data || null : null,
                products: productsWithIssues?.success ? productsWithIssues.data || null : null,
            },
            paginationMeta: {
                ranking: ranking?.success ? ranking.pagination || null : null,
                conversion: conversion?.success ? conversion.pagination || null : null,
                inventory: inventory?.success ? inventory.pagination || null : null,
                products: productsWithIssues?.success ? productsWithIssues.pagination || null : null,
            },
            sourceMeta: {
                issuesData: 'IssuesDataService.getIssuesData',
                summary: 'IssuesPaginationService.getIssuesSummary',
                ranking: 'IssuesPaginationService.getRankingIssues',
                conversion: 'IssuesPaginationService.getConversionIssues',
                inventory: 'IssuesPaginationService.getInventoryIssues',
                account: 'IssuesPaginationService.getAccountIssues',
                products: 'IssuesPaginationService.getProductsWithIssues',
            },
        },
    };
}

function deriveComparisonType(question) {
    const text = String(question || '').toLowerCase();
    if (/\bweek\s*over\s*week\b|\bwow\b/.test(text)) return 'wow';
    if (/\bmonth\s*over\s*month\b|\bmom\b/.test(text)) return 'mom';
    return 'none';
}

async function fetchIssuesByProductParity({ userId, country, region, question }) {
    const comparisonType = deriveComparisonType(question);
    const analyseResult = await AnalyseService.Analyse(userId, country, region);
    if (!analyseResult || analyseResult.status !== 200) {
        return {
            success: false,
            source: 'issues_by_product_parity',
            error: analyseResult?.message || 'Failed to fetch raw analyse payload',
        };
    }

    const rawData = analyseResult.message;
    const calculatedData = await analyseData(rawData, userId);
    const dashboardData = calculatedData?.dashboardData || {};
    const productList = dashboardData.productWiseError || [];
    const { asinPpcSales: economicsAsinSalesOverride } =
        await ProfitabilityService.getAsinPpcSalesFromEconomics(rawData?.EconomicsMetrics);
    const performanceMap = aggregateProductPerformance({
        productList,
        buyBoxData: rawData?.BuyBoxData,
        productWiseSponsoredAds: rawData?.ProductWiseSponsoredAds,
        economicsMetrics: rawData?.EconomicsMetrics,
        economicsAsinSalesOverride,
    });
    let enrichedProducts = enrichProductsWithPerformance(productList, performanceMap);

    let comparisonMeta = null;
    if (comparisonType !== 'none') {
        const comparisonResult = await fetchAndEnrichWithComparison({
            userId,
            region,
            country,
            comparisonType,
            currentBuyBoxData: rawData?.BuyBoxData,
            currentEconomicsData: rawData?.EconomicsMetrics,
            products: enrichedProducts,
        });
        enrichedProducts = comparisonResult?.products || enrichedProducts;
        comparisonMeta = comparisonResult?.comparisonMeta || null;
    }

    const errorMaps = buildErrorMaps(
        dashboardData.conversionProductWiseErrors || [],
        dashboardData.rankingProductWiseErrors || [],
        dashboardData.inventoryProductWiseErrors || []
    );
    const recommendationsMap = generateAllRecommendations(enrichedProducts, errorMaps);
    enrichedProducts = enrichProductsWithRecommendations(enrichedProducts, recommendationsMap);

    return {
        success: true,
        source: 'issues_by_product_parity',
        data: {
            productWiseError: enrichedProducts,
            rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
            conversionProductWiseErrors: dashboardData.conversionProductWiseErrors || [],
            inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || [],
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            InventoryAnalysis: dashboardData.InventoryAnalysis || {},
            Country: dashboardData.Country,
            profitibilityData: dashboardData.profitibilityData || [],
            buyBoxSummary: rawData?.BuyBoxData
                ? {
                      totalProducts: rawData.BuyBoxData.totalProducts,
                      productsWithBuyBox: rawData.BuyBoxData.productsWithBuyBox,
                      productsWithoutBuyBox: rawData.BuyBoxData.productsWithoutBuyBox,
                      dateRange: rawData.BuyBoxData.dateRange,
                  }
                : null,
            comparisonMeta,
            issueTotals: buildAnalyseIssueTotalsFromDashboard(dashboardData),
            sourceMeta: {
                raw: 'AnalyseService.Analyse',
                calculate: 'DashboardCalculation.analyseData',
                performance: 'ProductPerformanceService.aggregateProductPerformance/enrichProductsWithPerformance',
                recommendations:
                    'RecommendationService.buildErrorMaps/generateAllRecommendations/enrichProductsWithRecommendations',
                comparison: 'ProductPerformanceComparisonService.fetchAndEnrichWithComparison',
            },
        },
    };
}

async function fetchUnifiedData({ resolvedContext, executionPlan, question }) {
    const req = executionPlan?.dataRequirements || {};
    const { userId, country, region, startDate, endDate, calendarMode } = resolvedContext;
    const asinMatch = String(question || '').match(/\b(B0[A-Z0-9]{8,9})\b/i);
    const asin = asinMatch ? asinMatch[1].toUpperCase() : null;

    const tasks = {};

    if (req.metrics) {
        tasks.metrics = safeResult(() =>
            QMateMetricsService.getQMateMetricsContext(userId, country, region, {
                topAsinsLimit: 25,
                startDate,
                endDate,
                calendarMode,
            })
        );
        // Profitability-page parity source for sales/expenses/gross-profit values.
        tasks.profitabilityParity = safeResult(() =>
            fetchProfitabilityParity({
                userId,
                country,
                region,
                startDate,
                endDate,
                calendarMode,
            })
        );
        tasks.salesOnlyParity = safeResult(async () => {
            const periodType =
                calendarMode === 'last7'
                    ? 'last7'
                    : calendarMode === 'last14'
                    ? 'last14'
                    : calendarMode === 'custom' && startDate && endDate
                    ? 'custom'
                    : 'last30';
            const data = await getTotalSalesFilteredData(userId, country, region, {
                periodType,
                startDate,
                endDate,
            });
            return {
                success: true,
                source: 'total_sales_filter_parity',
                data,
            };
        });
    }
    if (req.issues) {
        tasks.issues = safeResult(() =>
            QMateIssuesService.getQMateIssuesContext(userId, country, region, {
                topProductsLimit: 30,
                issuesPerCategoryLimit: 50,
            })
        );
        tasks.issuesPageParity = safeResult(() =>
            fetchIssuesPageParity({
                userId,
                country,
                region,
            })
        );
        tasks.issuesByProductParity = safeResult(() =>
            fetchIssuesByProductParity({
                userId,
                country,
                region,
                question,
            })
        );
    }
    if (req.ppc) {
        tasks.ppc = safeResult(() =>
            QMatePPCService.getQMatePPCContext(userId, country, region, {
                startDate,
                endDate,
                limit: 200,
            })
        );
        tasks.campaignAuditParity = safeResult(() =>
            fetchCampaignAuditParity({
                userId,
                country,
                region,
                startDate,
                endDate,
            })
        );
    }
    if (req.profitability) tasks.profitability = safeResult(() => QMateProfitabilityService.getQMateProfitabilityContext(userId, country, region));
    if (req.inventory) tasks.inventory = safeResult(() => QMateInventoryService.getQMateInventoryContext(userId, country, region));
    if (req.reimbursement) tasks.reimbursement = safeResult(() => QMateReimbursementService.getQMateReimbursementContext(userId, country, region));
    if (req.products) tasks.products = safeResult(() => QMateProductsService.getQMateProductsContext(userId, country, region));
    if (req.account) tasks.account = safeResult(() => QMateAccountService.getQMateAccountContext(userId, country, region));
    if (req.keywords) {
        tasks.keywords = safeResult(() =>
            QMateKeywordService.getQMateKeywordContext(userId, country, region, { asin, limit: 500 })
        );
    }

    const keys = Object.keys(tasks);
    const values = await Promise.all(keys.map((k) => tasks[k]));
    const bySource = keys.reduce((acc, key, idx) => {
        acc[key] = normalizeSourceResult(key, values[idx]);
        return acc;
    }, {});

    if (req.issues && bySource.issues?.success) {
        attachIssuesSourceSelection(bySource, { userId, country, region });
    }

    return {
        bySource,
        primaryMetrics: bySource.metrics?.data || null,
        fetchStatus: keys.reduce((acc, k) => {
            acc[k] = Boolean(bySource[k]?.success);
            return acc;
        }, {}),
    };
}

module.exports = { fetchUnifiedData };

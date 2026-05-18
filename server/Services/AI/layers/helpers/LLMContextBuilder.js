/**
 * Builds a compact, backend-only view of unified fetch results for LLM rendering.
 * Unified payloads use `bySource` keys from UnifiedDataAccessService.fetchUnifiedData.
 */

function buildIssuesContextForLLM(by) {
    const selection = by.issues?.issuesSelection;
    if (selection?.source === 'precomputed' || selection?.source === 'summary_only') {
        const summary = selection.data?.summary;
        if (!summary || typeof summary !== 'object') return null;
        return {
            total: summary.totalIssues != null ? Number(summary.totalIssues) : 0,
            ranking: Number(summary.totalRankingErrors ?? summary.rankingErrors ?? 0),
            inventory: Number(summary.totalInventoryErrors ?? summary.inventoryErrors ?? 0),
            conversion: Number(summary.totalConversionErrors ?? summary.conversionErrors ?? 0),
            ppc: Number(summary.totalSponsoredAdsErrors ?? summary.sponsoredAdsErrors ?? 0),
            profitability: Number(summary.totalProfitabilityErrors ?? summary.profitabilityErrors ?? 0),
        };
    }
    if (selection?.source === 'analyse') {
        const data = selection.data;
        if (!data || typeof data !== 'object') return null;
        return {
            total: data.totalIssues != null ? Number(data.totalIssues) : 0,
            ranking: Number(data.totalRankingerrors ?? data.TotalRankingerrors ?? 0),
            inventory: Number(data.totalInventoryErrors ?? 0),
            conversion: Number(data.totalErrorInConversion ?? 0),
            ppc: Number(data.totalSponsoredAdsErrors ?? 0),
            profitability: Number(data.totalProfitabilityErrors ?? 0),
        };
    }

    const issuesRoot = by.issues?.data;
    const summary = issuesRoot?.summary;
    if (summary && typeof summary === 'object') {
        return {
            total: summary.totalIssues != null ? Number(summary.totalIssues) : 0,
            ranking: Number(summary.totalRankingErrors ?? summary.rankingErrors ?? 0),
            inventory: Number(summary.totalInventoryErrors ?? summary.inventoryErrors ?? 0),
            conversion: Number(summary.totalConversionErrors ?? summary.conversionErrors ?? 0),
            ppc: Number(summary.totalSponsoredAdsErrors ?? summary.sponsoredAdsErrors ?? 0),
            profitability: Number(summary.totalProfitabilityErrors ?? summary.profitabilityErrors ?? 0),
        };
    }
    if (issuesRoot && typeof issuesRoot === 'object' && (issuesRoot.totalIssues != null || issuesRoot.inventoryErrors != null)) {
        return {
            total: issuesRoot.totalIssues != null ? Number(issuesRoot.totalIssues) : 0,
            ranking: Number(issuesRoot.rankingErrors ?? issuesRoot.totalRankingErrors ?? 0),
            inventory: Number(issuesRoot.inventoryErrors ?? 0),
            conversion: Number(issuesRoot.conversionErrors ?? 0),
            ppc: Number(issuesRoot.sponsoredAdsErrors ?? 0),
            profitability: Number(issuesRoot.profitabilityErrors ?? 0),
        };
    }
    return null;
}

function buildLLMContext(unifiedData, _interpretation) {
    const by = unifiedData?.bySource || {};
    const context = {};

    const metricsSummary = by.metrics?.data?.summary;
    if (metricsSummary && typeof metricsSummary === 'object') {
        context.sales = metricsSummary.totalSales != null ? metricsSummary.totalSales : null;
        context.profit = metricsSummary.grossProfit != null ? metricsSummary.grossProfit : null;
        context.adSpend = metricsSummary.ppcSpend != null ? metricsSummary.ppcSpend : null;
    }

    const issuesCtx = buildIssuesContextForLLM(by);
    if (issuesCtx) {
        context.issues = {
            total: issuesCtx.total,
            inventory: issuesCtx.inventory,
            ppc: issuesCtx.ppc,
            ranking: issuesCtx.ranking,
            conversion: issuesCtx.conversion,
            profitability: issuesCtx.profitability,
        };
    }

    const productsData = by.products?.data;
    let topProducts = [];
    if (Array.isArray(productsData?.topProducts)) {
        topProducts = productsData.topProducts.slice(0, 5);
    } else if (Array.isArray(productsData?.topSellingProducts)) {
        topProducts = productsData.topSellingProducts.slice(0, 5);
    } else {
        const rows =
            by.profitabilityParity?.data?.tableFullForAI?.rows ||
            by.profitabilityParity?.data?.tablePage?.rows ||
            [];
        if (Array.isArray(rows) && rows.length) {
            topProducts = [...rows]
                .sort((a, b) => Number(b?.totalSales || 0) - Number(a?.totalSales || 0))
                .slice(0, 5)
                .map((r) => ({ asin: r.asin, totalSales: r.totalSales }));
        }
    }
    if (topProducts.length) {
        context.topProducts = topProducts;
    }

    if (by.inventory?.data?.summary && typeof by.inventory.data.summary === 'object') {
        context.inventory = by.inventory.data.summary;
    }

    return context;
}

module.exports = { buildLLMContext, buildIssuesContextForLLM };

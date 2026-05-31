const logger = require('../../../../../utils/Logger.js');

function numeric(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * @deprecated Use FinanceEngine.handleFinanceQuery() instead.
 * This function does NOT match the dashboard's expense/profit calculation:
 * - Missing COGS subtraction
 * - Missing overhead expenses
 * - Missing per-field expense formula (uses aggregate totalExpenses instead)
 * - adSpend potentially double-counted
 *
 * Retained for backward compatibility in non-finance suggestion_engine paths.
 * The FinanceEngine intercept in layers/index.js handles finance queries
 * before this function is reached.
 */
function buildProfitabilityDerived({ profitabilityParity, campaignAuditParity, reimbursement }) {
    logger.warn('[QMate][DEPRECATED] buildProfitabilityDerived called — should be handled by FinanceEngine for finance queries');
    const summary = profitabilityParity?.summary || {};
    const expenses = profitabilityParity?.expenses || {};
    const snapshotTotals = profitabilityParity?.snapshot?.totals || {};
    const tableRows = Array.isArray(profitabilityParity?.tableFullForAI?.rows) ? profitabilityParity.tableFullForAI.rows : [];
    const totalSales = numeric(summary.totalSales);
    const totalExpenses = Math.abs(numeric(snapshotTotals.totalExpenses || summary.totalExpenses || expenses.total));
    const adSpend = numeric(campaignAuditParity?.summary?.spend || summary.ppcSpend);
    const grossProfit = numeric(totalSales - totalExpenses - adSpend);

    const losingProducts = tableRows.filter((row) => numeric(row?.grossProfit) < 0).length;
    const lowMarginProducts = tableRows.filter((row) => {
        const sales = numeric(row?.totalSales);
        if (sales <= 0) return false;
        const marginPct = (numeric(row?.grossProfit) / sales) * 100;
        return marginPct >= 0 && marginPct < 10;
    }).length;
    const healthyProducts = Math.max(0, tableRows.length - losingProducts - lowMarginProducts);
    const overallMarginPct = totalSales > 0 ? ((grossProfit / totalSales) * 100) : 0;
    const businessHealth =
        overallMarginPct > 15 ? 'HEALTHY' : overallMarginPct > 5 ? 'CAUTION' : 'CRITICAL';

    return {
        totalSales,
        totalExpenses,
        adSpend,
        grossProfit,
        overallMarginPct: Number(overallMarginPct.toFixed(2)),
        productHealth: {
            totalProducts: tableRows.length,
            losingProducts,
            lowMarginProducts,
            healthyProducts,
            businessHealth,
        },
        reimbursement: {
            recoverable: numeric(reimbursement?.recoverable?.summary?.totalRecoverable),
            received: numeric(reimbursement?.received?.summary?.totalAmount),
        },
    };
}

function buildPpcDerived({ campaignAuditParity }) {
    const highAcos = Array.isArray(campaignAuditParity?.highAcos?.data) ? campaignAuditParity.highAcos.data : [];
    const wasted = Array.isArray(campaignAuditParity?.wastedSpend?.data) ? campaignAuditParity.wastedSpend.data : [];
    const topKeywords = Array.isArray(campaignAuditParity?.topKeywords?.data) ? campaignAuditParity.topKeywords.data : [];
    const zeroSales = Array.isArray(campaignAuditParity?.zeroSales?.data) ? campaignAuditParity.zeroSales.data : [];

    const totalWastedSpend = wasted.reduce((sum, row) => sum + numeric(row?.spend), 0);
    const totalTopKeywordSales = topKeywords.reduce((sum, row) => sum + numeric(row?.sales), 0);
    const totalTopKeywordSpend = topKeywords.reduce((sum, row) => sum + numeric(row?.spend), 0);
    const topKeywordAcos = totalTopKeywordSales > 0 ? (totalTopKeywordSpend / totalTopKeywordSales) * 100 : 0;

    return {
        counts: {
            highAcos: highAcos.length,
            wasted: wasted.length,
            topKeywords: topKeywords.length,
            zeroSales: zeroSales.length,
        },
        totals: {
            totalWastedSpend: Number(totalWastedSpend.toFixed(2)),
            topKeywordSales: Number(totalTopKeywordSales.toFixed(2)),
            topKeywordSpend: Number(totalTopKeywordSpend.toFixed(2)),
            topKeywordAcos: Number(topKeywordAcos.toFixed(2)),
        },
    };
}

function buildIssuesDerived({ issuesPageParity, issuesByProductParity, issuesSelection }) {
    if (issuesSelection?.source === 'analyse' && issuesSelection.data && typeof issuesSelection.data === 'object') {
        const d = issuesSelection.data;
        const ranking = numeric(d.totalRankingerrors ?? d.TotalRankingerrors);
        const conversion = numeric(d.totalErrorInConversion);
        const inventory = numeric(d.totalInventoryErrors);
        const account = numeric(d.totalErrorInAccount);
        const ppc = numeric(d.totalSponsoredAdsErrors);
        const profitability = numeric(d.totalProfitabilityErrors);
        const totalIssues = numeric(d.totalIssues) || ranking + conversion + inventory + profitability + account;
        const productsWithIssues = Array.isArray(issuesByProductParity?.productWiseError)
            ? issuesByProductParity.productWiseError.length
            : 0;
        return {
            counts: {
                totalIssues,
                ranking,
                conversion,
                inventory,
                account,
                ppc,
                profitability,
                productsWithIssues,
            },
        };
    }

    if (
        (issuesSelection?.source === 'precomputed' || issuesSelection?.source === 'summary_only') &&
        issuesSelection.data?.summary &&
        typeof issuesSelection.data.summary === 'object'
    ) {
        const s = issuesSelection.data.summary;
        const ranking = numeric(s.totalRankingErrors ?? s.ranking ?? s.rankingErrors);
        const conversion = numeric(s.totalConversionErrors ?? s.conversion ?? s.conversionErrors);
        const inventory = numeric(s.totalInventoryErrors ?? s.inventory ?? s.inventoryErrors);
        const account = numeric(s.totalAccountErrors ?? s.account ?? s.accountErrors);
        const ppc = numeric(s.totalSponsoredAdsErrors ?? s.sponsoredAdsErrors);
        const profitability = numeric(s.totalProfitabilityErrors ?? s.profitabilityErrors);
        const totalIssues = numeric(s.totalIssues) || ranking + conversion + inventory + account + ppc + profitability;
        const productsWithIssues = numeric(s.numberOfProductsWithIssues);
        return {
            counts: {
                totalIssues,
                ranking,
                conversion,
                inventory,
                account,
                ppc,
                profitability,
                productsWithIssues,
            },
        };
    }

    const summary = issuesPageParity?.byCategory?.summary || {};
    const ranking = numeric(summary.ranking || summary.totalRankingErrors);
    const conversion = numeric(summary.conversion || summary.totalConversionErrors);
    const inventory = numeric(summary.inventory || summary.totalInventoryErrors);
    const account = numeric(summary.account || summary.totalAccountErrors);
    const totalIssues = ranking + conversion + inventory + account;
    const productsWithIssues = Array.isArray(issuesByProductParity?.productWiseError)
        ? issuesByProductParity.productWiseError.length
        : 0;

    return {
        counts: {
            totalIssues,
            ranking,
            conversion,
            inventory,
            account,
            productsWithIssues,
        },
    };
}

function buildDerivedParityContext({ bySource }) {
    const profitabilityParity = bySource?.profitabilityParity?.data || null;
    const campaignAuditParity = bySource?.campaignAuditParity?.data || null;
    const issuesPageParity = bySource?.issuesPageParity?.data || null;
    const issuesByProductParity = bySource?.issuesByProductParity?.data || null;
    const reimbursement = bySource?.reimbursement?.data || null;
    const issuesSelection = bySource?.issues?.issuesSelection || null;

    return {
        profitability: buildProfitabilityDerived({ profitabilityParity, campaignAuditParity, reimbursement }),
        ppc: buildPpcDerived({ campaignAuditParity }),
        issues: buildIssuesDerived({ issuesPageParity, issuesByProductParity, issuesSelection }),
    };
}

module.exports = {
    numeric,
    buildProfitabilityDerived,
    buildPpcDerived,
    buildIssuesDerived,
    buildDerivedParityContext,
};

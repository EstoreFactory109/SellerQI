const { getDashboardPhase3 } = require('../../../Calculations/DashboardSummaryService.js');
const { buildDerivedParityContext } = require('./helpers/FrontendParityCalculations.js');
const { generateFollowUps } = require('../helpers/FollowUpGenerator.js');

function numeric(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function normalizeDateKey(value) {
    if (!value) return null;
    const s = String(value);
    const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

async function handleInformationIntent({ interpretation, unifiedData, question, resolvedContext }) {
    const prompt = String(question || '').toLowerCase();
    const outputFormat = interpretation?.outputPreference?.format || 'unspecified';
    // Phase 4 / Task 4.1: deterministic, intent-templated follow-ups.
    // Single-number answers stay quiet (no follow-up chips); everything else
    // gets up-to-3 answerable suggestions from FollowUpGenerator.
    const followUps = outputFormat === 'single_number'
        ? []
        : generateFollowUps(interpretation?.intent, interpretation?.entities, unifiedData);
    const metrics = unifiedData?.bySource?.metrics;
    const profitabilityParity = unifiedData?.bySource?.profitabilityParity?.data;
    const campaignAuditParity = unifiedData?.bySource?.campaignAuditParity?.data;
    const salesOnlyParity = unifiedData?.bySource?.salesOnlyParity?.data;
    const reimbursement = unifiedData?.bySource?.reimbursement?.data;
    const issuesParity = unifiedData?.bySource?.issuesPageParity?.data;
    const issuesByProductParity = unifiedData?.bySource?.issuesByProductParity?.data;
    const productQuery = interpretation?.entities?.productQuery || null;
    const tableRows = Array.isArray(profitabilityParity?.tableFullForAI?.rows) ? profitabilityParity.tableFullForAI.rows : [];
    const summary = metrics?.data?.summary || {};
    const expenses = metrics?.data?.expenses || {};
    const currency = summary.currency || 'USD';
    const derived = buildDerivedParityContext({ bySource: unifiedData?.bySource || {} });
    const asksSales = /\b(total\s+)?sales\b/.test(prompt);
    const asksProfit = /\b(gross\s*profit|profit)\b/.test(prompt);
    const wantsGraph = outputFormat === 'graph' || /\b(graph|chart|plot|trend|representation|visual)\b/.test(prompt);

    const asksGrossProfit = /\bgross\s*profit\b/.test(prompt);

    if (wantsGraph && asksSales && asksProfit) {
        const profitabilityChart = Array.isArray(profitabilityParity?.chart) ? profitabilityParity.chart : [];
        const salesOnlyDatewise = Array.isArray(salesOnlyParity?.datewiseChartData) ? salesOnlyParity.datewiseChartData : [];
        const expenseDatewise = Array.isArray(profitabilityParity?.expenses?.datewise) ? profitabilityParity.expenses.datewise : [];
        const ppcDatewise = Array.isArray(profitabilityParity?.ppcGraph?.graphData) ? profitabilityParity.ppcGraph.graphData : [];
        const salesRows = salesOnlyDatewise.length > 0 ? salesOnlyDatewise : profitabilityChart;
        const expensesByDate = new Map();
        for (const row of expenseDatewise) {
            const key = normalizeDateKey(row?.date);
            if (!key) continue;
            expensesByDate.set(key, Number(row?.totalAmount || 0));
        }
        const ppcByDate = new Map();
        for (const row of ppcDatewise) {
            const key = normalizeDateKey(row?.rawDate || row?.date);
            if (!key) continue;
            ppcByDate.set(key, Number(row?.spend || 0));
        }
        const merged = salesRows.map((row) => {
            const key = normalizeDateKey(row?.originalDate || row?.date);
            const totalSales = Number(row?.totalSales || 0);
            const totalExpenses = key ? Number(expensesByDate.get(key) || 0) : 0;
            const adSpend = key ? Number(ppcByDate.get(key) || 0) : 0;
            return {
                date: key || String(row?.date || ''),
                totalSales: Number(totalSales.toFixed(2)),
                grossProfit: Number((totalSales - totalExpenses - adSpend).toFixed(2)),
            };
        });
        if (merged.length > 0) {
            return {
                status: 200,
                answer_markdown: `Here is the sales vs gross profit graph data for the selected period (${currency}).`,
                chart_suggestions: [
                    {
                        type: 'line',
                        title: 'Total Sales vs Gross Profit',
                        data: merged,
                        xField: 'date',
                        yFields: [
                            { field: 'totalSales', label: 'Total Sales' },
                            { field: 'grossProfit', label: 'Gross Profit' },
                        ],
                    },
                ],
                follow_up_questions: followUps,
                needs_clarification: false,
                intent_interpretation: interpretation,
                responseSource: 'deterministic',
                dataConfidence: 'high',
                dataSources: ['metrics'],
            };
        }
    }

    if (/\b(issue|issues|errors?)\b/.test(prompt) && /\b(total|count|how many)\b/.test(prompt)) {
        const issuesSelection = unifiedData?.bySource?.issues?.issuesSelection;
        const summaryObj = issuesParity?.byCategory?.summary || {};
        const possibleCounts = Object.values(summaryObj).map((v) => Number(v)).filter((n) => Number.isFinite(n));
        let totalIssues = Number(derived?.issues?.counts?.totalIssues || 0);
        if (issuesSelection?.source === 'precomputed' || issuesSelection?.source === 'summary_only') {
            totalIssues = Number(issuesSelection.data?.summary?.totalIssues ?? totalIssues);
        } else if (issuesSelection?.source === 'analyse') {
            totalIssues = Number(issuesSelection.data?.totalIssues ?? totalIssues);
        }
        if (totalIssues <= 0 && possibleCounts.length > 0) {
            totalIssues = possibleCounts.reduce((sum, n) => sum + n, 0);
        } else if (totalIssues <= 0 && Array.isArray(issuesByProductParity?.productWiseError)) {
            totalIssues = issuesByProductParity.productWiseError.reduce((sum, row) => sum + Number(row?.totalErrors || 0), 0);
        }
        if (totalIssues > 0) {
            return {
                status: 200,
                answer_markdown: `Total detected issues for the selected account: ${Number(totalIssues).toFixed(0)}.`,
                chart_suggestions: [],
                follow_up_questions: followUps,
                needs_clarification: false,
                intent_interpretation: interpretation,
                responseSource: 'deterministic',
                dataConfidence: 'high',
                dataSources: ['issues'],
            };
        }
    }

    if (productQuery?.type === 'best_selling_product' || productQuery?.type === 'top_n_products') {
        const byProfit = productQuery.metric === 'profit';
        const sortField = byProfit ? 'grossProfit' : 'totalSales';
        const metricLabel = byProfit ? 'gross profit' : 'sales';
        const rankingLabel = byProfit ? 'most profitable' : 'selling';
        const sorted = [...tableRows].sort(
            (a, b) => Number(b?.[sortField] || 0) - Number(a?.[sortField] || 0)
        );
        if (sorted.length > 0) {
            if (productQuery.type === 'best_selling_product') {
                const top = sorted[0];
                const headline = byProfit
                    ? `Most profitable product (selected period): ASIN ${top.asin} with gross profit ${currency} ${Number(top.grossProfit || 0).toFixed(2)} on sales ${currency} ${Number(top.totalSales || 0).toFixed(2)}.`
                    : `Best selling product (selected period): ASIN ${top.asin} with sales ${currency} ${Number(top.totalSales || 0).toFixed(2)}.`;
                return {
                    status: 200,
                    answer_markdown: headline,
                    chart_suggestions: [],
                    follow_up_questions: followUps,
                    needs_clarification: false,
                    intent_interpretation: interpretation,
                };
            }
            const limit = Math.max(1, Math.min(100, Number(productQuery.limit || 10)));
            const topList = sorted.slice(0, limit);
            return {
                status: 200,
                answer_markdown:
                    `Top ${topList.length} ${rankingLabel} products (selected period):\n` +
                    topList
                        .map((r, idx) => `${idx + 1}. ${r.asin} - ${currency} ${Number(r?.[sortField] || 0).toFixed(2)} ${metricLabel}`)
                        .join('\n'),
                chart_suggestions: [],
                follow_up_questions: followUps,
                needs_clarification: false,
                intent_interpretation: interpretation,
                responseSource: 'deterministic',
                dataConfidence: 'high',
                dataSources: ['metrics'],
            };
        }
    }
    if (asksGrossProfit) {
        const totalSales =
            numeric(salesOnlyParity?.totalSales?.amount) ??
            numeric(profitabilityParity?.summary?.totalSales) ??
            numeric(summary.totalSales) ??
            0;
        const snapshotExpenses = numeric(profitabilityParity?.snapshot?.totals?.totalExpenses);
        const summaryExpenses = numeric(profitabilityParity?.summary?.totalExpenses);
        const expensesServiceTotal = numeric(profitabilityParity?.expenses?.total);
        const metricsExpenses = numeric(expenses?.totalExpenses?.total);
        const totalExpenses = Math.abs(snapshotExpenses ?? summaryExpenses ?? expensesServiceTotal ?? metricsExpenses ?? 0);
        const totalAdSpend =
            numeric(salesOnlyParity?.ppcSpent?.amount) ??
            numeric(summary.ppcSpend) ??
            numeric(campaignAuditParity?.summary?.spend) ??
            0;
        let grossProfit = totalSales - totalExpenses - totalAdSpend;
        if (!Number.isFinite(grossProfit)) grossProfit = numeric(derived?.profitability?.grossProfit) || 0;
        return {
            status: 200,
            answer_markdown: `Gross profit for the selected period: ${currency} ${Number(grossProfit).toFixed(2)}.`,
            chart_suggestions: [],
            follow_up_questions: followUps,
            needs_clarification: false,
            intent_interpretation: interpretation,
        };
    }

    if (/\bmoney\s+wasted\b.*\bads\b|\bwasted.*ads\b/.test(prompt)) {
        let wasted = campaignAuditParity ? numeric(derived?.ppc?.totals?.totalWastedSpend) : null;
        if (wasted === null) wasted = numeric(campaignAuditParity?.wastedSpend?.data?.reduce((sum, row) => sum + (Number(row?.spend || 0)), 0));
        if (wasted === null) wasted = numeric(metrics?.data?.wastedAds?.totalWastedSpend);
        if (wasted === null) {
            try {
                const d = await getDashboardPhase3(resolvedContext.userId, resolvedContext.country, resolvedContext.region);
                if (d?.success) wasted = numeric(d?.data?.moneyWastedInAds);
            } catch (e) {}
        }
        if (wasted !== null) {
            return {
                status: 200,
                answer_markdown: `Money Wasted in Ads is ${currency} ${Number(wasted).toFixed(2)} for the selected period.`,
                chart_suggestions: [],
                follow_up_questions: followUps,
                needs_clarification: false,
                intent_interpretation: interpretation,
                responseSource: 'deterministic',
                dataConfidence: 'high',
                dataSources: ['metrics'],
            };
        }
    }

    if (asksSales) {
        const totalSales =
            numeric(salesOnlyParity?.totalSales?.amount) ??
            numeric(profitabilityParity?.summary?.totalSales) ??
            numeric(summary.totalSales);
        if (totalSales !== null) {
            return {
                status: 200,
                answer_markdown: `Total sales for the selected period: ${currency} ${Number(totalSales).toFixed(2)}.`,
                chart_suggestions: [],
                follow_up_questions: followUps,
                needs_clarification: false,
                intent_interpretation: interpretation,
                responseSource: 'deterministic',
                dataConfidence: 'high',
                dataSources: ['metrics'],
            };
        }
    }

    if (/\b(other|remaining|non[-\s]?amazon)\s+(expenses|expense|expences|expence)\b/.test(prompt)) {
        const totalExpensesRaw =
            numeric(profitabilityParity?.snapshot?.totals?.totalExpenses) ??
            numeric(profitabilityParity?.summary?.totalExpenses) ??
            numeric(profitabilityParity?.expenses?.total) ??
            numeric(expenses?.totalExpenses?.total) ??
            numeric(derived?.profitability?.totalExpenses);
        const amazonFeesRaw =
            numeric(profitabilityParity?.snapshot?.totals?.amazonFees) ??
            numeric(profitabilityParity?.summary?.amazonFees) ??
            numeric(summary.amazonFees) ??
            0;
        const refundsRaw =
            numeric(profitabilityParity?.summary?.refunds) ??
            numeric(summary.refunds) ??
            0;
        const totalExpenses = Math.abs(Number(totalExpensesRaw || 0));
        const amazonFees = Math.abs(Number(amazonFeesRaw || 0));
        const refunds = Math.abs(Number(refundsRaw || 0));
        const otherExpenses = totalExpenses - amazonFees - refunds;
        return {
            status: 200,
            answer_markdown: `Other expenses for the selected period: ${currency} ${Number(otherExpenses).toFixed(2)}.`,
            chart_suggestions: [],
            follow_up_questions: followUps,
            needs_clarification: false,
            intent_interpretation: interpretation,
        };
    }

    if (/\bamazon fees?\b/.test(prompt)) {
        const amazonFees =
            numeric(profitabilityParity?.snapshot?.totals?.amazonFees) ??
            numeric(profitabilityParity?.summary?.amazonFees) ??
            numeric(summary.amazonFees);
        if (amazonFees !== null) {
            return {
                status: 200,
                answer_markdown: `Amazon fees for the selected period: ${currency} ${Math.abs(Number(amazonFees)).toFixed(2)}.`,
                chart_suggestions: [],
                follow_up_questions: followUps,
                needs_clarification: false,
                intent_interpretation: interpretation,
                responseSource: 'deterministic',
                dataConfidence: 'high',
                dataSources: ['metrics'],
            };
        }
    }

    if (/\brefunds?\b/.test(prompt)) {
        const refunds =
            numeric(profitabilityParity?.summary?.refunds) ??
            numeric(summary.refunds) ??
            0;
        return {
            status: 200,
            answer_markdown: `Refunds for the selected period: ${currency} ${Math.abs(Number(refunds)).toFixed(2)}.`,
            chart_suggestions: [],
            follow_up_questions: followUps,
            needs_clarification: false,
            intent_interpretation: interpretation,
        };
    }

    if (/\bfba fees?\b/.test(prompt)) {
        const fbaFees =
            numeric(profitabilityParity?.summary?.fbaFees) ??
            numeric(summary.fbaFees) ??
            0;
        return {
            status: 200,
            answer_markdown: `FBA fees for the selected period: ${currency} ${Math.abs(Number(fbaFees)).toFixed(2)}.`,
            chart_suggestions: [],
            follow_up_questions: followUps,
            needs_clarification: false,
            intent_interpretation: interpretation,
        };
    }

    if (/\bstorage fees?\b/.test(prompt)) {
        const storageFees =
            numeric(profitabilityParity?.summary?.storageFees) ??
            numeric(summary.storageFees) ??
            0;
        return {
            status: 200,
            answer_markdown: `Storage fees for the selected period: ${currency} ${Math.abs(Number(storageFees)).toFixed(2)}.`,
            chart_suggestions: [],
            follow_up_questions: followUps,
            needs_clarification: false,
            intent_interpretation: interpretation,
        };
    }

    if (/\b(total\s+)?(expenses|expense|expences|expence)\b/.test(prompt)) {
        let totalExpenses =
            numeric(profitabilityParity?.snapshot?.totals?.totalExpenses) ??
            numeric(profitabilityParity?.summary?.totalExpenses) ??
            numeric(profitabilityParity?.expenses?.total) ??
            numeric(expenses?.totalExpenses?.total);
        if (totalExpenses === null) totalExpenses = numeric(derived?.profitability?.totalExpenses);
        if (totalExpenses !== null) {
            return {
                status: 200,
                answer_markdown: `Total expenses for the selected period: ${currency} ${Math.abs(Number(totalExpenses)).toFixed(2)}.`,
                chart_suggestions: [],
                follow_up_questions: followUps,
                needs_clarification: false,
                intent_interpretation: interpretation,
                responseSource: 'deterministic',
                dataConfidence: 'high',
                dataSources: ['metrics'],
            };
        }
    }

    const asksReimbursement =
        /\breimbursement(s)?\b/.test(prompt) ||
        /\brecoverable\b/.test(prompt) ||
        /\bclaim(s|able)?\b/.test(prompt) ||
        /\blost inventory\b/.test(prompt) ||
        /\bdamaged inventory\b/.test(prompt) ||
        /\bdisposed inventory\b/.test(prompt) ||
        /\bshipment discrepancy\b/.test(prompt);
    if (asksReimbursement) {
        const recoverableTotal = numeric(derived?.profitability?.reimbursement?.recoverable || reimbursement?.recoverable?.summary?.totalRecoverable);
        const receivedTotal = numeric(derived?.profitability?.reimbursement?.received || reimbursement?.received?.summary?.totalAmount);
        const reimbCurrency = reimbursement?.received?.summary?.currency || currency;
        if (recoverableTotal !== null || receivedTotal !== null) {
            return {
                status: 200,
                answer_markdown:
                    `Reimbursement snapshot (selected account):\n` +
                    `- Recoverable reimbursements: ${reimbCurrency} ${Number(recoverableTotal || 0).toFixed(2)}\n` +
                    `- Reimbursements received: ${reimbCurrency} ${Number(receivedTotal || 0).toFixed(2)}`,
                chart_suggestions: [],
                follow_up_questions: followUps,
                needs_clarification: false,
                intent_interpretation: interpretation,
                responseSource: 'deterministic',
                dataConfidence: 'high',
                dataSources: ['reimbursement'],
            };
        }
    }

    if (/\b(business health|health status)\b/.test(prompt)) {
        const health = derived?.profitability?.productHealth?.businessHealth || 'UNKNOWN';
        const margin = Number(derived?.profitability?.overallMarginPct || 0);
        return {
            status: 200,
            answer_markdown: `Profitability health status: ${health} (overall margin ${margin.toFixed(2)}%).`,
            chart_suggestions: [],
            follow_up_questions: followUps,
            needs_clarification: false,
            intent_interpretation: interpretation,
            responseSource: 'deterministic',
            dataConfidence: 'high',
            dataSources: ['profitability'],
        };
    }

    if (/\b(products?)\b/.test(prompt) && /\b(losing money|negative profit|critical)\b/.test(prompt)) {
        const count = Number(derived?.profitability?.productHealth?.losingProducts || 0);
        return {
            status: 200,
            answer_markdown: `Products currently losing money: ${count.toFixed(0)}.`,
            chart_suggestions: [],
            follow_up_questions: followUps,
            needs_clarification: false,
            intent_interpretation: interpretation,
            responseSource: 'deterministic',
            dataConfidence: 'high',
            dataSources: ['profitability'],
        };
    }

    if (/\b(acos|roas|ppc)\b/.test(prompt) && /\b(top keywords?|top performing)\b/.test(prompt)) {
        const acos = Number(derived?.ppc?.totals?.topKeywordAcos || 0);
        const sales = Number(derived?.ppc?.totals?.topKeywordSales || 0);
        const spend = Number(derived?.ppc?.totals?.topKeywordSpend || 0);
        return {
            status: 200,
            answer_markdown:
                `Top-performing keyword cohort (selected period):\n` +
                `- Sales: ${currency} ${sales.toFixed(2)}\n` +
                `- Spend: ${currency} ${spend.toFixed(2)}\n` +
                `- ACOS: ${acos.toFixed(2)}%`,
            chart_suggestions: [],
            follow_up_questions: followUps,
            needs_clarification: false,
            intent_interpretation: interpretation,
            responseSource: 'deterministic',
            dataConfidence: 'high',
            dataSources: ['ppc'],
        };
    }

    // ASIN-wise parity answers from profitability table source
    const asinMatch = String(question || '').match(/\b(B0[A-Z0-9]{8,9})\b/i);
    if (asinMatch) {
        const asin = asinMatch[1].toUpperCase();
        const row = tableRows.find((r) => String(r?.asin || '').toUpperCase() === asin);
        if (row) {
            const sales = Number(row.totalSales || 0).toFixed(2);
            const exp = Number(row.totalExpenses || 0).toFixed(2);
            const gp = Number(row.grossProfit || 0).toFixed(2);
            return {
                status: 200,
                answer_markdown:
                    `ASIN ${asin} (selected period):\n` +
                    `- Sales: ${currency} ${sales}\n` +
                    `- Expenses: ${currency} ${exp}\n` +
                    `- Gross Profit: ${currency} ${gp}`,
                chart_suggestions: [],
                follow_up_questions: followUps,
                needs_clarification: false,
                intent_interpretation: interpretation,
                responseSource: 'deterministic',
                dataConfidence: 'high',
                dataSources: ['metrics'],
            };
        }
    }

    return {
        status: 200,
        answer_markdown:
            'I found the relevant account data. Ask for a specific metric (for example: gross profit, total sales, money wasted in ads, or reimbursements) and I will return the exact value.',
        chart_suggestions: [],
        follow_up_questions: followUps,
        needs_clarification: false,
        intent_interpretation: interpretation,
        responseSource: 'deterministic',
        dataConfidence: 'low',
        dataSources: [],
    };
}

module.exports = { handleInformationIntent };

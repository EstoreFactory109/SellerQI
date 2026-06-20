/**
 * QMate FinanceEngine regression suite.
 *
 * NOTE: jest.config.js sets roots: ['<rootDir>/__tests__'], so tests must live
 * under server/__tests__/. (The brief asked for server/tests/, which Jest would
 * not discover — placed here to match the real convention and stay runnable.)
 *
 * Section 1 — classifier: every PART-3 question routes to the correct queryType.
 * Section 2 — handler return-shape checks (structure only, not values).
 * Section 3 — parity proof: shared computeDisplayTotalExpenses == the
 *             ProfitabilityDashboard.jsx field-by-field formula.
 */

const FE = require('../../../Services/AI/layers/services/FinanceEngine.js');
const readSvc = require('../../../Services/Finance/FinanceDashboardReadService.js');
const Cogs = require('../../../models/finance/CogsModel.js');
const PPCMetrics = require('../../../models/amazon-ads/PPCMetricsModel.js');
const { computeDisplayTotalExpenses } = require('../../../shared/financeCalculations.js');

// ── Mock interpretation builder (mirrors what the real interpreter produces) ──
function buildInterpretation(tc) {
    const expected = tc.expected;
    return {
        intent:
            expected === 'comparison' ? 'comparison'
            : expected === 'why_analysis' ? 'why_question'
            : 'value_lookup',
        entities: {
            metrics: [],
            asins: tc.asins || [],
            queryShape: expected === 'why_analysis' ? 'explanation' : 'generic',
        },
        routing: { engine: expected === 'not_finance' ? 'suggestion_engine' : 'information_engine' },
        raw: tc.input,
    };
}

// ── Section 1 data: the PART-3 question set ──
const CLASSIFIER_TEST_CASES = [
    // Category A: Direct Number Lookups → summary_metrics
    { input: 'What were my total sales last 30 days?', expected: 'summary_metrics', category: 'A' },
    { input: 'What is my profit?', expected: 'summary_metrics', category: 'A' },
    { input: 'What is my profit margin?', expected: 'summary_metrics', category: 'A' },
    { input: 'How many units did I sell this month?', expected: 'summary_metrics', category: 'A' },
    { input: 'How many orders did I get last week?', expected: 'summary_metrics', category: 'A' },
    { input: 'What is my revenue?', expected: 'summary_metrics', category: 'A' },
    { input: 'What is my gross profit?', expected: 'summary_metrics', category: 'A' },
    { input: 'What is my net profit?', expected: 'summary_metrics', category: 'A' },
    { input: 'How much did I make today?', expected: 'summary_metrics', category: 'A' },
    { input: 'What is my average daily sales?', expected: 'summary_metrics', category: 'A' },
    { input: 'What is my average order value?', expected: 'summary_metrics', category: 'A' },
    { input: 'What is my average selling price per unit?', expected: 'summary_metrics', category: 'A' },

    // Category B: Expense & Fee Questions
    { input: 'What are my total expenses?', expected: 'expense_breakdown', category: 'B' },
    { input: 'How much am I paying in FBA fees?', expected: 'fee_specific', category: 'B' },
    { input: 'What are my referral fees?', expected: 'fee_specific', category: 'B' },
    { input: 'How much did I spend on ads?', expected: 'fee_specific', category: 'B' },
    { input: 'What is my ACOS?', expected: 'fee_specific', category: 'B' },
    { input: 'What is my ROAS?', expected: 'fee_specific', category: 'B' },
    { input: 'How much am I losing to refunds?', expected: 'fee_specific', category: 'B' },
    { input: 'What are my storage fees?', expected: 'overhead_query', category: 'B' },
    { input: 'Break down my expenses', expected: 'expense_breakdown', category: 'B' },
    { input: 'What are my shipping charges?', expected: 'fee_specific', category: 'B' },
    { input: 'How much are promotions costing me?', expected: 'fee_specific', category: 'B' },
    { input: 'What are my inbound shipping fees?', expected: 'overhead_query', category: 'B' },
    { input: 'What Amazon fees am I paying?', expected: 'expense_breakdown', category: 'B' },
    { input: 'What is my subscription fee?', expected: 'overhead_query', category: 'B' },
    { input: 'How much in reimbursements did I get?', expected: 'fee_specific', category: 'B' },
    { input: 'What are my disposal fees?', expected: 'fee_specific', category: 'B' },
    { input: 'How much tax was collected?', expected: 'fee_specific', category: 'B' },
    { input: 'What are my other fees?', expected: 'expense_breakdown', category: 'B' },
    { input: 'What percentage of revenue goes to fees?', expected: 'expense_breakdown', category: 'B' },

    // Category C: Per-Product
    { input: 'Which product makes the most profit?', expected: 'top_bottom_products', category: 'C' },
    { input: 'Which products are losing money?', expected: 'top_bottom_products', category: 'C' },
    { input: 'Show me profitability for B0ABC12345', expected: 'single_asin', category: 'C', asins: ['B0ABC12345'] },
    { input: 'What are the FBA fees for B0ABC12345?', expected: 'single_asin', category: 'C', asins: ['B0ABC12345'] },
    { input: 'What is the profit margin on B0ABC12345?', expected: 'single_asin', category: 'C', asins: ['B0ABC12345'] },
    { input: 'Which products have the highest fees?', expected: 'top_bottom_products', category: 'C' },
    { input: 'My top 5 products by sales', expected: 'top_bottom_products', category: 'C' },
    { input: 'My bottom 5 products by profit', expected: 'top_bottom_products', category: 'C' },
    { input: 'Which product has the highest refund rate?', expected: 'top_bottom_products', category: 'C' },
    { input: 'How many units of B0ABC12345 did I sell?', expected: 'single_asin', category: 'C', asins: ['B0ABC12345'] },
    { input: 'Compare B0ABC12345 vs B0XYZ67890', expected: 'asin_comparison', category: 'C', asins: ['B0ABC12345', 'B0XYZ67890'] },
    { input: 'Show me products with margin below 10%', expected: 'top_bottom_products', category: 'C' },
    // ASIN + datewise cue → per-ASIN time series (NOT a single total).
    { input: 'tell me the datewise sales of B0ABC12345 for last 7 days', expected: 'asin_time_series', category: 'C', asins: ['B0ABC12345'] },
    { input: 'B0ABC12345 units per day', expected: 'asin_time_series', category: 'C', asins: ['B0ABC12345'] },
    { input: 'show me sales of B0ABC12345 over time', expected: 'asin_time_series', category: 'C', asins: ['B0ABC12345'] },
    // Guard: ASIN without a datewise cue stays single_asin.
    { input: 'what is the profit for B0ABC12345', expected: 'single_asin', category: 'C', asins: ['B0ABC12345'] },

    // Category D: Trends → time_series
    { input: 'Show me my sales trend', expected: 'time_series', category: 'D' },
    { input: 'Show me profit over time', expected: 'time_series', category: 'D' },
    { input: 'How are my sales trending this month?', expected: 'time_series', category: 'D' },
    { input: 'Graph my expenses over the last 30 days', expected: 'time_series', category: 'D' },
    { input: 'Show daily PPC spend vs sales', expected: 'time_series', category: 'D' },
    { input: 'What day had the highest sales?', expected: 'time_series', category: 'D' },
    { input: 'Are my fees increasing?', expected: 'time_series', category: 'D' },
    // "datewise" / "per day" / "by date" must return the datewise chart, not a total.
    { input: 'give me sales and profit datewise for last 7 days', expected: 'time_series', category: 'D' },
    { input: 'sales date wise last 7 days', expected: 'time_series', category: 'D' },
    { input: 'profit per day this week', expected: 'time_series', category: 'D' },
    { input: 'show me sales and profit by date', expected: 'time_series', category: 'D' },
    // Guard: average/per-unit queries stay summary (rule 3 wins over time_series).
    { input: 'what is my average profit per day', expected: 'summary_metrics', category: 'A' },
    { input: 'average daily sales', expected: 'summary_metrics', category: 'A' },

    // Category E: Comparisons → comparison
    { input: 'Compare this month to last month', expected: 'comparison', category: 'E' },
    { input: 'How do my sales compare to last week?', expected: 'comparison', category: 'E' },
    { input: 'Is my profit better or worse than last month?', expected: 'comparison', category: 'E' },
    { input: 'Compare my fees this month vs last month', expected: 'comparison', category: 'E' },
    { input: 'Am I spending more on PPC than before?', expected: 'comparison', category: 'E' },
    { input: 'Are things getting better or worse?', expected: 'comparison', category: 'E' },

    // Category F: Why Questions → why_analysis
    { input: 'Why is my profit dropping?', expected: 'why_analysis', category: 'F' },
    { input: 'Why are my expenses so high?', expected: 'why_analysis', category: 'F' },
    { input: 'Why did my sales drop last week?', expected: 'why_analysis', category: 'F' },
    { input: 'Why is my margin so low?', expected: 'why_analysis', category: 'F' },
    { input: "What's eating into my profit?", expected: 'why_analysis', category: 'F' },
    { input: 'Why did my fees increase?', expected: 'why_analysis', category: 'F' },

    // Category G: Suggestions → not_finance (suggestion engine handles, with injected context)
    { input: 'How can I improve my profit?', expected: 'not_finance', category: 'G' },
    { input: 'How do I reduce my expenses?', expected: 'not_finance', category: 'G' },
    { input: 'Which products should I focus on?', expected: 'not_finance', category: 'G' },
    { input: 'What mistakes am I making?', expected: 'not_finance', category: 'G' },
    { input: 'Should I discontinue any products?', expected: 'not_finance', category: 'G' },

    // Category H: COGS → cogs_query
    { input: 'What are my COGS?', expected: 'cogs_query', category: 'H' },
    { input: "Which products don't have COGS entered?", expected: 'cogs_query', category: 'H' },
    { input: "What's my total COGS for the period?", expected: 'cogs_query', category: 'H' },
    { input: 'How does COGS affect my profit?', expected: 'cogs_query', category: 'H' },

    // Category I: Overhead → overhead_query
    { input: 'What are my storage fees?', expected: 'overhead_query', category: 'I' },
    { input: 'What are my overhead costs?', expected: 'overhead_query', category: 'I' },
    { input: 'How much is my FBA subscription?', expected: 'overhead_query', category: 'I' },
    { input: 'What are my inbound shipping costs?', expected: 'overhead_query', category: 'I' },

    // Category J: Edge Cases
    { input: 'Am I profitable?', expected: 'summary_metrics', category: 'J' },
    { input: 'Give me a complete financial summary', expected: 'summary_metrics', category: 'J' },
    { input: 'How much do I keep from each sale?', expected: 'summary_metrics', category: 'J' },
    { input: 'How much of my revenue goes to Amazon?', expected: 'summary_metrics', category: 'J' },
];

const CATEGORY_NAMES = {
    A: 'Category A: Direct Number Lookups',
    B: 'Category B: Expense & Fee Questions',
    C: 'Category C: Per-Product Analysis',
    D: 'Category D: Trends',
    E: 'Category E: Comparisons',
    F: 'Category F: Why Questions',
    G: 'Category G: Suggestions & Strategy',
    H: 'Category H: COGS',
    I: 'Category I: Overhead',
    J: 'Category J: Edge Cases',
};

describe('FinanceEngine — Section 1: Classifier routing (PART 3)', () => {
    const byCategory = CLASSIFIER_TEST_CASES.reduce((acc, tc) => {
        (acc[tc.category] = acc[tc.category] || []).push(tc);
        return acc;
    }, {});

    for (const cat of Object.keys(CATEGORY_NAMES)) {
        const cases = byCategory[cat] || [];
        describe(CATEGORY_NAMES[cat], () => {
            for (const tc of cases) {
                it(`"${tc.input}" → ${tc.expected}`, () => {
                    const got = FE.classifyFinanceQueryType(buildInterpretation(tc));
                    expect(got).toBe(tc.expected);
                });
            }
        });
    }
});

// ── Section 2: shared mock dashboard data (matches getDashboard() shape) ──
const MOCK_DASHBOARD = {
    totals: {
        productSales: 10000,
        units: 200,
        orderCount: 160,
        adsSpend: 800,
        fbaInventoryReimbursement: 50,
        fbaFulfillmentFee: -1000,
        referralCommission: -1500,
        closingFee: -50,
        technologyFee: -20,
        shippingChargeback: -30,
        giftWrapChargeback: -10,
        fbaDisposalFee: -5,
        fbaReversedReimbursement: -15,
        refundedAmount: -200,
        refundCommission: -25,
        refundedReferralFee: -40,
        refundedPromotion: -12,
        restockingFee: -8,
        promotionsDiscount: -100,
        shippingDiscount: -60,
        taxDiscount: -7,
        shippingTaxDiscount: -3,
        tdsDeducted: -90,
        tcsCollected: -45,
        otherExpenses: -33,
        salesTaxCollected: -120,
        marketplaceFacilitatorTax: -80,
        otherExpensesBreakdown: [{ category: 'Misc Fee', amount: -33 }],
    },
    overhead: [
        { category: 'FBA Storage Fee', isRevenue: false, amount: -200 },
        { category: 'Subscription Fee', isRevenue: false, amount: -39.99 },
        { category: 'Disbursement', isRevenue: false, amount: -5000 }, // excluded (revenue cat)
        { category: 'Seller Reward', isRevenue: true, amount: 80 },     // excluded (isRevenue)
    ],
    overheadTotal: 239.99,
    asinWise: [
        { asin: 'B0ABC12345', productName: 'Alpha', units: 100, productSales: 6000, adsSpend: 500, totalExpenses: -1800, fbaFulfillmentFee: -600, referralCommission: -900 },
        { asin: 'B0XYZ67890', productName: 'Beta', units: 100, productSales: 4000, adsSpend: 300, totalExpenses: -2600, fbaFulfillmentFee: -400, referralCommission: -600, refundedAmount: -800 },
    ],
    dateWise: [
        { date: '2026-05-01', productSales: 300, totalExpenses: -120, units: 6, orderCount: 5 },
        { date: '2026-05-02', productSales: 400, totalExpenses: -150, units: 8, orderCount: 6 },
        { date: '2026-05-03', productSales: 700, totalExpenses: -210, units: 14, orderCount: 11 },
        { date: '2026-05-04', productSales: 900, totalExpenses: -260, units: 18, orderCount: 14 },
    ],
};

const MOCK_COGS = { hasCOGS: true, entries: [{ asin: 'B0ABC12345', sku: 'S1', cogs: 5 }], cogsMap: new Map([['B0ABC12345', 5]]) };

const MOCK_SNAPSHOT = {
    asin: 'B0ABC12345', sku: 'S1', productName: 'Alpha',
    totalSales: 6000, unitsSold: 100, orderCount: 80,
    totalExpenses: 1800, amazonFees: 1500, refunds: 0, reimbursements: 0, promotions: 0,
    adsSpend: 500, grossProfit: 4200,
    breakdown: [{ category: 'Referral Commission', amount: -900 }, { category: 'FBA Fulfillment Fee', amount: -600 }],
};

const DATE_RANGE = { startDate: '2026-05-01', endDate: '2026-05-30', dayCount: 30, mode: 'default', source: 'period_anchored' };
const USER_CTX = { userId: '64b2f0000000000000000001', country: 'US', region: 'NA' };

// financeSummary as handleFinanceQuery builds it
const FINANCE_SUMMARY = {
    dateRange: DATE_RANGE,
    totalSales: 10000,
    totalUnits: 200,
    totalOrders: 160,
    displayTotalExpenses: 4000,
    adSpend: 800,
    totalCogs: 500,
    displayProfit: 5500,
    profitMargin: 55,
    overheadTotal: 239.99,
    reimbursements: 50,
    refunds: 200,
};

describe('FinanceEngine — Section 2: Handler return shapes', () => {
    beforeEach(() => {
        jest.spyOn(readSvc, 'getDashboard').mockResolvedValue(MOCK_DASHBOARD);
        jest.spyOn(readSvc, 'getAsinSnapshot').mockResolvedValue(MOCK_SNAPSHOT);
        // buildSingleAsinResponse now uses getAsinWisePL + computeAsinRowEntry
        // (dashboard parity) instead of getAsinSnapshot.
        jest.spyOn(readSvc, 'getAsinWisePL').mockResolvedValue(MOCK_DASHBOARD.asinWise);
        jest.spyOn(Cogs, 'findOne').mockReturnValue({ lean: async () => ({ cogsEntries: MOCK_COGS.entries }) });
        // Ad spend is now sourced from PPCMetrics (dashboard parity); stub it so
        // comparison/why-analysis handlers don't hit the DB.
        jest.spyOn(PPCMetrics, 'calculateMetricsForDateRange').mockResolvedValue({ found: true, summary: { totalSpend: 800 } });
    });

    it('summary_metrics → { type, metrics{ totalSales, displayProfit, profitMargin } }', () => {
        const r = FE.buildSummaryResponse(FINANCE_SUMMARY, DATE_RANGE);
        expect(r.type).toBe('summary_metrics');
        expect(r.metrics).toBeDefined();
        ['totalSales', 'displayProfit', 'profitMargin', 'displayTotalExpenses', 'totalCogs'].forEach((k) =>
            expect(r.metrics).toHaveProperty(k)
        );
    });

    it('expense_breakdown → { type, categories, total }', () => {
        const r = FE.buildExpenseBreakdownResponse(FINANCE_SUMMARY, MOCK_DASHBOARD, DATE_RANGE);
        expect(r.type).toBe('expense_breakdown');
        expect(r).toHaveProperty('total');
        expect(r.categories).toBeDefined();
        ['fbaFees', 'referralFees', 'adSpend', 'cogs'].forEach((k) => expect(r.categories).toHaveProperty(k));
    });

    it('fee_specific → { type, fee{ name, amount } }', () => {
        const r = FE.buildFeeSpecificResponse(MOCK_DASHBOARD, ['fba fee'], DATE_RANGE);
        expect(r.type).toBe('fee_specific');
        expect(r.fee).toBeDefined();
        expect(r.fee).toHaveProperty('name');
        expect(r.fee).toHaveProperty('amount');
        expect(r.fee.amount).toBeGreaterThanOrEqual(0); // positive
    });

    it('single_asin → { type, asin, metrics, feeBreakdown }', async () => {
        const r = await FE.buildSingleAsinResponse('B0ABC12345', USER_CTX, DATE_RANGE, MOCK_COGS);
        expect(r.type).toBe('single_asin');
        expect(r.asin).toBe('B0ABC12345');
        expect(r.metrics).toBeDefined();
        ['productSales', 'grossProfit', 'profitMargin', 'cogs'].forEach((k) => expect(r.metrics).toHaveProperty(k));
        expect(Array.isArray(r.feeBreakdown)).toBe(true);
    });

    it('asin_comparison → { type, products[], winner }', async () => {
        jest.spyOn(readSvc, 'getAsinSnapshot').mockImplementation(async ({ asin }) => ({
            ...MOCK_SNAPSHOT, asin, productName: asin,
        }));
        const r = await FE.buildAsinComparisonResponse(['B0ABC12345', 'B0XYZ67890'], USER_CTX, DATE_RANGE, MOCK_COGS);
        expect(r.type).toBe('asin_comparison');
        expect(Array.isArray(r.products)).toBe(true);
        expect(r.products.length).toBe(2);
        expect(r.winner).toBeDefined();
        ['bySales', 'byProfit', 'byMargin', 'byUnits'].forEach((k) => expect(r.winner).toHaveProperty(k));
    });

    it('comparison → { type, deltas{ sales, expenses, profit }, profitDrivers }', async () => {
        const r = await FE.buildComparisonResponse(FINANCE_SUMMARY, USER_CTX, DATE_RANGE);
        expect(r.type).toBe('comparison');
        expect(r.deltas).toBeDefined();
        ['sales', 'expenses', 'profit'].forEach((k) => expect(r.deltas).toHaveProperty(k));
        expect(Array.isArray(r.profitDrivers)).toBe(true);
    });

    it('why_analysis → { type, insights, profitDrivers, losingProducts }', async () => {
        const r = await FE.buildWhyAnalysisResponse(FINANCE_SUMMARY, USER_CTX, DATE_RANGE, MOCK_DASHBOARD);
        expect(r.type).toBe('why_analysis');
        expect(Array.isArray(r.insights)).toBe(true);
        expect(Array.isArray(r.profitDrivers)).toBe(true);
        expect(Array.isArray(r.losingProducts)).toBe(true);
    });

    it('time_series → { type, dataPoints, trend }', () => {
        const r = FE.buildTimeSeriesResponse(MOCK_DASHBOARD, MOCK_COGS, DATE_RANGE);
        expect(r.type).toBe('time_series');
        expect(Array.isArray(r.dataPoints)).toBe(true);
        expect(r.trend).toBeDefined();
        expect(r.trend).toHaveProperty('direction');
        // Default (no metric named) → Sales vs Profit.
        expect(r.charts[0].yFields).toEqual([
            { field: 'totalSales', label: 'Sales' },
            { field: 'grossProfit', label: 'Gross Profit' },
        ]);
    });

    it('time_series is metric-aware → plots the requested finance field', () => {
        const interp = { raw: { prompt: 'units sold datewise', normalizedPrompt: 'units sold datewise' }, entities: {} };
        const r = FE.buildTimeSeriesResponse(MOCK_DASHBOARD, MOCK_COGS, DATE_RANGE, interp);
        expect(r.metrics).toEqual(['units']);
        expect(r.trend.metric).toBe('units');
        expect(r.charts[0].yFields).toEqual([{ field: 'units', label: 'Units' }]);
    });

    it('time_series metric-aware → expenses', () => {
        const interp = { raw: { prompt: 'show me expenses per day', normalizedPrompt: 'show me expenses per day' }, entities: {} };
        const r = FE.buildTimeSeriesResponse(MOCK_DASHBOARD, MOCK_COGS, DATE_RANGE, interp);
        expect(r.metrics).toEqual(['totalExpenses']);
        expect(r.charts[0].yFields).toEqual([{ field: 'totalExpenses', label: 'Expenses' }]);
    });

    it('asin_time_series → per-day rows for one ASIN, metric-aware', async () => {
        jest.spyOn(readSvc, 'getAsinDateWise').mockResolvedValue([
            { date: '2026-05-26', productName: 'Alpha', productSales: 369.92, totalExpenses: -160, units: 16, orderCount: 15 },
            { date: '2026-05-27', productName: 'Alpha', productSales: 412.45, totalExpenses: -175, units: 18, orderCount: 17 },
        ]);
        const interp = { raw: { prompt: 'datewise sales of B0ABC12345', normalizedPrompt: 'datewise sales of B0ABC12345' }, entities: { asins: ['B0ABC12345'] } };
        const r = await FE.buildAsinTimeSeriesResponse('B0ABC12345', USER_CTX, DATE_RANGE, interp);
        expect(r.type).toBe('asin_time_series');
        expect(r.asin).toBe('B0ABC12345');
        expect(r.productName).toBe('Alpha');
        expect(r.dataPoints).toHaveLength(2);
        expect(r.dataPoints[0]).toMatchObject({ date: '2026-05-26', totalSales: 369.92 });
        expect(r.metric).toBe('totalSales');
        expect(r.charts[0].yFields).toEqual([{ field: 'totalSales', label: 'Sales' }]);
    });

    it('asin_time_series → notFound when the ASIN has no daily data', async () => {
        jest.spyOn(readSvc, 'getAsinDateWise').mockResolvedValue([]);
        const interp = { raw: { prompt: 'datewise sales of B0NONE00000', normalizedPrompt: 'datewise sales of B0NONE00000' }, entities: { asins: ['B0NONE00000'] } };
        const r = await FE.buildAsinTimeSeriesResponse('B0NONE00000', USER_CTX, DATE_RANGE, interp);
        expect(r.notFound).toBe(true);
        expect(r.dataPoints).toEqual([]);
    });

    it('top_bottom_products → { type, products[] }', () => {
        const interp = { rewrittenQuestion: 'top 5 products by sales', entities: {} };
        const r = FE.buildTopBottomResponse(MOCK_DASHBOARD, MOCK_COGS, interp, DATE_RANGE);
        expect(r.type).toBe('top_bottom_products');
        expect(Array.isArray(r.products)).toBe(true);
    });

    // Honesty for "top N by profit" when fewer than N are actually profitable:
    // a request for top 5 must not present break-even / loss products as winners.
    it('top_bottom_products (by profit) → surfaces profitableCount + shortfall', () => {
        const dash = {
            ...MOCK_DASHBOARD,
            asinWise: [
                // Clearly profitable.
                { asin: 'P1', productName: 'Winner', units: 100, productSales: 10000, adsSpend: 100, totalExpenses: -1000 },
                // Clearly loss-making.
                { asin: 'P2', productName: 'Loser', units: 50, productSales: 50, adsSpend: 300, totalExpenses: -900 },
            ],
        };
        const interp = { rewrittenQuestion: 'top 5 products by profit', entities: {} };
        const r = FE.buildTopBottomResponse(dash, { hasCOGS: false, cogsMap: new Map() }, interp, DATE_RANGE);
        expect(r.isProfitRanked).toBe(true);
        expect(r.requestedCount).toBe(5);
        expect(r.profitableCount).toBe(1);          // only Winner has grossProfit > 0
        expect(r.profitableInListShortfall).toBe(true);
        const txt = FE.buildFallbackNarration(r);
        expect(txt).toMatch(/Only 1 of your product/i);
        expect(txt).toMatch(/break-even or a loss/i);
    });

    it('top_bottom_products (by profit, all profitable) → no shortfall', () => {
        const dash = {
            ...MOCK_DASHBOARD,
            asinWise: [
                { asin: 'P1', productName: 'A', units: 100, productSales: 10000, adsSpend: 100, totalExpenses: -1000 },
                { asin: 'P2', productName: 'B', units: 100, productSales: 8000, adsSpend: 100, totalExpenses: -1000 },
            ],
        };
        const interp = { rewrittenQuestion: 'top 5 products by profit', entities: {} };
        const r = FE.buildTopBottomResponse(dash, { hasCOGS: false, cogsMap: new Map() }, interp, DATE_RANGE);
        expect(r.profitableInListShortfall).toBe(false);
        expect(r.profitableCount).toBe(2);
    });

    it('asin_profitability → { type, categories, summary }', () => {
        const r = FE.buildAsinProfitabilityResponse(MOCK_DASHBOARD, MOCK_COGS, 800, DATE_RANGE);
        expect(r.type).toBe('asin_profitability');
        expect(r.categories).toBeDefined();
        expect(r.summary).toBeDefined();
        expect(r.summary).toHaveProperty('totalProducts');
    });

    it('cogs_query → { type, totalCOGS, productsWithCOGS, productsWithoutCOGS }', () => {
        const r = FE.buildCogsResponse(MOCK_COGS, MOCK_DASHBOARD.asinWise, FINANCE_SUMMARY);
        expect(r.type).toBe('cogs_query');
        expect(r).toHaveProperty('totalCOGS');
        expect(Array.isArray(r.productsWithCOGS)).toBe(true);
        expect(Array.isArray(r.productsWithoutCOGS)).toBe(true);
    });

    it('overhead_query → { type, expenses[], totalOverheadExpenses }', () => {
        const r = FE.buildOverheadResponse(MOCK_DASHBOARD.overhead, DATE_RANGE);
        expect(r.type).toBe('overhead_query');
        expect(Array.isArray(r.expenses)).toBe(true);
        expect(r).toHaveProperty('totalOverheadExpenses');
    });
});

describe('FinanceEngine — Section 3: Parity with ProfitabilityDashboard.jsx', () => {
    it('shared computeDisplayTotalExpenses equals the dashboard field-by-field formula', () => {
        const t = MOCK_DASHBOARD.totals;
        const abs = Math.abs;

        // Field-by-field formula transcribed verbatim from ProfitibilityDashboard.jsx
        // (perAsinExpenses lines ~346-365, overhead ~376, displayTotalExpenses ~391).
        const perAsinExpenses =
            abs(t.fbaFulfillmentFee || 0) +
            abs(t.referralCommission || 0) +
            abs(t.closingFee || 0) +
            abs(t.technologyFee || 0) +
            abs(t.shippingChargeback || 0) +
            abs(t.giftWrapChargeback || 0) +
            abs(t.fbaDisposalFee || 0) +
            abs(t.fbaReversedReimbursement || 0) +
            abs(t.refundedAmount || 0) +
            abs(t.refundCommission || 0) -
            abs(t.refundedReferralFee || 0) -
            abs(t.refundedPromotion || 0) -
            abs(t.restockingFee || 0) +
            abs(t.promotionsDiscount || 0) +
            abs(t.shippingDiscount || 0) +
            abs(t.taxDiscount || 0) +
            abs(t.shippingTaxDiscount || 0) +
            abs(t.tdsDeducted || 0) +
            abs(t.tcsCollected || 0) +
            abs(t.otherExpenses || 0);

        const OVERHEAD_EXCLUDE = new Set([
            'Disbursement', 'Reserve Hold', 'Reserve Release', 'Seller Reward', 'Reimbursement',
            'SAFE-T Reimbursement', 'SERRAC Reimbursement', 'EBT Refund Reimbursement', 'Fulfillment Fee Refund',
        ]);
        const overheadExpenseTotal = MOCK_DASHBOARD.overhead
            .filter((item) => !item.isRevenue && !OVERHEAD_EXCLUDE.has(item.category))
            .reduce((sum, item) => sum + abs(item.amount), 0);

        const reimbursements = abs(t.fbaInventoryReimbursement || 0);
        const adSpend = t.adsSpend || 0;
        const dashboardValue = perAsinExpenses + overheadExpenseTotal - reimbursements + adSpend;

        const sharedValue = computeDisplayTotalExpenses(t, MOCK_DASHBOARD.overhead, adSpend);

        expect(sharedValue).toBeCloseTo(dashboardValue, 2);
    });
});

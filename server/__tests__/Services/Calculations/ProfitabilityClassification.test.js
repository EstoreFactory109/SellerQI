/**
 * The single profitability rule (RecoverableAmountUtils.classifyProfitabilityRow),
 * and the three places that used to carry their own copy of it.
 *
 * Production, before: 10,016 open low_margin tasks on products with $0 sales
 * (amount $0), 3,310 negative_profit tasks on $0 sales, and 11 marketplaces judged
 * on EconomicsMetrics ~195 days old.
 */
const {
    classifyProfitabilityRow,
    isEconomicsFresh,
    ECONOMICS_MAX_AGE_DAYS,
} = require('../../../Services/Calculations/RecoverableAmountUtils.js');
const { calculateProfitabilityErrors } = require('../../../Services/Calculations/DashboardCalculation.js');
const ProfitabilityService = require('../../../Services/Calculations/ProfitabilityService.js');
const CreateTaskService = require('../../../Services/Calculations/CreateTasksService.js');

const fresh = { financeFresh: true };

describe('classifyProfitabilityRow', () => {
    it('keeps the existing rules for products with sales', () => {
        expect(classifyProfitabilityRow({ sales: 100, ads: 80, amzFee: 30 }, fresh))
            .toMatchObject({ errorType: 'negative_profit', amount: 10, netProfit: -10 });
        expect(classifyProfitabilityRow({ sales: 100, ads: 60, amzFee: 35 }, fresh))
            .toMatchObject({ errorType: 'low_margin', amount: 5, profitMargin: 5 });
        expect(classifyProfitabilityRow({ sales: 100, ads: 20, amzFee: 30 }, fresh)).toBeNull();
    });

    // The 10,016 $0 tasks: no sales, no ads, read as "0% margin".
    it('makes no verdict on a product with no sales and no ad spend', () => {
        expect(classifyProfitabilityRow({ sales: 0, ads: 0, amzFee: 0 }, fresh)).toBeNull();
        expect(classifyProfitabilityRow({ sales: 0, ads: 0, amzFee: 4 }, fresh)).toBeNull();
    });

    it('calls ad spend on a product with no sales what it is', () => {
        expect(classifyProfitabilityRow({ sales: 0, ads: 75.22, amzFee: 0, source: 'adsOnly' }, fresh))
            .toEqual({ errorType: 'ad_spend_no_sales', amount: 75.22, netProfit: -75.22, profitMargin: 0 });
    });

    it('makes no verdict at all when the finance behind the rows is not fresh', () => {
        expect(classifyProfitabilityRow({ sales: 0, ads: 75 }, { financeFresh: false })).toBeNull();
        expect(classifyProfitabilityRow({ sales: 100, ads: 200 }, { financeFresh: false })).toBeNull();
        expect(classifyProfitabilityRow({ sales: 100, ads: 200 }, {})).toBeNull();
    });

    // ProductWiseSales has had no new document since 2025-12-04.
    it('makes no verdict on legacy rows, whose sales come from a stopped source', () => {
        expect(classifyProfitabilityRow({ sales: 50, ads: 90, source: 'legacy' }, fresh)).toBeNull();
    });

    it('reads fees from amzFee, falling back to totalFees', () => {
        expect(classifyProfitabilityRow({ sales: 100, ads: 0, amzFee: 0, totalFees: 120 }, fresh).errorType).toBe('negative_profit');
    });
});

describe('isEconomicsFresh', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const daysAgo = (n) => new Date(now.getTime() - n * 864e5);

    it(`accepts a doc up to ${ECONOMICS_MAX_AGE_DAYS} days old`, () => {
        expect(isEconomicsFresh({ createdAt: daysAgo(3) }, now)).toBe(true);
        expect(isEconomicsFresh({ createdAt: daysAgo(ECONOMICS_MAX_AGE_DAYS) }, now)).toBe(true);
    });

    it('rejects the ~195-day-old docs production was still reading, and undatable or missing docs', () => {
        expect(isEconomicsFresh({ createdAt: daysAgo(195) }, now)).toBe(false);
        expect(isEconomicsFresh({}, now)).toBe(false);
        expect(isEconomicsFresh(null, now)).toBe(false);
    });
});

describe('every copy of the rule agrees', () => {
    const rows = [
        { asin: 'A', sales: 0, ads: 0, amzFee: 0 },            // ghost row: nothing
        { asin: 'B', sales: 0, ads: 40, amzFee: 0 },           // ad spend, no sales
        { asin: 'C', sales: 100, ads: 80, amzFee: 30 },        // negative profit
        { asin: 'D', sales: 100, ads: 60, amzFee: 35 },        // low margin
    ];
    const summarise = (details) => details.map(d => `${d.asin}:${d.errorType}`).sort();
    const expected = ['B:ad_spend_no_sales', 'C:negative_profit', 'D:low_margin'];

    it('DashboardCalculation (tasks)', () => {
        const r = calculateProfitabilityErrors(rows, [], { financeFresh: true });
        expect(summarise(r.errorDetails)).toEqual(expected);
        expect(r.errorDetails.find(d => d.asin === 'B')).toMatchObject({ amount: 40, ads: 40 });
    });

    it('DashboardCalculation makes no verdicts on stale finance', () => {
        expect(calculateProfitabilityErrors(rows, [], { financeFresh: false }).errorDetails).toEqual([]);
    });

    it('ProfitabilityService (Profitability page)', () => {
        const r = ProfitabilityService.calculateProfitabilityErrors(rows, [], { financeFresh: true });
        expect(summarise(r.errorDetails)).toEqual(expected);
    });
});

describe('ad_spend_no_sales task', () => {
    it('is generated with its own type and the ad spend as renderData', () => {
        const [task] = CreateTaskService.generateProfitabilityTasks([
            { asin: 'B', productName: 'Widget', sales: 0, ads: 75.22, netProfit: -75.22, profitMargin: 0, errorType: 'ad_spend_no_sales', amount: 75.22 },
        ]);
        expect(task).toMatchObject({ errorType: 'ad_spend_no_sales', amount: 75.22 });
        expect(task.renderData.ads).toBe(75.22);
    });

    it('renders honest wording, not "losing money on revenue $0"', () => {
        const { error, solution } = CreateTaskService.renderProfitabilityTaskText('ad_spend_no_sales', { ads: 75.22, sales: 0, netProfit: -75.22 });
        expect(error).toContain('spent $75.22 on ads');
        expect(error).toContain('no sales recorded');
        expect(error).not.toContain('Revenue');
        expect(solution).toMatch(/Pause or cut bids/);
    });
});

describe('ProfitabilityIssuesService (Profitability issues page)', () => {
    const { calculateProfitabilityIssues } = require('../../../Services/Calculations/ProfitabilityIssuesService.js');

    it('applies the shared rule and explains ad spend with no sales', () => {
        const { issues } = calculateProfitabilityIssues([
            { asin: 'A', sales: 0, ads: 0, amzFee: 0 },
            { asin: 'B', sales: 0, ads: 40, amzFee: 0 },
            { asin: 'C', sales: 100, ads: 80, amzFee: 30 },
        ]);
        expect(issues.map(i => `${i.asin}:${i.issueType}`).sort()).toEqual(['B:ad_spend_no_sales', 'C:negative_profit']);
        const b = issues.find(i => i.asin === 'B');
        expect(b).toMatchObject({ severity: 'high', amount: 40 });
        expect(b.recommendation.title).toBe('Ad Spend With No Sales');
    });
});

/**
 * tasks-logics.xlsx rules for "Products to Replenish" and "Unfulfillable inventory".
 */
const { replenishmentQty, inventoryPlanningData } = require('../../../Services/Calculations/Inventory_.js');

const restock = (over = {}) => ({
    asin: 'A1', merchantSku: 'SKU1', currencyCode: 'USD',
    available: '30', inbound: '0', unitsSoldLast30Days: '60', alert: '', recommendedReplenishmentQty: '100',
    ...over
});

describe('replenishmentQty', () => {
    it('flags stock that runs out before lead time + 14 days (59 by default)', () => {
        // 60 sold in 30 days = 2/day; 30 + 0 units = 15 days of supply.
        const [row] = replenishmentQty([restock()]);
        expect(row.status).toBe('Error');
        expect(row.daysOfSupply).toBe(15);
        expect(row.Message).toContain('run out in about 15 days');
        expect(row.Message).toContain('inside your 45-day lead time plus 14 days');
        expect(row.Message).toContain('Amazon recommends 100 units');
    });

    it('counts inbound units as supply', () => {
        // 30 + 100 = 130 units at 2/day = 65 days.
        const [row] = replenishmentQty([restock({ inbound: '100' })]);
        expect(row.status).toBe('Success');
        expect(row.daysOfSupply).toBe(65);
    });

    it('uses the seller lead time when given', () => {
        const [row] = replenishmentQty([restock({ inbound: '100' })], { leadTimeDays: 60 });
        expect(row.status).toBe('Error');
    });

    it("flags Amazon's out_of_stock / low_stock alert even with supply", () => {
        for (const alert of ['out_of_stock', 'low_stock']) {
            const [row] = replenishmentQty([restock({ available: '500', alert })]);
            expect(row.status).toBe('Error');
        }
    });

    it('skips SKUs selling under 1 unit a day, alert or not', () => {
        const [row] = replenishmentQty([restock({ unitsSoldLast30Days: '29', available: '0', alert: 'out_of_stock' })]);
        expect(row.status).toBe('Success');
    });
});

describe('inventoryPlanningData unfulfillable', () => {
    const planning = (qty) => ({ asin: 'A1', unfulfillable_quantity: String(qty) });

    it('flags 5+ units', () => {
        const { unfulfillable } = inventoryPlanningData(planning(5));
        expect(unfulfillable.status).toBe('Error');
        expect(unfulfillable.Message).toBe('5 units of this product are unsellable and still taking up paid storage.');
    });

    it('ignores a few cheap units', () => {
        expect(inventoryPlanningData(planning(4)).unfulfillable.status).toBe('Success');
        expect(inventoryPlanningData(planning(4), {}, {}, { A1: 10 }).unfulfillable.status).toBe('Success');
    });

    it('flags $50+ in value, at cost when known, else at price', () => {
        expect(inventoryPlanningData(planning(2), {}, {}, { A1: 25 }).unfulfillable.status).toBe('Error');
        // COGS wins over price: 2 x $10 = $20.
        expect(inventoryPlanningData(planning(2), { A1: 10 }, {}, { A1: 25 }).unfulfillable.status).toBe('Success');
        const { unfulfillable } = inventoryPlanningData(planning(2), { A1: 30 });
        expect(unfulfillable.status).toBe('Error');
        expect(unfulfillable.capitalAmount).toBe(60);
    });
});

describe('classifyProfitabilityRow loss-making rule (tasks pass cogsMap)', () => {
    const { classifyProfitabilityRow } = require('../../../Services/Calculations/RecoverableAmountUtils.js');
    // $500 sales, $100 ads, $150 fees = $250 before COGS.
    const row = (quantity) => ({ asin: 'A1', sales: 500, ads: 100, amzFee: 150, quantity, source: 'economics' });

    it('subtracts COGS and flags a loss on 10+ units', () => {
        const v = classifyProfitabilityRow(row(10), { financeFresh: true, cogsMap: { A1: 30 } });
        expect(v.errorType).toBe('negative_profit');
        expect(v.netProfit).toBe(-50);
    });

    it('does not judge a loss under 10 units or without COGS', () => {
        expect(classifyProfitabilityRow(row(9), { financeFresh: true, cogsMap: { A1: 30 } })).toBeNull();
        const loss = { asin: 'A1', sales: 100, ads: 80, amzFee: 50, quantity: 20, source: 'economics' };
        expect(classifyProfitabilityRow(loss, { financeFresh: true, cogsMap: {} })).toBeNull();
        // Pages (no cogsMap) keep the old rule.
        expect(classifyProfitabilityRow(loss, { financeFresh: true }).errorType).toBe('negative_profit');
    });
});

describe('Profitability page uses the same loss rule as the tasks', () => {
    const { calculateProfitabilityIssues } = require('../../../Services/Calculations/ProfitabilityIssuesService.js');
    const row = { asin: 'A1', sales: 500, ads: 100, amzFee: 150, quantity: 10, source: 'economics' };

    it('counts COGS when it is entered', () => {
        const r = calculateProfitabilityIssues([row], { cogsMap: { A1: 30 } });
        expect(r.issues.map(i => i.issueType)).toEqual(['negative_profit']);
        expect(calculateProfitabilityIssues([row], { cogsMap: { A1: 10 } }).issues.map(i => i.issueType)).not.toContain('negative_profit');
    });
});

describe('aged inventory surcharge (planning report)', () => {
    const row = (over) => ({ asin: 'A1', unfulfillable_quantity: '0',
        quantity_to_be_charged_ais_181_210_days: '0', quantity_to_be_charged_ais_211_240_days: '0', quantity_to_be_charged_ais_241_270_days: '0',
        quantity_to_be_charged_ais_271_300_days: '0', quantity_to_be_charged_ais_301_330_days: '0', quantity_to_be_charged_ais_331_365_days: '0',
        quantity_to_be_charged_ais_365_plus_days: '0', ...over });

    it('flags an estimated surcharge over $25, with the fee', () => {
        const { longTermStorageFees } = inventoryPlanningData(row({ quantity_to_be_charged_ais_181_210_days: '12', estimated_ais_total: 30.5 }));
        expect(longTermStorageFees.status).toBe('Error');
        expect(longTermStorageFees.amount).toBe(30.5);
        expect(longTermStorageFees.Message).toBe("12 units have been in Amazon's warehouse long enough to attract an aged inventory surcharge of about $30.50 a month.");
    });

    it('lets a small surcharge through when the estimate is known', () => {
        expect(inventoryPlanningData(row({ quantity_to_be_charged_ais_181_210_days: '2', estimated_ais_total: 4 })).longTermStorageFees.status).toBe('Success');
    });

    it('flags 91-180-day stock that will not sell in time', () => {
        // 100 aged units; 90 sold in 90 days -> 45 sell in 45 days -> 55 left.
        const { longTermStorageFees } = inventoryPlanningData(row({ estimated_ais_total: 0, inv_age_91_to_180_days: '100', units_shipped_t90: '90' }));
        expect(longTermStorageFees.status).toBe('Error');
        expect(longTermStorageFees.agingUnsoldUnits).toBe(55);
        expect(inventoryPlanningData(row({ estimated_ais_total: 0, inv_age_91_to_180_days: '40', units_shipped_t90: '90' })).longTermStorageFees.status).toBe('Success');
    });

    it('keeps the old rule for reports without estimate columns', () => {
        expect(inventoryPlanningData(row({ quantity_to_be_charged_ais_365_plus_days: '1' })).longTermStorageFees.status).toBe('Error');
    });
});

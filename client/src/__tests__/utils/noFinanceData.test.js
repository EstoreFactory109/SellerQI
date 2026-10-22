/**
 * No finance data is "not available" ('—' / Set up), never $0.00 or 0%;
 * a real 0 still shows as 0.
 */
import { describe, it, expect } from 'vitest';
import { hasFinanceDashboardData } from '../../utils/financeDashboardData';
import { buildProfitabilityRow1, formatKpiAmount } from '../../utils/profitabilityKpis';
import { computeTacos, formatPercentOrNA } from '../../utils/ppcKpis';

describe('hasFinanceDashboardData', () => {
  it('is false for totals null (new server)', () => {
    expect(hasFinanceDashboardData(null, { hasFinanceData: false })).toBe(false);
    expect(hasFinanceDashboardData(null, null)).toBe(false);
    expect(hasFinanceDashboardData(undefined, undefined)).toBe(false);
  });

  it('is false for metadata.hasFinanceData false even with a totals object', () => {
    expect(hasFinanceDashboardData({ productSales: 0 }, { hasFinanceData: false, totalDays: 5 })).toBe(false);
  });

  it('is false for zero-filled totals with totalDays 0 (old server)', () => {
    expect(hasFinanceDashboardData({ productSales: 0 }, { totalDays: 0 })).toBe(false);
  });

  it('is true for real rows, including a real $0', () => {
    expect(hasFinanceDashboardData({ productSales: 0 }, { hasFinanceData: true, totalDays: 30 })).toBe(true);
    expect(hasFinanceDashboardData({ productSales: 12 }, { totalDays: 3 })).toBe(true);
    expect(hasFinanceDashboardData({ productSales: 12 }, null)).toBe(true);
  });
});

describe('Profitability KPI row', () => {
  const withData = {
    hasFinanceData: true,
    currency: '$',
    totalSales: 1000,
    totalUnitsSold: 1234,
    totalExpenses: 250.5,
    netProfit: 749.5,
    salesBreakdown: [{ label: 'Organic Sales', amount: 1000 }],
    expenseBreakdown: [{ label: 'Referral Fee', amount: -150 }],
  };

  it("shows '—' and the Set-up state on every card with no finance data", () => {
    const row = buildProfitabilityRow1({ ...withData, hasFinanceData: false });
    expect(row.map((c) => c.label)).toEqual(['Total Sales', 'Total Units Sold', 'Expenses', 'Net Profit']);
    row.forEach((card) => {
      expect(card.value).toBe('—');
      expect(card.noData).toBe(true);
      expect(card.isExpandable).toBeFalsy();
      expect(card.value).not.toMatch(/\$0/);
    });
  });

  it('formats real values as before', () => {
    const row = buildProfitabilityRow1(withData);
    expect(row.map((c) => c.value)).toEqual(['$1000.00', '1,234', '$250.50', '$749.50']);
    expect(row.some((c) => c.noData)).toBe(false);
    expect(row[0].isExpandable).toBe(true);
    expect(row[2].isExpandable).toBe(true);
  });

  it('keeps a real 0 as $0.00', () => {
    const row = buildProfitabilityRow1({ ...withData, totalSales: 0, totalUnitsSold: 0, totalExpenses: 0, netProfit: 0 });
    expect(row.map((c) => c.value)).toEqual(['$0.00', '0', '$0.00', '$0.00']);
  });

  it('formatKpiAmount is null-aware', () => {
    expect(formatKpiAmount(null, '€')).toBe('—');
    expect(formatKpiAmount(NaN)).toBe('—');
    expect(formatKpiAmount(0, '€')).toBe('€0.00');
  });
});

describe('PPC TACoS', () => {
  it("is not available ('—') when total sales are null", () => {
    const tacos = computeTacos({ backendTacos: null, spend: 50, totalSales: null });
    expect(tacos).toBeNull();
    expect(formatPercentOrNA(tacos)).toBe('—');
  });

  it('is not available when total sales are 0 (no ∞)', () => {
    expect(formatPercentOrNA(computeTacos({ backendTacos: null, spend: 50, totalSales: 0 }))).toBe('—');
  });

  it('derives from spend / total sales', () => {
    expect(formatPercentOrNA(computeTacos({ backendTacos: null, spend: 50, totalSales: 1000 }))).toBe('5.00%');
    expect(formatPercentOrNA(computeTacos({ backendTacos: null, spend: 0, totalSales: 1000 }))).toBe('0.00%');
  });

  it("prefers the backend's value, including a real 0", () => {
    expect(computeTacos({ backendTacos: 7.5, spend: 50, totalSales: null })).toBe(7.5);
    expect(formatPercentOrNA(computeTacos({ backendTacos: 0, spend: 0, totalSales: null }))).toBe('0.00%');
    expect(computeTacos({ backendTacos: Infinity, spend: 5, totalSales: null })).toBeNull();
  });
});

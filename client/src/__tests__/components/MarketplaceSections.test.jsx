import { describe, it, expect } from 'vitest';
import {
  formatMoney, formatPct, hintFor, healthStatus, marginStatus, acosStatus, roasStatus,
  needsAttentionFirst, comparisonExportRows, costsNote, usdBreakdown, excludedNote,
} from '../../Components/Dashboard/MarketplaceSections.jsx';

const us = { country: 'US', region: 'NA', currencyCode: 'USD', hint: null, metrics: { totalSales: 1000, healthPct: 100, acos: 25, topFix: { title: 'Fix US', amount: 50 } } };
const uk = { country: 'UK', region: 'EU', currencyCode: 'GBP', hint: { rate: 1.32, asOf: '2026-10-09' }, metrics: { totalSales: 900, healthPct: 50, acos: 40, topFix: null } };

describe('formatting', () => {
  it('uses the marketplace\'s own currency and shows — for missing values', () => {
    expect(formatMoney(1234.5, 'GBP')).toContain('£');
    expect(formatMoney(1234.5, 'USD')).toContain('$');
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatPct(null)).toBe('—');
    expect(formatPct(27)).toBe('27.0%');
  });
  it('treats a real zero as a value, not as missing', () => {
    expect(formatMoney(0, 'USD')).toContain('0');
    expect(formatPct(0)).toBe('0.0%');
  });
});

describe('hintFor', () => {
  it('converts other currencies to the hint currency, and never the hint currency itself', () => {
    expect(hintFor(900, uk)).toBe('≈ $1,188');
    expect(hintFor(1000, us)).toBeNull();
  });
  it('keeps cents on small amounts so a £0.80 click cost is not shown as "≈ $1"', () => {
    expect(hintFor(0.8, uk)).toBe('≈ $1.06');
    expect(hintFor(6, uk)).toBe('≈ $7.92');
    expect(hintFor(75.5, uk)).toBe('≈ $99.66');
    expect(hintFor(76, uk)).toBe('≈ $100');
  });
  it('is absent for zero, missing values, or no rate', () => {
    expect(hintFor(0, uk)).toBeNull();
    expect(hintFor(null, uk)).toBeNull();
    expect(hintFor(900, { ...uk, hint: null })).toBeNull();
  });
});

describe('status thresholds', () => {
  it('health bands', () => {
    expect([100, 80, 79, 50, 49, 30].map(healthStatus)).toEqual(['good', 'good', 'watch', 'watch', 'fix', 'fix']);
    expect(healthStatus(null)).toBeNull();
  });
  it('margin, ACoS and ROAS', () => {
    expect([20, 15, 5, 0, -3].map(marginStatus)).toEqual(['good', 'good', 'watch', 'watch', 'fix']);
    expect([10, 25, 25.1].map(acosStatus)).toEqual(['good', 'good', 'fix']);
    expect([5, 4, 2, 1, 0.5].map(roasStatus)).toEqual(['good', 'good', 'watch', 'watch', 'fix']);
  });
});

describe('needsAttentionFirst', () => {
  it('picks the lowest health score when scores differ', () => {
    expect(needsAttentionFirst([us, uk]).country).toBe('UK');
  });
  it('says nothing when scores tie, are missing, or there is only one marketplace', () => {
    expect(needsAttentionFirst([us, { ...uk, metrics: { healthPct: 100 } }])).toBeNull();
    expect(needsAttentionFirst([us, { ...uk, metrics: {} }])).toBeNull();
    expect(needsAttentionFirst([us])).toBeNull();
  });
});

describe('comparisonExportRows', () => {
  it('has a column per marketplace with its currency; ≈ hints only on other currencies', () => {
    const rows = comparisonExportRows({ marketplaces: [us, uk], ratesAsOf: '2026-10-09' });
    expect(rows[0]).toEqual(['Metric', 'US (USD)', 'UK (GBP)']);
    const sales = rows.find((r) => r[0] === 'Total Sales');
    expect(sales[1]).not.toContain('≈');
    expect(sales[2]).toContain('≈');
    expect(rows.find((r) => r[0] === 'Biggest fix')[2]).toBe('—');
  });
});

describe('costsNote', () => {
  it('says how many products have costs when some are missing', () => {
    expect(costsNote({ grossProfit: 10, productsSold: 166, productsCosted: 0 })).toBe('Product costs entered for 0 of 166 products — profit excludes the rest');
    expect(costsNote({ grossProfit: 10, productsSold: 5, productsCosted: 2 })).toContain('2 of 5');
  });
  it('is silent when every product has a cost, or there is no profit figure', () => {
    expect(costsNote({ grossProfit: 10, productsSold: 5, productsCosted: 5 })).toBeNull();
    expect(costsNote({ grossProfit: null, productsSold: 5, productsCosted: 0 })).toBeNull();
    expect(costsNote({ grossProfit: 10, productsSold: 0, productsCosted: 0 })).toBeNull();
  });
});

describe('USD totals helpers', () => {
  const totals = {
    included: [
      { country: 'US', currencyCode: 'USD', salesLocal: 1000, salesUsd: 1000, profitLocal: 450, profitUsd: 450 },
      { country: 'UK', currencyCode: 'GBP', salesLocal: 500, salesUsd: 660, profitLocal: 135, profitUsd: 178.2 },
    ],
    excluded: [{ country: 'DE', currencyCode: 'EUR', reason: 'fx_unavailable' }, { country: 'MX', currencyCode: 'MXN', reason: 'no_finance_data' }],
    ads: [
      { country: 'US', currencyCode: 'USD', ppcSalesLocal: 1200, ppcSalesUsd: 1200, adSpendLocal: 300, adSpendUsd: 300 },
      { country: 'UK', currencyCode: 'GBP', ppcSalesLocal: 600, ppcSalesUsd: 792, adSpendLocal: 240, adSpendUsd: 316.8 },
    ],
    adsExcluded: [{ country: 'DE', currencyCode: 'EUR', reason: 'fx_unavailable' }],
    totalSales: 1660, grossProfit: 628.2, marginPct: 37.8, ppcSales: 1992, adSpend: 616.8, ratesAsOf: '2026-10-09',
  };

  it('shows each marketplace in its own currency, with the converted amount only on non-USD ones', () => {
    const line = usdBreakdown(totals, 'sales');
    expect(line).toContain('US $1,000.00');
    expect(line).toContain('UK £500.00 (≈ $660.00)');
    expect(line.split(' + ')).toHaveLength(2);
    expect(usdBreakdown(totals, 'profit')).toContain('UK £135.00 (≈ $178.20)');
  });

  it('builds the PPC sales and ad spend lines from the ads rows, which can cover different marketplaces', () => {
    expect(usdBreakdown(totals, 'ppcSales')).toBe('US $1,200.00 + UK £600.00 (≈ $792.00)');
    expect(usdBreakdown(totals, 'adSpend')).toBe('US $300.00 + UK £240.00 (≈ $316.80)');
    expect(usdBreakdown(totals, 'nonsense')).toBe('');
  });

  it('explains what was left out and why', () => {
    expect(excludedNote(totals.excluded)).toBe('DE (no exchange rate), MX (no finance data yet)');
    expect(excludedNote([])).toBe('');
  });

  it('puts the Global performance block first, then the per-marketplace table', () => {
    const rows = comparisonExportRows({ marketplaces: [us, uk], totals, ratesAsOf: '2026-10-09' });
    expect(rows[0]).toEqual(['Global performance (USD)', 'Amount', 'Built from']);
    expect(rows.find((r) => r[0] === 'Total sales')[1]).toContain('1,660');
    expect(rows.find((r) => r[0] === 'Gross profit')[1]).toContain('628.20');
    expect(rows.find((r) => r[0] === 'PPC sales')[1]).toContain('1,992');
    expect(rows.find((r) => r[0] === 'Ad spend')[2]).toContain('UK £240.00');
    expect(rows.find((r) => r[0] === 'Left out of sales & profit')[1]).toContain('DE');
    expect(rows.find((r) => r[0] === 'Left out of ad totals')[1]).toContain('no exchange rate');
    expect(rows.find((r) => r[0] === 'Exchange rate')[1]).toContain('2026-10-09');
    const tableHeader = rows.findIndex((r) => r[0] === 'Metric');
    expect(tableHeader).toBeGreaterThan(0);
    expect(rows[tableHeader]).toEqual(['Metric', 'US (USD)', 'UK (GBP)']);
    expect(rows[tableHeader - 1]).toEqual([]);
  });

  it('works without totals (e.g. none computed) and with no marketplaces', () => {
    expect(comparisonExportRows({ marketplaces: [us, uk] })[0]).toEqual(['Metric', 'US (USD)', 'UK (GBP)']);
    expect(comparisonExportRows({ marketplaces: [], totals: null })[0]).toEqual(['Metric']);
  });

  it('every row survives a CSV round trip with its figures intact (commas, symbols, quotes)', async () => {
    const Papa = (await import('papaparse')).default;
    const rows = comparisonExportRows({ marketplaces: [us, uk], totals, ratesAsOf: '2026-10-09' });
    const parsed = Papa.parse(Papa.unparse(rows, { header: false })).data.filter((r) => r.length > 1 || r[0] !== '');
    const sales = parsed.find((r) => r[0] === 'Total sales');
    expect(sales[1]).toBe('$1,660.00');
    expect(sales[2]).toContain('UK £500.00');
    expect(parsed.find((r) => r[0] === 'Total Sales')[2]).toContain('≈');
  });
});

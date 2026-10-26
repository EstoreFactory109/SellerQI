import { describe, it, expect } from 'vitest';
import { formatDay, tickInterval, shapeChartData, compactUsd, money, SERIES } from '../../Components/Dashboard/GlobalDailyChart.jsx';
import { comparisonExportRows } from '../../Components/Dashboard/MarketplaceSections.jsx';

describe('chart helpers', () => {
  it('formats a plain date without letting the timezone shift the day', () => {
    expect(formatDay('2026-09-14')).toBe('Sep 14');
    expect(formatDay('2026-10-01')).toBe('Oct 1');
    expect(formatDay('')).toBe('');
    expect(formatDay('garbage')).toBe('garbage');
  });

  it('thins date labels only when there are many days', () => {
    expect(tickInterval(7)).toBe(0);
    expect(tickInterval(10)).toBe(0);
    expect(tickInterval(30)).toBe(3);   // every 4th day -> ~8 labels
    expect(tickInterval(90)).toBe(11);
  });

  it('formats axis ticks compactly, including loss days', () => {
    expect(compactUsd(0)).toBe('$0');
    expect(compactUsd(950)).toBe('$950');
    expect(compactUsd(1200)).toBe('$1.2k');
    expect(compactUsd(15400)).toBe('$15k');
    expect(compactUsd(-3400)).toBe('-$3.4k');
    expect(compactUsd(-50)).toBe('-$50');
  });

  it('puts the minus sign before the dollar sign in the tooltip', () => {
    expect(money(1250.5)).toBe('$1,250.50');
    expect(money(-20.6)).toBe('-$20.60');
    expect(money(0)).toBe('$0.00');
    expect(money(null)).toBe('$0.00');
  });

  it('keeps days with anything on them, drops empty ones, and says when nothing is left', () => {
    const { rows, hasData } = shapeChartData([
      { date: '2026-10-01', totalSales: 100, grossProfit: 0, ppcSales: 0, adSpend: 0 },
      { date: '2026-10-02', totalSales: 0, grossProfit: 0, ppcSales: 0, adSpend: 0 },
      { date: '2026-10-03', totalSales: 0, grossProfit: -5, ppcSales: 0, adSpend: 0 },
    ]);
    expect(rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-03']);
    expect(hasData).toBe(true);
    expect(shapeChartData([]).hasData).toBe(false);
    expect(shapeChartData(undefined).hasData).toBe(false);
    expect(shapeChartData([{ date: '2026-10-01', totalSales: 0, grossProfit: 0, ppcSales: 0, adSpend: 0 }]).hasData).toBe(false);
  });

  it('draws revenue as bars and profit/ad spend as lines', () => {
    expect(SERIES.filter((s) => s.kind === 'bar').map((s) => s.key)).toEqual(['totalSales', 'ppcSales']);
    expect(SERIES.filter((s) => s.kind === 'line').map((s) => s.key)).toEqual(['grossProfit', 'adSpend']);
  });
});

describe('daily table in the export', () => {
  it('appends one row per day in USD, after the per-marketplace table', () => {
    const totals = {
      included: [], ads: [], excluded: [], adsExcluded: [],
      daily: [
        { date: '2026-10-01', totalSales: 1000, grossProfit: 300, ppcSales: 400, adSpend: 100 },
        { date: '2026-10-02', totalSales: 1250.5, grossProfit: -20, ppcSales: 300, adSpend: 80 },
      ],
    };
    const rows = comparisonExportRows({ marketplaces: [], totals });
    const head = rows.findIndex((r) => r[0] === 'Daily, all marketplaces (USD)');
    expect(head).toBeGreaterThan(0);
    expect(rows[head]).toEqual(['Daily, all marketplaces (USD)', 'Total sales', 'Gross profit', 'PPC sales', 'Ad spend']);
    expect(rows[head + 1]).toEqual(['2026-10-01', '$1,000.00', '$300.00', '$400.00', '$100.00']);
    expect(rows[head + 2][0]).toBe('2026-10-02');
    expect(rows[head + 2][1]).toBe('$1,250.50');
  });

  it('has no daily table when there are no daily figures', () => {
    expect(comparisonExportRows({ marketplaces: [], totals: { included: [], ads: [], daily: [] } }).some((r) => String(r[0]).startsWith('Daily'))).toBe(false);
  });
});

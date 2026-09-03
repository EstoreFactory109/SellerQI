/**
 * Tests for the ESF client dashboard's pure date/delta logic.
 *
 * The comparison window is the part most likely to drift: it must be the
 * SAME LENGTH as the selected window and end the day before it starts,
 * otherwise every "vs previous" figure on the page is quietly wrong.
 */

const {
  resolveWindows,
  buildTimeseries,
  buildDeltas,
  pctChange,
} = require('../../../Services/Calculations/EsfClientDashboardService.js');

describe('EsfClientDashboardService', () => {
  describe('resolveWindows', () => {
    it('defaults to a 30-day window ending yesterday', () => {
      const { current } = resolveWindows({});
      expect(current.days).toBe(30);

      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      expect(current.endDate).toBe(yesterday);
    });

    it('derives a previous window of equal length ending the day before', () => {
      const { current, previous } = resolveWindows({ startDate: '2026-08-01', endDate: '2026-08-07' });
      expect(current).toEqual({ startDate: '2026-08-01', endDate: '2026-08-07', days: 7 });
      expect(previous).toEqual({ startDate: '2026-07-25', endDate: '2026-07-31', days: 7 });
    });

    it('honours an explicit comparison window', () => {
      const { previous } = resolveWindows({
        startDate: '2026-08-01',
        endDate: '2026-08-07',
        compareStartDate: '2026-07-01',
        compareEndDate: '2026-07-07',
      });
      expect(previous.startDate).toBe('2026-07-01');
      expect(previous.endDate).toBe('2026-07-07');
    });

    it('falls back to the default window when the range is inverted', () => {
      const { current } = resolveWindows({ startDate: '2026-08-31', endDate: '2026-08-01' });
      expect(current.days).toBe(30);
    });

    it('falls back to the default window on a malformed date', () => {
      const { current } = resolveWindows({ startDate: 'not-a-date', endDate: '2026-08-01' });
      expect(current.days).toBe(30);
    });

    it('spans month and year boundaries correctly', () => {
      const { current, previous } = resolveWindows({ startDate: '2027-01-01', endDate: '2027-01-31' });
      expect(current.days).toBe(31);
      expect(previous).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31', days: 31 });
    });
  });

  describe('buildTimeseries', () => {
    const ppc = [{ date: '2026-08-02', sales: 100, spend: 25 }];
    const sales = [{ date: '2026-08-02', totalSales: 500, unitsSold: 10 }];

    it('emits one row per day, filling days with no data', () => {
      const rows = buildTimeseries(ppc, sales, '2026-08-01', '2026-08-03');
      expect(rows.map((r) => r.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
      expect(rows[0]).toMatchObject({ totalSales: 0, ppcSales: 0, adSpend: 0, acos: 0, tacos: 0 });
    });

    it('computes ACOS as spend / PPC sales and TACOS as spend / total sales', () => {
      const [, day] = buildTimeseries(ppc, sales, '2026-08-01', '2026-08-03');
      expect(day.acos).toBe(25); // 25 / 100
      expect(day.tacos).toBe(5); // 25 / 500
    });

    it('never divides by zero', () => {
      const rows = buildTimeseries(
        [{ date: '2026-08-01', sales: 0, spend: 40 }],
        [{ date: '2026-08-01', totalSales: 0 }],
        '2026-08-01',
        '2026-08-01'
      );
      expect(rows[0].acos).toBe(0);
      expect(rows[0].tacos).toBe(0);
    });
  });

  describe('pctChange', () => {
    it('computes a normal percentage change', () => {
      expect(pctChange(120, 100)).toBe(20);
      expect(pctChange(80, 100)).toBe(-20);
    });

    it('returns null when there is no baseline to compare against', () => {
      expect(pctChange(50, 0)).toBeNull();
    });

    it('returns 0 when both periods are zero', () => {
      expect(pctChange(0, 0)).toBe(0);
    });
  });

  describe('buildDeltas', () => {
    const current = { totalSales: 1200, ppcSales: 300, adSpend: 90, unitsSold: 60, acos: 30, tacos: 7.5 };
    const previous = { totalSales: 1000, ppcSales: 250, adSpend: 75, unitsSold: 50, acos: 25, tacos: 7.5 };

    it('reports money and unit metrics as percentage change', () => {
      const d = buildDeltas(current, previous);
      expect(d.totalSales).toEqual({ absolute: 200, percent: 20 });
      expect(d.unitsSold).toEqual({ absolute: 10, percent: 20 });
    });

    it('reports ACOS and TACOS as percentage POINTS, not percent change', () => {
      const d = buildDeltas(current, previous);
      expect(d.acos).toEqual({ points: 5 });
      expect(d.tacos).toEqual({ points: 0 });
    });
  });
});

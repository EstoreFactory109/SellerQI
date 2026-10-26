import { describe, it, expect } from 'vitest';
import {
  openTasksOf,
  summarizeUrgency,
  packageValue,
  paybackDays,
  formatPaybackDays,
  recommendPackageId,
  daysLeftInMonth,
  lossOverSeconds,
  ACCOUNT_RISK_MIN_WEIGHT,
} from '../../utils/taskUrgency.js';

const task = (over = {}) => ({
  taskId: over.taskId || Math.random().toString(36).slice(2),
  errorCategory: 'sponsoredAds',
  errorType: 'wasted_spend_keyword',
  status: 'pending',
  amount: 0,
  ...over,
});

describe('openTasksOf', () => {
  it('drops tasks the seller completed and tasks the system resolved', () => {
    const tasks = [
      task({ taskId: 'open' }),
      task({ taskId: 'done' }),
      task({ taskId: 'gone', status: 'resolved' }),
    ];
    expect(openTasksOf(tasks, new Set(['done'])).map(t => t.taskId)).toEqual(['open']);
  });
});

describe('summarizeUrgency', () => {
  it('sums open amounts into a monthly figure and a daily cost', () => {
    const u = summarizeUrgency([task({ amount: 200 }), task({ amount: 100 })]);
    expect(u.monthlyRecoverable).toBe(300);
    expect(u.dailyCost).toBe(10);
    expect(u.openCount).toBe(2);
  });

  // Capital is stock value, not a monthly loss: adding it would overstate the leak.
  it('keeps capital out of the monthly and daily figures', () => {
    const u = summarizeUrgency([
      task({ amount: 30 }),
      task({ errorCategory: 'inventory', errorType: 'stranded_inventory', capitalAmount: 900 }),
    ]);
    expect(u.monthlyRecoverable).toBe(30);
    expect(u.dailyCost).toBe(1);
    expect(u.capitalTiedUp).toBe(900);
  });

  it('reports how much of the figure is estimated', () => {
    const u = summarizeUrgency([task({ amount: 75, amountIsEstimated: true }), task({ amount: 25 })]);
    expect(u.anyEstimated).toBe(true);
    expect(u.estimatedShare).toBeCloseTo(0.75);
  });

  it('ignores negative and missing amounts', () => {
    const u = summarizeUrgency([task({ amount: -50 }), task({ amount: undefined }), task({ amount: 'x' })]);
    expect(u.monthlyRecoverable).toBe(0);
    expect(u.estimatedShare).toBe(0);
  });

  it('names the biggest leak by issue type, using the server group title', () => {
    const u = summarizeUrgency(
      [
        task({ amount: 40 }),
        task({ amount: 40 }),
        task({ errorCategory: 'profitability', errorType: 'negative_profit', amount: 70 }),
      ],
      [{ id: 'sponsoredAds:wasted_spend_keyword', title: 'Keywords spending money with zero sales' }]
    );
    expect(u.biggestLeak).toMatchObject({
      key: 'sponsoredAds:wasted_spend_keyword',
      amount: 80,
      count: 2,
      title: 'Keywords spending money with zero sales',
    });
    expect(u.leaks.map(l => l.key)).toEqual(['sponsoredAds:wasted_spend_keyword', 'profitability:negative_profit']);
    expect(u.leaks[0].share).toBeCloseTo(80 / 150);
  });

  it('has no biggest leak when nothing carries money', () => {
    expect(summarizeUrgency([task({ errorCategory: 'ranking', errorType: 'titleresult_char_limit' })]).biggestLeak).toBeNull();
  });

  it('flags open account issues at or above the risk weight, most severe first', () => {
    const u = summarizeUrgency([
      task({ errorCategory: 'account', errorType: 'lateShipmentRateStatus', impactWeight: ACCOUNT_RISK_MIN_WEIGHT }),
      task({ errorCategory: 'account', errorType: 'accountStatus', impactWeight: 100 }),
      task({ errorCategory: 'account', errorType: 'responseUnder24HoursCount', impactWeight: 28 }),
    ]);
    expect(u.accountRisks.map(r => r.label)).toEqual(['Account Status', 'Late Shipment Rate']);
  });
});

describe('packageValue', () => {
  const open = [task({ amount: 5 }), task({ amount: 100 }), task({ amount: 40 }), task({ amount: 0 })];

  it('counts the highest-value open tasks the package could cover', () => {
    expect(packageValue(open, 2)).toEqual({ monthlyValue: 140, covered: 2, unpriced: 0 });
  });

  it('caps at the number of open tasks and counts the unpriced ones', () => {
    expect(packageValue(open, 30)).toEqual({ monthlyValue: 145, covered: 4, unpriced: 1 });
  });
});

describe('paybackDays', () => {
  it('is price over daily value', () => {
    expect(paybackDays(299, 900)).toBeCloseTo(9.97);
  });

  // No recoverable money means no payback claim at all.
  it('is null when there is nothing to recover', () => {
    expect(paybackDays(299, 0)).toBeNull();
  });

  it('formats under a day, one day, and rounds up otherwise', () => {
    expect(formatPaybackDays(0.4)).toBe('< 1 day');
    expect(formatPaybackDays(1)).toBe('1 day');
    expect(formatPaybackDays(9.1)).toBe('10 days');
    expect(formatPaybackDays(null)).toBeNull();
  });
});

describe('recommendPackageId', () => {
  it.each([
    [1, 'trial'], [2, 'trial'],
    [3, 'standard'], [30, 'standard'],
    [31, 'accelerated'], [500, 'accelerated'],
  ])('%i open tasks -> %s', (n, id) => {
    expect(recommendPackageId(n)).toBe(id);
  });
});

describe('projections', () => {
  it('annualises the monthly figure', () => {
    expect(summarizeUrgency([task({ amount: 100 })]).yearlyRecoverable).toBe(1200);
  });

  it('counts the days left in the month, including today', () => {
    expect(daysLeftInMonth(new Date(2026, 9, 14))).toBe(18);
    expect(daysLeftInMonth(new Date(2026, 9, 31))).toBe(1);
    expect(daysLeftInMonth(new Date(2028, 1, 1))).toBe(29); // leap February
  });

  it('spreads the monthly figure evenly over time for the live counter', () => {
    expect(lossOverSeconds(2592, 86400)).toBeCloseTo(86.4); // one day of $2,592/mo
    expect(lossOverSeconds(2592, -5)).toBe(0);
  });
});

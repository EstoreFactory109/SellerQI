/**
 * taskUrgency — the figures the Tasks page uses to show what leaving tasks open
 * costs the seller. Pure: no React, no store, so every claim the page makes can be
 * pinned by a test.
 *
 * What the numbers honestly mean (see RecoverableAmountUtils on the server):
 *  - `amount` is recoverable profit measured over the last ~30 days of data
 *    (ads spend, profitability), or a 30-day extrapolation where flagged
 *    `amountIsEstimated` (Buy Box). Summing it gives a fair "per month" figure.
 *  - `capitalAmount` is the value of stock stuck in FBA, a one-off amount. It is
 *    never added to the monthly figure and never expressed per day.
 *  - Account-health tasks carry no amount; their urgency is risk, via impactWeight.
 */

import { groupKeyForTask } from './taskBuckets.js';

export const DAYS_PER_MONTH = 30;

// Account issues at or above this weight are a threat to the selling account
// itself (status, policy, A-to-z, ODR, late shipment, cancellation); below it they
// are housekeeping. Weights: server TaskPrioritizationService.IMPACT_WEIGHT.
export const ACCOUNT_RISK_MIN_WEIGHT = 68;

// Seller-facing names for account errorTypes, matching the server's task text
// (CreateTasksService.generateAccountTasks).
export const ACCOUNT_RISK_LABELS = {
  accountStatus: 'Account Status',
  PolicyViolations: 'Policy Violations',
  validTrackingRateStatus: 'Valid Tracking Rate',
  orderWithDefectsStatus: 'Order Defect Rate',
  lateShipmentRateStatus: 'Late Shipment Rate',
  CancellationRate: 'Cancellation Rate',
  onTimeDeliveryRateStatus: 'On-Time Delivery Rate',
  negativeFeedbacks: 'Negative Feedback',
  NCX: 'Negative Customer Experience',
  a_z_claims: 'A-to-Z Claims',
  responseUnder24HoursCount: 'Response Time',
  // tasks-logics.xlsx wave 1 (server kpi/Wave1Detectors.detectAhrEarlyWarning)
  ahr_early_warning: 'Falling Account Health Rating',
};

// A metric Amazon keeps flipping is stored as '<key>_unstable' (same task, lower
// priority): same name, marked as such, never the raw key.
export const accountRiskLabel = (errorType) => {
  const type = String(errorType || '');
  const base = type.endsWith('_unstable') ? type.slice(0, -'_unstable'.length) : type;
  const label = ACCOUNT_RISK_LABELS[base];
  if (!label) return type;
  return base === type ? label : `${label} (unstable)`;
};

const money = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const cents = (n) => Math.round(n * 100) / 100;

/**
 * Tasks the seller still has to do.
 * @param {Array} tasks
 * @param {Set<string>} completedSet - ids done by the seller or resolved by the system
 */
export function openTasksOf(tasks = [], completedSet = new Set()) {
  return tasks.filter((t) => t && !completedSet.has(t.taskId) && t.status !== 'resolved');
}

/**
 * @param {Array} openTasks
 * @param {Array} [serverGroups] - state.tasks.groups, used only for titles
 */
export function summarizeUrgency(openTasks = [], serverGroups = []) {
  let monthly = 0;
  let estimated = 0;
  let capital = 0;
  const byGroup = new Map();
  const risks = [];

  for (const t of openTasks) {
    const amount = Math.max(0, money(t.amount));
    monthly += amount;
    if (t.amountIsEstimated) estimated += amount;
    capital += Math.max(0, money(t.capitalAmount));

    if (amount > 0) {
      const key = groupKeyForTask(t);
      const g = byGroup.get(key) || { amount: 0, count: 0 };
      g.amount += amount;
      g.count += 1;
      byGroup.set(key, g);
    }

    if (t.errorCategory === 'account' && money(t.impactWeight) >= ACCOUNT_RISK_MIN_WEIGHT) {
      risks.push({
        taskId: t.taskId,
        errorType: t.errorType,
        label: accountRiskLabel(t.errorType),
        impactWeight: money(t.impactWeight),
      });
    }
  }

  // Every money-carrying issue type, biggest first, titled from the server groups
  // (the same wording as the Dashboard's "Top things to fix").
  const titles = new Map((serverGroups || []).filter(Boolean).map((g) => [g.id, g.title]));
  const leaks = [...byGroup.entries()]
    .map(([key, g]) => ({
      key,
      amount: cents(g.amount),
      count: g.count,
      share: monthly > 0 ? g.amount / monthly : 0,
      title: titles.get(key) || null,
    }))
    .sort((a, b) => b.amount - a.amount);
  const biggestLeak = leaks[0] || null;

  risks.sort((a, b) => b.impactWeight - a.impactWeight);

  return {
    openCount: openTasks.length,
    monthlyRecoverable: cents(monthly),
    estimatedShare: monthly > 0 ? estimated / monthly : 0,
    anyEstimated: estimated > 0,
    dailyCost: cents(monthly / DAYS_PER_MONTH),
    capitalTiedUp: cents(capital),
    yearlyRecoverable: cents(monthly * 12),
    hourlyCost: monthly / DAYS_PER_MONTH / 24,
    accountRisks: risks,
    leaks,
    biggestLeak,
  };
}

/**
 * What a package of `n` tasks could cover, if it took the highest-value open tasks.
 * @returns {{ monthlyValue: number, covered: number, unpriced: number }}
 */
export function packageValue(openTasks = [], n = 0) {
  const top = [...openTasks]
    .sort((a, b) => money(b.amount) - money(a.amount))
    .slice(0, Math.max(0, n));
  const monthlyValue = top.reduce((sum, t) => sum + Math.max(0, money(t.amount)), 0);
  return {
    monthlyValue: cents(monthlyValue),
    covered: top.length,
    unpriced: top.filter((t) => !(money(t.amount) > 0)).length,
  };
}

/**
 * Days of recovered profit needed to cover the price. null when there is nothing
 * to recover, so the page never claims a payback it cannot support.
 */
export function paybackDays(price, monthlyValue) {
  const perDay = money(monthlyValue) / DAYS_PER_MONTH;
  if (!(perDay > 0)) return null;
  return money(price) / perDay;
}

/** "< 1 day", "1 day", "5 days". Rounds up: never understate the wait. */
export function formatPaybackDays(days) {
  if (days === null || days === undefined) return null;
  if (days < 1) return '< 1 day';
  const d = Math.ceil(days);
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** Smallest package that covers the open tasks; the largest when none does. */
export function recommendPackageId(openCount) {
  if (openCount <= 2) return 'trial';
  if (openCount <= 30) return 'standard';
  return 'accelerated';
}

/** Days left in the current month, counting today. */
export function daysLeftInMonth(now = new Date()) {
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return last - now.getDate() + 1;
}

/**
 * Money lost over `seconds` at the account's current rate. Drives the live
 * "lost while you've been on this page" counter; it is the measured monthly figure
 * spread evenly over time, nothing more.
 */
export function lossOverSeconds(monthlyRecoverable, seconds) {
  return (money(monthlyRecoverable) / DAYS_PER_MONTH / 86400) * Math.max(0, money(seconds));
}

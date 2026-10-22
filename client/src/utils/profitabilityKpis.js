import { NOT_AVAILABLE, isMissingNumber } from './currencyUtils.js';

/**
 * Amount as the Profitability KPI cards show it: `${currency}1234.56`, or '—'
 * when there is no number (no finance data). A real 0 stays `${currency}0.00`.
 */
export const formatKpiAmount = (value, currency = '$') =>
  isMissingNumber(value) ? NOT_AVAILABLE : `${currency}${Number(value).toFixed(2)}`;

/**
 * First row of Profitability KPI cards (Total Sales, Units, Expenses, Net Profit).
 *
 * With no finance data every card shows '—' and is marked `noData` (the card
 * then shows the "Set up" state) — never $0.00, and no breakdown to expand.
 */
export function buildProfitabilityRow1({
  hasFinanceData,
  currency = '$',
  totalSales,
  totalUnitsSold,
  totalExpenses,
  netProfit,
  salesBreakdown = [],
  expenseBreakdown = [],
  productsMissingCogs = 0,
  watchColor = null,
}) {
  if (!hasFinanceData) {
    return [
      { label: 'Total Sales', value: NOT_AVAILABLE, icon: 'dollar-sign', noData: true },
      { label: 'Total Units Sold', value: NOT_AVAILABLE, icon: 'list', noData: true },
      { label: 'Expenses', value: NOT_AVAILABLE, icon: 'trending-down', noData: true },
      { label: 'Net Profit', value: NOT_AVAILABLE, icon: 'dollar-sign', noData: true },
    ];
  }

  return [
    {
      label: 'Total Sales',
      value: formatKpiAmount(totalSales, currency),
      icon: 'dollar-sign',
      breakdown: salesBreakdown,
      isExpandable: true,
    },
    {
      label: 'Total Units Sold',
      value: isMissingNumber(totalUnitsSold) ? NOT_AVAILABLE : Number(totalUnitsSold).toLocaleString(),
      icon: 'list',
    },
    {
      label: 'Expenses',
      value: formatKpiAmount(totalExpenses, currency),
      icon: 'trending-down',
      breakdown: expenseBreakdown,
      isExpandable: expenseBreakdown.length > 0,
      caption: 'Fees, ads, refunds',
    },
    {
      label: 'Net Profit',
      value: formatKpiAmount(netProfit, currency),
      icon: 'dollar-sign',
      caption: productsMissingCogs > 0 ? 'Partial — costs missing' : null,
      tintColor: productsMissingCogs > 0 ? watchColor : null,
    },
  ];
}
